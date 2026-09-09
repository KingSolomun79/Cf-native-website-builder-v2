// SIMPLE design pipeline orchestration (experiment/simplified-design-pipeline).
//
// Replaces the legacy design chain for DESIGN_PIPELINE_VERSION=simple_blueprint_v1:
//
//   reference capture (REUSED legacy intake)
//   -> DESIGN BLUEPRINT      (ONE multimodal schema-validated call + deterministic gate)
//   -> IMAGE GENERATION      (REUSED durable KIE machinery; blueprint slots + prompts)
//   -> WEBSITE BUILD         (ONE builder stage: full site-bundle, two-call fallback)
//   -> assemble + preview    (REUSED deterministic assembly/Technical Preflight/preview)
//   -> QA                    (deterministic truth+technical + ONE visual QA call → qa-package)
//   -> ONE REPAIR            (only if required; new immutable Build Version)
//   -> final QA              (re-render + re-judge; NO second repair)
//   -> RELEASE_READY | HUMAN_REVIEW_REQUIRED
//
// Keep-list infrastructure reused unchanged: lifecycle/state, artifact store,
// stage claims, retry containment, KIE budget gates, accepted image identity,
// release/approval/publication/rollback. States reuse the EXISTING lifecycle
// enum (KEEP: "D1 lifecycle/state"); SIMPLE stage names live in step names
// and workflow events.

import type { Env } from "../env.d";
import { appendBuildWorkflowEvent, createInitialBuild, createNextBuildVersion } from "../domain/lifecycle";
import { runReferenceIntake, getFrozenReferenceEvidence, type ReferenceCaptureFn } from "../domain/reference-intake";
import { getEffectiveBusinessFacts } from "../domain/revision";
import { getAcceptedImageMap, type ImageGenerationProvider } from "../domain/image-pipeline";
import { runImageGenerationDurable } from "../domain/image-orchestration";
import { KieV2ImageProvider } from "../lib/kie-v2";
import { buildAssembledCandidate, deployPreview, freezeAssembledCandidate, AssemblyPreflightError, type PreviewDeployer } from "../domain/assembly";
import { buildStandardEvidenceBundle, type QaCaptureFn } from "../domain/qa-evidence";
import { createProductionQaCapture } from "../domain/qa-capture";
import { classifyStageFailure } from "../domain/stage-failure";
import { getBuildStageArtifact, storeBuildStageArtifactIdempotent } from "../domain/stage-artifacts";
import { VisionGatewayError } from "../lib/ai-gateway";
import type { RawAiGenerate } from "../domain/ai-boundary";
import type { BusinessFacts } from "../domain/lifecycle-schema";
import {
  blueprintSlotsToImageSlots,
  blueprintSlotsToPromptRecords,
  type DesignBlueprint,
  type QaPackage,
  type SiteBundle,
} from "./contracts";
import { runSimpleDesignBlueprintStage, SimpleDesignBlueprintError } from "./design-blueprint";
import { runSimpleWebsiteBuilderStage, type SimpleBuilderVisualInput } from "./website-builder";
import { runSimpleVisualQaStage } from "./visual-qa";
import { runSimpleSiteRepairStage } from "./site-repair";
import { runDeterministicBundleQa } from "./bundle-qa";
import { buildSimpleQaPackage, finalizeSimpleRelease, simpleReleaseVerdict, storeSimpleQaPackage } from "./qa-package";

// ── Experiment selector (spec section 4) ────────────────────────────────────

export type DesignPipelineVersion = "legacy_v2" | "simple_blueprint_v1";
export const DESIGN_PIPELINE_VERSIONS: readonly DesignPipelineVersion[] = ["legacy_v2", "simple_blueprint_v1"];
// Experiment-branch default: SIMPLE. Flip the wrangler var to "legacy_v2"
// for A/B comparison runs. Never exposed in onboarding; the business-facing
// Build Mode remains REFERENCE_BOUND only.
export const DEFAULT_DESIGN_PIPELINE_VERSION: DesignPipelineVersion = "simple_blueprint_v1";

