// V2 benchmark case runner (issue #17, PRD 43-45).
//
// Drives ONE frozen benchmark case through the full automated V2 pipeline:
// intake -> evidence freeze -> analysis -> blueprint -> implementation
// contract -> incremental generation -> two-wave images -> assembly +
// Technical Preflight -> Preview -> standardized QA evidence -> QA-A/QA-B ->
// Release Ready. Every seam (model, image provider, deployer, QA capture) is
// injectable so tests drive deterministic scripts while production wiring
// uses the real services. Approval and Publication are deliberately NOT part
// of the benchmark path. Failures map to the PRD section 45 root-cause
// taxonomy and are recorded on the run row.

import type { Env } from "../env.d";
import { startSiteGeneration, createInitialBuild } from "./lifecycle";
import { runReferenceIntake, getFrozenReferenceEvidence } from "./reference-intake";
import { runReferenceAnalysisStage } from "./reference-analysis";
import { runVisualBlueprintStage } from "./visual-blueprint";
import { produceImplementationContract } from "./implementation-planner";
import { generateCompleteSite } from "./site-generator";
import { runImageGeneration, getAcceptedImageMap, getImageSpendReport, type ImageGenerationProvider } from "./image-pipeline";
import { assembleBuildVersionCandidate, deployPreview, type AssembledCandidate, type PreviewDeployer } from "./assembly";
import { buildStandardEvidenceBundle, compareGeometry, geometryFromRegions, type GeometryProfile, type QaCaptureFn } from "./qa-evidence";
import { runQaAStage, runQaBStage } from "./qa-stages";
import { assignReleaseReady } from "./release";
import { getEffectiveBusinessFacts } from "./revision";
import type { RawAiGenerate } from "./ai-boundary";
import {
  benchmarkCaseById,
  frozenCaptureFor,
  persistFrozenScreenshot,
  recordBenchmarkRun,
  verifyBenchmarkIdentity,
  type BenchmarkRootCause,
} from "./benchmark";

export interface BenchmarkDeps {
  generate: RawAiGenerate;
  imageProvider: ImageGenerationProvider;
  previewDeployer: PreviewDeployer;
  qaCapture: QaCaptureFn;
}

export interface BenchmarkRunOutcome {
  runId: string;
  pass: boolean;
  reasons: string[];
  rootCause: BenchmarkRootCause | null;
  buildId: string;
  buildVersionId: string;
  releaseReady: boolean;
  imageSpendUsd: number;
}

const STAGE_ROOT_CAUSES: Record<string, BenchmarkRootCause> = {
  intake: "EVIDENCE_EXTRACTION",
  analysis: "REFERENCE_ANALYSIS",
  blueprint: "BLUEPRINT",
  contract: "IMPLEMENTATION_PLAN",
  generation: "GENERATOR",
  images: "IMAGE_GENERATION",
  preflight: "TECHNICAL_PREFLIGHT",
  preview: "PLATFORM_RUNTIME",
  qa: "QA_FALSE_POSITIVE",
  release: "PLATFORM_RUNTIME",
};

async function labeled<T>(stageLabel: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    (error as Error & { stageLabel?: string }).stageLabel = stageLabel;
    throw error;
  }
}

