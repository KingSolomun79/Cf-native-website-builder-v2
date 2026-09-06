// V2 bounded Automated Repair (issue #14, PRD sections 2.5, 30-31).
//
// Release defects enter a strictly bounded repair lifecycle:
//
//   failed QA
//     -> ONE coordinated Fix Coordinator batch (merges QA-A/QA-B findings,
//        deduplicates root causes, repairs at the narrowest correct level)
//     -> material repair creates a NEW immutable Build Version = new
//        Release Candidate
//     -> QA-A Confirmation + QA-B Confirmation evaluate that NEW version
//        (never mutating or inheriting the prior verdict); every finding
//        carries an explicit ACTIVE/RESOLVED status — RESOLVED findings are
//        resolution records of fixed prior blockers, never active blockers
//        (issue #38)
//     -> if valid P0/P1 remain: at most ONE narrow Release Blocker Fix
//        -> confirmation reruns for the changed domains
//     -> terminal outcome: Release Ready, BLUEPRINT_REVIEW_REQUIRED (which
//        routes to HUMAN_REVIEW_REQUIRED), or HUMAN_REVIEW_REQUIRED.
//
// Automated Repair can never change Business Facts, Reference, Build Mode or
// the Visual Blueprint. There is no unbounded retry or mutation loop: the
// (build_id, kind) uniqueness in repair_batches enforces the ceiling at the
// storage boundary.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { appendBuildWorkflowEvent, createNextBuildVersion } from "./lifecycle";
import { runSchemaValidatedAiStage, type RawAiGenerate } from "./ai-boundary";
import {
  evaluateQaARelease,
  evaluateQaBRelease,
  QA_A_CONFIRMATION_SCHEMA_VERSION,
  QA_B_CONFIRMATION_SCHEMA_VERSION,
  QaAConfirmationReportSchema,
  QaBConfirmationReportSchema,
  type QaAReport,
  type QaAReportAugmented,
  type QaBReport,
  type QaFinding,
  type QaAConfirmationReport,
  type QaBConfirmationReport,
  type EvaluableQaFinding,
} from "./qa-stages";
import { assignReleaseReady } from "./release";

export const FIX_PLAN_SCHEMA_VERSION = "fix-plan/1";

// Repair strategies operate on realization only (PRD section 2.5): HTML/CSS/
// JS implementation, geometry/crop, asset routing, content remap within
// approved facts, image attempts and bounded regeneration, technical
// metadata and form integration.
export const RepairStrategySchema = Type.Union([
  Type.Literal("css_geometry_crop"),
  Type.Literal("asset_routing"),
  Type.Literal("content_remap"),
  Type.Literal("image_attempt_selection"),
  Type.Literal("image_regeneration"),
  Type.Literal("html_structure"),
  Type.Literal("metadata_repair"),
  Type.Literal("form_contract_repair"),
  Type.Literal("js_repair"),
]);

export const FixPlanSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    rootCauses: Type.Array(
      Type.Object(
        {
          findingRef: Type.String({ minLength: 1, maxLength: 500 }),
          domain: Type.String({ minLength: 1, maxLength: 200 }),
          rootCause: Type.String({ minLength: 1, maxLength: 2000 }),
        },
        { additionalProperties: false }
      ),
      { minItems: 1 }
    ),
    repairs: Type.Array(
      Type.Object(
        {
          target: Type.Union([Type.Literal("implementation"), Type.Literal("image")]),
          strategy: RepairStrategySchema,
          slotId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
          description: Type.String({ minLength: 1, maxLength: 2000 }),
        },
        { additionalProperties: false }
      ),
      { minItems: 1 }
    ),
    // Blueprint-root defects emit BLUEPRINT_REVIEW_REQUIRED instead of
    // implementation-only repair (PRD section 13).
    blueprintReviewRequired: Type.Boolean(),
    blueprintReviewReason: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  },
  { additionalProperties: false }
);
export type FixPlan = Static<typeof FixPlanSchema>;

