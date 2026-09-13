// Mutable Client Intake Draft (operator GO 2026-09-12, client intake layer).
//
// The Intake Draft sits BEFORE the canonical immutable Onboarding Submission:
// the PUBLIC form creates a draft (never a Site Generation), the admin edits
// it, chooses the Build Mode, and only the explicit Validate & Generate
// action constructs the canonical payload, runs the EXISTING canonical domain
// validation, creates the immutable submission + Site Generation and starts
// the WebsiteBuildWorkflow. The draft is deliberately simple and mutable —
// it does NOT duplicate the canonical lifecycle state machine.
//
// Private client/operator metadata (submitter name/email, adminNotes) rides
// the draft and never becomes public Business Facts: the person filling out
// the form is not necessarily the site's public contact.

import type { Env } from "../env.d";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { generateId, nowIso } from "../lib/crypto";
import {
  BusinessFactsSchema,
  OnboardingSubmissionPayloadSchema,
  validateBusinessFactsSemantics,
  validateOnboardingSubmissionPayload,
  normalizeBusinessFacts,
  type BusinessFacts,
  type SubmissionValidationIssue,
} from "./lifecycle-schema";
import { CreativeDirectionSchema, type CreativeDirection } from "./creative-direction";
import type { ReferenceInput } from "./lifecycle-schema";