export function resolveDesignPipelineVersion(env: Partial<Pick<Env, "DESIGN_PIPELINE_VERSION">> | undefined): DesignPipelineVersion {
  const value = env?.DESIGN_PIPELINE_VERSION as DesignPipelineVersion | undefined;
  return value && DESIGN_PIPELINE_VERSIONS.includes(value) ? value : DEFAULT_DESIGN_PIPELINE_VERSION;
}

// ── Seams / inputs / outcome ────────────────────────────────────────────────

export interface SimplePipelineDeps {
  generate?: RawAiGenerate;
  /** Multimodal seam for the blueprint / builder / visual-QA / repair calls.
   *  Defaults to the production vision gateway; tests inject scripts. */
  visionGenerate?: RawAiGenerate;
  imageProvider?: ImageGenerationProvider;
  previewDeployer?: PreviewDeployer;
  qaCapture?: (previewUrl: string) => QaCaptureFn;
  capture?: ReferenceCaptureFn;
  step?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  sleep?: (name: string, ms: number) => Promise<void>;
}

export type SimplePipelineTerminal = "RELEASE_READY" | "HUMAN_REVIEW_REQUIRED" | "DEGRADED" | "FAILED";

export interface SimplePipelineOutcome {
  terminal: SimplePipelineTerminal;
  reasons: string[];
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  releaseReadyBuildVersionId: string | null;
  artifactManifestHash: string | null;
  previewUrl: string | null;
  repairApplied: boolean;
  builderStrategy: "ONE_CALL" | "TWO_CALL_SINGLE_STAGE" | null;
  designBlueprintR2Key: string | null;
}

interface SimpleVersionContext {
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
}

interface AssembleOutcome {
  kind: "ok";
  manifestHash: string;
  previewUrl: string | null;
}

interface QaOutcome {
  releaseReady: boolean;
  reasons: string[];
  pkg: QaPackage;
  evidenceR2Keys: string[];
  previewUrl: string | null;
}

const PAGE_FILES: Record<string, string> = { home: "index.html", about: "about.html", services: "services.html", contact: "contact.html" };

// Same copy semantics as the legacy pipeline's private helper: Accepted
// Image attempts stay valid project-controlled assets for the repair version
// without burning further KIE budget.
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

async function loadBundle(env: Env, buildVersionId: string): Promise<SiteBundle | null> {
  const stored = await getBuildStageArtifact<SiteBundle>(env, buildVersionId, "site_bundle");
  return stored?.value ?? null;
}