export type RepairErrorCode =
  | "BUILD_NOT_FOUND"
  | "REPAIR_BOUNDARY_VIOLATION"
  | "REPAIR_BUDGET_EXHAUSTED"
  | "FIX_PLAN_INVALID";

export class AutomatedRepairError extends Error {
  readonly code: RepairErrorCode;

  constructor(code: RepairErrorCode, message: string) {
    super(message);
    this.name = "AutomatedRepairError";
    this.code = code;
  }
}

// Deterministic boundary: a schema-valid plan still cannot smuggle design-
// origin or fact mutations through free-text descriptions.
const FORBIDDEN_MUTATION_PATTERNS: Array<{ pattern: RegExp; subject: string }> = [
  { pattern: /\b(change|update|modify|edit|replace|rewrite)\b[^.]{0,80}\b(business facts?|facts? snapshot|onboarding submission|fact update)\b/i, subject: "Business Facts" },
  { pattern: /\b(change|update|modify|edit|replace|rewrite|swap)\b[^.]{0,80}\b(reference|reference screenshot|reference url)\b/i, subject: "Reference" },
  { pattern: /\b(change|update|modify|edit|switch)\b[^.]{0,80}\bbuild mode\b/i, subject: "Build Mode" },
  { pattern: /\b(change|update|modify|edit|replace|rewrite|redefine|mutate)\b[^.]{0,80}\b(visual blueprint|blueprint)\b/i, subject: "Visual Blueprint" },
];

export function assertRepairPlanWithinBounds(plan: FixPlan): void {
  const serialized = JSON.stringify(plan);
  for (const { pattern, subject } of FORBIDDEN_MUTATION_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new AutomatedRepairError(
        "REPAIR_BOUNDARY_VIOLATION",
        `Automated Repair cannot change ${subject}: the repair plan attempts a design-origin or fact mutation`
      );
    }
  }
  if (plan.blueprintReviewRequired && !plan.blueprintReviewReason) {
    throw new AutomatedRepairError("FIX_PLAN_INVALID", "BLUEPRINT_REVIEW_REQUIRED plans must carry a reason");
  }
}

// ── Fix Coordinator (exactly one coordinated main batch) ────────────────────

export function buildFixCoordinatorUserPrompt(input: {
  qaA: QaAReportAugmented;
  qaB: QaBReport;
  priorBlockerDomains?: string[];
}): string {
  return `Plan ONE coordinated main Automated Repair batch for the failed Release Candidate. Merge the QA-A and QA-B findings, validate blockers against their evidence, deduplicate root causes and repair at the narrowest correct level while preserving already-correct work. You may ONLY plan realization changes (implementation HTML/CSS/JS, geometry/crop, asset routing, content remap within approved facts, image attempt selection or bounded regeneration, technical metadata, form integration). You must NOT change Business Facts, Reference, Build Mode or the Visual Blueprint — if a blocker's root cause is the Visual Blueprint itself (wrong, contradictory, impossible or inconsistent with the design-origin contract), set blueprintReviewRequired true with the reason instead of planning implementation repair. IMPORTANT wording rule: describe fixes ONLY in realization terms (CSS rules, HTML elements, asset paths, metadata); never phrase any fix as changing, updating, modifying, replacing or rewriting the Blueprint, the facts, the Reference or the Build Mode — those words next to those nouns are forbidden in the plan text.

QA-A REPORT:
${JSON.stringify(input.qaA, null, 2)}

QA-B REPORT:
${JSON.stringify(input.qaB, null, 2)}${
    input.priorBlockerDomains?.length
      ? `\n\nPREVIOUS BLOCKER DOMAINS (already repaired once; narrow further): ${JSON.stringify(input.priorBlockerDomains)}`
      : ""
  }`;
}

export interface RunFixCoordinatorInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  qaA: QaAReportAugmented;
  qaB: QaBReport;
  evidenceR2Keys?: string[];
  generate?: RawAiGenerate;
}