export const DRAFT_STATUSES = ["SUBMITTED", "IN_REVIEW", "GENERATION_STARTED"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

// The public form's contact/identity block. Private by design: it labels the
// DRAFT (and the admin notification), never the website.
export const DraftSubmitterSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    email: Type.String({ pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", maxLength: 320 }),
  },
  { additionalProperties: false }
);

// The client-supplied business brief. Structurally the canonical Business
// Facts (the same required services/businessHours + optional differentiator)
// so an admin can promote it with minimal rework — but the draft is NOT
// canonical and the admin edits it before conversion.
export const DraftBusinessSchema = Type.Composite([BusinessFactsSchema], {
  additionalProperties: false,
});

// Client design preferences are OPTIONAL at draft level (the client may not
// have an art direction). When the admin later chooses ORIGINAL_DESIGN these
// become the raw material for the canonical CreativeDirection (which requires
// at least `direction`); when they choose REFERENCE_BOUND the preferences
// stay draft-only CLIENT NOTES and never enter the immutable submission
// (the canonical mode contract rejects cross-mode leakage).
export const DraftDesignPreferencesSchema = Type.Object(
  {
    direction: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
    audience: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    conversionGoal: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    serviceEnvironment: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    inspirationNotes: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    preferredPalette: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    visualStyle: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    tone: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    avoidances: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  },
  { additionalProperties: false }
);

export const IntakeDraftPayloadSchema = Type.Object(
  {
    submitter: DraftSubmitterSchema,
    business: DraftBusinessSchema,
    designPreferences: Type.Optional(DraftDesignPreferencesSchema),
    // Set ONLY server-side by the admin screenshot-upload endpoint; a public
    // submission can never place an R2 key here.
    referenceScreenshotR2Key: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    referenceUrl: Type.Optional(Type.String({ pattern: "^https?://", maxLength: 2048 })),
  },
  { additionalProperties: false }
);
export type IntakeDraftPayload = Static<typeof IntakeDraftPayloadSchema>;

export interface IntakeDraftRow {
  id: string;
  status: DraftStatus;
  payload_json: string;
  business_name: string;
  submitter_name: string;
  submitter_email: string;
  admin_notes: string | null;
  converted_site_id: string | null;
  converted_site_generation_id: string | null;
  converted_onboarding_submission_id: string | null;
  converted_build_mode: string | null;
  created_at: string;
  updated_at: string;
}

export class IntakeDraftError extends Error {
  readonly code: "DRAFT_INVALID" | "DRAFT_NOT_FOUND" | "DRAFT_IMMUTABLE" | "DRAFT_ALREADY_CONVERTED";

  constructor(code: IntakeDraftError["code"], message: string) {
    super(message);
    this.name = "IntakeDraftError";
    this.code = code;
  }
}

/** Validates a draft payload shape and returns the typed value or issues. */
export function validateIntakeDraftPayload(
  payload: unknown
): { valid: true; value: IntakeDraftPayload } | { valid: false; issues: SubmissionValidationIssue[] } {
  if (typeof payload !== "object" || payload === null) {
    return { valid: false, issues: [{ path: "$", message: "draft payload must be an object" }] };
  }
  if (!Value.Check(IntakeDraftPayloadSchema, payload)) {
    const issues: SubmissionValidationIssue[] = [];
    for (const error of Value.Errors(IntakeDraftPayloadSchema, payload)) {
      issues.push({ path: error.path, message: error.message });
      if (issues.length >= 10) break;
    }
    return { valid: false, issues };
  }
  const value = payload as IntakeDraftPayload;
  const semanticIssues = validateBusinessFactsSemantics(value.business);
  if (semanticIssues.length > 0) return { valid: false, issues: semanticIssues };
  return { valid: true, value };
}

function rowToDraft(row: IntakeDraftRow): IntakeDraft {
  return {
    id: row.id,
    status: row.status,
    payload: JSON.parse(row.payload_json) as IntakeDraftPayload,
    businessName: row.business_name,
    submitterName: row.submitter_name,
    submitterEmail: row.submitter_email,
    adminNotes: row.admin_notes,
    convertedSiteId: row.converted_site_id,
    convertedSiteGenerationId: row.converted_site_generation_id,
    convertedOnboardingSubmissionId: row.converted_onboarding_submission_id,
    convertedBuildMode: row.converted_build_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface IntakeDraft {
  id: string;
  status: DraftStatus;
  payload: IntakeDraftPayload;
  businessName: string;
  submitterName: string;
  submitterEmail: string;
  adminNotes: string | null;
  convertedSiteId: string | null;
  convertedSiteGenerationId: string | null;
  convertedOnboardingSubmissionId: string | null;
  convertedBuildMode: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function createIntakeDraft(
  env: Env,
  payload: IntakeDraftPayload
): Promise<IntakeDraft> {
  const id = generateId();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO client_intake_drafts (id, status, payload_json, business_name, submitter_name, submitter_email, created_at, updated_at)
     VALUES (?, 'SUBMITTED', ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      JSON.stringify(payload),
      payload.business.businessName.trim(),
      payload.submitter.name.trim(),
      payload.submitter.email.trim(),
      now,
      now
    )
    .run();
  return await getIntakeDraft(env, id) as IntakeDraft;
}

export async function getIntakeDraft(env: Env, id: string): Promise<IntakeDraft | null> {
  const row = await env.DB.prepare("SELECT * FROM client_intake_drafts WHERE id = ?")
    .bind(id)
    .first<IntakeDraftRow>();
  return row ? rowToDraft(row) : null;
}

export interface IntakeDraftListItem {
  id: string;
  status: DraftStatus;
  businessName: string;
  submitterName: string;
  submitterEmail: string;
  createdAt: string;
  updatedAt: string;
  convertedSiteId: string | null;
  convertedSiteGenerationId: string | null;
  convertedBuildMode: string | null;
}

interface IntakeDraftListRow {
  id: string;
  status: DraftStatus;
  business_name: string;
  submitter_name: string;
  submitter_email: string;
  created_at: string;
  updated_at: string;
  converted_site_id: string | null;
  converted_site_generation_id: string | null;
  converted_build_mode: string | null;
}

export async function listIntakeDrafts(
  env: Env,
  options: { limit?: number } = {}
): Promise<IntakeDraftListItem[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const rows = await env.DB.prepare(
    `SELECT id, status, business_name, submitter_name, submitter_email, created_at, updated_at,
            converted_site_id, converted_site_generation_id, converted_build_mode
     FROM client_intake_drafts ORDER BY updated_at DESC, created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all<IntakeDraftListRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    businessName: row.business_name,
    submitterName: row.submitter_name,
    submitterEmail: row.submitter_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    convertedSiteId: row.converted_site_id,
    convertedSiteGenerationId: row.converted_site_generation_id,
    convertedBuildMode: row.converted_build_mode,
  }));
}

export interface DraftEditInput {
  /** Full replacement business brief (whole-object edit, like the draft itself). */
  business?: IntakeDraftPayload["business"];
  designPreferences?: IntakeDraftPayload["designPreferences"];
  referenceUrl?: string | null;
  adminNotes?: string | null;
  /** Marks the draft as being reviewed by an admin (SUBMITTED -> IN_REVIEW). */
  markInReview?: boolean;
}

/** Admin edit BEFORE conversion. After Validate & Generate the draft is immutable. */
export async function editIntakeDraft(
  env: Env,
  id: string,
  edit: DraftEditInput
): Promise<IntakeDraft> {
  const draft = await getIntakeDraft(env, id);
  if (!draft) throw new IntakeDraftError("DRAFT_NOT_FOUND", `Intake Draft ${id} does not exist`);
  if (draft.status === "GENERATION_STARTED" || draft.convertedSiteGenerationId) {
    throw new IntakeDraftError(
      "DRAFT_IMMUTABLE",
      "Intake Draft is immutable after Validate & Generate — later factual changes are Fact Updates inside a Revision Request"
    );
  }

  const nextPayload: IntakeDraftPayload = JSON.parse(JSON.stringify(draft.payload));
  if (edit.business !== undefined) nextPayload.business = edit.business;
  if (edit.designPreferences !== undefined) nextPayload.designPreferences = edit.designPreferences;
  if (edit.referenceUrl !== undefined) {
    if (edit.referenceUrl === null) delete nextPayload.referenceUrl;
    else nextPayload.referenceUrl = edit.referenceUrl;
  }

  const validated = validateIntakeDraftPayload(nextPayload);
  if (!validated.valid) {
    throw new IntakeDraftError(
      "DRAFT_INVALID",
      `Draft edit rejected: ${validated.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`
    );
  }

  const nextStatus: DraftStatus = edit.markInReview && draft.status === "SUBMITTED" ? "IN_REVIEW" : draft.status;
  const adminNotes =
    edit.adminNotes !== undefined ? (edit.adminNotes?.trim() ? edit.adminNotes.trim() : null) : draft.adminNotes;

  await env.DB.prepare(
    `UPDATE client_intake_drafts SET status = ?, payload_json = ?, admin_notes = ?, updated_at = ? WHERE id = ?`
  )
    .bind(nextStatus, JSON.stringify(nextPayload), adminNotes, nowIso(), id)
    .run();
  return (await getIntakeDraft(env, id)) as IntakeDraft;
}

// ── Draft -> canonical Onboarding Submission payload ─────────────────────────

export interface DraftConversionInput {
  buildMode: "ORIGINAL_DESIGN" | "REFERENCE_BOUND";
  /**
   * ORIGINAL_DESIGN only: the admin-reviewed creative direction. Built by the
   * admin from the client's designPreferences plus their own art direction.
   * (The client never chooses the Build Mode and never authors the canonical
   * creative direction directly.)
   */
  creativeDirection?: CreativeDirection;
  /**
   * REFERENCE_BOUND only: the Reference URL. The screenshot rides the draft
   * (uploaded through the admin endpoint) as referenceScreenshotR2Key.
   */
  referenceUrl?: string;
}

export interface DraftConversionPayload {
  facts: BusinessFacts;
  canonical: unknown;
}

/** Maps draft design preferences onto the canonical CreativeDirection shape. */
export function creativeDirectionFromPreferences(
  preferences: IntakeDraftPayload["designPreferences"]
): CreativeDirection | null {
  if (!preferences) return null;
  const candidate = {
    direction: preferences.direction ?? "",
    ...(preferences.audience ? { audience: preferences.audience } : {}),
    ...(preferences.conversionGoal ? { conversionGoal: preferences.conversionGoal } : {}),
    ...(preferences.serviceEnvironment ? { serviceEnvironment: preferences.serviceEnvironment } : {}),
    ...(preferences.inspirationNotes ? { inspirationNotes: preferences.inspirationNotes } : {}),
    ...(preferences.preferredPalette ? { preferredPalette: preferences.preferredPalette } : {}),
    ...(preferences.visualStyle ? { visualStyle: preferences.visualStyle } : {}),
    ...(preferences.tone ? { tone: preferences.tone } : {}),
    ...(preferences.avoidances ? { avoidances: preferences.avoidances } : {}),
  };
  return Value.Check(CreativeDirectionSchema, candidate) ? candidate : null;
}

/**
 * Constructs the canonical OnboardingSubmissionPayload from an admin-reviewed
 * draft. Mode rules are exactly the canonical ones (no weakening):
 *   ORIGINAL_DESIGN -> facts + creativeDirection (required); any Reference
 *   input present on the draft is REJECTED (never silently dropped).
 *   REFERENCE_BOUND -> facts + reference (url and/or uploaded screenshot);
 *   client design preferences NEVER enter the submission (draft-only notes).
 */
export function buildCanonicalSubmissionPayload(
  draft: IntakeDraft,
  input: DraftConversionInput
): { valid: true; payload: Static<typeof OnboardingSubmissionPayloadSchema> } | { valid: false; issues: SubmissionValidationIssue[] } {
  const facts = normalizeBusinessFacts(JSON.parse(JSON.stringify(draft.payload.business)) as BusinessFacts);

  const candidate: Record<string, unknown> = { buildMode: input.buildMode, facts };
  if (input.buildMode === "ORIGINAL_DESIGN") {
    if (draft.payload.referenceUrl || draft.payload.referenceScreenshotR2Key || input.referenceUrl) {
      return {
        valid: false,
        issues: [
          {
            path: "$.reference",
            message:
              "ORIGINAL_DESIGN accepts no Reference input — the client brief stays client notes; choose REFERENCE_BOUND to use it",
          },
        ],
      };
    }
    // Admin-supplied creative direction wins; fall back to the client's
    // reviewed preferences only when the admin did not override.
    const creativeDirection = input.creativeDirection ?? creativeDirectionFromPreferences(draft.payload.designPreferences);
    if (!creativeDirection) {
      return {
        valid: false,
        issues: [
          {
            path: "$.creativeDirection",
            message:
              "ORIGINAL_DESIGN requires creativeDirection — complete the admin creative direction (at minimum 'direction') before generating",
          },
        ],
      };
    }
    candidate.creativeDirection = creativeDirection;
  } else {
    const screenshotR2Key = draft.payload.referenceScreenshotR2Key;
    const url = input.referenceUrl ?? draft.payload.referenceUrl;
    const reference: ReferenceInput = {};
    if (screenshotR2Key) reference.screenshotR2Key = screenshotR2Key;
    if (url) reference.url = url;
    if (!reference.screenshotR2Key && !reference.url) {
      return {
        valid: false,
        issues: [
          {
            path: "$.reference",
            message: "REFERENCE_BOUND requires a reference screenshot, a reference URL, or both",
          },
        ],
      };
    }
    candidate.reference = reference;
  }

  const check = validateOnboardingSubmissionPayload(candidate);
  if (!check.valid) return check;
  return { valid: true, payload: check.value };
}

export interface DraftConversionResult {
  draft: IntakeDraft;
  siteId: string;
  onboardingSubmissionId: string;
  siteGenerationId: string;
  workflowInstanceId: string;
}

/**
 * Validate & Generate — the ONLY initial generation start action for a draft.
 * Idempotent: once a draft carries converted_site_generation_id, repeated
 * calls return the existing conversion and never create a second Site
 * Generation. The canonical payload goes through the EXISTING canonical
 * domain validation and lifecycle services (startSiteGeneration + the
 * workflow binding) — no internal HTTP hop, no new generation semantics.
 */
export async function validateAndGenerateFromDraft(
  env: Env,
  draftId: string,
  input: DraftConversionInput,
  startWorkflow: (siteGenerationId: string) => Promise<string>
): Promise<{ converted: DraftConversionResult; alreadyConverted: boolean }> {
  const draft = await getIntakeDraft(env, draftId);
  if (!draft) throw new IntakeDraftError("DRAFT_NOT_FOUND", `Intake Draft ${draftId} does not exist`);

  // Idempotency boundary (single dedupe decision point): the canonical
  // conversion happened exactly once if the generation id is present.
  if (draft.convertedSiteGenerationId) {
    if (draft.convertedBuildMode && input.buildMode !== draft.convertedBuildMode) {
      throw new IntakeDraftError(
        "DRAFT_ALREADY_CONVERTED",
        `Intake Draft already generated as '${draft.convertedBuildMode}' — changing Build Mode requires a new Site Generation`
      );
    }
    return { converted: {
      draft,
      siteId: draft.convertedSiteId ?? "",
      onboardingSubmissionId: draft.convertedOnboardingSubmissionId ?? "",
      siteGenerationId: draft.convertedSiteGenerationId,
      workflowInstanceId: "",
    }, alreadyConverted: true };
  }

  const built = buildCanonicalSubmissionPayload(draft, input);
  if (!built.valid) {
    throw new IntakeDraftError(
      "DRAFT_INVALID",
      `Validate & Generate rejected: ${built.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`
    );
  }

  // Existing canonical lifecycle services — the draft layer never reimplements them.
  const { startSiteGeneration } = await import("./lifecycle");
  const started = await startSiteGeneration(env, { siteId: null, payload: built.payload });
  const workflowInstanceId = await startWorkflow(started.siteGenerationId);

  const now = nowIso();
  await env.DB.prepare(
    `UPDATE client_intake_drafts
     SET status = 'GENERATION_STARTED',
         converted_site_id = ?, converted_site_generation_id = ?,
         converted_onboarding_submission_id = ?, converted_build_mode = ?, updated_at = ?
     WHERE id = ? AND converted_site_generation_id IS NULL`
  )
    .bind(started.siteId, started.siteGenerationId, started.onboardingSubmissionId, input.buildMode, now, draftId)
    .run();

  const updated = await getIntakeDraft(env, draftId);
  return {
    converted: {
      draft: updated ?? draft,
      siteId: started.siteId,
      onboardingSubmissionId: started.onboardingSubmissionId,
      siteGenerationId: started.siteGenerationId,
      workflowInstanceId,
    },
    alreadyConverted: false,
  };
}

/** Stores an admin-uploaded Reference screenshot R2 key on the draft (pre-conversion only). */
export async function setDraftReferenceScreenshot(
  env: Env,
  draftId: string,
  r2Key: string
): Promise<IntakeDraft> {
  const draft = await getIntakeDraft(env, draftId);
  if (!draft) throw new IntakeDraftError("DRAFT_NOT_FOUND", `Intake Draft ${draftId} does not exist`);
  if (draft.status === "GENERATION_STARTED" || draft.convertedSiteGenerationId) {
    throw new IntakeDraftError("DRAFT_IMMUTABLE", "Intake Draft is immutable after Validate & Generate");
  }
  const nextPayload: IntakeDraftPayload = JSON.parse(JSON.stringify(draft.payload));
  nextPayload.referenceScreenshotR2Key = r2Key;
  const validated = validateIntakeDraftPayload(nextPayload);
  if (!validated.valid) {
    throw new IntakeDraftError("DRAFT_INVALID", `Screenshot update rejected: ${validated.issues.map((i) => i.message).join("; ")}`);
  }
  await env.DB.prepare("UPDATE client_intake_drafts SET payload_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(nextPayload), nowIso(), draftId)
    .run();
  return (await getIntakeDraft(env, draftId)) as IntakeDraft;
}
