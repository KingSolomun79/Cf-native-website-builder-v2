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
import { runReferenceIntake, getFrozenReferenceEvidence } from "./reference-intake";
import { runReferenceAnalysisStage } from "./reference-analysis";
import { runVisualBlueprintStage } from "./visual-blueprint";
import { produceImplementationContract } from "./implementation-planner";
import { generateCompleteSite, type ImageSlot } from "./site-generator";
import {
  runImageGeneration,
  getAcceptedImageMap,
  expandSlotsToTarget,
  type ImageGenerationProvider,
} from "./image-pipeline";
import { assembleBuildVersionCandidate, deployPreview, type PreviewDeployer } from "./assembly";
import { buildStandardEvidenceBundle, compareGeometry, geometryFromRegions, type GeometryComparison, type QaCaptureFn } from "./qa-evidence";
import { createProductionQaCapture } from "./qa-capture";
import { runQaAStage, runQaBStage, type QaAReport, type QaBReport, type QaFinding } from "./qa-stages";
import { assignReleaseReady, ReleaseGateError } from "./release";
import { getBuildStageArtifact } from "./stage-artifacts";
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
import type { RawAiGenerate } from "./ai-boundary";
import { KieV2ImageProvider } from "../lib/kie-v2";

export interface BuildPipelineDeps {
  generate?: RawAiGenerate;
  imageProvider?: ImageGenerationProvider;
  previewDeployer?: PreviewDeployer;
  /** Built per Preview deployment; defaults to the browser-backed capture. */
  qaCapture?: (previewUrl: string) => QaCaptureFn;
  /** Durable step executor (the workflow's WorkflowStep). Each stage runs as
   *  its own step so a mid-flight isolate eviction retries only that stage;
   *  every stage is idempotent (artifact reuse / spend-resume) by design.
   *  Tests use the passthrough default. */
  step?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

export type PipelineTerminalStatus =
  | "RELEASE_READY"
  | "HUMAN_REVIEW_REQUIRED"
  | "DEGRADED"
  | "FAILED";

export interface BuildPipelineOutcome {
  terminal: PipelineTerminalStatus;
  reasons: string[];
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  releaseReadyBuildVersionId: string | null;
  artifactManifestHash: string | null;
  previewUrl: string | null;
  qaA: QaAReport | null;
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
  qaA: QaAReport;
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

    // ── Analysis -> Blueprint -> Contract (each its own durable step) ─────
    // Retry safety lives at THIS seam: a stage whose frozen artifact already
    // exists for the Build Version is reused verbatim; the domain stages
    // themselves stay strictly once-per-version.
    const analysis = await stepDo("pipeline: reference analysis", async () => {
      const existingAnalysis = await getBuildStageArtifact<ReferenceAnalysis>(env, version.buildVersionId, "reference_analysis");
      if (existingAnalysis) {
        return { analysis: existingAnalysis.value, artifactR2Key: existingAnalysis.artifactR2Key };
      }
      return runReferenceAnalysisStage(env, {
      siteGenerationId: input.siteGenerationId,
      buildId,
      buildVersionId: version.buildVersionId,
      buildVersionNumber: version.buildVersionNumber,
      evidence: frozen.evidence,
      evidenceR2Key: frozen.evidenceR2Key,
      generate: deps.generate,
      });
    });

    const facts = (await getEffectiveBusinessFacts(env, buildId)).facts;
    const blueprint = await stepDo("pipeline: visual blueprint", async () => {
      const existingBlueprint = await getBuildStageArtifact<VisualBlueprint>(env, version.buildVersionId, "visual_blueprint");
      if (existingBlueprint) {
        return { blueprint: existingBlueprint.value, artifactR2Key: existingBlueprint.artifactR2Key };
      }
      return runVisualBlueprintStage(env, {
      siteGenerationId: input.siteGenerationId,
      buildId,
      buildVersionId: version.buildVersionId,
      buildVersionNumber: version.buildVersionNumber,
      analysis: analysis.analysis,
      analysisR2Key: analysis.artifactR2Key,
      facts,
      adaptationContract: frozen.adaptationContract ?? null,
      referenceUrl: frozen.evidence.referenceUrl,
      generate: deps.generate,
      });
    });

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