export async function runFixCoordinatorStage(
  env: Env,
  input: RunFixCoordinatorInput
): Promise<{ plan: FixPlan }> {
  return planWithinBounds(env, input, {
    stage: "fix-coordinator",
    schemaVersion: FIX_PLAN_SCHEMA_VERSION,
    basePrompt: buildFixCoordinatorUserPrompt({ qaA: input.qaA, qaB: input.qaB }),
  });
}

// Text-boundary scan with ONE bounded re-word: a plan that trips the
// deterministic mutation-pattern heuristic gets exactly one re-planning
// chance with the violation shown to the planner (the scan reads plan text,
// and legitimate realization wording can mention design-origin nouns as
// reference points). A second violation propagates — the caller routes the
// build to human review. A genuinely design-mutating plan is rejected twice;
// the boundary never loosens.
async function planWithinBounds(
  env: Env,
  input: RunFixCoordinatorInput,
  planInput: { stage: import("./prompt-contract").PromptStageKey; schemaVersion: string; basePrompt: string }
): Promise<{ plan: FixPlan }> {
  const plan = async (userPrompt: string) =>
    (
      await runSchemaValidatedAiStage<FixPlan>(env, {
        stage: planInput.stage,
        schema: FixPlanSchema,
        schemaVersion: planInput.schemaVersion,
        userPrompt,
        buildId: input.buildId,
        siteGenerationId: input.siteGenerationId,
        buildVersionId: input.buildVersionId,
        buildVersionNumber: input.buildVersionNumber,
        inputArtifactIds: input.evidenceR2Keys ?? [],
        temperature: 0.2,
        generate: input.generate,
      })
    ).value;

  let value: FixPlan;
  try {
    value = await plan(planInput.basePrompt);
    assertRepairPlanWithinBounds(value);
    return { plan: value };
  } catch (error) {
    if (!(error instanceof AutomatedRepairError && error.code === "REPAIR_BOUNDARY_VIOLATION")) throw error;
    const violation = (error as Error).message;
    value = await plan(
      `${planInput.basePrompt}\n\nYOUR PREVIOUS PLAN WAS REJECTED: ${violation}. Re-emit the SAME repairs using ONLY implementation wording (CSS rules, HTML elements, asset paths, metadata). Never mention the Blueprint, the Business Facts, the Reference or the Build Mode anywhere in the plan text.`
    );
    assertRepairPlanWithinBounds(value);
    return { plan: value };
  }
}

// ── Batch application (material repair -> new immutable Build Version) ──────

export type RepairBatchKind = "fix_coordinator" | "release_blocker_fix";

export interface ApplyRepairBatchInput {
  siteGenerationId: string;
  buildId: string;
  sourceBuildVersionId: string;
  kind: RepairBatchKind;
  plan: FixPlan;
}

export type AppliedRepairBatch =
  | { status: "REPAIR_APPLIED"; batchId: string; newBuildVersionId: string; newBuildVersionNumber: number }
  | { status: "BLUEPRINT_REVIEW_REQUIRED"; reason: string };

