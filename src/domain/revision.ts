// V2 Revision Request + Fact Update lifecycle (issue #5, PRD 2.3).
//
// A Revision Request is a human-requested delta to an existing Site that
// preserves its Reference and Build Mode and starts a NEW Build derived from
// a parent Build. It may carry Fact Updates that supersede individual
// Business Facts for the new Build lineage; the historical Onboarding
// Submission and every earlier Build stay immutable. Changing Reference or
// Build Mode is rejected here and requires a new Site Generation.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import {
  BusinessFactsSchema,
  normalizeBusinessFacts,
  type BusinessFacts,
} from "./lifecycle-schema";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { BuildRow, OnboardingSubmissionRow } from "./lifecycle";

export type RevisionErrorCode =
  | "BUILD_NOT_FOUND"
  | "GENERATION_NOT_FOUND"
  | "REVISION_INVALID"
  | "DESIGN_ORIGIN_IMMUTABLE"
  | "FACT_UPDATE_INVALID"
  | "ORIGINAL_DESIGN_LOCKED";

export class RevisionError extends Error {
  readonly code: RevisionErrorCode;

  constructor(code: RevisionErrorCode, message: string) {
    super(message);
    this.name = "RevisionError";
    this.code = code;
  }
}

// ── Fact patch shape ────────────────────────────────────────────────────────

const FACT_SINGLE_KEYS = [
  "businessName",
  "contactEmail",
  "businessType",
  "businessDescription",
  "idealClientProfile",
  "addressLine1",
  "city",
  "country",
  "phoneNumber",
  "whatsappNumber",
  "logoUrl",
  "extraInformation",
] as const;

const SOCIAL_KEYS = ["facebook", "instagram", "twitter", "linkedin", "other"] as const;

type FactSingleKey = (typeof FACT_SINGLE_KEYS)[number];
type SocialKey = (typeof SOCIAL_KEYS)[number];

const optionalNullableString = (maxLength: number) =>
  Type.Union([Type.String({ minLength: 1, maxLength }), Type.Null()]);