    // ── Candidate production (generation -> images -> assembly -> preview) ─
    // NOTE: step results are capped at 1MiB by the Workflows engine — the
    // candidate's bundled image bytes must never cross a step boundary, only
    // its manifest hash and Preview URL do.
    const produceCandidate = async (
      ctx: VersionContext,
      repairDirectives?: string
    ): Promise<{ manifestHash: string; previewUrl: string }> => {
      // Measured Reference composition (frozen evidence) feeds generation as
      // numeric composition targets — QA-A hard-gates these exact proportions
      // (first_viewport_height_ratio, region count/order tolerance), so the
      // generator must see the same numbers QA measures.
      const referenceGeometry = frozen.evidence.regions.flatMap((region) =>
        typeof region.viewportHeightRatio === "number"
          ? [{ regionId: region.id, viewportHeightRatio: region.viewportHeightRatio }]
          : []
      );
      const site = await stepDo(`pipeline: generate site (v${ctx.buildVersionNumber})`, () => generateCompleteSite(env, {
        siteGenerationId: ctx.siteGenerationId,
        siteId: ctx.siteId,
        buildId: ctx.buildId,
        buildVersionId: ctx.buildVersionId,
        buildVersionNumber: ctx.buildVersionNumber,
        blueprint: blueprint.blueprint,
        blueprintR2Key: blueprint.artifactR2Key,
        contract: contract.contract,
        contractR2Key: contract.artifactR2Key,
        generate: deps.generate,
        referenceGeometry,
        ...(repairDirectives ? { repairDirectives } : {}),
      }));

      // Normal 12-Accepted-Image target with spend-resume idempotency: expand
      // to the target, then generate only slots without an acceptance for THIS
      // version, so a retried pipeline never re-spends KIE.
      const plannedSlots = expandSlotsToTarget(site.imagePlan.slots);
      const accepted = await getAcceptedImageMap(env, ctx.buildVersionId);
      const unresolved = plannedSlots.filter((slot) => !accepted.has(slot.id));
      if (unresolved.length > 0) {
        await stepDo(`pipeline: image generation (v${ctx.buildVersionNumber})`, () => runImageGeneration(env, {
          siteGenerationId: ctx.siteGenerationId,
          buildId: ctx.buildId,
          buildVersionId: ctx.buildVersionId,
          buildVersionNumber: ctx.buildVersionNumber,
          slots: unresolved,
          provider: deps.imageProvider ?? new KieV2ImageProvider(env),
          generate: deps.generate,
          expandToTarget: false,
        }));
      }

      const acceptedImageEntries = await getAcceptedImageMap(env, ctx.buildVersionId);
      const acceptedImages = new Map([...acceptedImageEntries].map(([slotId, entry]) => [slotId, entry.r2Key] as const));
      const candidate = await stepDo(`pipeline: assemble + preview (v${ctx.buildVersionNumber})`, async () => {
        const assembled = await assembleBuildVersionCandidate(env, {
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

        const preview = await deployPreview(env, {
          buildId: ctx.buildId,
          buildVersionId: ctx.buildVersionId,
          buildVersionNumber: ctx.buildVersionNumber,
          candidate: assembled,
          ...(deps.previewDeployer ? { deployer: deps.previewDeployer } : {}),
        });

        return { manifestHash: assembled.artifactManifestHash, previewUrl: preview.previewUrl };
      });
      return candidate;
    };

    const evaluate = async (
      ctx: VersionContext,
      previewUrl: string,
      acceptedImageCount: number
    ): Promise<{ qaA: QaAReport; qaB: QaBReport; release: Awaited<ReturnType<typeof assignReleaseReady>> }> => {
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

      // Geometry comparator: reference evidence regions vs the home desktop
      // candidate capture — same mapping both sides (PRD section 27).
      const homeDesktop = evidenceBundle.bundle.captures.find(
        (capture) => capture.page === "home" && capture.viewportWidth === 1440
      );
      const referenceRegions = frozen.evidence.regions.flatMap((region) =>
        typeof region.height === "number" && typeof region.viewportHeightRatio === "number"
          ? [{ id: region.id, height: region.height, viewportHeightRatio: region.viewportHeightRatio }]
          : []
      );
      const referenceProfile = geometryFromRegions(referenceRegions, homeDesktop?.geometry.imageMassRatio ?? 0.38);
      const candidateProfile = homeDesktop?.geometry ?? geometryFromRegions([], 0.38);
      const geometryComparison = compareGeometry(referenceProfile, candidateProfile);

      const qaA = await runQaAStage(env, {
        buildId: ctx.buildId,
        siteGenerationId: ctx.siteGenerationId,
        buildVersionId: ctx.buildVersionId,
        buildVersionNumber: ctx.buildVersionNumber,
        context: {
          businessName: facts.businessName,
          geometryComparison,
          evidenceSummary: `${evidenceBundle.bundle.captures.length} standardized captures (home 1440/768/390, inner pages desktop+mobile); geometry similarity ${geometryComparison.similarityScore}`,
          signatureTraitIds: blueprint.blueprint.signatureTraits.map((trait) => trait.id),
          adaptationContractQaExceptions: frozen.adaptationContract?.qaExceptions ?? [],
        },
        evidenceR2Key: evidenceBundle.artifactR2Key,
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

      let release: Awaited<ReturnType<typeof assignReleaseReady>>;
      try {
        release = await assignReleaseReady(env, {
          buildId: ctx.buildId,
          buildVersionId: ctx.buildVersionId,
          siteGenerationId: ctx.siteGenerationId,
          qaA: qaA.report,
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
      return { qaA: qaA.report, qaB: qaB.report, release };
      });
    };

    // ── First evaluation ───────────────────────────────────────────────────
    const first = await produceCandidate({
      siteGenerationId: input.siteGenerationId, siteId, buildId,
      buildVersionId: version.buildVersionId, buildVersionNumber: version.buildVersionNumber,
    }, currentVersionRepairPlan ? repairDirectivesFromPlan(currentVersionRepairPlan) : undefined);
    const firstQa = await evaluate(
      { siteGenerationId: input.siteGenerationId, siteId, buildId, buildVersionId: version.buildVersionId, buildVersionNumber: version.buildVersionNumber },
      first.previewUrl,
      (await getAcceptedImageMap(env, version.buildVersionId)).size
    );

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
            })
          : await runFixCoordinatorStage(env, {
              siteGenerationId: input.siteGenerationId,
              buildId,
              buildVersionId: version.buildVersionId,
              buildVersionNumber: version.buildVersionNumber,
              qaA: currentQa.qaA,
              qaB: currentQa.qaB,
              generate: deps.generate,
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
      const resolved = await resolveAfterConfirmation(env, {
        siteGenerationId: input.siteGenerationId,
        buildId,
        buildVersionId: version.buildVersionId,
        confirmation,
        evidenceR2Keys: [],
      });
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
        outcome = {
          terminal: "HUMAN_REVIEW_REQUIRED",
          reasons: resolved.reasons,
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
