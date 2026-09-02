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
import { assembleBuildVersionCandidate, deployPreview, type AssembledCandidate, type PreviewDeployer } from "./assembly";
import { buildStandardEvidenceBundle, compareGeometry, geometryFromRegions, type QaCaptureFn } from "./qa-evidence";
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
  runConfirmationQa,
  runFixCoordinatorStage,
  runReleaseBlockerFixStage,
  resolveAfterConfirmation,
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
    const produceCandidate = async (
      ctx: VersionContext,
      repairDirectives?: string
    ): Promise<{ candidate: AssembledCandidate; previewUrl: string; site: Awaited<ReturnType<typeof generateCompleteSite>> }> => {
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

        return { candidate: assembled, previewUrl: preview.previewUrl, site };
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
    });
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
          artifactManifestHash: first.candidate.artifactManifestHash,
          previewUrl: first.previewUrl,
          qaA: firstQa.qaA,
          qaB: firstQa.qaB,
          repairApplied: false,
        }
      : null;

    // ── Bounded repair: one Fix Coordinator batch + one Release Blocker Fix ─
    let repairApplied = false;
    let previousBlockers: QaFinding[] = firstQa.release.blockers;
    let currentQa = firstQa;
    let currentPreviewUrl = first.previewUrl;

    while (!outcome) {
      // First pass: the one coordinated Fix Coordinator batch. Second pass
      // (only after RELEASE_BLOCKER_FIX_ALLOWED): the one narrow final batch.
      const planResult = repairApplied
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
      const plan = planResult.plan;

      const applied = await applyRepairBatch(env, {
        siteGenerationId: input.siteGenerationId,
        buildId,
        sourceBuildVersionId: version.buildVersionId,
        kind: repairApplied ? "release_blocker_fix" : "fix_coordinator",
        plan,
      });

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

      // Material repair creates a NEW immutable Build Version: regenerate the
      // realization under the same fixed Blueprint/Contract with the repair
      // directives, then confirmation QA evaluates the NEW version only.
      const repairedCtx: VersionContext = {
        siteGenerationId: input.siteGenerationId, siteId, buildId,
        buildVersionId: version.buildVersionId, buildVersionNumber: version.buildVersionNumber,
      };
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
          artifactManifestHash: regenerated.candidate.artifactManifestHash,
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
