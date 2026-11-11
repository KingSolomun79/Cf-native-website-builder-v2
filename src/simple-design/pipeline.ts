// The V2 design pipeline (canonical since the 2026-09 legacy cleanup): the
// SIMPLE chain is the ONLY design path, for BOTH Build Modes (issue #24).
//
//   REFERENCE_BOUND:
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
//   ORIGINAL_DESIGN: the SAME chain from the blueprint stage onward. The
//   Reference-only stages are SKIPPED (never faked): the Design Blueprint is
//   invented from Business Facts + Creative Direction
//   (simple-original-design-blueprint/v1, same design-blueprint/2 schema) and
//   visual QA judges the candidate against the Blueprint + Creative Direction
//   (simple-original-design-visual-qa/v1, same report schema). No fallback
//   exists in either direction between the modes.
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
import type { RawAiGenerate } from "../domain/ai-boundary";
import type { BusinessFacts, BuildMode, OnboardingSubmissionPayload } from "../domain/lifecycle-schema";
import {
  creativeDirectionChecksum,
  deriveCreativeDirection,
  renderCreativeDirectionBrief,
  type CreativeDirectionContext,
} from "../domain/creative-direction";
import {
  materializeAcceptedImageDescriptors,
  materializeBlueprintImageSlots,
  materializeBlueprintPromptRecords,
  DESIGN_BLUEPRINT_V2_SCHEMA_VERSION,
  type DesignBlueprintV2,
  type QaPackage,
  type SiteBundle,
  type VisualQaReport,
} from "./contracts";
import { AiStageSchemaInvalidError } from "../domain/ai-boundary";
import { runSimpleDesignBlueprintStage, SimpleDesignBlueprintError } from "./design-blueprint";
import {
  runSimpleWebsiteBuilderStage,
  SimpleWebsiteBuilderError,
  runSimplePreQaRepairStage,
  copyBuilderFileArtifacts,
  PRE_QA_REPAIR_PLAN_ARTIFACT_KIND,
  PRE_QA_REPAIR_PLAN_SCHEMA_VERSION,
  type PreQaRepairPlan,
} from "./website-builder";
import type { BuilderFileKind } from "./builder-file-realization";
import type { SimpleBuilderVisualInput } from "./contracts";
import { runSimpleVisualQaStage } from "./visual-qa";
import { runSimpleSiteRepairStage } from "./site-repair";
import { runDeterministicBundleQa } from "./bundle-qa";
import { buildSimpleQaPackage, finalizeSimpleRelease, simpleReleaseVerdict, storeSimpleQaPackage } from "./qa-package";

// Pipeline provenance identifier. The legacy_v2 executable path was removed
// (cleanup 2026-09-10): this constant is retained only as the artifact/
// provenance version string. There is no runtime selector and no env var.
export const DESIGN_PIPELINE_VERSION = "simple_blueprint_v1";

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
  builderStrategy: "SIX_CALL_FILE_REALIZATION" | null;
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

// Redesign-intent detection for blueprint reuse (operator GO 2026-11-09).
// Deliberately CONSERVATIVE toward regeneration: only unmistakable redesign
// language opts a revision out of reusing the parent's accepted Design
// Blueprint. Layout/composition FIX requests ("fix the overflow", "centre the
// content", "make the cards even") are realization defects, not redesigns —
// they reuse the blueprint and steer the builder. Exported for tests.
export function revisionRequestsRedesign(note: string | undefined): boolean {
  if (!note) return false;
  return /start afresh|start over|start from scratch|redesign|new design|fresh design|different design|completely different|change the design|overall design/i.test(note);
}

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

