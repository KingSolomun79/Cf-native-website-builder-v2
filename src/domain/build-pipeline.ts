// V2 production Build pipeline orchestration (issue #30 production wiring).
//
// Runs ONE REFERENCE_BOUND Build from its current open Build Version through
// the full canonical pipeline:
//
//   reference intake (frozen evidence reuse)
//   -> Reference Analysis -> Visual Blueprint -> Implementation Contract
//   -> incremental Site generation -> two-wave images (spend-gated)
//   -> assembly + Technical Preflight -> Preview deployment
//   -> standardized QA evidence -> QA-A/QA-B
//   -> Release Ready OR one bounded Fix Coordinator batch + confirmation
//      + at most one Release Blocker Fix + confirmation
//   -> terminal: RELEASE_READY | HUMAN_REVIEW_REQUIRED | DEGRADED | FAILED
//
// Every seam stays injectable so tests drive deterministic fakes while the
// production defaults wire the real services (ZAI/gateway LLM via the AI
// boundary default generate, KIE image provider, assets-only deployer,
// browser-backed reference/QA capture). The Form Service base URL is the
// platform's own PUBLIC_APP_URL so generated Contact forms post to the real
// central Form Service — never the placeholder default.

import { nowIso } from "../lib/crypto";
import type { Env } from "../env.d";
import { appendBuildWorkflowEvent, createInitialBuild } from "./lifecycle";
import { runReferenceIntake, getFrozenReferenceEvidence, type ReferenceCaptureFn } from "./reference-intake";
import { runReferenceAnalysisStage, ReferenceAnalysisError, createProductionVisionGenerate } from "./reference-analysis";
import { runVisualBlueprintStage, VisualBlueprintError, canonicalRegionComposition, evaluateBlueprintCoverage } from "./visual-blueprint";
import { produceImplementationContract } from "./implementation-planner";
import { generateCompleteSite, regeneratePagesForRealization, SiteGenerationValidationError, type GeneratedSite, type AssemblyFinding, type ImageSlot } from "./site-generator";
import {
  getAcceptedImageMap,
  expandSlotsToTarget,
  type ImageGenerationProvider,
} from "./image-pipeline";
import { runImageGenerationDurable } from "./image-orchestration";
import { buildAssembledCandidate, deployPreview, freezeAssembledCandidate, type PreviewDeployer } from "./assembly";
import { getObject } from "../lib/assets";
import { buildStandardEvidenceBundle, compareGeometry, geometryFromRegions, evaluateReferenceMacroFidelity, type GeometryComparison, type QaCaptureFn } from "./qa-evidence";
import { createCraftCapture, createProductionQaCapture } from "./qa-capture";
import {
  runCraftPreflight,
  storeCraftCrops,
  storedVerdict,
  CRAFT_PREFLIGHT_SCHEMA_VERSION,
  type CraftCapture,
  type StoredCraftPreflight,
} from "./craft-preflight";
import { runQaAStage, runQaBStage, type QaAReport, type QaAReportAugmented, type QaBReport, type QaFinding } from "./qa-stages";
import { buildRepairContext, evaluateRepairRegression, type RepairEvaluationSnapshot } from "./repair-guard";
import { assignReleaseReady, ReleaseGateError } from "./release";
import { getBuildStageArtifact, storeBuildStageArtifactIdempotent } from "./stage-artifacts";
import type { ReferenceAnalysis } from "./reference-analysis";
import type { VisualBlueprint } from "./visual-blueprint";
import type { ImplementationContract } from "./implementation-planner";
import { getEffectiveBusinessFacts } from "./revision";
import {
  applyRepairBatch,
  assertRepairPlanWithinBounds,
  AutomatedRepairError,
  parseFixPlan,
  runConfirmationQa,
  runFixCoordinatorStage,
  runReleaseBlockerFixStage,
  resolveAfterConfirmation,
  type AppliedRepairBatch,
  type FixPlan,
} from "./automated-repair";
import { evaluateQaARelease, evaluateQaBRelease } from "./qa-stages";
import type { RawAiGenerate } from "./ai-boundary";
import { VisionGatewayError } from "../lib/ai-gateway";
import { KieV2ImageProvider } from "../lib/kie-v2";

// Deterministic, unhealable vision-seam failures: every configured vision
// provider was exhausted (VisionGatewayError carries the per-attempt record)
// or the stored visual input is missing/cannot be bounded. Transient faults
// stay covered by the gateway's own per-provider attempts; these terminal
// classifications must surface as an observable pipeline state instead of a
// generic step-retry storm.
function isVisionSeamExhaustion(error: unknown): boolean {
  if (error instanceof VisionGatewayError) return true;
  if (error instanceof ReferenceAnalysisError) {
    return error.code === "VISION_INPUT_UNAVAILABLE" || error.code === "VISION_INPUT_OVERSIZE";
  }
  return false;
}

function visionSeamDetail(error: unknown): string {
  if (error instanceof VisionGatewayError) {
    const attempts = error.attempts
      .map((attempt) => `${attempt.provider}/${attempt.model}#${attempt.attempt}:${attempt.outcome}${attempt.classification ? `(${attempt.classification})` : ""}${attempt.httpStatus ? ` http ${attempt.httpStatus}` : ""}${attempt.responseSnippet ? ` "${attempt.responseSnippet.slice(0, 120)}"` : ""}`)
      .join("; ");
    return attempts || "all configured vision providers failed with no attempt record";
  }
  if (error instanceof ReferenceAnalysisError) {
    return `${error.code}: ${error.message}`;
  }
  return (error as Error).message;
}

export interface BuildPipelineDeps {
  generate?: RawAiGenerate;
  imageProvider?: ImageGenerationProvider;
  previewDeployer?: PreviewDeployer;
  /** Built per Preview deployment; defaults to the browser-backed capture. */
  qaCapture?: (previewUrl: string) => QaCaptureFn;
  /** Reference URL capture; defaults to the production browser capture.
   *  Only invoked when the Site Generation carries a Reference URL. */
  capture?: ReferenceCaptureFn;
  /** Multimodal generate seam (issue #42/#43): used for the analyzer and
   *  generation steps when normalized visual inputs exist. Defaults to the
   *  production vision adapter (real gateway); tests inject deterministic
   *  scripts. */
  visionGenerate?: import("./ai-boundary").RawAiGenerate;
  /** Design Craft Preflight capture seam (issue #49): one home-desktop load.
   *  Defaults to the production browser capture; tests inject layouts. */
  craftCapture?: (previewUrl: string) => Promise<CraftCapture>;
  /** Durable step executor (the workflow's WorkflowStep). Each stage runs as
   *  its own step so a mid-flight isolate eviction retries only that stage;
   *  every stage is idempotent (artifact reuse / spend-resume) by design.
   *  Tests use the passthrough default. */
  step?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  /** Durable wait for the image poll loop (issue #58): the workflow maps this
   *  to step.sleep, so provider waiting pauses the instance instead of
   *  occupying a running step. Defaults to an instant no-op (tests and
   *  immediately-complete providers never wait). */
  sleep?: (name: string, ms: number) => Promise<void>;
}

export type PipelineTerminalStatus =
  | "RELEASE_READY"
  | "HUMAN_REVIEW_REQUIRED"
  | "DEGRADED"
  | "FAILED";

// Deterministic terminal marker (issue #62 §7): returned from inside a
// pipeline step when the stage's own authorized bounded repair is exhausted
// and a deterministic validation blocker persists. Repeating the step reuses
// the same frozen immutable artifacts and re-derives the same findings — it
// can never heal — so the marker is RETURNED instead of thrown to Workflow
// retries (the #60 blueprint-escalation pattern). The generated artifacts
// stay stored and inspectable, so where a candidate exists the pipeline
// escalates to HUMAN_REVIEW_REQUIRED with the precise findings (#62 §8).
interface DeterministicReviewMarker {
  deterministicReview: {
    findings: AssemblyFinding[];
    message: string;
    /** Deployed preview evidence when one exists (realization-repair path). */
    previewUrl: string | null;
  };
}

function deterministicReviewOutcome(
  ids: { siteGenerationId: string; siteId: string; buildId: string; buildVersionId: string },
  review: DeterministicReviewMarker["deterministicReview"],
  repairApplied: boolean,
  qa: { qaA: BuildPipelineOutcome["qaA"]; qaB: BuildPipelineOutcome["qaB"] }
): BuildPipelineOutcome {
  const findings = review.findings.map((finding) => `${finding.id} (${finding.detail})`);
  const reasons = [
    "SITE_GENERATION_REVIEW_REQUIRED: deterministic assembly validation still failing after the stage's bounded informed repair — automation stopped deterministically; candidate retained for review in the Build Version artifacts (#62 §8)",
    ...findings,
  ];
  return {
    terminal: "HUMAN_REVIEW_REQUIRED",
    reasons,
    siteGenerationId: ids.siteGenerationId,
    siteId: ids.siteId,
    buildId: ids.buildId,
    releaseReadyBuildVersionId: null,
    artifactManifestHash: null,
    previewUrl: review.previewUrl,
    qaA: qa.qaA,
    qaB: qa.qaB,
    repairApplied,
  };
}