export const FactPatchSchema = Type.Object(
  {
    businessName: Type.Optional(optionalNullableString(200)),
    contactEmail: Type.Optional(
      Type.Union([
        Type.String({ pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", maxLength: 320 }),
        Type.Null(),
      ])
    ),
    businessType: Type.Optional(optionalNullableString(200)),
    businessDescription: Type.Optional(optionalNullableString(5000)),
    idealClientProfile: Type.Optional(optionalNullableString(2000)),
    addressLine1: Type.Optional(optionalNullableString(300)),
    city: Type.Optional(optionalNullableString(120)),
    country: Type.Optional(optionalNullableString(120)),
    phoneNumber: Type.Optional(optionalNullableString(60)),
    whatsappNumber: Type.Optional(optionalNullableString(60)),
    logoUrl: Type.Optional(optionalNullableString(2048)),
    extraInformation: Type.Optional(optionalNullableString(5000)),
    socials: Type.Optional(
      Type.Object(
        {
          facebook: Type.Optional(optionalNullableString(2048)),
          instagram: Type.Optional(optionalNullableString(2048)),
          twitter: Type.Optional(optionalNullableString(2048)),
          linkedin: Type.Optional(optionalNullableString(2048)),
          other: Type.Optional(optionalNullableString(2048)),
        },
        { additionalProperties: false }
      )
    ),
  },
  { additionalProperties: false }
);
export type FactPatch = Static<typeof FactPatchSchema>;

export interface RevisionRequestPayload {
  changes?: { facts?: FactPatch };
  requestNote?: string;
}

const RevisionRequestEnvelopeSchema = Type.Object(
  {
    changes: Type.Optional(
      Type.Object({ facts: Type.Optional(FactPatchSchema) }, { additionalProperties: false })
    ),
    requestNote: Type.Optional(Type.String({ minLength: 1, maxLength: 5000 })),
  },
  { additionalProperties: false }
);

// Design-origin fields can never travel through a Revision Request: changing
// Reference or Build Mode starts a new Site Generation instead (CONTEXT.md).
const DESIGN_ORIGIN_KEYS = ["buildMode", "reference", "build_mode", "screenshotR2Key", "url"];

function assertNoDesignOriginChange(container: unknown, path: string): void {
  if (typeof container !== "object" || container === null) return;
  for (const [key, value] of Object.entries(container)) {
    if (DESIGN_ORIGIN_KEYS.includes(key)) {
      throw new RevisionError(
        "DESIGN_ORIGIN_IMMUTABLE",
        `Revision Requests cannot change '${path}${key}': changing Reference or Build Mode requires a new Site Generation`
      );
    }
    assertNoDesignOriginChange(value, `${path}${key}.`);
  }
}

function validateFactPatch(patch: unknown): FactPatch {
  if (typeof patch !== "object" || patch === null) {
    throw new RevisionError("REVISION_INVALID", "changes.facts must be an object");
  }
  assertNoDesignOriginChange(patch, "changes.");
  if (!Value.Check(FactPatchSchema, patch)) {
    const issues: string[] = [];
    for (const error of Value.Errors(FactPatchSchema, patch)) {
      issues.push(`${error.path}: ${error.message}`);
      if (issues.length >= 5) break;
    }
    throw new RevisionError("REVISION_INVALID", `Fact patch rejected: ${issues.join("; ")}`);
  }
  return patch as FactPatch;
}

// ── Fact Update application ─────────────────────────────────────────────────

function trimPatchValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Applies one field-level Fact Update onto a facts object. Field paths are
// top-level Business Facts keys or 'socials.<key>'; a null value removes the
// fact for this lineage.
function applyFactUpdate(facts: BusinessFacts, field: string, value: unknown): void {
  if (field.startsWith("socials.")) {
    const socialKey = field.slice("socials.".length) as SocialKey;
    if (!SOCIAL_KEYS.includes(socialKey)) return;
    const socials = { ...(facts.socials ?? {}) };
    if (value === null) delete socials[socialKey];
    else socials[socialKey] = String(value);
    if (Object.keys(socials).length > 0) facts.socials = socials;
    else delete facts.socials;
    return;
  }
  if (!(FACT_SINGLE_KEYS as readonly string[]).includes(field)) return;
  if (value === null) delete (facts as Record<string, unknown>)[field];
  else (facts as Record<string, unknown>)[field] = value;
}

function diffFactsToFactsUpdates(base: BusinessFacts, next: BusinessFacts): Array<{ field: string; value: unknown }> {
  const updates: Array<{ field: string; value: unknown }> = [];
  for (const key of FACT_SINGLE_KEYS) {
    const before = (base as Record<string, unknown>)[key];
    const after = (next as Record<string, unknown>)[key];
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
      updates.push({ field: key, value: after ?? null });
    }
  }
  for (const key of SOCIAL_KEYS) {
    const before = base.socials?.[key] ?? null;
    const after = next.socials?.[key] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      updates.push({ field: `socials.${key}`, value: after });
    }
  }
  return updates;
}

// ── Effective facts for a Build lineage ─────────────────────────────────────

export interface EffectiveFactsResult {
  facts: BusinessFacts;
  /** Builds in lineage order (initial first) contributing Fact Updates. */
  lineage: Array<{ buildId: string; kind: BuildRow["kind"]; factUpdateCount: number }>;
}