export async function applyRepairBatch(
  env: Env,
  input: ApplyRepairBatchInput
): Promise<AppliedRepairBatch> {
  assertRepairPlanWithinBounds(input.plan);

  const build = await env.DB.prepare("SELECT * FROM builds WHERE id = ?")
    .bind(input.buildId)
    .first<{ id: string; state: string }>();
  if (!build) {
    throw new AutomatedRepairError("BUILD_NOT_FOUND", `Build ${input.buildId} does not exist`);
  }

  // Budget pre-check BEFORE the next Build Version is created: a rejected
  // batch must not burn an orphan immutable version. The UNIQUE (build_id,
  // kind) index below stays as the concurrent-race backstop.
  const budgetMessage = `Build ${input.buildId} already consumed its ${input.kind === "fix_coordinator" ? "single Fix Coordinator batch" : "single Release Blocker Fix"}; automation must stop`;
  const existingBatch = await env.DB.prepare(
    "SELECT id FROM repair_batches WHERE build_id = ? AND kind = ?"
  )
    .bind(input.buildId, input.kind)
    .first<{ id: string }>();
  if (existingBatch) {
    throw new AutomatedRepairError("REPAIR_BUDGET_EXHAUSTED", budgetMessage);
  }

  // Blueprint-root defects never reach implementation repair: emit
  // BLUEPRINT_REVIEW_REQUIRED -> HUMAN_REVIEW_REQUIRED and stop automation.
  if (input.plan.blueprintReviewRequired) {
    await appendBuildWorkflowEvent(env, {
      buildId: input.buildId,
      buildVersionId: input.sourceBuildVersionId,
      fromState: "QA",
      toState: "HUMAN_REVIEW_REQUIRED",
      stage: "blueprint_review",
      detail: `BLUEPRINT_REVIEW_REQUIRED: ${input.plan.blueprintReviewReason ?? "the Visual Blueprint itself is defective"}`,
    });
    return { status: "BLUEPRINT_REVIEW_REQUIRED", reason: input.plan.blueprintReviewReason ?? "" };
  }

  // Material repair: a new immutable Build Version inside the same Build —
  // the prior version and its artifacts are never mutated.
  const next = await createNextBuildVersion(env, {
    buildId: input.buildId,
    cause: input.kind,
    detail: `Bounded Automated Repair batch (${input.kind}) applied ${input.plan.repairs.length} repair(s)`,
  });

  const batchId = generateId();
  try {
    await env.DB.prepare(
      `INSERT INTO repair_batches (id, build_id, source_build_version_id, kind, plan_json, created_build_version_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(batchId, input.buildId, input.sourceBuildVersionId, input.kind, JSON.stringify(input.plan), next.buildVersionId, nowIso())
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: repair_batches")) {
      throw new AutomatedRepairError("REPAIR_BUDGET_EXHAUSTED", budgetMessage);
    }
    throw error;
  }

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: next.buildVersionId,
    fromState: input.kind === "fix_coordinator" ? "QA" : "CONFIRMATION",
    toState: input.kind === "fix_coordinator" ? "FIX" : "RELEASE_BLOCKER_FIX",
    stage: input.kind,
    detail: `New immutable Build Version ${next.buildVersionNumber} created as the new Release Candidate (${input.plan.repairs.length} repair(s), ${input.plan.rootCauses.length} root cause(s))`,
  });

  return {
    status: "REPAIR_APPLIED",
    batchId,
    newBuildVersionId: next.buildVersionId,
    newBuildVersionNumber: next.buildVersionNumber,
  };
}

// ── Confirmation (evaluates the NEW Build Version) ──────────────────────────
//
// Issue #38: confirmation is evaluating whether the previously identified
// blockers remain active after repair — not producing a fresh blocker list.
// Every confirmation finding therefore carries an explicit structured
// `status`: RESOLVED (a prior defect verifiably fixed — a resolution record
// with its ORIGINAL severity, never an active blocker) or ACTIVE (unfixed /
// partially fixed prior blocker, or a NEW defect). Missing or ambiguous
// status fails schema validation and takes the existing repair/fail path.

export interface ConfirmationQaResult {
  qaA: QaAConfirmationReport;
  qaB: QaBConfirmationReport;
}

export async function runConfirmationQa(
  env: Env,
  input: {
    siteGenerationId: string;
    buildId: string;
    // The repaired Build Version — confirmation never evaluates the old one.
    buildVersionId: string;
    buildVersionNumber: number;
    previousBlockers: QaFinding[];
    evidenceR2Keys?: string[];
    generate?: RawAiGenerate;
  }
): Promise<ConfirmationQaResult> {
  const focus =
    "Re-evaluate THIS new Build Version produced by repair. Focus on the previous/changed blocker domains; any plausibly affected domain must also rerun. This is a NEW immutable Build Version — never treat the repaired candidate as the same version or inherit the prior verdict.";
  const resolutionContract = `You are evaluating whether the PREVIOUSLY IDENTIFIED blockers remain active after the repair — not producing a fresh blocker list without context. For EVERY finding you emit you must set its structured status field:
- "RESOLVED": the evidence shows a previously identified defect is fixed on THIS Build Version. Report it with its ORIGINAL severity (a fixed P1 stays severity "P1") and status "RESOLVED" — it is a resolution record, NOT an active blocker, and must never by itself fail the release.
- "ACTIVE": the defect is currently present on THIS Build Version — a previous blocker that is unfixed or only partially fixed, or a NEW defect discovered during this confirmation. Only ACTIVE P0/P1 findings count as Release Blockers.
Do not mark RESOLVED if the evidence still shows the defect, and never report a resolved previous blocker without the explicit RESOLVED status.
BUSINESS TRUTH IS NEVER VISUALLY RESOLVED (issue #48): a previously identified fabricated identity or trust entity (invented clients, partners, awards, certifications, testimonials, press, or imagery with baked-in logos/names) stays ACTIVE unless the evidence shows the fabricated content itself was removed from THIS Build Version. Fixing the visual defects around it never resolves it.`;

  const runA = await runSchemaValidatedAiStage<QaAConfirmationReport>(env, {
    stage: "qa-a-confirmation",
    schema: QaAConfirmationReportSchema,
    schemaVersion: QA_A_CONFIRMATION_SCHEMA_VERSION,
    userPrompt: `QA-A Confirmation. ${focus}\n\n${resolutionContract}\n\nPREVIOUS BLOCKERS:\n${JSON.stringify(input.previousBlockers, null, 2)}`,
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: input.evidenceR2Keys ?? [],
    temperature: 0.2,
    generate: input.generate,
  });
  const runB = await runSchemaValidatedAiStage<QaBConfirmationReport>(env, {
    stage: "qa-b-confirmation",
    schema: QaBConfirmationReportSchema,
    schemaVersion: QA_B_CONFIRMATION_SCHEMA_VERSION,
    userPrompt: `QA-B Confirmation. ${focus}\n\n${resolutionContract}\n\nPREVIOUS BLOCKERS:\n${JSON.stringify(input.previousBlockers, null, 2)}`,
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: input.evidenceR2Keys ?? [],
    temperature: 0.2,
    generate: input.generate,
  });

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: input.buildVersionNumber === 2 ? "FIX" : "RELEASE_BLOCKER_FIX",
    toState: "CONFIRMATION",
    stage: "confirmation",
    detail: "Confirmation QA evaluated the repaired Build Version",
  });

  return { qaA: runA.value, qaB: runB.value };
}

// ── Release Blocker Fix (at most one narrow final batch) ────────────────────

export async function runReleaseBlockerFixStage(
  env: Env,
  input: RunFixCoordinatorInput & { remainingBlockers: QaFinding[] }
): Promise<{ plan: FixPlan }> {
  return planWithinBounds(env, input, {
    stage: "release-blocker-fix",
    schemaVersion: FIX_PLAN_SCHEMA_VERSION,
    basePrompt: `Plan at most ONE narrow final Automated Repair batch for the still-valid Release Blockers after failed confirmation. Repair only the narrowest realization details behind the remaining blockers; do not introduce new human intent and do not change Business Facts, Reference, Build Mode or the Visual Blueprint. If you cannot fix a blocker within those bounds, say so via blueprintReviewRequired only when the Blueprint itself is the root cause.

REMAINING VALID BLOCKERS:
${JSON.stringify(input.remainingBlockers, null, 2)}`,
  });
}

// ── Terminal resolution ─────────────────────────────────────────────────────

export type RepairTerminalStatus =
  | "RELEASE_READY"
  | "RELEASE_BLOCKER_FIX_ALLOWED"
  | "HUMAN_REVIEW_REQUIRED"
  | "BLUEPRINT_REVIEW_REQUIRED";

export interface ResolveAfterConfirmationInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  confirmation: ConfirmationQaResult;
  evidenceR2Keys?: string[];
}

