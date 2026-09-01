// V2 domain lifecycle service (issue #4, PRD Phase 1).
//
// Owns the canonical identity chain:
//   Business -> Site identity -> Site Generation -> Build -> Build Version
//
// Rules enforced here and at the storage boundary (migration 0017):
//   - A fresh Onboarding Submission creates exactly one new Site Generation.
//   - A Site Generation is bound to exactly one immutable Onboarding Submission.
//   - The first Build and its initial immutable Build Version are created only
//     through this service, which the primary WebsiteBuildWorkflow invokes.
//   - There is no Client Account / Client User / mutable Client Profile path.
//   - Cross-entity references are validated before any write.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import {
  ONBOARDING_SUBMISSION_SCHEMA_VERSION,
  normalizeBusinessFacts,
  validateOnboardingSubmissionPayload,
  type BuildLifecycleState,
  type BuildMode,
  type BusinessFacts,
  type ReferenceInput,
} from "./lifecycle-schema";

export type LifecycleErrorCode =
  | "SUBMISSION_INVALID"
  | "SITE_NOT_FOUND"
  | "GENERATION_NOT_FOUND"
  | "BUILD_NOT_FOUND"
  | "SITE_MISMATCH"
  | "BUILD_VERSION_MISMATCH"
  | "INITIAL_BUILD_ALREADY_EXISTS";

export class LifecycleError extends Error {
  readonly code: LifecycleErrorCode;

  constructor(code: LifecycleErrorCode, message: string) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
  }
}

// ── Row shapes ───────────────────────────────────────────────────────────────

export interface BusinessRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface SiteIdentityRow {
  id: string;
  business_id: string;
  created_at: string;
  updated_at: string;
}

export interface OnboardingSubmissionRow {
  id: string;
  business_id: string;
  site_id: string;
  build_mode: BuildMode;
  schema_version: number;
  payload_json: string;
  fact_snapshot_json: string;
  checksum: string;
  submitted_at: string;
}

export interface SiteGenerationRow {
  id: string;
  site_id: string;
  onboarding_submission_id: string;
  build_mode: BuildMode;
  sequence_number: number;
  created_at: string;
  updated_at: string;
}

export interface BuildRow {
  id: string;
  site_generation_id: string;
  kind: "initial" | "revision";
  parent_build_id: string | null;
  state: BuildLifecycleState;
  workflow_instance_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuildVersionRow {
  id: string;
  build_id: string;
  version_number: number;
  created_at: string;
}

export interface BuildWorkflowEventRow {
  id: string;
  build_id: string;
  build_version_id: string | null;
  from_state: string | null;
  to_state: string;
  stage: string;
  detail: string | null;
  created_at: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isUniqueViolation(error: unknown, fragment: string): boolean {
  return error instanceof Error && error.message.includes(`UNIQUE constraint failed: ${fragment}`);
}

// ── Onboarding Submission -> Site Generation ────────────────────────────────

export interface StartSiteGenerationInput {
  /** Existing Site identity for a replacement Site Generation; omitted for a brand-new Site. */
  siteId?: string | null;
  /** Raw, untrusted submission payload. */
  payload: unknown;
}

export interface SiteGenerationStarted {
  businessId: string;
  siteId: string;
  onboardingSubmissionId: string;
  siteGenerationId: string;
  buildMode: BuildMode;
  sequenceNumber: number;
}

export async function startSiteGeneration(
  env: Env,
  input: StartSiteGenerationInput
): Promise<SiteGenerationStarted> {
  const validation = validateOnboardingSubmissionPayload(input.payload);
  if (!validation.valid) {
    const detail = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new LifecycleError("SUBMISSION_INVALID", `Onboarding Submission rejected: ${detail}`);
  }
  const payload = validation.value;
  const facts = normalizeBusinessFacts(payload.facts);
  const reference: ReferenceInput | undefined =
    payload.reference && (payload.reference.screenshotR2Key || payload.reference.url)
      ? {
          ...(payload.reference.screenshotR2Key ? { screenshotR2Key: payload.reference.screenshotR2Key } : {}),
          ...(payload.reference.url ? { url: payload.reference.url } : {}),
        }
      : undefined;

  const frozenPayload = stableStringify({ buildMode: payload.buildMode, facts, reference });
  const checksum = await sha256Hex(frozenPayload);
  const submittedAt = nowIso();

  let businessId: string;
  let siteId: string;

  if (input.siteId) {
    const site = await env.DB.prepare("SELECT * FROM site_identities WHERE id = ?")
      .bind(input.siteId)
      .first<SiteIdentityRow>();
    if (!site) {
      throw new LifecycleError("SITE_NOT_FOUND", `Site identity ${input.siteId} does not exist`);
    }
    businessId = site.business_id;
    siteId = site.id;
  } else {
    businessId = generateId();
    siteId = generateId();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO businesses (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
      ).bind(businessId, facts.businessName, submittedAt, submittedAt),
      env.DB.prepare(
        "INSERT INTO site_identities (id, business_id, created_at, updated_at) VALUES (?, ?, ?, ?)"
      ).bind(siteId, businessId, submittedAt, submittedAt),
    ]);
  }