// Effective Business Facts for a Build = the governing Onboarding Submission's
// frozen fact snapshot plus every Fact Update carried by the Build chain from
// the initial Build down to this Build, applied in lineage order.
export async function getEffectiveBusinessFacts(
  env: Env,
  buildId: string
): Promise<EffectiveFactsResult> {
  // Resolve the chain initial -> ... -> target.
  const chain: BuildRow[] = [];
  let cursor: BuildRow | null = null;
  let currentId: string | null = buildId;
  const seen = new Set<string>();
  while (currentId) {
    if (seen.has(currentId)) {
      throw new RevisionError("REVISION_INVALID", `Build parent chain contains a cycle at ${currentId}`);
    }
    seen.add(currentId);
    cursor = await env.DB.prepare("SELECT * FROM builds WHERE id = ?").bind(currentId).first<BuildRow>();
    if (!cursor) {
      throw new RevisionError("BUILD_NOT_FOUND", `Build ${currentId} does not exist`);
    }
    chain.unshift(cursor);
    currentId = cursor.parent_build_id;
  }

  const generationId = chain[0].site_generation_id;
  const submission = await env.DB.prepare(
    "SELECT * FROM onboarding_submissions WHERE id = (SELECT onboarding_submission_id FROM site_generations WHERE id = ?)"
  )
    .bind(generationId)
    .first<OnboardingSubmissionRow>();
  if (!submission) {
    throw new RevisionError("GENERATION_NOT_FOUND", `Site Generation ${generationId} has no Onboarding Submission`);
  }

  const facts = JSON.parse(submission.fact_snapshot_json) as BusinessFacts;
  const lineage: EffectiveFactsResult["lineage"] = [];

  for (const build of chain) {
    const updates = await env.DB.prepare(
      "SELECT field, value_json FROM fact_updates WHERE build_id = ? ORDER BY created_at, id"
    )
      .bind(build.id)
      .all<{ field: string; value_json: string }>();
    for (const row of updates.results ?? []) {
      applyFactUpdate(facts, row.field, JSON.parse(row.value_json));
    }
    lineage.push({ buildId: build.id, kind: build.kind, factUpdateCount: (updates.results ?? []).length });
  }

  return { facts, lineage };
}

// ── Revision Request -> new Build ───────────────────────────────────────────

export interface CreateRevisionBuildInput {
  parentBuildId: string;
  payload: unknown;
}

export interface RevisionBuildCreated {
  revisionRequestId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  factUpdateCount: number;
  effectiveFacts: BusinessFacts;
}