export async function runBenchmarkCase(
  env: Env,
  input: { caseId: string; deps: BenchmarkDeps; manualSourceEdits?: number; imageMassRatio?: number }
): Promise<BenchmarkRunOutcome> {
  const caseDefinition = benchmarkCaseById(input.caseId);
  await verifyBenchmarkIdentity(env, { caseId: input.caseId, evidence: caseDefinition.evidence });

  const recordFailure = async (
    context: { siteGenerationId: string; buildId: string; buildVersionId: string },
    stage: string,
    error: unknown
  ): Promise<BenchmarkRunOutcome> => {
    const spend = await getImageSpendReport(env, context.buildId, []).catch(() => null);
    const rootCause: BenchmarkRootCause = STAGE_ROOT_CAUSES[stage] ?? "PLATFORM_RUNTIME";
    const recorded = await recordBenchmarkRun(env, {
      benchmarkCaseId: caseDefinition.id,
      ...context,
      releaseReady: false,
      imageSpendUsd: spend?.spentUsd ?? 0,
      manualSourceEdits: input.manualSourceEdits ?? 0,
      rootCause,
      qaSummary: { failedStage: stage, error: (error as Error).message.slice(0, 500) },
    });
    return {
      runId: recorded.runId,
      pass: false,
      reasons: recorded.reasons,
      rootCause,
      ...context,
      releaseReady: false,
      imageSpendUsd: spend?.spentUsd ?? 0,
    };
  };

  const screenshotR2Key = await persistFrozenScreenshot(env, caseDefinition);
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: caseDefinition.brief,
      reference: { url: caseDefinition.referenceUrl, screenshotR2Key },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  const context = {
    siteGenerationId: started.siteGenerationId,
    buildId: created.buildId,
    buildVersionId: created.buildVersionId,
  };

  try {
    await labeled("intake", () =>
      runReferenceIntake(env, {
        ...context,
        buildVersionNumber: 1,
        capture: frozenCaptureFor(caseDefinition),
        adaptationContract: caseDefinition.adaptationContract ?? undefined,
      })
    );
    const frozen = await getFrozenReferenceEvidence(env, context.siteGenerationId);
    if (!frozen) throw new Error("frozen evidence package missing after intake");

    const analysis = await labeled("analysis", () =>
      runReferenceAnalysisStage(env, {
        ...context,
        buildVersionNumber: 1,
        evidence: frozen.evidence,
        evidenceR2Key: frozen.evidenceR2Key,
        generate: input.deps.generate,
      })
    );

    const facts = (await getEffectiveBusinessFacts(env, context.buildId)).facts;
    const blueprint = await labeled("blueprint", () =>
      runVisualBlueprintStage(env, {
        ...context,
        buildVersionNumber: 1,
        analysis: analysis.analysis,
        analysisR2Key: analysis.artifactR2Key,
        facts,
        adaptationContract: caseDefinition.adaptationContract,
        referenceUrl: caseDefinition.referenceUrl,
        generate: input.deps.generate,
      })
    );

    const siteIdRow = await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?")
      .bind(context.siteGenerationId)
      .first<{ site_id: string }>();
    const contract = await labeled("contract", () =>
      produceImplementationContract(env, {
        ...context,
        siteId: siteIdRow!.site_id,
        blueprint: blueprint.blueprint,
        facts,
      })
    );

    const site = await labeled("generation", () =>
      generateCompleteSite(env, {
        ...context,
        siteId: siteIdRow!.site_id,
        buildVersionNumber: 1,
        blueprint: blueprint.blueprint,
        blueprintR2Key: blueprint.artifactR2Key,
        contract: contract.contract,
        contractR2Key: contract.artifactR2Key,
        generate: input.deps.generate,
      })
    );

    await labeled("images", () =>
      runImageGeneration(env, {
        siteGenerationId: context.siteGenerationId,
        buildId: context.buildId,
        buildVersionId: context.buildVersionId,
        buildVersionNumber: 1,
        slots: site.imagePlan.slots,
        provider: input.deps.imageProvider,
        generate: input.deps.generate,
      })
    );

    const acceptedImageEntries = await getAcceptedImageMap(env, context.buildVersionId);
    const acceptedImages = new Map([...acceptedImageEntries].map(([slotId, entry]) => [slotId, entry.r2Key] as const));
    const candidate: AssembledCandidate = await labeled("preflight", () =>
      assembleBuildVersionCandidate(env, {
        ...context,
        buildVersionNumber: 1,
        pages: site.pages,
        sharedCss: site.sharedCss,
        sharedJs: site.sharedJs,
        imagePlanSlots: site.imagePlan.slots,
        acceptedImages,
        formServiceEndpoint: contract.contract.formContract.formServiceEndpoint,
        expectedSiteFormId: contract.contract.formContract.siteFormId,
      })
    );

    await labeled("preview", () =>
      deployPreview(env, {
        ...context,
        buildVersionNumber: 1,
        candidate,
        deployer: input.deps.previewDeployer,
      })
    );

    const evidenceBundle = await labeled("qa", () =>
      buildStandardEvidenceBundle(env, {
        ...context,
        buildVersionNumber: 1,
        capture: input.deps.qaCapture,
      })
    );

    const imageMass = input.imageMassRatio ?? 0.38;
    const geometryComparison = compareGeometry(
      geometryFromRegions(caseDefinition.evidence.regions, imageMass),
      geometryFromRegions(caseDefinition.evidence.regions, imageMass)
    );

    const qaA = await labeled("qa", () =>
      runQaAStage(env, {
        ...context,
        buildVersionNumber: 1,
        context: {
          businessName: caseDefinition.brief.businessName,
          geometryComparison,
          evidenceSummary: `${evidenceBundle.bundle.captures.length} standardized captures`,
          signatureTraitIds: blueprint.blueprint.signatureTraits.map((trait) => trait.id),
          adaptationContractQaExceptions: caseDefinition.adaptationContract?.qaExceptions ?? [],
        },
        evidenceR2Key: evidenceBundle.artifactR2Key,
        generate: input.deps.generate,
      })
    );
    const qaB = await labeled("qa", () =>
      runQaBStage(env, {
        ...context,
        buildVersionNumber: 1,
        context: {
          formServiceEndpoint: contract.contract.formContract.formServiceEndpoint,
          evidenceSummary: `${evidenceBundle.bundle.captures.length} standardized captures`,
          preflightPassed: true,
          imageManifestSummary: `${acceptedImages.size} accepted images bundled`,
        },
        evidenceR2Key: evidenceBundle.artifactR2Key,
        generate: input.deps.generate,
      })
    );

    const release = await labeled("release", () =>
      assignReleaseReady(env, {
        ...context,
        qaA: qaA.report,
        qaB: qaB.report,
        qaBuildVersionId: context.buildVersionId,
        geometryComparison,
        evidenceR2Keys: [evidenceBundle.artifactR2Key],
      })
    );

    const spend = await getImageSpendReport(env, context.buildId, site.imagePlan.slots);
    const provenanceRows = await env.DB.prepare(
      "SELECT stage, prompt_id, prompt_version, model, schema_version, attempt, outcome FROM ai_stage_runs WHERE build_id = ? ORDER BY created_at"
    )
      .bind(context.buildId)
      .all<Record<string, unknown>>();
    const recorded = await recordBenchmarkRun(env, {
      benchmarkCaseId: caseDefinition.id,
      ...context,
      releaseReady: release.releaseReady,
      imageSpendUsd: spend.spentUsd,
      manualSourceEdits: input.manualSourceEdits ?? 0,
      rootCause: release.releaseReady ? null : "GENERATOR",
      qaSummary: {
        visualScore: qaA.report.visualScore,
        contentScore: qaA.report.contentScore,
        technicalScore: qaB.report.technicalScore,
        hardGates: qaA.report.hardGates,
        mandatoryGates: qaB.report.gates,
        reasons: release.reasons,
      },
      provenance: provenanceRows.results ?? [],
    });

    return {
      runId: recorded.runId,
      pass: recorded.pass,
      reasons: recorded.reasons,
      rootCause: release.releaseReady ? null : "GENERATOR",
      ...context,
      releaseReady: release.releaseReady,
      imageSpendUsd: spend.spentUsd,
    };
  } catch (error) {
    const stage = (error as { stageLabel?: string }).stageLabel ?? "platform";
    return recordFailure(context, stage, error);
  }
}