export interface ResolveAfterConfirmationResult {
  status: RepairTerminalStatus;
  reasons: string[];
  blockers: QaFinding[];
  polish: QaFinding[];
  /** Resolution records: prior blockers the confirmation verifiably
   *  re-confirmed as fixed (issue #38) — never part of `blockers`. */
  resolved: EvaluableQaFinding[];
  releaseReadyRecordId?: string;
}

export async function resolveAfterConfirmation(
  env: Env,
  input: ResolveAfterConfirmationInput
): Promise<ResolveAfterConfirmationResult> {
  // The release evaluators count only ACTIVE P0/P1 findings as blockers;
  // RESOLVED confirmation findings are returned as `resolved` records and
  // never produce a release reason (issue #38).
  const verdictA = evaluateQaARelease(input.confirmation.qaA);
  const verdictB = evaluateQaBRelease(input.confirmation.qaB);
  const reasons = [...verdictA.reasons, ...verdictB.reasons];
  const blockers = [...verdictA.blockers, ...verdictB.blockers];
  const polish = [...verdictA.polish, ...verdictB.polish];
  const resolved = [...verdictA.resolved, ...verdictB.resolved];

  if (reasons.length === 0) {
    // Terminal success: Release Ready for the exact repaired Build Version.
    const released = await assignReleaseReady(env, {
      buildId: input.buildId,
      buildVersionId: input.buildVersionId,
      siteGenerationId: input.siteGenerationId,
      qaA: input.confirmation.qaA,
      qaB: input.confirmation.qaB,
      qaBuildVersionId: input.buildVersionId,
      evidenceR2Keys: input.evidenceR2Keys ?? [],
    });
    return { status: "RELEASE_READY", reasons: [], blockers, polish, resolved, releaseReadyRecordId: released.recordId };
  }

  const blockerFixUsed = await env.DB.prepare(
    "SELECT id FROM repair_batches WHERE build_id = ? AND kind = 'release_blocker_fix'"
  )
    .bind(input.buildId)
    .first<{ id: string }>();

  if (!blockerFixUsed) {
    return { status: "RELEASE_BLOCKER_FIX_ALLOWED", reasons, blockers, polish, resolved };
  }

  // Repair budget consumed and valid blockers remain: stop automation.
  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "CONFIRMATION",
    toState: "HUMAN_REVIEW_REQUIRED",
    stage: "human_review",
    detail: `HUMAN_REVIEW_REQUIRED: ${blockers.length} valid Release Blocker(s) remain after the bounded repair budget (one Fix Coordinator batch + one Release Blocker Fix): ${reasons.slice(0, 5).join("; ")}`,
  });
  return { status: "HUMAN_REVIEW_REQUIRED", reasons, blockers, polish, resolved };
}

// Degraded vs Failed (PRD section 31): Degraded means a genuinely useful
// Preview/partial result exists while non-optional requirements remain
// unsatisfied; Failed means no usable candidate remains.
export async function classifyTerminalOutcome(
  env: Env,
  input: { buildId: string; buildVersionId: string }
): Promise<{ outcome: "DEGRADED" | "FAILED"; rationale: string }> {
  const useful = await env.DB.prepare(
    "SELECT id FROM build_deployments WHERE build_version_id = ? AND role = 'preview' AND status = 'active'"
  )
    .bind(input.buildVersionId)
    .first<{ id: string }>();

  const outcome = useful ? "DEGRADED" : "FAILED";
  const rationale = useful
    ? "A genuinely useful Preview of this exact Build Version exists while non-optional release requirements remain unsatisfied"
    : "No usable candidate or meaningful partial result remains for the intended contract";

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "HUMAN_REVIEW_REQUIRED",
    toState: outcome,
    stage: "terminal_outcome",
    detail: rationale,
  });
  return { outcome, rationale };
}

export function parseFixPlan(raw: unknown): FixPlan | null {
  return Value.Check(FixPlanSchema, raw) ? (raw as FixPlan) : null;
}