// ONE repair per Build, total (#14): within a Build, only the bounded repair
// ever creates an additional immutable Build Version (createNextBuildVersion
// has no other caller), so the version count is the durable repair-budget
// truth — engine-retry-safe and readable from any resumed entry.
async function countBuildVersions(env: Env, buildId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?")
    .bind(buildId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function runSimpleBuildPipeline(
  env: Env,
  input: { siteGenerationId: string; buildId?: string; deps?: SimplePipelineDeps }
): Promise<SimplePipelineOutcome> {
  const deps = input.deps ?? {};
  const stepDo = deps.step ?? (async <T>(_name: string, fn: () => Promise<T>) => fn());
  const buildId =
    input.buildId ?? (await createInitialBuild(env, { siteGenerationId: input.siteGenerationId })).buildId;
  const generation = await env.DB.prepare(
    "SELECT site_id, onboarding_submission_id, build_mode FROM site_generations WHERE id = ?"
  )
    .bind(input.siteGenerationId)
    .first<{ site_id: string; onboarding_submission_id: string; build_mode: BuildMode }>()
    .then((row) => {
      if (!row) throw new Error(`Site Generation ${input.siteGenerationId} not found`);
      return row;
    });
  const siteId = generation.site_id;
  const submissionId = generation.onboarding_submission_id;
  const buildMode: BuildMode = generation.build_mode;
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
    // ── Design-origin intake (mode-conditional, issue #24) ────────────────
    // REFERENCE_BOUND: the REUSED legacy intake with suitability/sufficiency
    // gates. ORIGINAL_DESIGN: Reference-only stages are SKIPPED — no
    // Reference, no fake empty artifacts; the frozen Onboarding Submission's
    // Creative Direction is the design-intent authority.
    let version: { buildVersionId: string; buildVersionNumber: number } = await env.DB.prepare(
      "SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1"
    )
      .bind(buildId)
      .first<{ id: string; version_number: number }>()
      .then((row) => {
        if (!row) throw new Error(`Build ${buildId} has no Build Version`);
        return { buildVersionId: row.id, buildVersionNumber: row.version_number };
      });

    // Non-null exactly for REFERENCE_BOUND; ORIGINAL_DESIGN has no Reference
    // evidence and never records a fake one (GO §30).
    let frozen: Awaited<ReturnType<typeof getFrozenReferenceEvidence>> = null;
    let creativeContext: CreativeDirectionContext | null = null;
    let creativeDirectionSha256: string | null = null;

    const facts = (await getEffectiveBusinessFacts(env, buildId)).facts;

    if (buildMode === "REFERENCE_BOUND") {
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
      frozen = await getFrozenReferenceEvidence(env, input.siteGenerationId);
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
    } else {
      // Resume-safety (found live 2026-11-11, union validation build
      // c1bdb659): the creative-direction context and checksum were derived
      // INSIDE the cached step callback — an engine restart replays the step
      // from cache WITHOUT running the callback, leaving creativeContext null
      // and sending ORIGINAL_DESIGN visual QA down the REFERENCE_BOUND branch
      // ("REFERENCE_BOUND visual QA requires Reference visual inputs" -> the
      // Build died as WORKFLOW_EXECUTION_EXHAUSTED). The derivation is pure
      // and idempotent from the frozen submission row, so it now runs on
      // EVERY invocation OUTSIDE the cached step; the step keeps only the
      // (idempotent) provenance event.
      const loadOriginalDesignContext = async (): Promise<void> => {
        const submissionRow = await env.DB.prepare(
          "SELECT payload_json FROM onboarding_submissions WHERE id = ?"
        )
          .bind(submissionId)
          .first<{ payload_json: string }>();
        if (!submissionRow) throw new Error(`Onboarding Submission ${submissionId} not found`);
        const payload = JSON.parse(submissionRow.payload_json) as OnboardingSubmissionPayload;
        if (payload.buildMode !== "ORIGINAL_DESIGN" || !payload.creativeDirection) {
          // Frozen rows were validated at intake; this is a corruption guard,
          // never a mode fallback.
          throw new Error(`Onboarding Submission ${submissionId} does not carry ORIGINAL_DESIGN creative direction`);
        }
        creativeContext = deriveCreativeDirection({ creativeDirection: payload.creativeDirection, facts });
        creativeDirectionSha256 = await creativeDirectionChecksum(payload.creativeDirection);
      };
      await loadOriginalDesignContext();
      await stepDo("simple: original design intake", async () => {
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: version.buildVersionId,
          fromState: "INTAKE_READY",
          toState: "REFERENCE_CHECK",
          stage: "original_design_intake",
          detail: `buildMode=ORIGINAL_DESIGN; referenceEvidence=NOT_APPLICABLE; onboardingSubmission=${submissionId}; creativeDirectionSha256=${creativeDirectionSha256}`,
        });
        return null;
      });
    }

    // Governing human revision instruction (operator GO 2026-09-12): a
    // revision Build carries its Revision Request's requestNote into the
    // SAME Builder v8/model/path as a bounded intent block. Initial builds
    // have none. Since the blueprint-reuse GO (2026-11-09) it ALSO steers the
    // two design-level decisions below (blueprint reuse vs regeneration).
    let humanRevisionInstruction: string | undefined;
    const buildKindRow = await env.DB.prepare("SELECT kind, parent_build_id FROM builds WHERE id = ?").bind(buildId).first<{ kind: string; parent_build_id: string | null }>();
    if (buildKindRow?.kind === "revision") {
      const requestRow = await env.DB.prepare("SELECT request_note FROM revision_requests WHERE build_id = ?")
        .bind(buildId)
        .first<{ request_note: string | null }>();
      if (requestRow?.request_note) humanRevisionInstruction = requestRow.request_note;
    }

    // ── DESIGN BLUEPRINT (the ONE design-authority artifact) ───────────────
    //
    // Blueprint reuse on revision (operator GO 2026-11-09): a revision whose
    // note does NOT request a redesign reuses the parent Build's accepted
    // Design Blueprint (and its Accepted Images) instead of re-rolling the
    // design authority from scratch — revisions improve ONE design; live
    // evidence 2026-11-02..06 showed regeneration turning careful fix notes
    // into fidelity-0 rebuilds. An explicit redesign note regenerates, with
    // the note riding the Blueprint call as a bounded intent block.
    const blueprintResult = await stepDo("simple: design blueprint", (): Promise<
      | { kind: "ok"; blueprint: DesignBlueprintV2; artifactR2Key: string; schemaVersion: string }
      | { kind: "review"; reason: string }
      | { kind: "failed"; reason: string }
    > => {
      // Artifact reuse lives inside the stage (frozen blueprint IS the result;
      // v1 artifacts resume through the stage's read-only compat path).
      return (async () => {
        if (buildKindRow?.kind === "revision" && buildKindRow.parent_build_id && !revisionRequestsRedesign(humanRevisionInstruction)) {
          const parentLatest = await env.DB.prepare(
            "SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1"
          )
            .bind(buildKindRow.parent_build_id)
            .first<{ id: string; version_number: number }>();
          const parentBlueprint = parentLatest
            ? await getBuildStageArtifact<unknown>(env, parentLatest.id, "design_blueprint")
            : null;
          if (parentBlueprint && (parentBlueprint.value as { version?: unknown })?.version === "2") {
            const blueprintValue = parentBlueprint.value as DesignBlueprintV2;
            const stored = await storeBuildStageArtifactIdempotent(env, {
              buildId,
              buildVersionId: version.buildVersionId,
              siteGenerationId: input.siteGenerationId,
              kind: "design_blueprint",
              schemaVersion: DESIGN_BLUEPRINT_V2_SCHEMA_VERSION,
              value: blueprintValue,
              provenance: parentBlueprint.provenance,
            });
            // The reused blueprint's slots are the parent's slots verbatim, so
            // the parent's Accepted Images transfer exactly (hero slots are
            // deterministic; supporting slots carry the same model-chosen ids).
            if (parentLatest) await reuseAcceptedImages(env, parentLatest.id, version.buildVersionId);
            await appendBuildWorkflowEvent(env, {
              buildId,
              buildVersionId: version.buildVersionId,
              fromState: buildMode === "ORIGINAL_DESIGN" ? "REFERENCE_CHECK" : "REFERENCE_EVIDENCE",
              toState: "BLUEPRINT",
              stage: "simple_design_blueprint",
              detail: `Reused the parent Build's accepted Design Blueprint and Accepted Images (operator GO 2026-11-09: no redesign requested — the revision improves ONE design instead of re-rolling it); parent build ${buildKindRow.parent_build_id.slice(0, 8)} v${parentLatest?.version_number}`,
            });
            return { kind: "ok" as const, blueprint: blueprintValue, artifactR2Key: stored.artifactR2Key, schemaVersion: DESIGN_BLUEPRINT_V2_SCHEMA_VERSION };
          }
          // No reusable parent blueprint (e.g. the parent failed before the
          // blueprint stage): fall through to normal generation, never fake.
        }
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
            ...(buildMode === "ORIGINAL_DESIGN"
              ? {
                  originalDesign: {
                    creativeDirection: creativeContext!,
                    creativeDirectionSha256: creativeDirectionSha256!,
                    onboardingSubmissionId: submissionId,
                  },
                }
              : {
                  ...(frozen!.evidence.referenceUrl ? { referenceUrl: frozen!.evidence.referenceUrl } : {}),
                  visualInputs: frozen!.evidence.visualInputs ?? [],
                }),
            ...(humanRevisionInstruction && revisionRequestsRedesign(humanRevisionInstruction)
              ? { humanRevisionInstruction }
              : {}),
            ...(deps.visionGenerate ? { generate: deps.visionGenerate } : {}),
            ...(deps.generate ? { generate: deps.generate } : {}),
          });
          return { kind: "ok" as const, blueprint: produced.blueprint, artifactR2Key: produced.artifactR2Key, schemaVersion: produced.schemaVersion };
        } catch (error) {
          if (error instanceof SimpleDesignBlueprintError) {
            // Spec section 30: one schema correction (already spent inside the
            // boundary) then HUMAN_REVIEW_REQUIRED. Never a second semantic
            // generation.
            return { kind: "review" as const, reason: `DESIGN_BLUEPRINT_REVIEW_REQUIRED: ${error.code}: ${error.message}` };
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
    const blueprintSchemaVersion: string = blueprintResult.schemaVersion;
    // design-blueprint/2: hero slots, page ownership and priorities are
    // deterministic domain construction — the materialized plan is the ONLY
    // image representation downstream stages see.
    const imagePlan = materializeBlueprintImageSlots(blueprint);
    const acceptedImageDescriptors = materializeAcceptedImageDescriptors(blueprint);
    await appendBuildWorkflowEvent(env, {
      buildId,
      buildVersionId: version.buildVersionId,
      fromState: buildMode === "ORIGINAL_DESIGN" ? "REFERENCE_CHECK" : "REFERENCE_EVIDENCE",
      toState: "BLUEPRINT",
      stage: "simple_design_blueprint",
      detail:
        buildMode === "ORIGINAL_DESIGN"
          ? `Original Design Blueprint produced (${blueprintResult.schemaVersion}: ${blueprint.designDna.length} DNA rules, ${imagePlan.length} materialized image slots incl. 4 page heroes, ${blueprint.acceptanceChecklist.length} acceptance conditions)`
          : `Design Blueprint produced (${blueprintResult.schemaVersion}: ${blueprint.designDna.length} DNA rules, ${imagePlan.length} materialized image slots incl. 4 page heroes, ${blueprint.acceptanceChecklist.length} acceptance conditions)`,
    });

    // ── IMAGES (REUSED durable KIE machinery; blueprint is prompt authority)
    await stepDo(`simple: images (v${version.buildVersionNumber})`, async () => {
      const accepted = await getAcceptedImageMap(env, version.buildVersionId);
      const unresolved = imagePlan.filter((slot) => !accepted.has(slot.id));
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
            promptRecords: materializeBlueprintPromptRecords(blueprint),
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
    // The Builder is text-only in both modes; Reference visuals flow to visual
    // QA and the repair only. ORIGINAL_DESIGN carries none (issue #24).
    const visualInputs: SimpleBuilderVisualInput[] =
      buildMode === "REFERENCE_BOUND" ? (frozen!.evidence.visualInputs ?? []) : [];
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
            imagePlanSlots: imagePlan,
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
            imagePlanSlots: imagePlan,
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
        // All-page judgement (operator GO 2026-11-09): the inner routed pages'
        // desktop renders ride the SAME single visual QA call so every page is
        // graded, not only home.
        const candidateInnerPages = evidenceBundle
          ? (["about", "services", "contact"] as const)
            .map((page) => ({
              page,
              desktop: evidenceBundle.bundle.captures.find((c) => c.page === page && c.viewportWidth === 1440)?.artifactR2Key,
            }))
            .filter((entry): entry is { page: "about" | "services" | "contact"; desktop: string } => Boolean(entry.desktop))
          : [];

        const deterministic = runDeterministicBundleQa({
          bundle,
          blueprint,
          facts,
          formServiceEndpoint,
          siteFormId,
          slotIds: new Set(imagePlan.map((slot) => slot.id)),
          resolvedSlotIds: new Set(
            [...(await getAcceptedImageMap(env, ctx.buildVersionId)).keys()]
          ),
          renderEvidence: evidenceBundle
            ? {
                capturesRendered: evidenceBundle.bundle.captures.length,
                mobileCaptured: evidenceBundle.bundle.captures.some((c) => c.viewportWidth === 390),
                failedRequestCount: evidenceBundle.bundle.captures.reduce((sum, c) => sum + c.failedRequestCount, 0),
                tapTargetViolations: evidenceBundle.bundle.captures.reduce(
                  (sum, c) => sum + (c.tapTargets?.violations ?? 0),
                  0
                ),
                tapTargetOffenders: [
                  ...new Set(
                    evidenceBundle.bundle.captures.flatMap((c) => c.tapTargets?.offenders ?? [])
                  ),
                ].slice(0, 10),
              }
            : null,
        });

        // ONE visual QA call per evaluation — only when a candidate render
        // exists to judge (a preflight-failed candidate is judged
        // deterministically; its repair clears the technical findings first).
        let visual: VisualQaReport | null = null;
        let visualQaEvaluationFailed = false;
        if (candidateDesktop && !existingPkg) {
          try {
            visual = (await runSimpleVisualQaStage(env, {
              siteGenerationId: ctx.siteGenerationId,
              buildId: ctx.buildId,
              buildVersionId: ctx.buildVersionId,
              buildVersionNumber: ctx.buildVersionNumber,
              blueprint,
              // ORIGINAL_DESIGN: candidate-only judgement against the
              // Blueprint + Creative Direction (no Reference attached).
              ...(buildMode === "ORIGINAL_DESIGN" && creativeContext
                ? { originalDesign: { creativeDirectionBrief: renderCreativeDirectionBrief(creativeContext) } }
                : { referenceVisualInputs: visualInputs }),
              candidateDesktopR2Key: candidateDesktop,
              ...(candidateMobile ? { candidateMobileR2Key: candidateMobile } : {}),
              ...(candidateInnerPages.length > 0 ? { candidateInnerPageR2Keys: candidateInnerPages } : {}),
              ...(deps.visionGenerate ? { generate: deps.visionGenerate } : {}),
              ...(deps.generate ? { generate: deps.generate } : {}),
            })).report;
          } catch (error) {
            // A visual-QA schema failure means this evaluation cannot judge
            // the candidate. The candidate is NOT silently passed: the
            // version evaluates not-release-ready and the ONE repair's
            // re-evaluation gives the verdict a fresh chance — never an
            // engine retry and never an instance-killing escape (live
            // evidence 2026-09-11).
            if (!(error instanceof AiStageSchemaInvalidError)) throw error;
            visualQaEvaluationFailed = true;
          }
        } else {
          visual = existingPkg?.value.visual ?? null;
        }
        if (visualQaEvaluationFailed) {
          await appendBuildWorkflowEvent(env, {
            buildId: ctx.buildId,
            buildVersionId: ctx.buildVersionId,
            fromState: "QA_EVIDENCE",
            toState: "QA",
            stage: "simple_visual_qa",
            detail: "VISUAL_QA_SCHEMA_INVALID: the visual report failed schema validation twice; the version evaluates not-release-ready",
          });
        }

        const pkg = buildSimpleQaPackage({
          buildVersionNumber: ctx.buildVersionNumber,
          visual,
          deterministic,
          // ORIGINAL_DESIGN records NO reference identity — null, never a fake
          // screenshot key (GO §30).
          referenceScreenshotKeys:
            buildMode === "REFERENCE_BOUND"
              ? {
                  desktop: visualInputs.find((entry) => entry.kind === "full-page")?.artifact ?? frozen!.canonicalScreenshotR2Key,
                  ...(visualInputs.find((entry) => /mobile/i.test(entry.kind))?.artifact
                    ? { mobile: visualInputs.find((entry) => /mobile/i.test(entry.kind))!.artifact }
                    : {}),
                }
              : null,
          candidateScreenshotKeys: {
            desktop: candidateDesktop ?? "",
            ...(candidateMobile ? { mobile: candidateMobile } : {}),
          },
          ...(candidateInnerPages.length > 0 ? { candidateInnerPageScreenshotKeys: candidateInnerPages } : {}),
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

    // Governing human revision instruction (operator GO 2026-09-12): fetched
    // above the Blueprint step since the reuse GO (2026-11-09) — see there.

    const buildOutcome = await stepDo(
      `simple: website build (v${version.buildVersionNumber})`,
      async (): Promise<
        | { kind: "ok"; strategy: SimplePipelineOutcome["builderStrategy"]; preQaRepaired?: boolean }
        | { kind: "failed"; reason: string; repairTarget: BuilderFileKind | null; gateFindings: string[]; preQaRepaired?: boolean }
      > => {
        // PRE-QA REPAIR RESUME (#14): a prior engine entry already decided the
        // ONE pre-QA repair for this version (the frozen plan artifact) and
        // the repaired bundle is not frozen yet — complete the bounded repair
        // here. A fresh core run could never be correct: the five frozen
        // files would be reused but the target would be re-generated WITHOUT
        // the injected findings — a blind second attempt the budget forbids.
        const repairPlan = await getBuildStageArtifact<PreQaRepairPlan>(env, version.buildVersionId, PRE_QA_REPAIR_PLAN_ARTIFACT_KIND);
        if (repairPlan) {
          try {
            const repaired = await runSimplePreQaRepairStage(env, {
              siteGenerationId: input.siteGenerationId,
              buildId,
              buildVersionId: version.buildVersionId,
              buildVersionNumber: version.buildVersionNumber,
              blueprint,
              facts,
              acceptedImages: acceptedImageDescriptors,
              formServiceEndpoint,
              siteFormId,
              ...(humanRevisionInstruction ? { humanRevisionInstruction } : {}),
              plan: repairPlan.value,
              ...(deps.generate ? { generate: deps.generate } : {}),
            });
            await appendBuildWorkflowEvent(env, {
              buildId,
              buildVersionId: version.buildVersionId,
              fromState: "FIX",
              toState: "CONFIRMATION",
              stage: "simple_pre_qa_repair",
              detail: `ONE pre-QA repair applied → new immutable Build Version v${version.buildVersionNumber} (repaired ${repaired.repairedFile})`,
            });
            return { kind: "ok" as const, strategy: "SIX_CALL_FILE_REALIZATION", preQaRepaired: true };
          } catch (error) {
            const reason =
              error instanceof SimpleWebsiteBuilderError
                ? `WEBSITE_BUILDER_${error.code}: ${error.message}`
                : `PRE_QA_REPAIR_FAILED: ${(error as Error).message.slice(0, 400)}`;
            return { kind: "failed" as const, reason, repairTarget: null, gateFindings: [], preQaRepaired: true };
          }
        }
        try {
          const built = await runSimpleWebsiteBuilderStage(env, {
            siteGenerationId: input.siteGenerationId,
            buildId,
            buildVersionId: version.buildVersionId,
            buildVersionNumber: version.buildVersionNumber,
            blueprint,
            facts,
            acceptedImages: acceptedImageDescriptors,
            formServiceEndpoint,
            siteFormId,
            ...(humanRevisionInstruction ? { humanRevisionInstruction } : {}),
            ...(deps.generate ? { generate: deps.generate } : {}),
          });
          return { kind: "ok" as const, strategy: built.strategy };
        } catch (error) {
          // EVERY SimpleWebsiteBuilderError is a deterministic gate outcome —
          // the six file-sized realization calls are the Builder's whole
          // budget, so no engine retry can ever fix one. Fail closed IN-STEP
          // (the #62 §7 terminal-result pattern) as FAILED, never as a review:
          // every one of these gates throws BEFORE the SiteBundle persists, so
          // there is no candidate to inspect and HUMAN_REVIEW_REQUIRED would
          // escalate a build the human has nothing to review (#62 §8/§9: no
          // candidate means Build FAILED — live evidence 2026-09-15, build
          // ec2ef1c4: an invented-structure CSS reached the review terminal
          // with no preview, no manifest and a "ready for human review"
          // email). 2026-09-11 history: unmapped codes used to escape as
          // non-transient step failures and terminate the whole instance
          // (invented-structure CSS, then shared-chrome drift).
          if (error instanceof SimpleWebsiteBuilderError) {
            return {
              kind: "failed" as const,
              reason: `WEBSITE_BUILDER_${error.code}: ${error.message}`,
              repairTarget: error.repairTarget,
              gateFindings: error.gateFindings,
            };
          }
          throw error;
        }
      }
    );
    if (buildOutcome.kind === "failed") {
      // Issue #14 (operator decision 2026-09-15): an eligible deterministic
      // builder-gate failure spends the Build's ONE repair on the ONE
      // implicated file — BEFORE QA. Without a mechanically identifiable
      // single-file target, or once the budget is spent, the terminal stays
      // FAILED exactly as before (no candidate to review, #62 §8/§9).
      const repairSpent = (await countBuildVersions(env, buildId)) > 1;
      const repairTarget = buildOutcome.repairTarget;
      if (repairTarget === null || repairSpent) {
        const disposition = repairTarget
          ? "the Build's ONE repair is already spent — no further automated repair is allowed"
          : "no mechanically identifiable single-file repair target — outside the bounded pre-QA repair";
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: version.buildVersionId,
          fromState: "BLUEPRINT",
          toState: "FAILED",
          stage: "simple_website_build",
          detail: `${buildOutcome.reason.slice(0, 300)} — ${disposition}`.slice(0, 400),
        });
        return terminal("FAILED", [buildOutcome.reason], {
          designBlueprintR2Key: blueprintArtifactR2Key,
          ...(buildOutcome.preQaRepaired ? { repairApplied: true } : {}),
        });
      }
      return await runPreQaFileRepairAndContinue({ reason: buildOutcome.reason, repairTarget, gateFindings: buildOutcome.gateFindings });
    }
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
        detail: buildOutcome.preQaRepaired
          ? "QA passed after the ONE pre-QA repair (spec section 48 + issue #14 decision)"
          : "First-pass success — no repair needed (spec section 48)",
      });
      return terminal("RELEASE_READY", [], {
        releaseReadyBuildVersionId: version.buildVersionId,
        artifactManifestHash: v1Assembled.manifestHash,
        previewUrl: v1Assembled.previewUrl,
        repairApplied: buildOutcome.preQaRepaired === true,
        builderStrategy,
        designBlueprintR2Key: blueprintArtifactR2Key,
      });
    }

    return await runRepairAndFinalQa(first);

    // ── ONE pre-QA repair → the repaired version carries the build forward ──
    // Issue #14 (operator decision 2026-09-15): an eligible deterministic
    // builder-gate failure spends the Build's ONE repair on regenerating the
    // ONE implicated Builder file (findings injected — a new input, never a
    // retry), then the pipeline continues on the repaired immutable Build
    // Version (assemble → QA). The post-QA repair is no longer available for
    // this Build; any further repair-eligible failure is terminal FAILED.
    async function runPreQaFileRepairAndContinue(
      failed: { reason: string; repairTarget: BuilderFileKind; gateFindings: string[] }
    ): Promise<SimplePipelineOutcome> {
      // Durable repair-position truth: the latest version carries the repair.
      const latest = await env.DB.prepare(
        "SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1"
      )
        .bind(buildId)
        .first<{ id: string; version_number: number }>();
      if (!latest) throw new Error(`Build ${buildId} has no Build Version`);

      let repairCtx: SimpleVersionContext;
      if (latest.version_number === version.buildVersionNumber) {
        const created = await stepDo("simple: pre-QA repair version", async () => {
          const next = await createNextBuildVersion(env, {
            buildId,
            cause: "simple_pre_qa_repair",
            detail: "SIMPLE pipeline ONE repair — pre-QA builder-file repair (issue #14 decision 2026-09-15)",
          });
          return { buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber };
        });
        await stepDo("simple: pre-QA repair inheritance", async () => {
          // The plan freezes FIRST: a resumed entry must complete the bounded
          // repair, never start a fresh Builder attempt (see the build step).
          const plan: PreQaRepairPlan = {
            targetKind: failed.repairTarget,
            gateFindings: failed.gateFindings,
            failedReason: failed.reason,
          };
          await storeBuildStageArtifactIdempotent(env, {
            buildId,
            buildVersionId: created.buildVersionId,
            siteGenerationId: input.siteGenerationId,
            kind: PRE_QA_REPAIR_PLAN_ARTIFACT_KIND,
            schemaVersion: PRE_QA_REPAIR_PLAN_SCHEMA_VERSION,
            value: plan,
          });
          await reuseAcceptedImages(env, version.buildVersionId, created.buildVersionId);
          await storeBuildStageArtifactIdempotent(env, {
            buildId,
            buildVersionId: created.buildVersionId,
            siteGenerationId: input.siteGenerationId,
            kind: "design_blueprint",
            schemaVersion: blueprintSchemaVersion,
            value: blueprint,
          });
          await copyBuilderFileArtifacts(env, {
            buildId,
            siteGenerationId: input.siteGenerationId,
            fromBuildVersionId: version.buildVersionId,
            toBuildVersionId: created.buildVersionId,
            exceptKind: failed.repairTarget,
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

      await appendBuildWorkflowEvent(env, {
        buildId,
        buildVersionId: repairCtx.buildVersionId,
        fromState: "BLUEPRINT",
        toState: "FIX",
        stage: "simple_pre_qa_repair",
        detail: `Eligible deterministic builder-gate failure — the ONE pre-QA repair targets ${failed.repairTarget}: ${failed.reason.slice(0, 250)}`.slice(0, 400),
      });

      try {
        await stepDo(`simple: pre-QA file repair (v${repairCtx.buildVersionNumber})`, async () => {
          const repaired = await runSimplePreQaRepairStage(env, {
            siteGenerationId: input.siteGenerationId,
            buildId,
            buildVersionId: repairCtx.buildVersionId,
            buildVersionNumber: repairCtx.buildVersionNumber,
            blueprint,
            facts,
            acceptedImages: acceptedImageDescriptors,
            formServiceEndpoint,
            siteFormId,
            ...(humanRevisionInstruction ? { humanRevisionInstruction } : {}),
            plan: { targetKind: failed.repairTarget, gateFindings: failed.gateFindings, failedReason: failed.reason },
            ...(deps.generate ? { generate: deps.generate } : {}),
          });
          await appendBuildWorkflowEvent(env, {
            buildId,
            buildVersionId: repairCtx.buildVersionId,
            fromState: "FIX",
            toState: "CONFIRMATION",
            stage: "simple_pre_qa_repair",
            detail: `ONE pre-QA repair applied → new immutable Build Version v${repairCtx.buildVersionNumber} (repaired ${repaired.repairedFile})`,
          });
          return null;
        });
      } catch (error) {
        console.log("DEBUG PREQA2 STACK:", (error as Error).stack);
        // The repaired candidate still fails a deterministic gate: the ONE
        // repair is spent — terminal FAILED, no additional automated repair.
        const reason =
          error instanceof SimpleWebsiteBuilderError
            ? `WEBSITE_BUILDER_${error.code}: ${error.message}`
            : `PRE_QA_REPAIR_FAILED: ${(error as Error).message.slice(0, 400)}`;
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: repairCtx.buildVersionId,
          fromState: "CONFIRMATION",
          toState: "FAILED",
          stage: "simple_pre_qa_repair",
          detail: reason.slice(0, 400),
        });
        return terminal("FAILED", [reason], {
          repairApplied: true,
          builderStrategy,
          designBlueprintR2Key: blueprintArtifactR2Key,
        });
      }

      const repairedBundle = await loadBundle(env, repairCtx.buildVersionId);
      if (!repairedBundle) {
        // Unreachable in practice (the repair step persists it), but a resumed
        // entry whose repair call failed schema validation lands here: the
        // repair budget is consumed — escalate, never re-repair.
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: repairCtx.buildVersionId,
          fromState: "CONFIRMATION",
          toState: "HUMAN_REVIEW_REQUIRED",
          stage: "simple_pre_qa_repair",
          detail: "repaired bundle missing after the ONE pre-QA repair — automation stops",
        });
        return terminal("HUMAN_REVIEW_REQUIRED", ["SIMPLE pre-QA repair produced no valid bundle; HUMAN_REVIEW_REQUIRED"], {
          repairApplied: true,
          builderStrategy,
          designBlueprintR2Key: blueprintArtifactR2Key,
        });
      }

      const repairedAssembled = await assembleAndPreview(repairCtx, repairedBundle);
      if ("preflightBlockers" in repairedAssembled) {
        const evaluated = await evaluateVersion(repairCtx, null);
        const reasons = [
          ...(evaluated.releaseReady
            ? []
            : [
                "repaired candidate failed deterministic Technical Preflight after the ONE pre-QA repair — automation stops",
                ...repairedAssembled.preflightBlockers.map((blocker) => `${blocker.id}: ${blocker.detail}`),
              ]),
          ...evaluated.reasons,
        ];
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: repairCtx.buildVersionId,
          fromState: "CONFIRMATION",
          toState: evaluated.releaseReady ? "RELEASE_READY" : "HUMAN_REVIEW_REQUIRED",
          stage: "simple_final_qa",
          detail: (evaluated.releaseReady
            ? "Final deterministic QA passed after the ONE pre-QA repair"
            : reasons.join("; ")
          ).slice(0, 400),
        });
        return terminal(evaluated.releaseReady ? "RELEASE_READY" : "HUMAN_REVIEW_REQUIRED", evaluated.releaseReady ? [] : reasons, {
          releaseReadyBuildVersionId: evaluated.releaseReady ? repairCtx.buildVersionId : null,
          repairApplied: true,
          builderStrategy,
          designBlueprintR2Key: blueprintArtifactR2Key,
        });
      }

      const final = await evaluateVersion(repairCtx, repairedAssembled.previewUrl);
      if (final.releaseReady) {
        await appendBuildWorkflowEvent(env, {
          buildId,
          buildVersionId: repairCtx.buildVersionId,
          fromState: "CONFIRMATION",
          toState: "RELEASE_READY",
          stage: "simple_final_qa",
          detail: `Final QA passed after the ONE pre-QA repair (visual ${final.pkg.visual?.scores.overall ?? "n/a"})`,
        });
        return terminal("RELEASE_READY", [], {
          releaseReadyBuildVersionId: repairCtx.buildVersionId,
          artifactManifestHash: repairedAssembled.manifestHash,
          previewUrl: repairedAssembled.previewUrl,
          repairApplied: true,
          builderStrategy,
          designBlueprintR2Key: blueprintArtifactR2Key,
        });
      }
      // Composed budget (operator GO 2026-11-09/10): the pre-QA repair was
      // round 1 of the SAME bounded improving budget — a failing QA hands the
      // Build to the post-QA rounds loop instead of terminating here. The
      // loop's durable alignment picks up this version and its qa package.
      return await runRepairAndFinalQa(final);
    }

    // ── Bounded improving repair rounds (operator GO 2026-11-09, superseding
    // the single-repair §49-53 policy) ─────────────────────────────────────
    // Each round is ONE semantic repair call on a NEW immutable Build Version
    // (the per-version ONE-repair rule is untouched). Up to
    // SIMPLE_REPAIR_ROUNDS rounds (default 3, clamped 1-3) run while the
    // visual score STRICTLY improves; a pass, a non-improving round, a
    // preflight failure or an exhausted budget escalates to
    // HUMAN_REVIEW_REQUIRED exactly as before. Live evidence 2026-11-02..06:
    // one blind text-only round went 80→85 on the lucky build and 85→84
    // (worse) on the final one, with hard composition gates still failing.
    async function runRepairAndFinalQa(first: QaOutcome): Promise<SimplePipelineOutcome> {
      const maxRounds = Math.max(1, Math.min(3, Number.parseInt(env.SIMPLE_REPAIR_ROUNDS ?? "3", 10) || 3));
      let current = first;
      let sourceCtx: SimpleVersionContext = {
        siteGenerationId: input.siteGenerationId,
        siteId,
        buildId,
        buildVersionId: version.buildVersionId,
        buildVersionNumber: version.buildVersionNumber,
      };
      let lastVisualScore = current.pkg.visual?.scores.overall ?? null;

      while (!current.releaseReady) {
        // Durable repair-position truth: versions beyond v1 are repair rounds.
        const latest = await env.DB.prepare(
          "SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1"
        )
          .bind(buildId)
          .first<{ id: string; version_number: number }>();
        if (!latest) throw new Error(`Build ${buildId} has no Build Version`);

        // Durable alignment (resume, operator GO 2026-11-11): a resumed engine
        // entry must repair the LATEST bundled version with ITS qa package —
        // never a stale v1 brief — and must honor the improvement baseline the
        // previous entry already established: when the newest COMPLETED round
        // did not improve on its predecessor, stop exactly as a fresh run
        // would, without minting another version.
        if (latest.version_number > 1) {
          const latestPkg = await getBuildStageArtifact<QaPackage>(env, latest.id, "qa_package");
          if (latestPkg && latestPkg.value.releaseReady === false) {
            const newestScore = latestPkg.value.visual?.scores.overall ?? null;
            const previous = latest.version_number > 1
              ? await env.DB.prepare(
                  "SELECT id FROM build_versions WHERE build_id = ? AND version_number = ?"
                )
                    .bind(buildId, latest.version_number - 1)
                    .first<{ id: string }>()
              : null;
            const previousPkg = previous
              ? await getBuildStageArtifact<QaPackage>(env, previous.id, "qa_package")
              : null;
            const previousScore = previousPkg?.value.visual?.scores.overall ?? null;
            current = { releaseReady: false, reasons: latestPkg.value.reasons, pkg: latestPkg.value, evidenceR2Keys: [], previewUrl: current.previewUrl };
            sourceCtx = {
              siteGenerationId: input.siteGenerationId,
              siteId,
              buildId,
              buildVersionId: latest.id,
              buildVersionNumber: latest.version_number,
            };
            lastVisualScore = newestScore;
            if (newestScore !== null && previousScore !== null && newestScore <= previousScore) {
              await appendBuildWorkflowEvent(env, {
                buildId,
                buildVersionId: latest.id,
                fromState: "CONFIRMATION",
                toState: "HUMAN_REVIEW_REQUIRED",
                stage: "simple_final_qa",
                detail: `Final QA still failing after repair round ${latest.version_number - 1} and the visual score did not improve (${previousScore} → ${newestScore}): ${current.reasons.slice(0, 3).join("; ").slice(0, 240)}`,
              });
              return terminal("HUMAN_REVIEW_REQUIRED", current.reasons, {
                artifactManifestHash: null,
                previewUrl: current.previewUrl,
                repairApplied: true,
                builderStrategy,
                designBlueprintR2Key: blueprintArtifactR2Key,
              });
            }
          }
        }

        const roundsUsed = latest.version_number - 1;
        const roundNumber = roundsUsed + 1;
        if (roundsUsed >= maxRounds) {
          const reasons = [`repair budget exhausted after ${roundsUsed} round(s): ${current.reasons.slice(0, 3).join("; ").slice(0, 240)}`];
          await appendBuildWorkflowEvent(env, {
            buildId,
            buildVersionId: latest.id,
            fromState: "CONFIRMATION",
            toState: "HUMAN_REVIEW_REQUIRED",
            stage: "simple_final_qa",
            detail: `Final QA still failing after ${roundsUsed} repair round(s): ${current.reasons.slice(0, 4).join("; ").slice(0, 280)}`,
          });
          return terminal("HUMAN_REVIEW_REQUIRED", reasons, {
            repairApplied: roundsUsed > 0,
            builderStrategy,
            designBlueprintR2Key: blueprintArtifactR2Key,
            previewUrl: current.previewUrl,
          });
        }

        let repairCtx: SimpleVersionContext;
        if (latest.version_number === sourceCtx.buildVersionNumber) {
          const created = await stepDo(`simple: repair version (v${roundNumber + 1})`, async () => {
            const next = await createNextBuildVersion(env, {
              buildId,
              cause: "simple_repair_round",
              detail: `SIMPLE pipeline repair round ${roundNumber} of at most ${maxRounds} (operator GO 2026-11-09)`,
            });
            return { buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber };
          });
          await stepDo(`simple: repair inheritance (v${created.buildVersionNumber})`, async () => {
            await reuseAcceptedImages(env, sourceCtx.buildVersionId, created.buildVersionId);
            await storeBuildStageArtifactIdempotent(env, {
              buildId,
              buildVersionId: created.buildVersionId,
              siteGenerationId: input.siteGenerationId,
              kind: "design_blueprint",
              schemaVersion: blueprintSchemaVersion,
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
          // A prior engine entry already created this round's version — resume it.
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
            bundle: (await loadBundle(env, sourceCtx.buildVersionId))!,
            blueprint,
            facts,
            qaPackage: current.pkg,
            acceptedImages: acceptedImageDescriptors,
            formServiceEndpoint,
            siteFormId,
            referenceVisualInputs: visualInputs,
            ...(current.pkg.candidateScreenshotKeys.desktop ? { candidateDesktopR2Key: current.pkg.candidateScreenshotKeys.desktop } : {}),
            ...(current.pkg.candidateScreenshotKeys.mobile ? { candidateMobileR2Key: current.pkg.candidateScreenshotKeys.mobile } : {}),
            ...(current.pkg.candidateInnerPageScreenshotKeys && current.pkg.candidateInnerPageScreenshotKeys.length > 0
              ? { candidateInnerPageR2Keys: current.pkg.candidateInnerPageScreenshotKeys }
              : {}),
            ...(deps.visionGenerate ? { generate: deps.visionGenerate } : {}),
            ...(deps.generate ? { generate: deps.generate } : {}),
          });
          await appendBuildWorkflowEvent(env, {
            buildId,
            buildVersionId: repairCtx.buildVersionId,
            fromState: "FIX",
            toState: "CONFIRMATION",
            stage: "simple_repair",
            detail: `Repair round ${roundNumber}/${maxRounds} applied → new immutable Build Version v${repairCtx.buildVersionNumber}; notes: ${(repaired.bundle.notes ?? "none").slice(0, 200)}`,
          });
          return null;
        });

        const repairedBundle = await loadBundle(env, repairCtx.buildVersionId);
        if (!repairedBundle) {
          // Unreachable in practice (the repair step stores it), but a resumed
          // entry whose repair call failed schema validation lands here: this
          // round's budget is consumed — escalate, never re-repair.
          await appendBuildWorkflowEvent(env, {
            buildId,
            buildVersionId: repairCtx.buildVersionId,
            fromState: "CONFIRMATION",
            toState: "HUMAN_REVIEW_REQUIRED",
            stage: "simple_repair",
            detail: `repair bundle missing after repair round ${roundNumber} — automation stops`,
          });
          return terminal("HUMAN_REVIEW_REQUIRED", [`SIMPLE repair round ${roundNumber} produced no valid bundle; HUMAN_REVIEW_REQUIRED`], {
            repairApplied: true,
            builderStrategy,
            designBlueprintR2Key: blueprintArtifactR2Key,
            previewUrl: current.previewUrl,
          });
        }

        const repairedAssembled = await assembleAndPreview(repairCtx, repairedBundle);
        if ("preflightBlockers" in repairedAssembled) {
          const reasons = [
            `repaired candidate failed deterministic Technical Preflight after repair round ${roundNumber} — automation stops`,
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
            previewUrl: current.previewUrl,
          });
        }

        const evaluated = await evaluateVersion(repairCtx, repairedAssembled.previewUrl);
        const roundScore = evaluated.pkg.visual?.scores.overall ?? null;

        if (evaluated.releaseReady) {
          await appendBuildWorkflowEvent(env, {
            buildId,
            buildVersionId: repairCtx.buildVersionId,
            fromState: "CONFIRMATION",
            toState: "RELEASE_READY",
            stage: "simple_final_qa",
            detail: `Final QA passed after repair round ${roundNumber} (visual ${roundScore ?? "n/a"})`,
          });
          return terminal("RELEASE_READY", [], {
            releaseReadyBuildVersionId: repairCtx.buildVersionId,
            artifactManifestHash: repairedAssembled.manifestHash,
            previewUrl: repairedAssembled.previewUrl,
            repairApplied: true,
            builderStrategy,
            designBlueprintR2Key: blueprintArtifactR2Key,
          });
        }

        // Improvement gate: a round that does not strictly raise the visual
        // score is the stopping signal — further rounds would churn without
        // progress. Escalate with the current reasons.
        if (lastVisualScore !== null && roundScore !== null && roundScore <= lastVisualScore) {
          await appendBuildWorkflowEvent(env, {
            buildId,
            buildVersionId: repairCtx.buildVersionId,
            fromState: "CONFIRMATION",
            toState: "HUMAN_REVIEW_REQUIRED",
            stage: "simple_final_qa",
            detail: `Final QA still failing after repair round ${roundNumber} and the visual score did not improve (${lastVisualScore} → ${roundScore}): ${evaluated.reasons.slice(0, 3).join("; ").slice(0, 240)}`,
          });
          return terminal("HUMAN_REVIEW_REQUIRED", evaluated.reasons, {
            artifactManifestHash: repairedAssembled.manifestHash,
            previewUrl: repairedAssembled.previewUrl,
            repairApplied: true,
            builderStrategy,
            designBlueprintR2Key: blueprintArtifactR2Key,
          });
        }

        lastVisualScore = roundScore ?? lastVisualScore;
        current = evaluated;
        sourceCtx = repairCtx;
      }

      return terminal("RELEASE_READY", [], {
        releaseReadyBuildVersionId: sourceCtx.buildVersionId,
        repairApplied: sourceCtx.buildVersionNumber > version.buildVersionNumber,
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