export async function createRevisionBuild(
  env: Env,
  input: CreateRevisionBuildInput
): Promise<RevisionBuildCreated> {
  const parent = await env.DB.prepare("SELECT * FROM builds WHERE id = ?")
    .bind(input.parentBuildId)
    .first<BuildRow>();
  if (!parent) {
    throw new RevisionError("BUILD_NOT_FOUND", `Build ${input.parentBuildId} does not exist`);
  }

  // The ORIGINAL_DESIGN proof gate binds every way a Build can START, not
  // only the initial path: while the gate is shut, no new ORIGINAL_DESIGN
  // Build may begin — including via Revision Request (QA-F1).
  if (parent.site_generation_id) {
    const generationMode = await env.DB.prepare(
      "SELECT build_mode FROM site_generations WHERE id = ?"
    )
      .bind(parent.site_generation_id)
      .first<{ build_mode: "REFERENCE_BOUND" | "ORIGINAL_DESIGN" }>();
    if (generationMode?.build_mode === "ORIGINAL_DESIGN") {
      const { assertOriginalDesignUnlocked } = await import("./proof-gate");
      try {
        await assertOriginalDesignUnlocked(env);
      } catch (error) {
        throw new RevisionError("ORIGINAL_DESIGN_LOCKED", (error as Error).message);
      }
    }
  }

  if (typeof input.payload !== "object" || input.payload === null) {
    throw new RevisionError("REVISION_INVALID", "Revision Request payload must be an object");
  }
  assertNoDesignOriginChange(input.payload, "");
  if (!Value.Check(RevisionRequestEnvelopeSchema, input.payload)) {
    const issues: string[] = [];
    for (const error of Value.Errors(RevisionRequestEnvelopeSchema, input.payload)) {
      issues.push(`${error.path}: ${error.message}`);
      if (issues.length >= 5) break;
    }
    throw new RevisionError("REVISION_INVALID", `Revision Request rejected: ${issues.join("; ")}`);
  }
  const request = input.payload as RevisionRequestPayload;

  // Compute the merged fact state for the new lineage and verify it is still
  // a valid Business Facts snapshot.
  const parentFactsResult = await getEffectiveBusinessFacts(env, parent.id);
  const merged: BusinessFacts = JSON.parse(JSON.stringify(parentFactsResult.facts));
  const patch = request.changes?.facts ? validateFactPatch(request.changes.facts) : undefined;
  if (patch) {
    for (const key of FACT_SINGLE_KEYS) {
      const raw = (patch as Record<string, unknown>)[key];
      if (raw === undefined) continue;
      const value = typeof raw === "string" ? trimPatchValue(raw) : null;
      if (value === null) delete (merged as Record<string, unknown>)[key];
      else (merged as Record<string, unknown>)[key] = value;
    }
    if (patch.socials) {
      const socials = { ...(merged.socials ?? {}) };
      for (const key of SOCIAL_KEYS) {
        const raw = (patch.socials as Record<string, unknown>)[key];
        if (raw === undefined) continue;
        const value = typeof raw === "string" ? trimPatchValue(raw) : null;
        if (value === null) delete socials[key];
        else socials[key] = value;
      }
      if (Object.keys(socials).length > 0) merged.socials = socials;
      else delete merged.socials;
    }
  }
  if (!Value.Check(BusinessFactsSchema, merged)) {
    throw new RevisionError(
      "FACT_UPDATE_INVALID",
      "Fact Updates would leave an invalid Business Facts snapshot (businessName/contactEmail must remain supported)"
    );
  }
  const effectiveFacts = normalizeBusinessFacts(merged);
  const updates = diffFactsToFactsUpdates(parentFactsResult.facts, effectiveFacts);

  const createdAt = nowIso();
  const revisionRequestId = generateId();
  const buildId = generateId();
  const buildVersionId = generateId();

  const statements = [
    env.DB.prepare(
      `INSERT INTO builds (id, site_generation_id, kind, parent_build_id, state, workflow_instance_id, created_at, updated_at)
       VALUES (?, ?, 'revision', ?, 'INTAKE_READY', NULL, ?, ?)`
    ).bind(buildId, parent.site_generation_id, parent.id, createdAt, createdAt),
    env.DB.prepare(
      "INSERT INTO build_versions (id, build_id, version_number, created_at) VALUES (?, ?, 1, ?)"
    ).bind(buildVersionId, buildId, createdAt),
    env.DB.prepare(
      `INSERT INTO revision_requests (id, site_generation_id, parent_build_id, build_id, request_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      revisionRequestId,
      parent.site_generation_id,
      parent.id,
      buildId,
      request.requestNote ?? null,
      createdAt
    ),
    env.DB.prepare(
      `INSERT INTO build_workflow_events (id, build_id, build_version_id, from_state, to_state, stage, detail, created_at)
       VALUES (?, ?, ?, NULL, 'INTAKE_READY', 'revision_request', ?, ?)`
    ).bind(
      generateId(),
      buildId,
      buildVersionId,
      `Revision Request created Build from parent ${parent.id} with ${updates.length} Fact Update(s)`,
      createdAt
    ),
  ];
  for (const update of updates) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO fact_updates (id, site_generation_id, build_id, field, value_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(generateId(), parent.site_generation_id, buildId, update.field, JSON.stringify(update.value), createdAt)
    );
  }

  await env.DB.batch(statements);

  return {
    revisionRequestId,
    buildId,
    buildVersionId,
    buildVersionNumber: 1,
    factUpdateCount: updates.length,
    effectiveFacts,
  };
}

// ── Read model ──────────────────────────────────────────────────────────────

export interface RevisionRequestView {
  id: string;
  siteGenerationId: string;
  parentBuildId: string;
  buildId: string;
  requestNote: string | null;
  createdAt: string;
  factUpdates: Array<{ field: string; value: unknown }>;
}

export async function getRevisionRequestView(env: Env, buildId: string): Promise<RevisionRequestView | null> {
  const request = await env.DB.prepare("SELECT * FROM revision_requests WHERE build_id = ?")
    .bind(buildId)
    .first<{
      id: string;
      site_generation_id: string;
      parent_build_id: string;
      build_id: string;
      request_note: string | null;
      created_at: string;
    }>();
  if (!request) return null;
  const updates = await env.DB.prepare(
    "SELECT field, value_json FROM fact_updates WHERE build_id = ? ORDER BY created_at, id"
  )
    .bind(buildId)
    .all<{ field: string; value_json: string }>();
  return {
    id: request.id,
    siteGenerationId: request.site_generation_id,
    parentBuildId: request.parent_build_id,
    buildId: request.build_id,
    requestNote: request.request_note,
    createdAt: request.created_at,
    factUpdates: (updates.results ?? []).map((row) => ({
      field: row.field,
      value: JSON.parse(row.value_json),
    })),
  };
}