  const sequence = await env.DB.prepare(
    "SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next FROM site_generations WHERE site_id = ?"
  )
    .bind(siteId)
    .first<{ next: number }>();
  const sequenceNumber = sequence?.next ?? 1;

  const submissionId = generateId();
  const generationId = generateId();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO onboarding_submissions (
           id, business_id, site_id, build_mode, schema_version,
           payload_json, fact_snapshot_json, checksum, submitted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        submissionId,
        businessId,
        siteId,
        payload.buildMode,
        ONBOARDING_SUBMISSION_SCHEMA_VERSION,
        frozenPayload,
        JSON.stringify(facts),
        checksum,
        submittedAt
      ),
      env.DB.prepare(
        `INSERT INTO site_generations (
           id, site_id, onboarding_submission_id, build_mode, sequence_number, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(generationId, siteId, submissionId, payload.buildMode, sequenceNumber, submittedAt, submittedAt),
    ]);
  } catch (error) {
    // The UNIQUE(onboarding_submission_id) guard makes submission->generation
    // exactly 1:1 even under a replayed create.
    if (isUniqueViolation(error, "site_generations.onboarding_submission_id")) {
      throw new LifecycleError(
        "SUBMISSION_INVALID",
        "This Onboarding Submission already started a Site Generation"
      );
    }
    throw error;
  }

  return {
    businessId,
    siteId,
    onboardingSubmissionId: submissionId,
    siteGenerationId: generationId,
    buildMode: payload.buildMode,
    sequenceNumber,
  };
}

// ── Build + initial Build Version (primary workflow boundary) ───────────────

export interface CreateInitialBuildInput {
  siteGenerationId: string;
}

export interface InitialBuildCreated {
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
}

export async function createInitialBuild(
  env: Env,
  input: CreateInitialBuildInput
): Promise<InitialBuildCreated> {
  const generation = await env.DB.prepare(
    "SELECT * FROM site_generations WHERE id = ?"
  )
    .bind(input.siteGenerationId)
    .first<SiteGenerationRow>();
  if (!generation) {
    throw new LifecycleError(
      "GENERATION_NOT_FOUND",
      `Site Generation ${input.siteGenerationId} does not exist`
    );
  }

  const createdAt = nowIso();
  const buildId = generateId();
  const buildVersionId = generateId();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO builds (id, site_generation_id, kind, parent_build_id, state, workflow_instance_id, created_at, updated_at)
         VALUES (?, ?, 'initial', NULL, 'INTAKE_READY', NULL, ?, ?)`
      ).bind(buildId, generation.id, createdAt, createdAt),
      env.DB.prepare(
        "INSERT INTO build_versions (id, build_id, version_number, created_at) VALUES (?, ?, 1, ?)"
      ).bind(buildVersionId, buildId, createdAt),
      env.DB.prepare(
        `INSERT INTO build_workflow_events (id, build_id, build_version_id, from_state, to_state, stage, detail, created_at)
         VALUES (?, ?, ?, NULL, 'INTAKE_READY', 'intake', ?, ?)`
      ).bind(generateId(), buildId, buildVersionId, "Initial Build and immutable Build Version 1 created", createdAt),
    ]);
  } catch (error) {
    if (isUniqueViolation(error, "builds.site_generation_id")) {
      throw new LifecycleError(
        "INITIAL_BUILD_ALREADY_EXISTS",
        `Site Generation ${input.siteGenerationId} already has its initial Build`
      );
    }
    throw error;
  }

  return { buildId, buildVersionId, buildVersionNumber: 1 };
}

// ── State transitions and events ────────────────────────────────────────────

export async function appendBuildWorkflowEvent(
  env: Env,
  event: {
    buildId: string;
    buildVersionId?: string | null;
    fromState?: BuildLifecycleState | null;
    toState: BuildLifecycleState;
    stage: string;
    detail?: string | null;
  }
): Promise<void> {
  const build = await env.DB.prepare("SELECT * FROM builds WHERE id = ?")
    .bind(event.buildId)
    .first<BuildRow>();
  if (!build) {
    throw new LifecycleError("BUILD_NOT_FOUND", `Build ${event.buildId} does not exist`);
  }

  if (event.buildVersionId) {
    const version = await env.DB.prepare("SELECT * FROM build_versions WHERE id = ?")
      .bind(event.buildVersionId)
      .first<BuildVersionRow>();
    if (!version || version.build_id !== event.buildId) {
      throw new LifecycleError(
        "BUILD_VERSION_MISMATCH",
        `Build Version ${event.buildVersionId} does not belong to Build ${event.buildId}`
      );
    }
  }

  const createdAt = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO build_workflow_events (id, build_id, build_version_id, from_state, to_state, stage, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId(),
      event.buildId,
      event.buildVersionId ?? null,
      event.fromState ?? null,
      event.toState,
      event.stage,
      event.detail ?? null,
      createdAt
    ),
    env.DB.prepare("UPDATE builds SET state = ?, updated_at = ? WHERE id = ?").bind(
      event.toState,
      createdAt,
      event.buildId
    ),
  ]);
}

