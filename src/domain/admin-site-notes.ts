// Operator revision notes ("chat") + the ONE Generate Revision action
// (operator GO 2026-09-12, client intake layer).
//
// Deliberately NOT an AI chat agent: notes are persisted operator instructions
// displayed chronologically beside build/workflow events. Notes never start a
// Build individually — the explicit Generate Revision action combines the
// selected pending notes into ONE bounded requestNote (plus optional
// structured Business Fact changes) and creates exactly ONE Revision Request
// through the EXISTING revision domain, preserving Reference and Build Mode.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { createRevisionBuild, FactPatchSchema, type FactPatch } from "./revision";
import { Value } from "@sinclair/typebox/value";

export const MAX_COMBINED_REQUEST_NOTE_CHARS = 4500;

export interface SiteNote {
  id: string;
  siteId: string;
  note: string;
  status: "PENDING" | "INCLUDED";
  includedInRevisionRequestId: string | null;
  createdAt: string;
}

export class AdminRevisionError extends Error {
  readonly code: "SITE_NOT_FOUND" | "NO_PENDING_NOTES" | "NOTE_NOT_FOUND" | "REVISION_INVALID" | "BUILD_NOT_FOUND";

  constructor(code: AdminRevisionError["code"], message: string) {
    super(message);
    this.name = "AdminRevisionError";
    this.code = code;
  }
}

export async function addSiteNote(env: Env, siteId: string, note: string): Promise<SiteNote> {
  const trimmed = note.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) {
    throw new AdminRevisionError("REVISION_INVALID", "Note must be 1-2000 characters");
  }
  const site = await env.DB.prepare("SELECT id FROM site_identities WHERE id = ?").bind(siteId).first<{ id: string }>();
  if (!site) throw new AdminRevisionError("SITE_NOT_FOUND", `Site ${siteId} does not exist`);
  const id = generateId();
  await env.DB.prepare(
    "INSERT INTO admin_site_notes (id, site_id, note, status, created_at) VALUES (?, ?, ?, 'PENDING', ?)"
  )
    .bind(id, siteId, trimmed, nowIso())
    .run();
  return {
    id,
    siteId,
    note: trimmed,
    status: "PENDING",
    includedInRevisionRequestId: null,
    createdAt: nowIso(),
  };
}

export async function listSiteNotes(env: Env, siteId: string): Promise<SiteNote[]> {
  const rows = await env.DB.prepare(
    "SELECT id, site_id, note, status, included_in_revision_request_id, created_at FROM admin_site_notes WHERE site_id = ? ORDER BY created_at, id"
  )
    .bind(siteId)
    .all<{
      id: string;
      site_id: string;
      note: string;
      status: "PENDING" | "INCLUDED";
      included_in_revision_request_id: string | null;
      created_at: string;
    }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    siteId: row.site_id,
    note: row.note,
    status: row.status,
    includedInRevisionRequestId: row.included_in_revision_request_id,
    createdAt: row.created_at,
  }));
}

export interface GenerateRevisionInput {
  siteId: string;
  /** Pending note ids to combine. Defaults to ALL pending notes. */
  noteIds?: string[];
  /** Structured Business Fact changes (whole-field; validated by the revision domain). */
  factPatch?: unknown;
  startsWorkflow: (siteGenerationId: string, buildId: string) => Promise<string>;
}

export interface GenerateRevisionResult {
  revisionRequestId: string;
  buildId: string;
  workflowInstanceId: string;
  combinedNote: string;
  factUpdateCount: number;
  includedNoteIds: string[];
}

/**
 * Combines pending notes into ONE bounded Revision Request and starts the new
 * Build on the existing pipeline. Facts come ONLY from the structured patch —
 * free-text notes are human intent for the Builder, never a factual authority.
 */
export async function generateRevisionFromNotes(env: Env, input: GenerateRevisionInput): Promise<GenerateRevisionResult> {
  const site = await env.DB.prepare("SELECT id FROM site_identities WHERE id = ?").bind(input.siteId).first<{ id: string }>();
  if (!site) throw new AdminRevisionError("SITE_NOT_FOUND", `Site ${input.siteId} does not exist`);

  const pending = await listSiteNotes(env, input.siteId);
  const selected = input.noteIds
    ? pending.filter((note) => input.noteIds!.includes(note.id))
    : pending.filter((note) => note.status === "PENDING");
  if (selected.length === 0) {
    throw new AdminRevisionError("NO_PENDING_NOTES", "No pending revision notes selected — nothing to revise");
  }
  for (const note of selected) {
    if (note.status !== "PENDING") {
      throw new AdminRevisionError("NOTE_NOT_FOUND", `Note ${note.id} is not pending`);
    }
  }

  const combinedNote = selected.map((note) => `- ${note.note}`).join("\n");
  if (combinedNote.length > MAX_COMBINED_REQUEST_NOTE_CHARS) {
    throw new AdminRevisionError(
      "REVISION_INVALID",
      `Combined revision note exceeds ${MAX_COMBINED_REQUEST_NOTE_CHARS} characters — split the work across revisions`
    );
  }

  let factPatch: FactPatch | undefined;
  if (input.factPatch !== undefined) {
    if (typeof input.factPatch !== "object" || input.factPatch === null || !Value.Check(FactPatchSchema, input.factPatch)) {
      throw new AdminRevisionError("REVISION_INVALID", "factPatch failed schema validation");
    }
    factPatch = input.factPatch as FactPatch;
  }

  // The lineage head: latest Site Generation (highest sequence) and its newest Build.
  const generation = await env.DB.prepare(
    "SELECT id FROM site_generations WHERE site_id = ? ORDER BY sequence_number DESC LIMIT 1"
  )
    .bind(input.siteId)
    .first<{ id: string }>();
  if (!generation) throw new AdminRevisionError("SITE_NOT_FOUND", `Site ${input.siteId} has no Site Generation`);
  const headBuild = await env.DB.prepare(
    "SELECT id FROM builds WHERE site_generation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1"
  )
    .bind(generation.id)
    .first<{ id: string }>();
  if (!headBuild) throw new AdminRevisionError("BUILD_NOT_FOUND", `Site Generation ${generation.id} has no Build`);

  const created = await createRevisionBuild(env, {
    parentBuildId: headBuild.id,
    payload: {
      ...(factPatch ? { changes: { facts: factPatch } } : {}),
      requestNote: combinedNote,
    },
  });

  const workflowInstanceId = await input.startsWorkflow(generation.id, created.buildId);

  for (const note of selected) {
    await env.DB.prepare(
      `UPDATE admin_site_notes SET status = 'INCLUDED', included_in_revision_request_id = ? WHERE id = ?`
    )
      .bind(created.revisionRequestId, note.id)
      .run();
  }

  return {
    revisionRequestId: created.revisionRequestId,
    buildId: created.buildId,
    workflowInstanceId,
    combinedNote,
    factUpdateCount: created.factUpdateCount,
    includedNoteIds: selected.map((note) => note.id),
  };
}