export async function runSimpleBuildPipeline(
  env: Env,
  input: { siteGenerationId: string; buildId?: string; deps?: SimplePipelineDeps }
): Promise<SimplePipelineOutcome> {
  const deps = input.deps ?? {};
  const stepDo = deps.step ?? (async <T>(_name: string, fn: () => Promise<T>) => fn());
  const buildId =
    input.buildId ?? (await createInitialBuild(env, { siteGenerationId: input.siteGenerationId })).buildId;
  const siteId = await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?")
    .bind(input.siteGenerationId)
    .first<{ site_id: string }>()
    .then((row) => {
      if (!row) throw new Error(`Site Generation ${input.siteGenerationId} not found`);
      return row.site_id;
    });
  const submissionId = await env.DB.prepare("SELECT onboarding_submission_id FROM site_generations WHERE id = ?")
    .bind(input.siteGenerationId)
    .first<{ onboarding_submission_id: string }>()
    .then((row) => {
      if (!row) throw new Error(`Site Generation ${input.siteGenerationId} not found`);
      return row.onboarding_submission_id;
    });
  const businessFactsRef = `onboarding-submission:${submissionId}#fact-snapshot`;

  const terminal = (
    terminal: SimplePipelineTerminal,
    reasons: string[],
    extra?: Partial<SimplePipelineOutcome>
  ): SimplePipelineOutcome => ({
    terminal,
    reasons,
    siteGenerationId: input.siteGenerationId,
    siteId,
    buildId,
    releaseReadyBuildVersionId: null,
    artifactManifestHash: null,
    previewUrl: null,
    repairApplied: false,
    builderStrategy: null,
    designBlueprintR2Key: null,
    ...extra,
  });

  try {
    // ── Reference capture (REUSED legacy intake; idempotent frozen reuse) ──
    let version: { buildVersionId: string; buildVersionNumber: number } = await env.DB.prepare(
      "SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1"
    )
      .bind(buildId)
      .first<{ id: string; version_number: number }>()
      .then((row) => {
        if (!row) throw new Error(`Build ${buildId} has no Build Version`);
        return { buildVersionId: row.id, buildVersionNumber: row.version_number };
      });

    await stepDo("simple: reference capture", async () => {
      await runReferenceIntake(env, {
        siteGenerationId: input.siteGenerationId,
        buildId,
        buildVersionId: version.buildVersionId,
        buildVersionNumber: version.buildVersionNumber,
        capture: deps.capture,
      });
      return null;
    });
    const frozen = await getFrozenReferenceEvidence(env, input.siteGenerationId);
    if (!frozen) throw new Error("frozen evidence package missing after intake");
    if (frozen.suitability === "UNSUPPORTED") {
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "REFERENCE_CHECK",
        toState: "HUMAN_REVIEW_REQUIRED",
        stage: "simple_reference_capture",
        detail: `UNSUPPORTED Reference: ${frozen.suitabilityReasons.join("; ").slice(0, 300)}`,
      });
      return terminal("HUMAN_REVIEW_REQUIRED", [`UNSUPPORTED Reference: ${frozen.suitabilityReasons.join("; ")}`]);
    }
    if (frozen.evidenceSufficiency.sufficiency === "INSUFFICIENT") {
      const reason = `INSUFFICIENT_REFERENCE_EVIDENCE: ${frozen.evidenceSufficiency.reasons.join("; ")}`;
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "REFERENCE_EVIDENCE",
        toState: "HUMAN_REVIEW_REQUIRED",
        stage: "simple_reference_capture",
        detail: reason.slice(0, 400),
      });
      return terminal("HUMAN_REVIEW_REQUIRED", [reason]);
    }

    const facts = (await getEffectiveBusinessFacts(env, buildId)).facts;

    // ── DESIGN BLUEPRINT (the ONE design-authority artifact) ───────────────
    const blueprintResult = await stepDo("simple: design blueprint", (): Promise<
      | { kind: "ok"; blueprint: DesignBlueprint; artifactR2Key: string }
      | { kind: "review"; reason: string }
      | { kind: "failed"; reason: string }
    > => {
      // Artifact reuse lives inside the stage (frozen blueprint IS the result).
      return (async () => {
        try {
          const produced = await runSimpleDesignBlueprintStage(env, {
            siteGenerationId: input.siteGenerationId,
            buildId,
            buildVersionId: version.buildVersionId,
            buildVersionNumber: version.buildVersionNumber,
            businessFactsRef,
            replacementBusiness: {
              name: facts.businessName,
              ...(facts.businessType ? { type: facts.businessType } : {}),
              ...(facts.businessDescription ? { description: facts.businessDescription } : {}),
            },
            ...(frozen.evidence.referenceUrl ? { referenceUrl: frozen.evidence.referenceUrl } : {}),
            visualInputs: frozen.evidence.visualInputs ?? [],
            ...(deps.visionGenerate ? { generate: deps.visionGenerate } : {}),
            ...(deps.generate ? { generate: deps.generate } : {}),
          });
          return { kind: "ok" as const, blueprint: produced.blueprint, artifactR2Key: produced.artifactR2Key };
        } catch (error) {
          if (error instanceof SimpleDesignBlueprintError) {
            // Spec section 30: one schema correction (already spent inside the
            // boundary) then HUMAN_REVIEW_REQUIRED. Never a second semantic
            // generation.
            return { kind: "review" as const, reason: `DESIGN_BLUEPRINT_REVIEW_REQUIRED: ${error.code}: ${error.message}` };
          }
          if (isVisionSeamExhaustion(error)) {
            return { kind: "failed" as const, reason: `DESIGN_BLUEPRINT vision seam unavailable: ${(error as Error).message}` };
          }
          throw error;
        }
      })();
    });
    if (blueprintResult.kind !== "ok") {
      const terminalStatus = blueprintResult.kind === "review" ? "HUMAN_REVIEW_REQUIRED" : "FAILED";
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "BLUEPRINT",
        toState: terminalStatus,
        stage: "simple_design_blueprint",
        detail: blueprintResult.reason.slice(0, 400),
      });
      return terminal(terminalStatus, [blueprintResult.reason]);
    }
    const blueprint = blueprintResult.blueprint;
    const blueprintArtifactR2Key: string = blueprintResult.artifactR2Key;
    await appendBuildWorkflowEvent(env, {
      buildId,
      buildVersionId: version.buildVersionId,
      fromState: "REFERENCE_EVIDENCE",
      toState: "BLUEPRINT",
      stage: "simple_design_blueprint",
      detail: `Design Blueprint produced (${blueprint.designDna.length} DNA rules, ${blueprint.imagery.imageSlots.length} image slots, ${blueprint.acceptanceChecklist.length} acceptance conditions)`,
    });

    // ── IMAGES (REUSED durable KIE machinery; blueprint is prompt authority)
    await stepDo(`simple: images (v${version.buildVersionNumber})`, async () => {
      const slots = blueprintSlotsToImageSlots(blueprint);
      const accepted = await getAcceptedImageMap(env, version.buildVersionId);
      const unresolved = slots.filter((slot) => !accepted.has(slot.id));
      if (unresolved.length > 0) {
        await runImageGenerationDurable(
          env,
          {
            siteGenerationId: input.siteGenerationId,
            buildId,
            buildVersionId: version.buildVersionId,
            buildVersionNumber: version.buildVersionNumber,
            slots: unresolved,
            provider: deps.imageProvider ?? new KieV2ImageProvider(env),
            // No expandToTarget: the blueprint decides how many images the
            // design needs (spec section 21 — never force 12).
            expandToTarget: false,
            promptRecords: blueprintSlotsToPromptRecords(blueprint),
            ...(deps.generate ? { generate: deps.generate } : {}),
          },
          { stepDo, ...(deps.sleep ? { sleep: deps.sleep } : {}) }
        );
      }
      return null;
    });

    // ── Build + QA + bounded ONE repair ─────────────────────────────────────
    const formServiceEndpoint = `${env.PUBLIC_APP_URL}/api/v2/forms/submit`;
    const siteFormId = `site:${siteId}`;
    const visualInputs: SimpleBuilderVisualInput[] = frozen.evidence.visualInputs ?? [];
    let builderStrategy: SimplePipelineOutcome["builderStrategy"] = null;

    const assembleAndPreview = async (ctx: SimpleVersionContext, bundle: SiteBundle): Promise<AssembleOutcome | { preflightBlockers: { id: string; detail: string }[] }> => {
      return stepDo(`simple: assemble + preview (v${ctx.buildVersionNumber})`, async () => {
        const acceptedEntries = await getAcceptedImageMap(env, ctx.buildVersionId);
        const acceptedImages = new Map([...acceptedEntries].map(([slotId, entry]) => [slotId, entry.r2Key] as const));
        try {
          const built = await buildAssembledCandidate(env, {
            siteGenerationId: ctx.siteGenerationId,
            buildId: ctx.buildId,
            buildVersionId: ctx.buildVersionId,
            buildVersionNumber: ctx.buildVersionNumber,
            pages: bundle.pages,
            sharedCss: bundle.sharedCss,
            sharedJs: bundle.sharedJs,
            imagePlanSlots: blueprintSlotsToImageSlots(blueprint),
            acceptedImages,
            formServiceEndpoint,
            expectedSiteFormId: siteFormId,
          });
          await freezeAssembledCandidate(env, {
            siteGenerationId: ctx.siteGenerationId,
            buildId: ctx.buildId,
            buildVersionId: ctx.buildVersionId,
            buildVersionNumber: ctx.buildVersionNumber,
            pages: bundle.pages,
            sharedCss: bundle.sharedCss,
            sharedJs: bundle.sharedJs,
            candidate: built,
            imagePlanSlots: blueprintSlotsToImageSlots(blueprint),
            acceptedImages,
            formServiceEndpoint,
            expectedSiteFormId: siteFormId,
          });
          const preview = await deployPreview(env, {
            buildId: ctx.buildId,
            buildVersionId: ctx.buildVersionId,
            buildVersionNumber: ctx.buildVersionNumber,
            candidate: built,
            ...(deps.previewDeployer ? { deployer: deps.previewDeployer } : {}),
          });
          return { kind: "ok" as const, manifestHash: built.artifactManifestHash, previewUrl: preview.previewUrl };
        } catch (error) {
          if (error instanceof AssemblyPreflightError) {
            return {
              preflightBlockers: error.blockers.map((blocker) => ({ id: blocker.id, detail: blocker.detail ?? blocker.id })),
            };
          }
          throw error;
        }
      });
    };

    const evaluateVersion = async (ctx: SimpleVersionContext, previewUrl: string | null): Promise<QaOutcome> => {
      const evidenceBundle = previewUrl
        ? await stepDo(`simple: QA evidence (v${ctx.buildVersionNumber})`, () =>
            buildStandardEvidenceBundle(env, {
              buildId: ctx.buildId,
              buildVersionId: ctx.buildVersionId,
              buildVersionNumber: ctx.buildVersionNumber,
              siteGenerationId: ctx.siteGenerationId,
              capture: deps.qaCapture ? deps.qaCapture(previewUrl) : createProductionQaCapture(env, previewUrl, { expectedBuildVersionId: ctx.buildVersionId }),
            })
          )
        : null;

      return stepDo(`simple: QA package (v${ctx.buildVersionNumber})`, async () => {
        const existingPkg = await getBuildStageArtifact<QaPackage>(env, ctx.buildVersionId, "qa_package");
        const bundle = await loadBundle(env, ctx.buildVersionId);
        if (!bundle) throw new Error(`site bundle missing for Build Version ${ctx.buildVersionId}`);

        const candidateDesktop = evidenceBundle?.bundle.captures.find((c) => c.page === "home" && c.viewportWidth === 1440)?.artifactR2Key
          ?? existingPkg?.value.candidateScreenshotKeys.desktop;
        const candidateMobile = evidenceBundle?.bundle.captures.find((c) => c.page === "home" && c.viewportWidth === 390)?.artifactR2Key
          ?? existingPkg?.value.candidateScreenshotKeys.mobile;

        const deterministic = runDeterministicBundleQa({
          bundle,
          blueprint,
          facts,
          formServiceEndpoint,
          siteFormId,
          slotIds: new Set(blueprint.imagery.imageSlots.map((slot) => slot.id)),
          resolvedSlotIds: new Set(
            [...(await getAcceptedImageMap(env, ctx.buildVersionId)).keys()]
          ),
          renderEvidence: evidenceBundle
            ? {
                capturesRendered: evidenceBundle.bundle.captures.length,
                mobileCaptured: evidenceBundle.bundle.captures.some((c) => c.viewportWidth === 390),
                failedRequestCount: evidenceBundle.bundle.captures.reduce((sum, c) => sum + c.failedRequestCount, 0),
              }
            : null,
        });

        // ONE visual QA call per evaluation — only when a candidate render
        // exists to judge (a preflight-failed candidate is judged
        // deterministically; its repair clears the technical findings first).
        const visual =
          candidateDesktop && !existingPkg
            ? (await runSimpleVisualQaStage(env, {
                siteGenerationId: ctx.siteGenerationId,
                buildId: ctx.buildId,
                buildVersionId: ctx.buildVersionId,
                buildVersionNumber: ctx.buildVersionNumber,
                blueprint,
                referenceVisualInputs: visualInputs,
                candidateDesktopR2Key: candidateDesktop,
                ...(candidateMobile ? { candidateMobileR2Key: candidateMobile } : {}),
                ...(deps.visionGenerate ? { generate: deps.visionGenerate } : {}),
                ...(deps.generate ? { generate: deps.generate } : {}),
              })).report
            : existingPkg?.value.visual ?? null;

        const pkg = buildSimpleQaPackage({
          buildVersionNumber: ctx.buildVersionNumber,
          visual,
          deterministic,
          referenceScreenshotKeys: {
            desktop: visualInputs.find((entry) => entry.kind === "full-page")?.artifact ?? frozen.canonicalScreenshotR2Key,
            ...(visualInputs.find((entry) => /mobile/i.test(entry.kind))?.artifact
              ? { mobile: visualInputs.find((entry) => /mobile/i.test(entry.kind))!.artifact }
              : {}),
          },
          candidateScreenshotKeys: {
            desktop: candidateDesktop ?? "",
            ...(candidateMobile ? { mobile: candidateMobile } : {}),
          },
        });

        const release = await finalizeSimpleRelease(
          env,
          { buildId: ctx.buildId, buildVersionId: ctx.buildVersionId, siteGenerationId: ctx.siteGenerationId },
          pkg,
          deterministic.gates,
          evidenceBundle ? [evidenceBundle.artifactR2Key] : []
        );
        pkg.releaseReady = release.releaseReady;
        pkg.reasons = release.reasons;
        await storeSimpleQaPackage(
          env,
          { buildId: ctx.buildId, buildVersionId: ctx.buildVersionId, siteGenerationId: ctx.siteGenerationId },
          pkg
        );
        await appendBuildWorkflowEvent(env, {
          buildId: ctx.buildId,
          buildVersionId: ctx.buildVersionId,
          fromState: "QA_EVIDENCE",
          toState: "QA",
          stage: "simple_qa",
          detail: release.releaseReady
            ? `SIMPLE QA passed (visual ${visual?.scores.overall ?? "n/a"}, truth 0 blockers, technical 0 blockers)`
            : `SIMPLE QA found: ${release.reasons.slice(0, 4).join("; ").slice(0, 300)}`,
        });
        return {
          releaseReady: release.releaseReady,
          reasons: release.reasons,
          pkg,
          evidenceR2Keys: evidenceBundle ? [evidenceBundle.artifactR2Key] : [],
          previewUrl,
        };
      });
    };

    const buildOutcome = await stepDo(`simple: website build (v${version.buildVersionNumber})`, async () => {
      const built = await runSimpleWebsiteBuilderStage(env, {
        siteGenerationId: input.siteGenerationId,
        buildId,
        buildVersionId: version.buildVersionId,
        buildVersionNumber: version.buildVersionNumber,
        blueprint,
        facts,
        acceptedImages: blueprint.imagery.imageSlots.map((slot) => ({
          slotId: slot.id,
          altText: slot.altText,
          aspectRatio: slot.generationAspectRatio,
          page: slot.page,
          ...(slot.section ? { section: slot.section } : {}),
        })),
        formServiceEndpoint,
        siteFormId,
        visualInputs,
        ...(deps.visionGenerate ? { visionGenerate: deps.visionGenerate } : {}),
        ...(deps.generate ? { generate: deps.generate } : {}),
      });
      return { strategy: built.strategy };
    });
    builderStrategy = buildOutcome.strategy;
    await appendBuildWorkflowEvent(env, {
      buildId,
      buildVersionId: version.buildVersionId,
      fromState: "BLUEPRINT",
      toState: "SITE_GENERATION",
      stage: "simple_website_build",
      detail: `Site bundle built (${builderStrategy})`,
    });

    const v1Context: SimpleVersionContext = {
      siteGenerationId: input.siteGenerationId,
      siteId,
      buildId,
      buildVersionId: version.buildVersionId,
      buildVersionNumber: version.buildVersionNumber,
    };
    const v1Assembled = await assembleAndPreview(v1Context, (await loadBundle(env, version.buildVersionId))!);
    if ("preflightBlockers" in v1Assembled) {
      // No preview, no render — deterministic findings only drive the repair.
      const first = await evaluateVersion(v1Context, null);
      if (first.releaseReady) {
        return terminal("RELEASE_READY", [], {
          releaseReadyBuildVersionId: version.buildVersionId,
          repairApplied: false,
          builderStrategy,
          designBlueprintR2Key: blueprintArtifactR2Key,
        });
      }
      // → the ONE repair (below) consumes the entire remaining budget.
      return await runRepairAndFinalQa(first);
    }

    const first = await evaluateVersion(v1Context, v1Assembled.previewUrl);
    if (first.releaseReady) {
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: version.buildVersionId,
        fromState: "QA",
        toState: "RELEASE_READY",
        stage: "simple_release_ready",
        detail: "First-pass success — no repair needed (spec section 48)",
      });
      return terminal("RELEASE_READY", [], {
        releaseReadyBuildVersionId: version.buildVersionId,
        artifactManifestHash: v1Assembled.manifestHash,
        previewUrl: v1Assembled.previewUrl,
        repairApplied: false,
        builderStrategy,
        designBlueprintR2Key: blueprintArtifactR2Key,
      });
    }

    return await runRepairAndFinalQa(first);

    // ── ONE repair → re-render → final QA (no second repair, spec §49-53) ──
    async function runRepairAndFinalQa(first: QaOutcome): Promise<SimplePipelineOutcome> {
      // Durable repair-position truth: the latest version carries the repair.
      const latest = await env.DB.prepare(
        "SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1"
      )
        .bind(buildId)
        .first<{ id: string; version_number: number }>();
      if (!latest) throw new Error(`Build ${buildId} has no Build Version`);

      let repairCtx: SimpleVersionContext;
      if (latest.version_number === version.buildVersionNumber) {
        const created = await stepDo("simple: repair version", async () => {
          const next = await createNextBuildVersion(env, { buildId, cause: "simple_one_repair", detail: "SIMPLE pipeline ONE repair (spec sections 49-53)" });
          return { buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber };
        });
        await stepDo("simple: repair inheritance", async () => {
          await reuseAcceptedImages(env, version.buildVersionId, created.buildVersionId);
          await storeBuildStageArtifactIdempotent(env, {
            buildId,
            buildVersionId: created.buildVersionId,
            siteGenerationId: input.siteGenerationId,
            kind: "design_blueprint",
            schemaVersion: "design-blueprint/1",
            value: blueprint,
          });
          return null;
        });
        repairCtx = {
          siteGenerationId: input.siteGenerationId,
          siteId,
          buildId,
          buildVersionId: created.buildVersionId,
          buildVersionNumber: created.buildVersionNumber,
        };
      } else {
        // A prior engine entry already created the repair version — resume it.
        repairCtx = {
          siteGenerationId: input.siteGenerationId,
          siteId,
          buildId,
          buildVersionId: latest.id,
          buildVersionNumber: latest.version_number,
        };
      }

      await stepDo(`simple: repair (v${repairCtx.buildVersionNumber})`, async () => {
        const repaired = await runSimpleSiteRepairStage(env, {
          siteGenerationId: input.siteGenerationId,
          buildId,
          buildVersionId: repairCtx.buildVersionId,
          buildVersionNumber: repairCtx.buildVersionNumber,
          bundle: (await loadBundle(env, version.buildVersionId))!,
          blueprint,
          facts,
          qaPackage: first.pkg,
          acceptedImages: blueprint.imagery.imageSlots.map((slot) => ({
            slotId: slot.id,
            altText: slot.altText,
            aspectRatio: slot.generationAspectRatio,
          })),
          formServiceEndpoint,
          siteFormId,
          referenceVisualInputs: visualInputs,
          ...(first.pkg.candidateScreenshotKeys.desktop ? { candidateDesktopR2Key: first.pkg.candidateScreenshotKeys.desktop } : {}),
          ...(first.pkg.candidateScreenshotKeys.mobile ? { candidateMobileR2Key: first.pkg.candidateScreenshotKeys.mobile } : {}),
          ...(deps.visionGenerate ? { generate: deps.visionGenerate } : {}),
          ...(deps.generate ? { generate: deps.generate } : {}),
        });
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: repairCtx.buildVersionId,
          fromState: "FIX",
          toState: "CONFIRMATION",
          stage: "simple_repair",
          detail: `ONE repair applied → new immutable Build Version v${repairCtx.buildVersionNumber}; notes: ${(repaired.bundle.notes ?? "none").slice(0, 200)}`,
        });
        return null;
      });

      const repairedBundle = await loadBundle(env, repairCtx.buildVersionId);
      if (!repairedBundle) {
        // Unreachable in practice (the repair step stores it), but a resumed
        // entry whose repair call failed schema validation lands here: the
        // repair budget is consumed — escalate, never re-repair.
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: repairCtx.buildVersionId,
          fromState: "CONFIRMATION",
          toState: "HUMAN_REVIEW_REQUIRED",
          stage: "simple_repair",
          detail: "repair bundle missing after the ONE repair attempt — automation stops",
        });
        return terminal("HUMAN_REVIEW_REQUIRED", ["SIMPLE repair produced no valid bundle; HUMAN_REVIEW_REQUIRED (spec section 53)"], {
          repairApplied: true,
          builderStrategy,
          designBlueprintR2Key: blueprintArtifactR2Key,
          previewUrl: first.previewUrl,
        });
      }

      const repairedAssembled = await assembleAndPreview(repairCtx, repairedBundle);
      if ("preflightBlockers" in repairedAssembled) {
        const reasons = [
          "repaired candidate failed deterministic Technical Preflight after the ONE repair — automation stops (spec section 53)",
          ...repairedAssembled.preflightBlockers.map((blocker) => `${blocker.id}: ${blocker.detail}`),
        ];
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: repairCtx.buildVersionId,
          fromState: "CONFIRMATION",
          toState: "HUMAN_REVIEW_REQUIRED",
          stage: "simple_final_qa",
          detail: reasons.join("; ").slice(0, 400),
        });
        return terminal("HUMAN_REVIEW_REQUIRED", reasons, {
          repairApplied: true,
          builderStrategy,
          designBlueprintR2Key: blueprintArtifactR2Key,
          previewUrl: first.previewUrl,
        });
      }

      const final = await evaluateVersion(repairCtx, repairedAssembled.previewUrl);
      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: repairCtx.buildVersionId,
        fromState: "CONFIRMATION",
        toState: final.releaseReady ? "RELEASE_READY" : "HUMAN_REVIEW_REQUIRED",
        stage: "simple_final_qa",
        detail: final.releaseReady
          ? `Final QA passed after the ONE repair (visual ${final.pkg.visual?.scores.overall ?? "n/a"})`
          : `Final QA still failing after the ONE repair: ${final.reasons.slice(0, 4).join("; ").slice(0, 280)}`,
      });
      return terminal(final.releaseReady ? "RELEASE_READY" : "HUMAN_REVIEW_REQUIRED", final.reasons, {
        releaseReadyBuildVersionId: final.releaseReady ? repairCtx.buildVersionId : null,
        artifactManifestHash: repairedAssembled.manifestHash,
        previewUrl: repairedAssembled.previewUrl,
        repairApplied: true,
        builderStrategy,
        designBlueprintR2Key: blueprintArtifactR2Key,
      });
    }
  } catch (error) {
    // Same transient/terminal discipline as the legacy pipeline (issue #70):
    // the engine owns recovery for retryable failures; only deliberate domain
    // outcomes mutate Build state here.
    if (classifyStageFailure(error) === "TRANSIENT_RETRYABLE") {
      throw error;
    }
    const detail = `SIMPLE pipeline stage failure: ${(error as Error).message.slice(0, 400)}`;
    await appendBuildWorkflowEvent(env, {
      buildId,
      fromState: "QA",
      toState: "FAILED",
      stage: "simple_pipeline_failure",
      detail,
    }).catch(() => {});
    return terminal("FAILED", [detail]);
  }
}

function isVisionSeamExhaustion(error: unknown): boolean {
  return error instanceof VisionGatewayError;
}