// ── Read models ─────────────────────────────────────────────────────────────

export interface SiteGenerationView {
  siteGeneration: {
    id: string;
    siteId: string;
    businessId: string;
    onboardingSubmissionId: string;
    buildMode: BuildMode;
    sequenceNumber: number;
    createdAt: string;
  };
  submission: {
    id: string;
    schemaVersion: number;
    buildMode: BuildMode;
    facts: BusinessFacts;
    reference: ReferenceInput | null;
    checksum: string;
    submittedAt: string;
  };
  builds: Array<{
    id: string;
    kind: BuildRow["kind"];
    state: BuildLifecycleState;
    parentBuildId: string | null;
    createdAt: string;
    versions: Array<{ id: string; versionNumber: number; createdAt: string }>;
  }>;
}

export async function getSiteGenerationView(
  env: Env,
  siteGenerationId: string
): Promise<SiteGenerationView | null> {
  const generation = await env.DB.prepare("SELECT * FROM site_generations WHERE id = ?")
    .bind(siteGenerationId)
    .first<SiteGenerationRow>();
  if (!generation) return null;

  const submission = await env.DB.prepare(
    "SELECT * FROM onboarding_submissions WHERE id = ?"
  )
    .bind(generation.onboarding_submission_id)
    .first<OnboardingSubmissionRow>();
  if (!submission) return null;

  const builds = await env.DB.prepare(
    "SELECT * FROM builds WHERE site_generation_id = ? ORDER BY created_at"
  )
    .bind(generation.id)
    .all<BuildRow>();
  const buildRows = builds.results ?? [];

  const versionsByBuild = new Map<string, BuildVersionRow[]>();
  if (buildRows.length > 0) {
    const versions = await env.DB.prepare(
      "SELECT * FROM build_versions WHERE build_id IN (SELECT id FROM builds WHERE site_generation_id = ?) ORDER BY build_id, version_number"
    )
      .bind(generation.id)
      .all<BuildVersionRow>();
    for (const version of versions.results ?? []) {
      const list = versionsByBuild.get(version.build_id) ?? [];
      list.push(version);
      versionsByBuild.set(version.build_id, list);
    }
  }

  const payload = JSON.parse(submission.payload_json) as {
    buildMode: BuildMode;
    facts: BusinessFacts;
    reference?: ReferenceInput;
  };

  return {
    siteGeneration: {
      id: generation.id,
      siteId: generation.site_id,
      businessId: submission.business_id,
      onboardingSubmissionId: submission.id,
      buildMode: generation.build_mode,
      sequenceNumber: generation.sequence_number,
      createdAt: generation.created_at,
    },
    submission: {
      id: submission.id,
      schemaVersion: submission.schema_version,
      buildMode: submission.build_mode,
      facts: payload.facts,
      reference: payload.reference ?? null,
      checksum: submission.checksum,
      submittedAt: submission.submitted_at,
    },
    builds: buildRows.map((build) => ({
      id: build.id,
      kind: build.kind,
      state: build.state,
      parentBuildId: build.parent_build_id,
      createdAt: build.created_at,
      versions: (versionsByBuild.get(build.id) ?? []).map((version) => ({
        id: version.id,
        versionNumber: version.version_number,
        createdAt: version.created_at,
      })),
    })),
  };
}

export interface BuildView {
  build: {
    id: string;
    siteGenerationId: string;
    kind: BuildRow["kind"];
    parentBuildId: string | null;
    state: BuildLifecycleState;
    createdAt: string;
    updatedAt: string;
  };
  versions: Array<{ id: string; versionNumber: number; createdAt: string }>;
  workflowEvents: Array<{
    id: string;
    buildVersionId: string | null;
    fromState: string | null;
    toState: string;
    stage: string;
    detail: string | null;
    createdAt: string;
  }>;
}

export async function getBuildView(env: Env, buildId: string): Promise<BuildView | null> {
  const build = await env.DB.prepare("SELECT * FROM builds WHERE id = ?")
    .bind(buildId)
    .first<BuildRow>();
  if (!build) return null;

  const versions = await env.DB.prepare(
    "SELECT * FROM build_versions WHERE build_id = ? ORDER BY version_number"
  )
    .bind(buildId)
    .all<BuildVersionRow>();

  const events = await env.DB.prepare(
    "SELECT * FROM build_workflow_events WHERE build_id = ? ORDER BY created_at"
  )
    .bind(buildId)
    .all<BuildWorkflowEventRow>();

  return {
    build: {
      id: build.id,
      siteGenerationId: build.site_generation_id,
      kind: build.kind,
      parentBuildId: build.parent_build_id,
      state: build.state,
      createdAt: build.created_at,
      updatedAt: build.updated_at,
    },
    versions: (versions.results ?? []).map((version) => ({
      id: version.id,
      versionNumber: version.version_number,
      createdAt: version.created_at,
    })),
    workflowEvents: (events.results ?? []).map((event) => ({
      id: event.id,
      buildVersionId: event.build_version_id,
      fromState: event.from_state,
      toState: event.to_state,
      stage: event.stage,
      detail: event.detail,
      createdAt: event.created_at,
    })),
  };
}