export interface BuildPipelineOutcome {
  terminal: PipelineTerminalStatus;
  reasons: string[];
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  releaseReadyBuildVersionId: string | null;
  artifactManifestHash: string | null;
  previewUrl: string | null;
  qaA: QaAReportAugmented | null;
  qaB: QaBReport | null;
  repairApplied: boolean;
}

interface VersionContext {
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
}

async function loadSiteId(env: Env, siteGenerationId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?")
    .bind(siteGenerationId)
    .first<{ site_id: string }>();
  if (!row) throw new Error(`Site Generation ${siteGenerationId} not found`);
  return row.site_id;
}

async function currentVersionNumber(env: Env, buildId: string): Promise<{ buildVersionId: string; buildVersionNumber: number }> {
  const row = await env.DB.prepare("SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1")
    .bind(buildId)
    .first<{ id: string; version_number: number }>();
  if (!row) throw new Error(`Build ${buildId} has no Build Version`);
  return { buildVersionId: row.id, buildVersionNumber: row.version_number };
}

// ── Bounded-repair state, reconstructed from D1 truth ────────────────────────
// The repair loop's control flags are memory-only and do not survive the
// Workflow engine re-running this function after a Durable Object reset or
// isolate eviction. The append-only repair_batches ledger is the durable
// source of truth for how much of the bounded budget a Build has consumed.

interface RepairBatchRef {
  batchId: string;
  sourceBuildVersionId: string;
  createdBuildVersionId: string;
}

interface RepairStateSnapshot {
  fixCoordinator: RepairBatchRef | null;
  releaseBlockerFix: RepairBatchRef | null;
}

async function loadRepairState(env: Env, buildId: string): Promise<RepairStateSnapshot> {
  const { results } = await env.DB.prepare(
    "SELECT id, kind, source_build_version_id, created_build_version_id FROM repair_batches WHERE build_id = ?"
  )
    .bind(buildId)
    .all<{ id: string; kind: string; source_build_version_id: string; created_build_version_id: string }>();
  const pick = (kind: string): RepairBatchRef | null => {
    const row = results.find((batch) => batch.kind === kind);
    return row
      ? { batchId: row.id, sourceBuildVersionId: row.source_build_version_id, createdBuildVersionId: row.created_build_version_id }
      : null;
  };
  return { fixCoordinator: pick("fix_coordinator"), releaseBlockerFix: pick("release_blocker_fix") };
}

async function hasRepairBatch(env: Env, buildId: string, kind: "fix_coordinator" | "release_blocker_fix"): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM repair_batches WHERE build_id = ? AND kind = ?")
    .bind(buildId, kind)
    .first<{ id: string }>();
  return row !== null;
}

// The Fix Plan of the batch that CREATED this Build Version (D1 truth, so it
// survives Workflow engine re-entries). The plan's realization directives are
// what the repaired version's generation must apply — a repaired candidate is
// regenerated with them, never silently copied from the failed version.
async function loadRepairPlanForVersion(env: Env, buildId: string, buildVersionId: string): Promise<FixPlan | null> {
  const row = await env.DB.prepare(
    "SELECT plan_json FROM repair_batches WHERE build_id = ? AND created_build_version_id = ?"
  )
    .bind(buildId, buildVersionId)
    .first<{ plan_json: string }>();
  if (!row) return null;
  const parsed = parseFixPlan(JSON.parse(row.plan_json));
  if (!parsed) throw new Error(`repair batch plan for Build Version ${buildVersionId} failed its schema`);
  assertRepairPlanWithinBounds(parsed);
  return parsed;
}

// The frozen combined QA report stored by assignReleaseReady — a version's
// evaluation verdict, immutable once stored.
interface FrozenQaReport {
  schemaVersion: string;
  qaA: QaAReportAugmented;
  qaB: QaBReport;
  geometryComparison: GeometryComparison | null;
  releaseBlockers: QaFinding[];
  nonBlockingPolish: QaFinding[];
  evidenceR2Keys: string[];
  verdict: "RELEASE_READY" | "NOT_RELEASE_READY";
  reasons: string[];
}

// Copy the previous version's Accepted Images onto a repaired Build Version:
// the persisted attempts stay valid project-controlled assets, so the repair
// regeneration reuses them without burning further KIE budget.
async function reuseAcceptedImages(env: Env, fromBuildVersionId: string, toBuildVersionId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO accepted_images (build_version_id, slot_id, attempt_id, r2_key, accepted_at)
     SELECT ?, slot_id, attempt_id, r2_key, datetime('now')
     FROM accepted_images WHERE build_version_id = ?
     ON CONFLICT (build_version_id, slot_id) DO NOTHING`
  )
    .bind(toBuildVersionId, fromBuildVersionId)
    .run();
}

// Inherits the source Build Version's DESIGN-ORIGIN artifacts onto the
// repaired Build Version: reference analysis, blueprint, contract and the
// image plan. Automated Repair never mutates the validated design — only the
// realization (pages/css/js) is regenerated, driven by the batch's Fix Plan
// directives. R2 objects are shared read-only (same immutable content, same
// keys); each version gets its own artifact rows so per-version immutability
// and provenance stay truthful. Idempotent (INSERT OR IGNORE) so re-running
// the inheritance after a Workflow engine reset restores it harmlessly. The
// id is computed PER ROW inside the SELECT — a bound single id would collide
// on the primary key and silently copy only the first row.
async function inheritValidatedArtifacts(env: Env, buildId: string, fromBuildVersionId: string, toBuildVersionId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO build_stage_artifacts (id, build_id, build_version_id, site_generation_id, kind, subkey, schema_version, artifact_r2_key, provenance_json, checksum, created_at)
     SELECT lower(hex(randomblob(16))), ?, ?, site_generation_id, kind, subkey, schema_version, artifact_r2_key, provenance_json, checksum, ?
     FROM build_stage_artifacts
     WHERE build_version_id = ? AND kind IN ('reference_analysis', 'visual_blueprint', 'implementation_contract', 'image_plan')`
  )
    .bind(buildId, toBuildVersionId, nowIso(), fromBuildVersionId)
    .run();
}

function repairDirectivesFromPlan(plan: FixPlan): string {
  return plan.repairs.map((repair) => `- target=${repair.target} strategy=${repair.strategy}${repair.slotId ? ` slot=${repair.slotId}` : ""}: ${repair.description}`).join("\n");
}

export async function runBuildPipeline(
  env: Env,
  input: { siteGenerationId: string; buildId?: string; deps?: BuildPipelineDeps }
): Promise<BuildPipelineOutcome> {
  const deps = input.deps ?? {};
  const stepDo = deps.step ?? (async <T>(_name: string, fn: () => Promise<T>) => fn());
  const buildId =
    input.buildId ?? (await createInitialBuild(env, { siteGenerationId: input.siteGenerationId })).buildId;
  const siteId = await loadSiteId(env, input.siteGenerationId);

  const generation = await env.DB.prepare("SELECT build_mode FROM site_generations WHERE id = ?")
    .bind(input.siteGenerationId)
    .first<{ build_mode: string }>();
  if (generation?.build_mode !== "REFERENCE_BOUND") {
    await appendBuildWorkflowEvent(env, {
      buildId,
      fromState: "INTAKE_READY",
      toState: "HUMAN_REVIEW_REQUIRED",
      stage: "intake",
      detail: `Build Mode '${generation?.build_mode ?? "unknown"}' has no production pipeline yet (ORIGINAL_DESIGN is locked behind the REFERENCE_BOUND proof gate)`,
    });
    return {
      terminal: "HUMAN_REVIEW_REQUIRED",
      reasons: [`Build Mode '${generation?.build_mode ?? "unknown"}' has no production pipeline`],
      siteGenerationId: input.siteGenerationId,
      siteId,
      buildId,
      releaseReadyBuildVersionId: null,
      artifactManifestHash: null,
      previewUrl: null,
      qaA: null,
      qaB: null,
      repairApplied: false,
    };
  }

  let version = await currentVersionNumber(env, buildId);
  let priorVersionId: string | null = null;

  // Bounded-repair position, reconstructed from D1 truth on EVERY entry: the
  // engine may re-run this function after a Durable Object reset with the
  // loop flags below gone. Reconstructing from the repair_batches ledger is
  // what keeps a retried pipeline from misreading the repair budget and
  // terminating with a premature REPAIR_BUDGET_EXHAUSTED.
  const repairState = await loadRepairState(env, buildId);
  let repairApplied = repairState.fixCoordinator !== null;

  // Batch-created Build Versions inherit the source version's design-origin
  // artifacts. Re-running the idempotent inheritance on every entry restores
  // it after a reset, so a re-entered pipeline reuses the repaired version's
  // frozen design instead of regenerating it.
  for (const batch of [repairState.fixCoordinator, repairState.releaseBlockerFix]) {
    if (!batch) continue;
    await reuseAcceptedImages(env, batch.sourceBuildVersionId, batch.createdBuildVersionId);
    await inheritValidatedArtifacts(env, buildId, batch.sourceBuildVersionId, batch.createdBuildVersionId);
  }

  // A current version created by a repair batch is GENERATED WITH that batch's
  // Fix Plan directives (D1 truth — survives engine re-entries). The
  // realization is repaired, not copied from the failed version; the frozen
  // design and Accepted Images are inherited unchanged.
  const currentVersionRepairPlan = await loadRepairPlanForVersion(env, buildId, version.buildVersionId);

  try {
    // ── Reference intake (idempotent: frozen evidence is reused) ───────────
    const frozenPackage = await runReferenceIntake(env, {
      siteGenerationId: input.siteGenerationId,
      buildId,
      buildVersionId: version.buildVersionId,
      buildVersionNumber: version.buildVersionNumber,
      capture: deps.capture,
    });
    const frozen = await getFrozenReferenceEvidence(env, input.siteGenerationId);
    if (!frozen) throw new Error("frozen evidence package missing after intake");

    if (frozenPackage.suitability === "UNSUPPORTED") {
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "REFERENCE_CHECK",
        toState: "HUMAN_REVIEW_REQUIRED",
        stage: "reference_suitability",
        detail: `UNSUPPORTED Reference: ${frozenPackage.suitabilityReasons.join("; ").slice(0, 300)}`,
      });
      return {
        terminal: "HUMAN_REVIEW_REQUIRED",
        reasons: [`UNSUPPORTED Reference: ${frozenPackage.suitabilityReasons.join("; ")}`],
        siteGenerationId: input.siteGenerationId, siteId, buildId,
        releaseReadyBuildVersionId: null, artifactManifestHash: null, previewUrl: null,
        qaA: null, qaB: null, repairApplied: false,
      };
    }

    // Evidence-sufficiency guard (issue #39): dimensions-only evidence cannot
    // describe the Reference's design identity, so the build fails closed
    // instead of generating a Blueprint from defaults. Fixing the inputs means
    // a NEW Site Generation with a usable screenshot/capture — never a silent
    // mode switch. Root cause per the PRD §45 taxonomy: EVIDENCE_EXTRACTION.
    if (frozen.evidenceSufficiency.sufficiency === "INSUFFICIENT") {
      const reason = `INSUFFICIENT_REFERENCE_EVIDENCE (root cause: EVIDENCE_EXTRACTION): ${frozen.evidenceSufficiency.reasons.join("; ")}`;
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "REFERENCE_EVIDENCE",
        toState: "HUMAN_REVIEW_REQUIRED",
        stage: "reference_evidence_sufficiency",
        detail: reason.slice(0, 400),
      });
      return {
        terminal: "HUMAN_REVIEW_REQUIRED",
        reasons: [reason],
        siteGenerationId: input.siteGenerationId, siteId, buildId,
        releaseReadyBuildVersionId: null, artifactManifestHash: null, previewUrl: null,
        qaA: null, qaB: null, repairApplied: false,
      };
    }

    // ── Analysis -> Blueprint -> Contract (each its own durable step) ─────
    // Retry safety lives at THIS seam: a stage whose frozen artifact already
    // exists for the Build Version is reused verbatim; the domain stages
    // themselves stay strictly once-per-version.
    //
    // Vision-seam exhaustion (all configured vision providers rejected or
    // could not be bounded) is deterministic and cannot heal through the
    // generic step-retry budget — it returns a terminal marker from inside
    // the step so the pipeline records an observable FAILED state with the
    // per-attempt evidence (production retest 2026-09-05: silent retry storms
    // here used to outlive the outer workflow step timeout with zero
    // recorded diagnostics).
    const analysis = await stepDo("pipeline: reference analysis", async (): Promise<
      | { kind: "produced"; analysis: ReferenceAnalysis; artifactR2Key: string }
      | { kind: "vision-seam-unavailable"; detail: string }
    > => {
      const existingAnalysis = await getBuildStageArtifact<ReferenceAnalysis>(env, version.buildVersionId, "reference_analysis");
      if (existingAnalysis) {
        return { kind: "produced", analysis: existingAnalysis.value, artifactR2Key: existingAnalysis.artifactR2Key };
      }
      try {
        const produced = await runReferenceAnalysisStage(env, {
          siteGenerationId: input.siteGenerationId,
          buildId,
          buildVersionId: version.buildVersionId,
          buildVersionNumber: version.buildVersionNumber,
          evidence: frozen.evidence,
          evidenceR2Key: frozen.evidenceR2Key,
          visualInputs: frozen.evidence.visualInputs,
          visionGenerate: deps.visionGenerate,
          generate: deps.generate,
        });
        return { kind: "produced", analysis: produced.analysis, artifactR2Key: produced.artifactR2Key };
      } catch (error) {
        if (isVisionSeamExhaustion(error)) {
          return { kind: "vision-seam-unavailable", detail: visionSeamDetail(error) };
        }
        throw error;
      }
    });
    if (analysis.kind === "vision-seam-unavailable") {
      const reason = `REFERENCE_ANALYSIS vision seam unavailable: ${analysis.detail}`;
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "REFERENCE_ANALYSIS",
        toState: "FAILED",
        stage: "reference_analysis",
        detail: reason.slice(0, 400),
      });
      return {
        terminal: "FAILED",
        reasons: [reason],
        siteGenerationId: input.siteGenerationId, siteId, buildId,
        releaseReadyBuildVersionId: null, artifactManifestHash: null, previewUrl: null,
        qaA: null, qaB: null, repairApplied: false,
      };
    }

    const facts = (await getEffectiveBusinessFacts(env, buildId)).facts;
    const blueprint = await stepDo(
      "pipeline: visual blueprint",
      async (): Promise<
        | { blueprint: VisualBlueprint; artifactR2Key: string }
        | { blueprintReviewRequired: { code: string; message: string } }
      > => {
        const existingBlueprint = await getBuildStageArtifact<VisualBlueprint>(env, version.buildVersionId, "visual_blueprint");
        if (existingBlueprint) {
          return { blueprint: existingBlueprint.value, artifactR2Key: existingBlueprint.artifactR2Key };
        }
        try {
          return await runVisualBlueprintStage(env, {
          siteGenerationId: input.siteGenerationId,
          buildId,
          buildVersionId: version.buildVersionId,
          buildVersionNumber: version.buildVersionNumber,
          analysis: analysis.analysis,
          analysisR2Key: analysis.artifactR2Key,
          facts,
          adaptationContract: frozen.adaptationContract ?? null,
          evidenceRegions: frozen.evidence.regions.map((region) => ({
            id: region.id,
            ...(typeof region.viewportHeightRatio === "number" ? { viewportHeightRatio: region.viewportHeightRatio } : {}),
          })),
          referenceUrl: frozen.evidence.referenceUrl,
          generate: deps.generate,
          });
        } catch (error) {
          if (error instanceof VisualBlueprintError) {
            // Issue #60 §24-25: the stage already spent its initial generation
            // and its ONE informed, preservation-set-bound repair. A second
            // deterministic rejection is a blueprint-root defect — escalate
            // domain-visibly instead of burning the step-retry budget on
            // identical re-prompts (the 2026-09-06 production failure mode).
            return { blueprintReviewRequired: { code: error.code, message: error.message } };
          }
          throw error;
        }
      }
    );
    if ("blueprintReviewRequired" in blueprint) {
      const reason = `BLUEPRINT_REVIEW_REQUIRED: blueprint rejected by deterministic validation after the bounded informed repair — ${blueprint.blueprintReviewRequired.code}: ${blueprint.blueprintReviewRequired.message}`;
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "REFERENCE_ANALYSIS",
        toState: "HUMAN_REVIEW_REQUIRED",
        stage: "blueprint",
        detail: reason.slice(0, 400),
      });
      return {
        terminal: "HUMAN_REVIEW_REQUIRED",
        reasons: [reason],
        siteGenerationId: input.siteGenerationId, siteId, buildId,
        releaseReadyBuildVersionId: null, artifactManifestHash: null, previewUrl: null,
        qaA: null, qaB: null, repairApplied: false,
      };
    }

    // ── Blueprint coverage contract (issue #42) ─────────────────────────────
    // The Blueprint may aggregate the reference but may never erase it: every
    // identity-defining analysis trait and every major measured visual mass
    // must map to a canonical region/trait or an explicit Adaptation Contract
    // entry. A gap is a BLUEPRINT-ROOT defect — escalate to human review
    // instead of generating from a known-lossy Blueprint.
    const coverage = evaluateBlueprintCoverage({
      blueprint: blueprint.blueprint,
      analysis: analysis.analysis,
      evidenceRegions: frozen.evidence.regions,
      extraction: frozen.evidence.extraction,
      adaptationContract: frozen.adaptationContract,
    });
    if (coverage.status === "GAPS") {
      const reason = `BLUEPRINT_REVIEW_REQUIRED: blueprint fails the reference coverage contract — ${coverage.reasons.join("; ")}`;
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "BLUEPRINT",
        toState: "HUMAN_REVIEW_REQUIRED",
        stage: "blueprint_coverage",
        detail: reason.slice(0, 400),
      });
      return {
        terminal: "HUMAN_REVIEW_REQUIRED",
        reasons: [reason],
        siteGenerationId: input.siteGenerationId, siteId, buildId,
        releaseReadyBuildVersionId: null, artifactManifestHash: null, previewUrl: null,
        qaA: null, qaB: null, repairApplied: false,
      };
    }

    const contract = await stepDo("pipeline: implementation contract", async () => {
      const existingContract = await getBuildStageArtifact<ImplementationContract>(env, version.buildVersionId, "implementation_contract");
      if (existingContract) {
        return { contract: existingContract.value, artifactR2Key: existingContract.artifactR2Key };
      }
      return produceImplementationContract(env, {
      siteGenerationId: input.siteGenerationId,
      buildId,
      buildVersionId: version.buildVersionId,
      siteId,
      blueprint: blueprint.blueprint,
      facts,
      formServiceBaseurl: env.PUBLIC_APP_URL,
      });
    });
    if (contract.contract.blockers.length > 0) {
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "IMPLEMENTATION_PLAN",
        toState: "HUMAN_REVIEW_REQUIRED",
        stage: "implementation_plan",
        detail: `Implementation Contract surfaced explicit blockers: ${JSON.stringify(contract.contract.blockers).slice(0, 300)}`,
      });
      return {
        terminal: "HUMAN_REVIEW_REQUIRED",
        reasons: [`Implementation Contract blockers: ${JSON.stringify(contract.contract.blockers)}`],
        siteGenerationId: input.siteGenerationId, siteId, buildId,
        releaseReadyBuildVersionId: null, artifactManifestHash: null, previewUrl: null,
        qaA: null, qaB: null, repairApplied: false,
      };
    }

    // ── Canonical region composition (issue #37) ───────────────────────────
    // The Blueprint's canonical region topology is the ONLY binding structure
    // for generation and QA. Frozen Reference Evidence measurements are
    // aggregated per canonical region through provenance, so the generator
    // receives numeric per-region targets and QA compares measured geometry
    // against the SAME canonical regions. Blueprints frozen before the
    // provenance field carry no aggregation mapping — those keep the legacy
    // raw-evidence mapping so a re-entered old version still evaluates
    // instead of silently losing its measured-fidelity evidence.
    const canonicalComposition = canonicalRegionComposition(blueprint.blueprint, frozen.evidence.regions);
    const compositionFullyMeasured =
      canonicalComposition.length > 0 &&
      canonicalComposition.every((region) => region.viewportHeightRatio !== null);

    // ── Candidate production (generation -> images -> assembly -> preview) ─
    // NOTE: step results are capped at 1MiB by the Workflows engine — the
    // candidate's bundled image bytes must never cross a step boundary, only
    // its manifest hash and Preview URL do.
    const produceCandidate = async (
      ctx: VersionContext,
      repairDirectives?: string
    ): Promise<
      | { kind: "ok"; manifestHash: string; previewUrl: string }
      | { kind: "deterministic-review"; review: DeterministicReviewMarker["deterministicReview"] }
    > => {
      const compositionTargets = compositionFullyMeasured
        ? canonicalComposition.map((region) => ({
            regionId: region.regionId,
            viewportHeightRatio: region.viewportHeightRatio!,
            evidenceSegmentCount: region.sourceEvidenceRegionIds.length,
          }))
        : undefined;
      const site = await stepDo(
        `pipeline: generate site (v${ctx.buildVersionNumber})`,
        async (): Promise<GeneratedSite | DeterministicReviewMarker> => {
          try {
            return await generateCompleteSite(env, {
              siteGenerationId: ctx.siteGenerationId,
              siteId: ctx.siteId,
              buildId: ctx.buildId,
              buildVersionId: ctx.buildVersionId,
              visualInputs: frozen.evidence.visualInputs,
              visionGenerate: deps.visionGenerate,
              buildVersionNumber: ctx.buildVersionNumber,
              blueprint: blueprint.blueprint,
              blueprintR2Key: blueprint.artifactR2Key,
              contract: contract.contract,
              contractR2Key: contract.artifactR2Key,
              generate: deps.generate,
              compositionTargets,
              ...(repairDirectives ? { repairDirectives } : {}),
            });
          } catch (error) {
            // Issue #62 §7: deterministic assembly validation after the ONE
            // informed assembly repair (e.g. ORPHANED_CLASS,
            // FABRICATED_TRUST_ENTITY). Repeating the step reloads the same
            // frozen artifacts and returns the same findings — it must not
            // burn the Workflow retry budget. Candidate exists (pages/CSS/JS
            // are stored immutable) -> HUMAN_REVIEW_REQUIRED via the marker.
            if (error instanceof SiteGenerationValidationError) {
              return { deterministicReview: { findings: error.findings, message: error.message, previewUrl: null } };
            }
            throw error;
          }
        }
      );
      if ("deterministicReview" in site) {
        return { kind: "deterministic-review", review: site.deterministicReview };
      }

      // Normal 12-Accepted-Image target with spend-resume idempotency: expand
      // to the target, then generate only slots without an acceptance for THIS
      // version, so a retried pipeline never re-spends KIE.
      const plannedSlots = expandSlotsToTarget(site.imagePlan.slots);
      const accepted = await getAcceptedImageMap(env, ctx.buildVersionId);
      const unresolved = plannedSlots.filter((slot) => !accepted.has(slot.id));
      if (unresolved.length > 0) {
        // Durable image lifecycle (issue #58): submission, polling and waiting
        // are separate durable steps — a slow provider sleeps the Workflow
        // (step.sleep) instead of occupying one long-running step, and a slow
        // image can never own the fate of the surrounding pipeline stages.
        await runImageGenerationDurable(env, {
          siteGenerationId: ctx.siteGenerationId,
          buildId: ctx.buildId,
          buildVersionId: ctx.buildVersionId,
          buildVersionNumber: ctx.buildVersionNumber,
          slots: unresolved,
          provider: deps.imageProvider ?? new KieV2ImageProvider(env),
          generate: deps.generate,
          expandToTarget: false,
        }, {
          stepDo,
          ...(deps.sleep ? { sleep: deps.sleep } : {}),
        });
      }

      const acceptedImageEntries = await getAcceptedImageMap(env, ctx.buildVersionId);
      const acceptedImages = new Map([...acceptedImageEntries].map(([slotId, entry]) => [slotId, entry.r2Key] as const));
      const candidate = await stepDo(
        `pipeline: assemble + preview (v${ctx.buildVersionNumber})`,
        async (): Promise<{ manifestHash: string; previewUrl: string } | DeterministicReviewMarker> => {
        const craftInputs = {
          buildId: ctx.buildId,
          buildVersionId: ctx.buildVersionId,
          siteGenerationId: ctx.siteGenerationId,
          siteId: ctx.siteId,
          buildVersionNumber: ctx.buildVersionNumber,
        };
        // Deterministic Reference side for the craft preflight (issue #49 D/E):
        // the frozen normalized screenshot + its measured region coordinates.
        // Absent evidence simply loses the reference side of a crop — the
        // coordinates are never invented.
        const buildReferenceSide = async () => {
          const primary = frozen.evidence.visualInputs?.find((entry) => entry.kind === "full-page") ?? frozen.evidence.visualInputs?.[0];
          if (!primary) return null;
          const body = await getObject(env, primary.artifact);
          if (!body) return null;
          return {
            screenshot: new Uint8Array(await new Response(body).arrayBuffer()),
            cssViewportWidth: frozen.evidence.screenshotMetadata.likelyCssViewportWidth ?? 1440,
            regions: frozen.evidence.regions.map((region) => ({
              id: region.id,
              ...(typeof region.startY === "number" ? { startY: region.startY } : {}),
              ...(typeof region.endY === "number" ? { endY: region.endY } : {}),
            })),
          };
        };

        // Workflow-retry safety: the craft verdict is FROZEN per attempt. A
        // re-entered pipeline reuses attempt-1's verdict (and whatever repair
        // subkeys it already produced) instead of re-deciding on a fresh
        // browser roll — the whole step rebuilds deterministically.
        const existingCraft = await getBuildStageArtifact<StoredCraftPreflight>(env, ctx.buildVersionId, "craft_preflight", "attempt-1");
        let craft: StoredCraftPreflight | null = existingCraft ? existingCraft.value : null;

        // Build (pure) + deploy. Nothing is frozen yet: the intermediate
        // candidate may still be superseded by the one informed repair round,
        // and only the FINAL candidate ever occupies the immutable keys
        // (issue #49 lifecycle seam).
        let built = await buildAssembledCandidate(env, {
          siteGenerationId: ctx.siteGenerationId,
          buildId: ctx.buildId,
          buildVersionId: ctx.buildVersionId,
          buildVersionNumber: ctx.buildVersionNumber,
          pages: site.pages,
          sharedCss: site.sharedCss,
          sharedJs: site.sharedJs,
          imagePlanSlots: site.imagePlan.slots,
          acceptedImages,
          formServiceEndpoint: contract.contract.formContract.formServiceEndpoint,
          expectedSiteFormId: contract.contract.formContract.siteFormId,
        });
        let preview = await deployPreview(env, {
          buildId: ctx.buildId,
          buildVersionId: ctx.buildVersionId,
          buildVersionNumber: ctx.buildVersionNumber,
          candidate: built,
          ...(deps.previewDeployer ? { deployer: deps.previewDeployer } : {}),
        });

        if (!craft) {
          const capture = await (deps.craftCapture ? deps.craftCapture(preview.previewUrl) : createCraftCapture(env, preview.previewUrl));
          const referenceSide = await buildReferenceSide();
          const verdict = await runCraftPreflight(
            {
              capture,
              blueprint: blueprint.blueprint,
              contract: contract.contract,
              slots: site.imagePlan.slots,
              ...(compositionTargets ? { compositionTargets: compositionTargets.map(({ regionId, viewportHeightRatio }) => ({ regionId, viewportHeightRatio })) } : {}),
              referenceImageMassRatio: frozen.evidence.extraction?.imageMassRatio ?? null,
              ...(referenceSide ? { reference: referenceSide } : {}),
            },
            1
          );
          await storeCraftCrops(env, { buildId: ctx.buildId, buildVersionNumber: ctx.buildVersionNumber, attempt: 1, crops: verdict.crops });
          craft = storedVerdict(verdict);
          await storeBuildStageArtifactIdempotent(env, {
            ...craftInputs,
            kind: "craft_preflight",
            subkey: "attempt-1",
            schemaVersion: CRAFT_PREFLIGHT_SCHEMA_VERSION,
            value: craft,
          });
          void existingCraft;
          await appendBuildWorkflowEvent(env, {
            buildId: ctx.buildId, buildVersionId: ctx.buildVersionId,
            fromState: "PREVIEW", toState: "PREVIEW", stage: "craft_preflight",
            detail: verdict.passed
              ? "Design Craft Preflight passed (deterministic checks, one home-desktop capture)"
              : `Design Craft Preflight found ${verdict.findings.length} gross realization deviation(s)`,
          });
        }

        // At most ONE informed per-page realization repair (issue #49 G):
        // driven only by page-realization findings, consuming no QA repair
        // budget, reusing the #47 entry point's immutable subkeys.
        if (!craft.passed && craft.pageRepairable) {
          const affected = [...new Set(craft.findings.filter((finding) => finding.repairScope === "page-realization").map((finding) => finding.affectedPage))];
          const cropVisualInputs = craft.crops.flatMap((pair, index) => {
            const inputs: Array<{ kind: "slice"; artifact: string; sha256: string; width: number; height: number; sliceIndex: number }> = [];
            if (pair.reference) inputs.push({ kind: "slice" as const, artifact: pair.reference.artifactR2Key, sha256: pair.reference.cropSha256, width: pair.reference.width, height: pair.reference.height, sliceIndex: index * 2 });
            if (pair.candidate) inputs.push({ kind: "slice" as const, artifact: pair.candidate.artifactR2Key, sha256: pair.candidate.cropSha256, width: pair.candidate.width, height: pair.candidate.height, sliceIndex: index * 2 + 1 });
            return inputs;
          });
          // Issue #62 §7: the same deterministic-terminal rule applies to the
          // realization repair's re-validation — after its one bounded round,
          // a persisting validation blocker returns the review marker (with
          // the deployed preview as inspectable evidence) instead of throwing
          // into Workflow retries.
          let regenerated: Awaited<ReturnType<typeof regeneratePagesForRealization>>;
          try {
            regenerated = await regeneratePagesForRealization(env, {
              ...craftInputs,
              blueprint: blueprint.blueprint,
              blueprintR2Key: blueprint.artifactR2Key,
              contract: contract.contract,
              contractR2Key: contract.artifactR2Key,
              imagePlan: site.imagePlan,
              affected,
              findingDirectives: craft.directiveText,
              ...(compositionTargets ? { compositionTargets } : {}),
              ...(cropVisualInputs.length > 0 ? { visualInputs: cropVisualInputs } : {}),
              visionGenerate:
                cropVisualInputs.length > 0
                  ? deps.visionGenerate ??
                    createProductionVisionGenerate(env, cropVisualInputs, {
                      buildId: ctx.buildId,
                      buildVersionNumber: ctx.buildVersionNumber,
                    })
                  : deps.generate,
              generate: deps.generate,
            });
          } catch (error) {
            if (error instanceof SiteGenerationValidationError) {
              return { deterministicReview: { findings: error.findings, message: error.message, previewUrl: preview.previewUrl } };
            }
            throw error;
          }

          built = await buildAssembledCandidate(env, {
            siteGenerationId: ctx.siteGenerationId,
            buildId: ctx.buildId,
            buildVersionId: ctx.buildVersionId,
            buildVersionNumber: ctx.buildVersionNumber,
            pages: regenerated.pages,
            sharedCss: regenerated.sharedCss,
            sharedJs: regenerated.sharedJs,
            imagePlanSlots: site.imagePlan.slots,
            acceptedImages,
            formServiceEndpoint: contract.contract.formContract.formServiceEndpoint,
            expectedSiteFormId: contract.contract.formContract.siteFormId,
          });
          preview = await deployPreview(env, {
            buildId: ctx.buildId,
            buildVersionId: ctx.buildVersionId,
            buildVersionNumber: ctx.buildVersionNumber,
            candidate: built,
            ...(deps.previewDeployer ? { deployer: deps.previewDeployer } : {}),
          });
          if (!(await getBuildStageArtifact<StoredCraftPreflight>(env, ctx.buildVersionId, "craft_preflight", "attempt-2"))) {
            const capture2 = await (deps.craftCapture ? deps.craftCapture(preview.previewUrl) : createCraftCapture(env, preview.previewUrl));
            const referenceSide2 = await buildReferenceSide();
            const verdict2 = await runCraftPreflight(
              {
                capture: capture2,
                blueprint: blueprint.blueprint,
                contract: contract.contract,
                slots: site.imagePlan.slots,
                ...(compositionTargets ? { compositionTargets: compositionTargets.map(({ regionId, viewportHeightRatio }) => ({ regionId, viewportHeightRatio })) } : {}),
                referenceImageMassRatio: frozen.evidence.extraction?.imageMassRatio ?? null,
                ...(referenceSide2 ? { reference: referenceSide2 } : {}),
              },
              2
            );
            await storeCraftCrops(env, { buildId: ctx.buildId, buildVersionNumber: ctx.buildVersionNumber, attempt: 2, crops: verdict2.crops });
            await storeBuildStageArtifactIdempotent(env, {
              ...craftInputs,
              kind: "craft_preflight",
              subkey: "attempt-2",
              schemaVersion: CRAFT_PREFLIGHT_SCHEMA_VERSION,
              value: storedVerdict(verdict2),
            });
          }
          // Per issue #49 G the repair round is over either way — the
          // candidate proceeds to full QA with its attempt-2 evidence.
        }

        // Only the surviving candidate is frozen: invalid intermediate
        // candidates never occupy the immutable version keys.
        await freezeAssembledCandidate(env, {
          siteGenerationId: ctx.siteGenerationId,
          buildId: ctx.buildId,
          buildVersionId: ctx.buildVersionId,
          buildVersionNumber: ctx.buildVersionNumber,
          pages: built.pages,
          sharedCss: built.sharedCss,
          sharedJs: built.sharedJs,
          candidate: built,
          imagePlanSlots: site.imagePlan.slots,
          acceptedImages,
          formServiceEndpoint: contract.contract.formContract.formServiceEndpoint,
          expectedSiteFormId: contract.contract.formContract.siteFormId,
        });
        return { manifestHash: built.artifactManifestHash, previewUrl: preview.previewUrl };
      });
      if ("deterministicReview" in candidate) {
        return { kind: "deterministic-review", review: candidate.deterministicReview };
      }
      return { kind: "ok", manifestHash: candidate.manifestHash, previewUrl: candidate.previewUrl };
    };

    const evaluate = async (
      ctx: VersionContext,
      previewUrl: string,
      acceptedImageCount: number
    ): Promise<{ qaA: QaAReportAugmented; qaB: QaBReport; release: Awaited<ReturnType<typeof assignReleaseReady>>; macroFidelity?: Awaited<ReturnType<typeof evaluateReferenceMacroFidelity>>; geometryComparison?: GeometryComparison }> => {
      // The evidence capture (9 browser page loads) and the QA verdicts
      // (QA-A/QA-B/release) run as SEPARATE steps: one combined step exceeds
      // the isolate eviction window and gets killed mid-flight on retry.
      const evidenceBundle = await stepDo(`pipeline: QA evidence (v${ctx.buildVersionNumber})`, () => buildStandardEvidenceBundle(env, {
        buildId: ctx.buildId,
        buildVersionId: ctx.buildVersionId,
        buildVersionNumber: ctx.buildVersionNumber,
        siteGenerationId: ctx.siteGenerationId,
        capture: deps.qaCapture ? deps.qaCapture(previewUrl) : createProductionQaCapture(env, previewUrl),
      }));

      return stepDo(`pipeline: QA verdicts (v${ctx.buildVersionNumber})`, async () => {
      // Workflow-retry safety: a version's evaluation is frozen in its
      // qa_report artifact. A re-entered pipeline reuses that verdict instead
      // of re-judging the immutable version with fresh LLM runs (which could
      // never reproduce the frozen checksum and would hard-fail the store).
      const frozenReport = await getBuildStageArtifact<FrozenQaReport>(env, ctx.buildVersionId, "qa_report");
      if (frozenReport) {
        const releaseReady = frozenReport.value.verdict === "RELEASE_READY";
        if (releaseReady) {
          // A reset can hit the window between the report store and the
          // release-record insert: re-assigning with the frozen verdicts
          // reproduces the identical checksum (idempotent store) and pins
          // the record. An existing record is an idempotent success.
          try {
            await assignReleaseReady(env, {
              buildId: ctx.buildId,
              buildVersionId: ctx.buildVersionId,
              siteGenerationId: ctx.siteGenerationId,
              qaA: frozenReport.value.qaA,
              qaB: frozenReport.value.qaB,
              qaBuildVersionId: ctx.buildVersionId,
              geometryComparison: frozenReport.value.geometryComparison ?? undefined,
              evidenceR2Keys: frozenReport.value.evidenceR2Keys,
            });
          } catch (error) {
            if (!(error instanceof ReleaseGateError && error.code === "RELEASE_ALREADY_ASSIGNED")) throw error;
          }
        }
        return {
          qaA: frozenReport.value.qaA,
          qaB: frozenReport.value.qaB,
          release: {
            releaseReady,
            reasons: frozenReport.value.reasons,
            blockers: frozenReport.value.releaseBlockers,
            polish: frozenReport.value.nonBlockingPolish,
            ...(releaseReady ? { recordId: `release:${ctx.buildVersionId}` } : {}),
          },
        };
      }

      // Geometry comparator (issue #37 topology authority; #41 truthfulness).
      // The REFERENCE side carries only real measurements: region structure
      // from the canonical composition (or raw evidence for legacy
      // blueprints) and image mass from the deterministic screenshot
      // extraction channel when available — the reference image mass is
      // NEVER seeded from the candidate. Metrics without a measured value on
      // both sides are skipped, and an unmeasurable reference profile yields
      // INSUFFICIENT_REFERENCE_EVIDENCE instead of a similarity percentage.
      const homeDesktop = evidenceBundle.bundle.captures.find(
        (capture) => capture.page === "home" && capture.viewportWidth === 1440
      );
      const referenceImageMass = frozen.evidence.extraction?.imageMassRatio ?? null;
      const referenceProfile = compositionFullyMeasured
        ? geometryFromRegions(
            canonicalComposition.map((region) => ({
              id: region.regionId,
              height: region.heightPx ?? 0,
              viewportHeightRatio: region.viewportHeightRatio!,
            })),
            referenceImageMass
          )
        : geometryFromRegions(
            frozen.evidence.regions.flatMap((region) =>
              typeof region.height === "number" && typeof region.viewportHeightRatio === "number"
                ? [{ id: region.id, height: region.height, viewportHeightRatio: region.viewportHeightRatio }]
                : []
            ),
            referenceImageMass
          );
      const candidateProfile = homeDesktop?.geometry ?? null;
      const geometryComparison = candidateProfile
        ? compareGeometry(referenceProfile, candidateProfile)
        : {
            status: "INSUFFICIENT_REFERENCE_EVIDENCE" as const,
            metrics: [],
            similarityScore: null,
            measuredCoverage: 0,
            materialDeviations: [],
          };

      // Multimodal QA-A (issue #44): reference visual package + candidate
      // home capture attached through the vision seam when they exist.
      const homeDesktopCapture = evidenceBundle.bundle.captures.find(
        (capture) => capture.page === "home" && capture.viewportWidth === 1440
      );
      const qaA = await runQaAStage(env, {
        buildId: ctx.buildId,
        siteGenerationId: ctx.siteGenerationId,
        buildVersionId: ctx.buildVersionId,
        buildVersionNumber: ctx.buildVersionNumber,
        context: {
          businessName: facts.businessName,
          geometryComparison,
          evidenceSummary:
            geometryComparison.status === "MEASURED"
              ? `${evidenceBundle.bundle.captures.length} standardized captures (home 1440/768/390, inner pages desktop+mobile); geometry similarity ${geometryComparison.similarityScore} (measurement coverage ${Math.round(geometryComparison.measuredCoverage * 100)}%)`
              : `${evidenceBundle.bundle.captures.length} standardized captures (home 1440/768/390, inner pages desktop+mobile); geometry comparator: INSUFFICIENT_REFERENCE_EVIDENCE (reference measurements absent — no similarity may be claimed)`,
          signatureTraitIds: blueprint.blueprint.signatureTraits.map((trait) => trait.id),
          canonicalRegions: canonicalComposition.map((region) => ({
            order: region.order,
            id: region.regionId,
            purpose: region.purpose,
          })),
          firstViewportRegionIds: [...blueprint.blueprint.homepageFirstViewport.regionIds],
          adaptationContractQaExceptions: frozen.adaptationContract?.qaExceptions ?? [],
        },
        evidenceR2Key: evidenceBundle.artifactR2Key,
        referenceVisualInputs: frozen.evidence.visualInputs,
        candidateHomeCaptureR2Key: homeDesktopCapture?.artifactR2Key,
        visionGenerate: deps.visionGenerate,
        generate: deps.generate,
      });
      const qaB = await runQaBStage(env, {
        buildId: ctx.buildId,
        siteGenerationId: ctx.siteGenerationId,
        buildVersionId: ctx.buildVersionId,
        buildVersionNumber: ctx.buildVersionNumber,
        context: {
          formServiceEndpoint: contract.contract.formContract.formServiceEndpoint,
          evidenceSummary: `${evidenceBundle.bundle.captures.length} standardized captures; ${evidenceBundle.bundle.captures.reduce((sum, capture) => sum + capture.failedRequestCount, 0)} failed network requests`,
          preflightPassed: true,
          imageManifestSummary: `${acceptedImageCount} accepted images bundled`,
        },
        evidenceR2Key: evidenceBundle.artifactR2Key,
        generate: deps.generate,
      });

      // Deterministic direct-fidelity gate (issue #44): non-averageable —
      // appended to the QA-A hard gates so no aggregate score can compensate.
      // An unmeasured reference FAILS closed.
      const macroFidelity = evaluateReferenceMacroFidelity(geometryComparison);
      const qaAForRelease = {
        ...qaA.report,
        hardGates: [
          ...qaA.report.hardGates,
          { id: macroFidelity.gateId, passed: macroFidelity.verdict === "PASS" },
        ],
      };

      let release: Awaited<ReturnType<typeof assignReleaseReady>>;
      try {
        release = await assignReleaseReady(env, {
          buildId: ctx.buildId,
          buildVersionId: ctx.buildVersionId,
          siteGenerationId: ctx.siteGenerationId,
          qaA: qaAForRelease,
          qaB: qaB.report,
          qaBuildVersionId: ctx.buildVersionId,
          geometryComparison,
          evidenceR2Keys: [evidenceBundle.artifactR2Key],
        });
      } catch (error) {
        // Workflow-step retry safety: the exact Build Version already carries
        // a Release Ready record — a retried evaluation is an idempotent
        // success at the orchestration seam (the domain boundary stays
        // strict).
        if (error instanceof ReleaseGateError && error.code === "RELEASE_ALREADY_ASSIGNED") {
          release = { releaseReady: true, reasons: [], blockers: [], polish: [], recordId: `release:${ctx.buildVersionId}` };
        } else {
          throw error;
        }
      }
      return { qaA: qaAForRelease, qaB: qaB.report, release, macroFidelity, geometryComparison };
      });
    };

    // ── First evaluation ───────────────────────────────────────────────────
    const first = await produceCandidate({
      siteGenerationId: input.siteGenerationId, siteId, buildId,
      buildVersionId: version.buildVersionId, buildVersionNumber: version.buildVersionNumber,
    }, currentVersionRepairPlan ? repairDirectivesFromPlan(currentVersionRepairPlan) : undefined);
    if (first.kind === "deterministic-review") {
      // Issue #62 §8: a useful inspectable candidate exists (the generated
      // pages/CSS/JS are stored immutable) but automatic compliance failed —
      // automation stopped deterministically, operator intervention required.
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "SITE_GENERATION",
        toState: "HUMAN_REVIEW_REQUIRED",
        stage: "site_generation",
        detail: `SITE_GENERATION_REVIEW_REQUIRED: ${first.review.message.slice(0, 380)}`,
      });
      return deterministicReviewOutcome(
        { siteGenerationId: input.siteGenerationId, siteId, buildId, buildVersionId: version.buildVersionId },
        first.review,
        repairApplied,
        { qaA: null, qaB: null }
      );
    }
    const firstQa = await evaluate(
      { siteGenerationId: input.siteGenerationId, siteId, buildId, buildVersionId: version.buildVersionId, buildVersionNumber: version.buildVersionNumber },
      first.previewUrl,
      (await getAcceptedImageMap(env, version.buildVersionId)).size
    );

    // ── Measured repair context + regression guard baseline (issue #50) ────
    // Deterministic context for both repair batches: preservation set from
    // the CURRENT version's passing hard constraints, measured deltas from
    // the geometry comparator / macro verdict / frozen craft preflight, and
    // the provenance-bound region crops from the craft attempts.
    const buildRepairContextForVersion = async (evaluation: {
      qaA: QaAReportAugmented;
      qaB: QaBReport;
      macroFidelity?: Awaited<ReturnType<typeof evaluateReferenceMacroFidelity>>;
      geometryComparison?: GeometryComparison;
    }): Promise<string> => {
      const craft = (await getBuildStageArtifact<StoredCraftPreflight>(env, version.buildVersionId, "craft_preflight", "attempt-2"))
        ?? (await getBuildStageArtifact<StoredCraftPreflight>(env, version.buildVersionId, "craft_preflight", "attempt-1"));
      const regionCropKeys = (craft?.value.crops ?? [])
        .flatMap((pair) => [pair.reference?.artifactR2Key, pair.candidate?.artifactR2Key])
        .filter((key): key is string => Boolean(key));
      return buildRepairContext({
        blueprint: blueprint.blueprint,
        contract: contract.contract,
        qaAHardGates: evaluation.qaA.hardGates,
        qaBMandatoryGates: evaluation.qaB.gates,
        macroFidelityPassed: evaluation.macroFidelity ? evaluation.macroFidelity.verdict === "PASS" : null,
        macroFidelityReason: evaluation.macroFidelity?.reason ?? null,
        geometryComparison: evaluation.geometryComparison ?? null,
        craftPreflight: craft?.value ?? null,
        regionCropKeys,
      });
    };
    const repairContext = await buildRepairContextForVersion(firstQa);
    let previousEvaluation: RepairEvaluationSnapshot = {
      qaAHardGates: firstQa.qaA.hardGates,
      qaBMandatoryGates: firstQa.qaB.gates,
      blockers: firstQa.release.blockers,
    };

    let outcome: BuildPipelineOutcome | null = firstQa.release.releaseReady
      ? {
          terminal: "RELEASE_READY",
          reasons: [],
          siteGenerationId: input.siteGenerationId, siteId, buildId,
          releaseReadyBuildVersionId: version.buildVersionId,
          artifactManifestHash: first.manifestHash,
          previewUrl: first.previewUrl,
          qaA: firstQa.qaA,
          qaB: firstQa.qaB,
          repairApplied: false,
        }
      : null;

    // ── Bounded repair: one Fix Coordinator batch + one Release Blocker Fix ─
    // `repairApplied` starts from the D1-reconstructed state above.
    let previousBlockers: QaFinding[] = firstQa.release.blockers;
    let currentQa = firstQa;
    let currentPreviewUrl = first.previewUrl;

    while (!outcome) {
      // Bounded ceiling, re-derived from D1 each pass: once both batches are
      // durably recorded, valid blockers mean automation must stop — the same
      // terminal resolveAfterConfirmation reaches after the final batch.
      if (repairApplied && (await hasRepairBatch(env, buildId, "release_blocker_fix"))) {
        const reasons = [
          "bounded repair budget consumed (one Fix Coordinator batch + one Release Blocker Fix) while valid Release Blockers remain",
          ...currentQa.release.reasons,
        ];
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: version.buildVersionId,
          fromState: "QA",
          toState: "HUMAN_REVIEW_REQUIRED",
          stage: "human_review",
          detail: `HUMAN_REVIEW_REQUIRED: ${reasons.slice(0, 5).join("; ").slice(0, 300)}`,
        });
        outcome = {
          terminal: "HUMAN_REVIEW_REQUIRED",
          reasons,
          siteGenerationId: input.siteGenerationId, siteId, buildId,
          releaseReadyBuildVersionId: null, artifactManifestHash: null,
          previewUrl: currentPreviewUrl,
          qaA: currentQa.qaA, qaB: currentQa.qaB, repairApplied,
        };
        break;
      }

      // First pass: the one coordinated Fix Coordinator batch. Second pass
      // (only after RELEASE_BLOCKER_FIX_ALLOWED): the one narrow final batch.
      let planResult: Awaited<ReturnType<typeof runFixCoordinatorStage>>;
      try {
        planResult = repairApplied
          ? await runReleaseBlockerFixStage(env, {
              siteGenerationId: input.siteGenerationId,
              buildId,
              buildVersionId: version.buildVersionId,
              buildVersionNumber: version.buildVersionNumber,
              qaA: currentQa.qaA,
              qaB: currentQa.qaB,
              remainingBlockers: previousBlockers,
              generate: deps.generate,
              repairContext,
            })
          : await runFixCoordinatorStage(env, {
              siteGenerationId: input.siteGenerationId,
              buildId,
              buildVersionId: version.buildVersionId,
              buildVersionNumber: version.buildVersionNumber,
              qaA: currentQa.qaA,
              qaB: currentQa.qaB,
              generate: deps.generate,
              repairContext,
            });
      } catch (error) {
        // The planner could not produce a bounds-compliant plan even after
        // its one bounded re-word: automation stops for human review. No
        // batch is consumed and no Build Version is created — this is a
        // bounded terminal, not a pipeline failure.
        if (error instanceof AutomatedRepairError && error.code === "REPAIR_BOUNDARY_VIOLATION") {
          const reason = `Automated Repair planning could not produce a bounds-compliant plan: ${(error as Error).message}`;
          await appendBuildWorkflowEvent(env, {
            buildId,
            buildVersionId: version.buildVersionId,
            fromState: "QA",
            toState: "HUMAN_REVIEW_REQUIRED",
            stage: "repair_boundary",
            detail: reason.slice(0, 300),
          });
          outcome = {
            terminal: "HUMAN_REVIEW_REQUIRED",
            reasons: [reason],
            siteGenerationId: input.siteGenerationId, siteId, buildId,
            releaseReadyBuildVersionId: null, artifactManifestHash: null,
            previewUrl: currentPreviewUrl,
            qaA: currentQa.qaA, qaB: currentQa.qaB, repairApplied,
          };
          break;
        }
        throw error;
      }
      const plan = planResult.plan;

      let applied: AppliedRepairBatch;
      try {
        applied = await applyRepairBatch(env, {
          siteGenerationId: input.siteGenerationId,
          buildId,
          sourceBuildVersionId: version.buildVersionId,
          kind: repairApplied ? "release_blocker_fix" : "fix_coordinator",
          plan,
        });
      } catch (error) {
        // Storage-ceiling backstop (e.g. a concurrent pipeline racing the same
        // Build): automation stops and routes to human review — the budget
        // error must never surface as a FAILED pipeline.
        if (error instanceof AutomatedRepairError && error.code === "REPAIR_BUDGET_EXHAUSTED") {
          outcome = {
            terminal: "HUMAN_REVIEW_REQUIRED",
            reasons: [(error as Error).message],
            siteGenerationId: input.siteGenerationId, siteId, buildId,
            releaseReadyBuildVersionId: null, artifactManifestHash: null,
            previewUrl: currentPreviewUrl,
            qaA: currentQa.qaA, qaB: currentQa.qaB, repairApplied,
          };
          break;
        }
        throw error;
      }

      if (applied.status === "BLUEPRINT_REVIEW_REQUIRED") {
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: version.buildVersionId,
          fromState: "HUMAN_REVIEW_REQUIRED",
          toState: "HUMAN_REVIEW_REQUIRED",
          stage: "terminal_outcome",
          detail: `BLUEPRINT_REVIEW_REQUIRED escalated to human review: ${applied.reason.slice(0, 300)}`,
        });
        return {
          terminal: "HUMAN_REVIEW_REQUIRED",
          reasons: [`BLUEPRINT_REVIEW_REQUIRED: ${applied.reason}`],
          siteGenerationId: input.siteGenerationId, siteId, buildId,
          releaseReadyBuildVersionId: null, artifactManifestHash: null,
          previewUrl: currentPreviewUrl,
          qaA: currentQa.qaA, qaB: currentQa.qaB, repairApplied,
        };
      }

      repairApplied = true;
      priorVersionId = version.buildVersionId;
      version = { buildVersionId: applied.newBuildVersionId, buildVersionNumber: applied.newBuildVersionNumber };
      await reuseAcceptedImages(env, priorVersionId, version.buildVersionId);
      // The repaired version inherits only the frozen DESIGN-ORIGIN artifacts
      // (analysis, blueprint, contract, image plan); its realization is
      // regenerated below with the batch's directives — Automated Repair may
      // only modify realization details, never the validated design.
      await inheritValidatedArtifacts(env, buildId, priorVersionId, version.buildVersionId);

      // Material repair creates a NEW immutable Build Version; confirmation
      // QA evaluates the NEW version only.
      const repairedCtx: VersionContext = {
        siteGenerationId: input.siteGenerationId, siteId, buildId,
        buildVersionId: version.buildVersionId, buildVersionNumber: version.buildVersionNumber,
      };
      // The repaired candidate is GENERATED WITH the batch's Fix Plan
      // directives: Automated Repair repairs the realization (HTML/CSS/JS
      // within the frozen Blueprint/Contract) instead of copying the failed
      // version's content — a verbatim copy could never clear the blockers
      // that GATE_PREVIOUS_BLOCKERS_RESOLVED re-checks. The plan is durable
      // in repair_batches, so an engine re-entry regenerates the same
      // repaired version with the SAME directives (runOrReuse then reuses
      // whatever the interrupted pass already produced).
      const regenerated = await produceCandidate(repairedCtx, repairDirectivesFromPlan(plan));
      if (regenerated.kind === "deterministic-review") {
        // Issue #62 §8/§14: the repaired candidate deterministically failed
        // assembly validation after its own bounded repair. No Release Ready,
        // no Approval — escalate with the precise findings; the retained
        // artifacts remain the review candidate and the blocker stays
        // recorded. No Workflow retry burn.
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: version.buildVersionId,
          fromState: "SITE_GENERATION",
          toState: "HUMAN_REVIEW_REQUIRED",
          stage: "site_generation",
          detail: `SITE_GENERATION_REVIEW_REQUIRED (repaired v${version.buildVersionNumber}): ${regenerated.review.message.slice(0, 380)}`,
        });
        outcome = deterministicReviewOutcome(
          repairedCtx,
          regenerated.review,
          repairApplied,
          { qaA: currentQa.qaA, qaB: currentQa.qaB }
        );
        break;
      }
      currentPreviewUrl = regenerated.previewUrl;

      const confirmation = await runConfirmationQa(env, {
        siteGenerationId: input.siteGenerationId,
        buildId,
        buildVersionId: version.buildVersionId,
        buildVersionNumber: version.buildVersionNumber,
        previousBlockers,
        evidenceR2Keys: [],
        generate: deps.generate,
      });

      // Regression guard (issue #50 D/E/F): candidate N+1 vs candidate N on
      // HARD CONSTRAINTS only. A previously passing gate that now fails, or
      // an ACTIVE P0/P1 in a domain the previous blockers never covered, is
      // a REPAIR_REGRESSION: the candidate is not promoted and automation
      // escalates. Composite scores are deliberately never compared — a
      // score drop with all hard constraints intact is a valid repair.
      const guardVerdicts = {
        blockers: [...evaluateQaARelease(confirmation.qaA).blockers, ...evaluateQaBRelease(confirmation.qaB).blockers],
      };
      const regression = evaluateRepairRegression({
        previous: previousEvaluation,
        confirmationAHardGates: confirmation.qaA.hardGates,
        confirmationBMandatoryGates: confirmation.qaB.gates,
        confirmationBlockers: guardVerdicts.blockers,
      });
      if (regression.regression) {
        const reasons = [
          ...regression.regressions.map((line) => `REPAIR_REGRESSION: ${line}`),
          ...(regression.conflict
            ? ["CONSTRAINT_CONFLICT: previous blockers remain AND new regressions appeared — a binding constraint conflict that automated repair cannot resolve; escalating for human review"]
            : []),
        ];
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: version.buildVersionId,
          fromState: "CONFIRMATION",
          toState: "HUMAN_REVIEW_REQUIRED",
          stage: "repair_regression",
          detail: `REPAIR_REGRESSION guard blocked promotion: ${reasons.join("; ").slice(0, 300)}`,
        });
        outcome = {
          terminal: "HUMAN_REVIEW_REQUIRED",
          reasons,
          siteGenerationId: input.siteGenerationId, siteId, buildId,
          releaseReadyBuildVersionId: null, artifactManifestHash: null,
          previewUrl: currentPreviewUrl,
          qaA: confirmation.qaA, qaB: confirmation.qaB, repairApplied,
        };
        break;
      }

      const resolved = await resolveAfterConfirmation(env, {
        siteGenerationId: input.siteGenerationId,
        buildId,
        buildVersionId: version.buildVersionId,
        confirmation,
        evidenceR2Keys: [],
      });
      // The guard baseline advances to THIS version so a second repair batch
      // compares against its immediate predecessor (candidate N+1 vs N).
      previousEvaluation = {
        qaAHardGates: confirmation.qaA.hardGates,
        qaBMandatoryGates: confirmation.qaB.gates,
        blockers: resolved.blockers,
      };
      currentQa = { qaA: confirmation.qaA, qaB: confirmation.qaB, release: { releaseReady: resolved.status === "RELEASE_READY", reasons: resolved.reasons, blockers: resolved.blockers, polish: resolved.polish } } as typeof currentQa;
      previousBlockers = resolved.blockers;

      if (resolved.status === "RELEASE_READY") {
        outcome = {
          terminal: "RELEASE_READY",
          reasons: [],
          siteGenerationId: input.siteGenerationId, siteId, buildId,
          releaseReadyBuildVersionId: version.buildVersionId,
          artifactManifestHash: regenerated.manifestHash,
          previewUrl: regenerated.previewUrl,
          qaA: confirmation.qaA,
          qaB: confirmation.qaB,
          repairApplied,
        };
        break;
      }
      if (resolved.status === "HUMAN_REVIEW_REQUIRED") {
        // The repaired version's QA is the bounded confirmation (no fresh
        // deterministic re-measurement — that is the repair budget design),
        // so the latest DETERMINISTIC macro verdict available is the first
        // version's comparator result: if the direct reference fidelity gate
        // failed there and realization repair did not clear the release, the
        // defect is blueprint-level, not implementation drift (issue #45).
        const macroStillFailing = firstQa.macroFidelity?.verdict === "FAIL";
        const classified = macroStillFailing
          ? [
              ...resolved.reasons,
              "BLUEPRINT_REVIEW_REQUIRED: direct reference fidelity still fails after the bounded repair batch despite a coverage-valid Blueprint — classified as a blueprint-level fidelity defect, not implementation drift",
            ]
          : resolved.reasons;
        outcome = {
          terminal: "HUMAN_REVIEW_REQUIRED",
          reasons: classified,
          siteGenerationId: input.siteGenerationId, siteId, buildId,
          releaseReadyBuildVersionId: null, artifactManifestHash: null,
          previewUrl: regenerated.previewUrl,
          qaA: confirmation.qaA, qaB: confirmation.qaB, repairApplied,
        };
        break;
      }
      // RELEASE_BLOCKER_FIX_ALLOWED: exactly one more narrow batch, then stop.
      // (resolveAfterConfirmation's next pass sees the consumed batch and
      // escalates to HUMAN_REVIEW_REQUIRED.)
    }

    return outcome!;
  } catch (error) {
    const detail = `Pipeline stage failure: ${(error as Error).message.slice(0, 400)}`;
    await appendBuildWorkflowEvent(env, {
      buildId,
      buildVersionId: version.buildVersionId,
      fromState: "QA",
      toState: "FAILED",
      stage: "pipeline_failure",
      detail,
    }).catch(() => {});
    return {
      terminal: "FAILED",
      reasons: [detail],
      siteGenerationId: input.siteGenerationId,
      siteId,
      buildId,
      releaseReadyBuildVersionId: null,
      artifactManifestHash: null,
      previewUrl: null,
      qaA: null,
      qaB: null,
      repairApplied: false,
    };
  }
}
