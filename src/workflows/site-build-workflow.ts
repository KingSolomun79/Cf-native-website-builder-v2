import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { Env } from "../env.d";
import type { NormalizedIntake, SiteSpec, QaReport, ImageResult, RevisionPlan, ProvenanceManifestV1 } from "../types";
import { runImageGenerationPollLoop, createAllImageTasks } from "../lib/kie";
import { uploadAssets, createWorker, getWorkerPreviewUrl, deleteWorker } from "../lib/publish";
import { pushSiteToGitHub } from "../lib/github";
import { runQaReview } from "../lib/browser-run";
import { signApprovalToken } from "../lib/crypto";
import { sendPreviewEmail, sendInternalNotification } from "../lib/mail";
import { createRevisionPlan, applyRevisionToSpec } from "../agents/reviewer-agent";
import { validateBundle } from "../lib/bundle-validation";
import { assertPersistedReferences, ReferenceGuardError } from "../lib/reference-guard";
import { parseDesignBlueprint, parseInteractionBlueprint, type DesignBlueprintV2, type InteractionBlueprintV2 } from "../lib/blueprint-schema-v2";

interface BuildParams {
  jobId: string;
  siteId: string;
  clientId: string;
  clientSlug: string;
  intake: NormalizedIntake;
}

type ApprovalEvent = {
  status: "approved" | "rejected" | "revise_requested";
  prompt?: string;
};

function createRendererSiteSpec(intake: NormalizedIntake, publicUrl: string, clientSlug: string): SiteSpec {
  const description = intake.businessDescription ?? `${intake.companyName} provides ${intake.businessType ?? "professional services"}.`;
  const businessType = intake.businessType ?? "Services";
  const section = (type: SiteSpec["pages"][number]["sections"][number]["type"], heading: string | null, body: string | null, items: Record<string, unknown>[] | null = null): SiteSpec["pages"][number]["sections"][number] => ({
    type, heading, subheading: null, body, items, ctaLabel: null, ctaHref: null, inverted: false,
  });
  const services = [
    { title: businessType, description },
    intake.idealClientProfile ? { title: "Intended clients", description: intake.idealClientProfile } : null,
    intake.city ? { title: "Location", description: [intake.city, intake.country].filter(Boolean).join(", ") } : null,
  ].filter((item): item is { title: string; description: string } => item !== null);
  const hero = (heading: string, body: string) => section("hero", heading, body);
  const cta = section("cta", `Contact ${intake.companyName}`, "Use the contact page to share your enquiry.");
  cta.ctaLabel = "Contact us";
  cta.ctaHref = "/contact";
  return {
    site: {
      companyName: intake.companyName,
      clientEmail: intake.clientEmail,
      businessType: intake.businessType,
      brandSummary: description,
      idealClientProfile: intake.idealClientProfile,
      styleKey: "reference-driven",
      mode: intake.mode,
      logoUrl: intake.logoUrl ? `/${clientSlug}/branding/logo/normalized.webp` : "",
      socials: { facebook: intake.facebookUrl, instagram: intake.instagramUrl, twitter: intake.twitterUrl, linkedin: intake.linkedinUrl, other: intake.otherSocialUrl },
    },
    pages: [
      { slug: "/", name: "Home", seoTitle: intake.companyName, metaDescription: description, h1: intake.companyName, sections: [hero(intake.companyName, description), section("services-grid", `Our ${businessType}`, description, services), section("text-block", `About ${intake.companyName}`, description), section("stats", "At a glance", null, services.map((item) => ({ value: item.title, label: item.description }))), cta], images: [], internalLinks: ["/services", "/about", "/contact"] },
      { slug: "/services", name: "Services", seoTitle: `Services - ${intake.companyName}`, metaDescription: description, h1: `Our ${businessType}`, sections: [hero(`Our ${businessType}`, description), section("services-grid", `Our ${businessType}`, description, services), section("text-block", "How we can help", description), cta], images: [], internalLinks: ["/", "/about", "/contact"] },
      { slug: "/about", name: "About", seoTitle: `About - ${intake.companyName}`, metaDescription: description, h1: `About ${intake.companyName}`, sections: [hero(`About ${intake.companyName}`, description), section("text-block", "Our story", description), cta], images: [], internalLinks: ["/", "/services", "/contact"] },
      { slug: "/contact", name: "Contact", seoTitle: `Contact - ${intake.companyName}`, metaDescription: description, h1: `Contact ${intake.companyName}`, sections: [hero(`Contact ${intake.companyName}`, "Use the contact form to send an enquiry."), section("contact-form", "Send a message", null)], images: [], internalLinks: ["/", "/services", "/about"] },
    ],
    seo: { localBusiness: { name: intake.companyName, addressLocality: intake.city, addressCountry: intake.country, telephone: intake.whatsappNumber, url: publicUrl }, sameAs: [intake.facebookUrl, intake.instagramUrl, intake.twitterUrl, intake.linkedinUrl, intake.otherSocialUrl].filter(Boolean) as string[] },
  };
}

async function loadBundleFilesFromR2(
  env: Env,
  manifestR2Key: string
): Promise<Map<string, string | ArrayBuffer>> {
  const { getObject } = await import("../lib/assets");

  const manifestBody = await getObject(env, manifestR2Key);
  if (!manifestBody) {
    throw new Error(`Bundle manifest not found: ${manifestR2Key}`);
  }

  const manifestEntries = await new Response(manifestBody).json<Record<string, string>>();
  const files = new Map<string, string | ArrayBuffer>();

  for (const [path, r2Key] of Object.entries(manifestEntries)) {
    const body = await getObject(env, r2Key);
    if (!body) {
      throw new Error(`Bundle file not found: ${r2Key}`);
    }

    if (path.endsWith(".html") || path.endsWith(".css") || path.endsWith(".js") || path.endsWith(".json") || path.endsWith(".txt") || path.endsWith(".xml") || path.endsWith(".svg") || path.endsWith(".webmanifest")) {
      files.set(path, await new Response(body).text());
    } else {
      files.set(path, await new Response(body).arrayBuffer());
    }
  }

  return files;
}

async function failBundleValidation(env: Env, jobId: string, message: string, step: string = "html_review"): Promise<never> {
  const { updateJobStatus } = await import("../lib/db");
  await updateJobStatus(env.DB, jobId, "failed_validation", { current_step: step, error_message: message });
  throw new Error(message);
}

export class SiteBuildWorkflow extends WorkflowEntrypoint<Env, BuildParams> {
  async run(event: WorkflowEvent<BuildParams>, step: WorkflowStep) {
    const { jobId, siteId, clientId, clientSlug, intake } = event.payload;

    // ======== PHASE 1: SPEC GENERATION ========

    await step.do("1.0 verify reference inputs persisted", async () => {
      const { updateJobStatus } = await import("../lib/db");
      await updateJobStatus(this.env.DB, jobId, "running", { current_step: "reference_guard" });
      try {
        await assertPersistedReferences(this.env, {
          jobId,
          siteVersion: 1,
          referenceSiteUrl: intake.referenceSiteUrl,
          referenceScreenshotR2Key: intake.referenceScreenshotR2Key,
        });
      } catch (err) {
        const guardError = err instanceof ReferenceGuardError
          ? err
          : new ReferenceGuardError("REFERENCE_SCREENSHOT_NOT_PERSISTED", err instanceof Error ? err.message : String(err));
        await updateJobStatus(this.env.DB, jobId, "failed_validation", {
          current_step: "reference_guard",
          error_code: guardError.code,
          error_message: guardError.message,
        });
        throw guardError;
      }
    });

    await step.do("1.1 initialize build job", async () => {
      const { updateJobStatus } = await import("../lib/db");
      await updateJobStatus(this.env.DB, jobId, "running", { current_step: "init" });
    });

    const captureAttempt = await step.do("1.2 capture live reference evidence", async () => {
      const { updateJobStatus } = await import("../lib/db");
      const { captureEvidenceAttempt } = await import("../lib/evidence-attempt");
      await updateJobStatus(this.env.DB, jobId, "running", { current_step: "reference_capture" });
      if (!intake.referenceSiteUrl) throw new Error("Reference URL was not available after reference validation.");
      return captureEvidenceAttempt(this.env, {
        jobId,
        clientSlug,
        siteVersion: 1,
        referenceUrl: intake.referenceSiteUrl,
      });
    });

    const canonicalScreenshotEvidence = await step.do("1.3 produce canonical screenshot evidence", { retries: { limit: 0, delay: "1 second" }, timeout: "4 minutes" }, async () => {
      const { updateJobStatus } = await import("../lib/db");
      const { produceScreenshotEvidence, loadScreenshotEvidence, ScreenshotEvidenceUnavailableError } = await import("../lib/screenshot-evidence");
      const { canonicalScreenshotEvidenceKey } = await import("../lib/assets");
      const artifactR2Key = canonicalScreenshotEvidenceKey(clientSlug, 1, jobId);
      await updateJobStatus(this.env.DB, jobId, "running", { current_step: "canonical_screenshot_evidence" });
      const existing = await loadScreenshotEvidence(this.env, artifactR2Key);
      if (existing) return { artifact: existing, artifactR2Key };
      try {
        return await produceScreenshotEvidence(this.env, {
          jobId,
          siteId,
          clientSlug,
          screenshotR2Key: intake.referenceScreenshotR2Key!,
          artifactR2Key,
        });
      } catch (err) {
        if (err instanceof ScreenshotEvidenceUnavailableError) {
          await updateJobStatus(this.env.DB, jobId, "failed_validation", {
            current_step: "canonical_screenshot_evidence:failed",
            error_code: err.code,
            error_message: err.message,
          });
        }
        throw err;
      }
    });

    await step.do("1.4 capture interaction evidence with screenshot fallback", { retries: { limit: 0, delay: "1 second" }, timeout: "4 minutes" }, async () => {
      const { updateJobStatus } = await import("../lib/db");
      const { completeEvidenceAttempt } = await import("../lib/evidence-attempt");
      const { buildInteractionFallbackContext } = await import("../lib/interaction-capture-v2");
      await updateJobStatus(this.env.DB, jobId, "running", { current_step: "evidence_attempt" });

      try {
        const result = await completeEvidenceAttempt(this.env, {
          jobId,
          clientSlug,
          siteVersion: 1,
          referenceUrl: intake.referenceSiteUrl!,
          fallbackContext: buildInteractionFallbackContext(canonicalScreenshotEvidence.artifact),
        }, captureAttempt);
        await updateJobStatus(this.env.DB, jobId, "running", {
          current_step: result.promoted ? "evidence_attempt:promoted" : "evidence_attempt:failed",
          error_message: result.promoted ? undefined : `${result.failureCode}: ${result.failureMessage}`,
        });
        return { status: result.promoted ? "captured" : "failed", attemptId: result.attemptId };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Evidence attempt failed", { jobId, message });
        await updateJobStatus(this.env.DB, jobId, "running", {
          current_step: "evidence_attempt:failed",
          error_message: `Evidence attempt failed: ${message}`,
        });
        return { status: "failed" };
      }
    });

    const blueprints = await step.do("1.5 generate and validate blueprints (R4 screenshot-grounded)", async () => {
      const { updateJobStatus, getCurrentEvidenceAttempt, getAcceptedBlueprintAttempt } = await import("../lib/db");
      const { loadCurrentCaptureManifest } = await import("../lib/reference-capture-v2");
      const { loadCurrentInteractionManifest } = await import("../lib/interaction-capture-v2");
      const { buildEvidenceRegistry } = await import("../lib/evidence-registry");
      const { generateValidatedBlueprintsV2 } = await import("../lib/blueprint-generator-v2");
      const { blueprintRegistryKey } = await import("../lib/assets");
      await updateJobStatus(this.env.DB, jobId, "running", { current_step: "blueprint_generation" });

      // Load promoted R3 evidence.
      const captureManifest = await loadCurrentCaptureManifest(this.env, jobId, 1);
      const interactionManifest = await loadCurrentInteractionManifest(this.env, jobId, 1);
      const evidenceAttempt = await getCurrentEvidenceAttempt(this.env.DB, jobId, 1);

      const registryId = crypto.randomUUID();

      // Build the bounded evidence registry.
      const registryR2Key = blueprintRegistryKey(clientSlug, 1, registryId);
      const registryBuild = await buildEvidenceRegistry(this.env, {
        jobId, clientSlug, siteVersion: 1,
        evidenceAttemptId: evidenceAttempt?.attemptId ?? null,
        screenshotArtifact: canonicalScreenshotEvidence.artifact,
        screenshotArtifactR2Key: canonicalScreenshotEvidence.artifactR2Key,
        captureManifest,
        captureManifestR2Key: captureManifest?.manifestR2Key ?? null,
        interactionManifest,
        interactionManifestR2Key: interactionManifest?.manifestR2Key ?? null,
        clientFacts: {
          companyName: intake.companyName,
          businessType: intake.businessType,
          businessDescription: intake.businessDescription,
          idealClientProfile: intake.idealClientProfile,
          mode: intake.mode,
        },
        registryR2Key,
      });

      try {
        const result = await generateValidatedBlueprintsV2(this.env, {
          jobId, siteId, clientSlug, siteVersion: 1,
          referenceUrl: intake.referenceSiteUrl ?? undefined,
          registryId: registryBuild.registryId,
          registryR2Key: registryBuild.registryR2Key,
          registry: registryBuild.registry,
        });

        if (!result.accepted) {
          await updateJobStatus(this.env.DB, jobId, "failed_validation", {
            current_step: "blueprint_generation:no_accepted",
            error_code: "BLUEPRINT_NOT_ACCEPTED",
            error_message: `No blueprint attempt accepted after ${result.attempts.length} attempt(s): ${result.failureCode}`,
          });
          throw new Error(`Blueprint generation failed; no accepted pair. Stopped before rendering (${result.failureCode}).`);
        }

        const acceptedRow = await getAcceptedBlueprintAttempt(this.env.DB, jobId, 1);
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: "blueprint_generation:accepted" });
        // Structured-clone-serializable step result.
        return {
          status: "accepted",
          attempts: result.attempts.length,
          acceptedAttemptId: acceptedRow?.id ?? result.accepted.attemptId,
          designR2Key: acceptedRow?.design_r2_key ?? null,
          interactionR2Key: acceptedRow?.interaction_r2_key ?? null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await updateJobStatus(this.env.DB, jobId, "failed_validation", {
          current_step: "blueprint_generation:invalid",
          error_code: "BLUEPRINT_VALIDATION_FAILED",
          error_message: message,
        });
        throw new Error(`Blueprint validation failed; generation stopped before rendering: ${message}`);
      }
    });

    if (blueprints.status !== "accepted") {
      throw new Error("No accepted blueprint pair is available for the active initial-build renderer.");
    }

    const fallbackSpec = createRendererSiteSpec(intake, this.env.PUBLIC_APP_URL, clientSlug);
    let siteSpec: SiteSpec | null = fallbackSpec;

    let bundleResult: { workerName: string; buildManifestR2Key: string };
    let provenanceManifest: ProvenanceManifestV1 | null = null;

    let blueprintDesign = await step.do<DesignBlueprintV2>("2.0 load accepted design blueprint", async () => {
        const { getObject } = await import("../lib/assets");
        if (!blueprints.designR2Key) {
          throw new Error("Missing accepted design blueprint R2 key; cannot render from blueprints.");
        }
        const body = await getObject(this.env, blueprints.designR2Key);
        if (!body) {
          throw new Error(`Accepted design blueprint not found in R2: ${blueprints.designR2Key}`);
        }
        return parseDesignBlueprint(await new Response(body).json());
      });

    let blueprintInteraction = await step.do<InteractionBlueprintV2>("2.0b load accepted interaction blueprint", async () => {
        const { getObject } = await import("../lib/assets");
        if (!blueprints.interactionR2Key) {
          throw new Error("Missing accepted interaction blueprint R2 key; cannot render from blueprints.");
        }
        const body = await getObject(this.env, blueprints.interactionR2Key);
        if (!body) {
          throw new Error(`Accepted interaction blueprint not found in R2: ${blueprints.interactionR2Key}`);
        }
        return parseInteractionBlueprint(await new Response(body).json());
      });

    const rendered = await step.do("2.1 render deterministic bundle from blueprints", async () => {
        const { updateJobStatus } = await import("../lib/db");
        const { renderBlueprintSite } = await import("../render/site-renderer");
        const { buildRenderContent } = await import("../render/content");
        const { buildProvenanceManifest, extractHtmlBlocks, extractRenderContentBlocks, validateProvenanceManifest } = await import("../lib/provenance");
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: "blueprint_render" });

        const content = buildRenderContent(intake);
        const preRenderProvenance = await buildProvenanceManifest({
          jobId, siteId, clientSlug, siteVersion: 1, intake,
          blocks: extractRenderContentBlocks(content),
        });
        const preRenderValidation = validateProvenanceManifest(preRenderProvenance);
        if (preRenderValidation.blocking) {
          throw new Error(`Pre-render provenance validation failed: ${preRenderValidation.issues.map((issue) => issue.id).join(", ")}`);
        }
        const result = renderBlueprintSite({
          design: blueprintDesign,
          interaction: blueprintInteraction,
          content,
          siteUrl: this.env.PUBLIC_APP_URL,
        });
        const provenance = await buildProvenanceManifest({
          jobId, siteId, clientSlug, siteVersion: 1, intake,
          blocks: extractHtmlBlocks(result.files),
        });
        const provenanceValidation = validateProvenanceManifest(provenance);
        if (provenanceValidation.blocking) {
          throw new Error(`Rendered provenance validation failed: ${provenanceValidation.issues.map((issue) => issue.id).join(", ")}`);
        }
        const files: Record<string, string> = {};
        for (const [path, c] of result.files) {
          if (typeof c === "string") files[path] = c;
        }
        return { files, imageTasks: result.imageTasks, provenance };
      });

    provenanceManifest = rendered.provenance;
    siteSpec = { ...fallbackSpec, provenance: provenanceManifest };

    const initialImageResults = await step.do<ImageResult[]>("2.1.6 generate AI images via Kie", async () => {
        const { updateJobStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: "image_generation" });

        if (rendered.imageTasks.length === 0) return [];

        const taskMap = await createAllImageTasks(this.env, rendered.imageTasks);
        return runImageGenerationPollLoop(this.env, taskMap, clientSlug, 1);
      });

    bundleResult = await step.do<{ workerName: string; buildManifestR2Key: string }>("2.2-bundle-and-upload-manifest", async () => {
        const { putObject, bundlePrefix, getObject, logoNormalizedKey } = await import("../lib/assets");
        const { updateJobStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: "html_build" });

        const files = new Map<string, string | ArrayBuffer>();
        for (const [path, content] of Object.entries(rendered.files)) {
          files.set(path, content);
        }

        for (const img of initialImageResults) {
          const r2Body = await getObject(this.env, img.r2Key);
          if (r2Body) {
            const buffer = await new Response(r2Body).arrayBuffer();
            files.set(`assets/images/${img.outputFilename}`, buffer);
          }
        }

        if (intake.logoUrl) {
          const logoBody = await getObject(this.env, logoNormalizedKey(clientSlug));
          if (!logoBody) {
            throw new Error(`Normalized logo not found for ${clientSlug}; cannot produce a complete blueprint bundle.`);
          }
          files.set("assets/images/logo.webp", await new Response(logoBody).arrayBuffer());
        }

        const bundleBase = bundlePrefix(clientSlug, 1);
        const manifestEntries: Record<string, string> = {};
        for (const [path, content] of files) {
          const r2Key = `${bundleBase}/${path}`;
          await putObject(this.env, r2Key, content);
          manifestEntries[path] = r2Key;
        }
        await putObject(
          this.env,
          `${bundleBase}/manifest.json`,
          JSON.stringify(manifestEntries, null, 2),
          { httpMetadata: { contentType: "application/json" } }
        );

        return {
          workerName: `site-${clientSlug}-${siteId.slice(0, 6)}`,
          buildManifestR2Key: `${bundleBase}/manifest.json`,
        };
      });

    const { workerName, buildManifestR2Key } = bundleResult;

    if (!provenanceManifest) {
      throw new Error("No accepted provenance manifest is available for the generated bundle.");
    }

    const provenanceR2Key = await step.do("3.0 persist provenance artifact to R2", async () => {
      const { putObject, provenanceArtifactKey } = await import("../lib/assets");
      const key = provenanceArtifactKey(clientSlug, 1, provenanceManifest!.id);
      await putObject(this.env, key, JSON.stringify(provenanceManifest, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
      return key;
    });

    await step.do("3.2 validate HTML structure and assets", async () => {
      const { updateJobStatus } = await import("../lib/db");
      await updateJobStatus(this.env.DB, jobId, "running", { current_step: "html_validation" });

      const files = await loadBundleFilesFromR2(this.env, buildManifestR2Key);
      const validation = validateBundle(files);
      if (!validation.valid) {
        const message = `HTML bundle validation failed: ${validation.issues.map((issue) => `${issue.file}: ${issue.issue}`).join(" | ")}`;
        await failBundleValidation(this.env, jobId, message, "html_validation");
      }
      const { verifyProvenanceAgainstBundle } = await import("../lib/provenance");
      const provenanceValidation = await verifyProvenanceAgainstBundle(provenanceManifest!, files);
      if (provenanceValidation.blocking) {
        const message = `Provenance validation failed: ${provenanceValidation.issues.map((issue) => `${issue.code}:${issue.path}`).join(" | ")}`;
        await failBundleValidation(this.env, jobId, message, "provenance_validation");
      }
    });

    // ======== PHASE 4: PREVIEW DEPLOY ========

    const deployResult = await step.do<{ previewUrl: string; workerName: string; buildManifestR2Key: string }>("4.1 deploy preview Worker", async () => {
      const { updateJobStatus } = await import("../lib/db");
      await updateJobStatus(this.env.DB, jobId, "running", { current_step: "deploy" });

      const files = await loadBundleFilesFromR2(this.env, buildManifestR2Key);
      const uploadJwt = await uploadAssets(this.env, workerName, files);
      await createWorker(this.env, workerName, uploadJwt, intake.clientEmail);
      const url = await getWorkerPreviewUrl(this.env, workerName);

      return {
        previewUrl: url,
        workerName,
        buildManifestR2Key,
      };
    });

    const { previewUrl, workerName: deployedWorkerName } = deployResult;

    const versionRecord = await step.do<{ versionId: string }>("4.2 record version metadata and page specs", async () => {
      const { updateSitePreviewUrl, updateJobStatus, createSiteVersion, updateSiteCurrentVersion, createPageSpec, createImageAsset, createProvenanceArtifact } = await import("../lib/db");
      const { generateId } = await import("../lib/crypto");
      const { validateProvenanceManifest } = await import("../lib/provenance");

      await updateJobStatus(this.env.DB, jobId, "running", { current_step: "preview_record" });
      await updateSitePreviewUrl(this.env.DB, siteId, previewUrl);

      const versionId = `site-version:${provenanceManifest!.id}`;
      await createSiteVersion(this.env.DB, {
        id: versionId,
        site_id: siteId,
        version_number: 1,
        source_type: "initial_build",
        source_job_id: jobId,
        build_manifest_r2_key: `${clientSlug}/versions/v1/bundle/manifest.json`,
        static_bundle_r2_prefix: `${clientSlug}/versions/v1/bundle`,
        deployed_worker_name: deployedWorkerName,
        preview_url: previewUrl,
        qa_report_id: null,
      });
      await updateSiteCurrentVersion(this.env.DB, siteId, versionId);
      await createProvenanceArtifact(this.env.DB, {
        id: provenanceManifest!.id,
        job_id: jobId,
        site_version_id: versionId,
        site_version: 1,
        schema_version: provenanceManifest!.schemaVersion,
        parent_artifact_id: provenanceManifest!.parentArtifactId,
        r2_key: provenanceR2Key,
        manifest_json: JSON.stringify(provenanceManifest),
        validation_json: JSON.stringify(validateProvenanceManifest(provenanceManifest)),
        created_at: provenanceManifest!.createdAt,
      });

      if (siteSpec) {
        for (const page of siteSpec.pages) {
          await createPageSpec(this.env.DB, {
            id: generateId(),
            site_version_id: versionId,
            page_name: page.name,
            slug: page.slug,
            seo_title: page.seoTitle,
            meta_description: page.metaDescription,
            h1: page.h1,
            spec_json: JSON.stringify(page),
            html_r2_key: null,
          });
        }

        for (const img of initialImageResults) {
          await createImageAsset(this.env.DB, {
            id: generateId(),
            site_version_id: versionId,
            page_name: img.page,
            slot_name: img.slot,
            prompt_text: "",
            alt_text: img.outputFilename,
            source_job_ref: img.sourceJobRef,
            r2_key: img.r2Key,
            mime_type: img.mimeType,
            width: img.width,
            height: img.height,
            status: "complete",
          });
        }
      }

      return { versionId };
    });

    let currentVersionId = versionRecord.versionId;

    // ======== PHASE 5: QA REVIEW ========

    const qaReport = await step.do("5.1 run QA checks via Browser", async () => {
      const { updateJobStatus } = await import("../lib/db");
      await updateJobStatus(this.env.DB, jobId, "running", { current_step: "qa" });
      return runQaReview(this.env, previewUrl, clientSlug, 1, siteSpec!, provenanceManifest!, blueprintDesign, blueprintInteraction, 1);
    });

    await step.do("5.2 persist QA report and issues", async () => {
      const { createQaReport, createQaIssue } = await import("../lib/db");
      const { generateId } = await import("../lib/crypto");

      const reportId = generateId();
      await createQaReport(this.env.DB, {
        id: reportId,
        site_version_id: currentVersionId,
        status: qaReport.verdict,
        summary: qaReport.summary,
        report_json: JSON.stringify(qaReport),
        desktop_screenshot_r2_key: qaReport.screenshots.desktop.home ?? null,
        mobile_screenshot_r2_key: qaReport.screenshots.mobile.home ?? null,
      });

      for (const issue of qaReport.issues) {
        await createQaIssue(this.env.DB, {
          id: generateId(),
          qa_report_id: reportId,
          severity: issue.severity,
          category: issue.category,
          page_slug: issue.page,
          selector: issue.selector,
          issue_text: issue.issue,
          screenshot_r2_key: qaReport.screenshots.desktop[issue.page === "/" ? "home" : issue.page.replace(/^\//, "")] ?? null,
        });
      }
      await this.env.DB.prepare(
        `INSERT INTO quality_gate_attempts (id, job_id, site_version_id, site_version, attempt_number, score, threshold, status, report_r2_key, interaction_evidence_r2_key, created_at)
         VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)`
      ).bind(
        generateId(), jobId, currentVersionId, qaReport.qualityGate.score, qaReport.qualityGate.threshold,
        qaReport.qualityGate.publishable ? "pass" : "failed", qaReport.qualityGate.reportR2Key,
        qaReport.qualityGate.interactionEvidenceR2Key, new Date().toISOString()
      ).run();
      await this.env.DB.prepare("UPDATE site_versions SET qa_report_id = ? WHERE id = ?").bind(reportId, currentVersionId).run();
    });

    const configuredRevisionAttempts = Number.parseInt(this.env.MAX_REVISIONS ?? "3", 10);
    const maxRevisionAttempts = Number.isNaN(configuredRevisionAttempts) ? 3 : Math.max(0, configuredRevisionAttempts);
    let approval: { payload: ApprovalEvent };

    if (!qaReport.qualityGate.publishable) {
      await step.do("5.3 block failed visual quality gate", async () => {
        const { updateJobStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "failed_validation", {
          current_step: "visual_quality_gate",
          error_code: "VISUAL_QUALITY_GATE_FAILED",
          error_message: qaReport.summary,
        });
      });
      return;
    } else {
      // ======== PHASE 6: HUMAN-IN-THE-LOOP ========

      await step.do("6.1 send preview and approval email", async () => {
        const { updateJobStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "waiting_approval", { current_step: "awaiting_human_review" });

        const approveToken = await signApprovalToken(this.env, {
          jobId,
          action: "approve",
          exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });
        const reviseToken = await signApprovalToken(this.env, {
          jobId,
          action: "revise",
          exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });
        const rejectToken = await signApprovalToken(this.env, {
          jobId,
          action: "reject",
          exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        await sendPreviewEmail(this.env, {
          companyName: intake.companyName,
          previewUrl,
          jobId,
          qaVerdict: qaReport.verdict,
          criticalCount: qaReport.issues.filter((i) => i.severity === "critical").length,
          topIssues: qaReport.issues.slice(0, 3).map((i) => ({
            severity: i.severity,
            page: i.page,
            issue: i.issue,
          })),
          approveToken,
          reviseToken,
          rejectToken,
        });
      });

      approval = await step.waitForEvent<ApprovalEvent>("6.2 await human decision (approve / revise / reject)", {
        type: "human-approval",
        timeout: `${this.env.APPROVAL_TIMEOUT_DAYS ?? "7"} days` as `${number} days`,
      });
    }

    // ======== REVISION LOOP ========

    let revisionNumber = 0;
    let currentSpec = siteSpec;
    let currentQa = qaReport;
    let currentBuildManifestR2Key = buildManifestR2Key;
    let currentPreviewUrl = previewUrl;
    let currentWorkerName = deployedWorkerName;

    while (approval.payload.status === "revise_requested" && revisionNumber < maxRevisionAttempts) {
      revisionNumber++;
      const verNum = revisionNumber + 1;
      const revLabel = `R${revisionNumber} (v${verNum})`;
      const parentArtifactId = currentSpec?.provenance?.id ?? null;

      const revision = await step.do(`6.3.${revisionNumber}a plan revision ${revLabel}`, async () => {
        const { updateJobStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: `revision_planning_r${revisionNumber}` });
        const prompt = approval.payload.prompt ?? "No revision instructions provided";
        return createRevisionPlan(
          this.env,
          jobId,
          siteId,
          clientSlug,
          currentSpec!,
          currentQa,
          prompt
        );
      });

      let revisedSpec = await step.do(`6.3.${revisionNumber}b apply revision ${revLabel} to spec`, async () => {
        const { updateJobStatus } = await import("../lib/db");
        const { buildProvenanceManifest, extractSiteSpecBlocks, validateProvenanceManifest } = await import("../lib/provenance");
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: `revision_apply_r${revisionNumber}` });
        const applied = applyRevisionToSpec(currentSpec!, revision);
        const sourceManifest = await buildProvenanceManifest({
          jobId, siteId, clientSlug, siteVersion: verNum, intake,
          parentArtifactId,
          blocks: extractSiteSpecBlocks(applied),
        });
        const provenanceValidation = validateProvenanceManifest(sourceManifest);
        if (provenanceValidation.blocking) {
          const message = `Revision provenance validation failed: ${provenanceValidation.issues.map((issue) => `${issue.code}:${issue.path}`).join(" | ")}`;
          await failBundleValidation(this.env, jobId, message, `revision_provenance_r${revisionNumber}`);
        }
        return applied;
      });

      const revisionBundle = await step.do(`6.3.${revisionNumber}c build revised HTML bundle ${revLabel}`, async () => {
        const { updateJobStatus } = await import("../lib/db");
        const { putObject, bundlePrefix, getObject } = await import("../lib/assets");
        const { renderBlueprintSite } = await import("../render/site-renderer");
        const { buildRenderContent } = await import("../render/content");
        const { buildProvenanceManifest, extractHtmlBlocks, extractRenderContentBlocks, validateProvenanceManifest } = await import("../lib/provenance");
        const { provenanceArtifactKey } = await import("../lib/assets");
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: `revision_build_r${revisionNumber}` });

        const content = buildRenderContent(intake, revisedSpec);
        const preRenderProvenance = await buildProvenanceManifest({
          jobId, siteId, clientSlug, siteVersion: verNum, intake,
          parentArtifactId,
          blocks: extractRenderContentBlocks(content),
        });
        const preRenderValidation = validateProvenanceManifest(preRenderProvenance);
        if (preRenderValidation.blocking) {
          throw new Error(`Pre-render revision provenance validation failed: ${preRenderValidation.issues.map((finding) => finding.id).join(", ")}`);
        }
        const renderedRevision = renderBlueprintSite({
          design: blueprintDesign,
          interaction: blueprintInteraction,
          content,
          siteUrl: this.env.PUBLIC_APP_URL,
        });
        const provenance = await buildProvenanceManifest({
          jobId, siteId, clientSlug, siteVersion: verNum, intake,
          parentArtifactId,
          blocks: extractHtmlBlocks(renderedRevision.files),
        });
        const provenanceValidation = validateProvenanceManifest(provenance);
        if (provenanceValidation.blocking) {
          throw new Error(`Rendered revision provenance validation failed: ${provenanceValidation.issues.map((issue) => issue.id).join(", ")}`);
        }
        const provenanceR2Key = provenanceArtifactKey(clientSlug, verNum, provenance.id);
        await putObject(this.env, provenanceR2Key, JSON.stringify(provenance, null, 2), {
          httpMetadata: { contentType: "application/json" },
        });

        const bundleBase = bundlePrefix(clientSlug, verNum);
        const previousFiles = await loadBundleFilesFromR2(this.env, currentBuildManifestR2Key);
        const manifest = new Map<string, string | ArrayBuffer>();
        for (const [path, contentValue] of renderedRevision.files) manifest.set(path, contentValue);
        for (const [path, contentValue] of previousFiles) {
          if (!manifest.has(path) && path.startsWith("assets/images/")) manifest.set(path, contentValue);
        }
        const manifestEntries: Record<string, string> = {};
        for (const [path, content] of manifest) {
          const r2Key = `${bundleBase}/${path}`;
          await putObject(this.env, r2Key, content);
          manifestEntries[path] = r2Key;
        }
        await putObject(
          this.env,
          `${bundleBase}/manifest.json`,
          JSON.stringify(manifestEntries, null, 2),
          { httpMetadata: { contentType: "application/json" } }
        );

        return {
          workerName: currentWorkerName,
          buildManifestR2Key: `${bundleBase}/manifest.json`,
          provenance,
          provenanceR2Key,
        };
      });
      const { attachProvenanceManifestToSiteSpec } = await import("../lib/provenance");
      revisedSpec = attachProvenanceManifestToSiteSpec(revisedSpec, revisionBundle.provenance);
      currentSpec = revisedSpec;

      await step.do(`6.3.${revisionNumber}d validate revised HTML ${revLabel}`, async () => {
        const { updateJobStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: `revision_validate_r${revisionNumber}` });

        const files = await loadBundleFilesFromR2(this.env, revisionBundle.buildManifestR2Key);
        const validation = validateBundle(files);
        if (!validation.valid) {
          const message = `Revised HTML bundle validation failed (R${revisionNumber}): ${validation.issues.map((issue) => `${issue.file}: ${issue.issue}`).join(" | ")}`;
          await failBundleValidation(this.env, jobId, message, `revision_validate_r${revisionNumber}`);
        }
        const { verifyProvenanceAgainstBundle } = await import("../lib/provenance");
        const provenanceValidation = await verifyProvenanceAgainstBundle(revisionBundle.provenance, files);
        if (provenanceValidation.blocking) {
          const message = `Revised provenance validation failed (R${revisionNumber}): ${provenanceValidation.issues.map((issue) => `${issue.code}:${issue.path}`).join(" | ")}`;
          await failBundleValidation(this.env, jobId, message, `revision_provenance_validate_r${revisionNumber}`);
        }
      });

      const newDeploy = await step.do<{ previewUrl: string; buildManifestR2Key: string }>(`6.3.${revisionNumber}f deploy revised preview ${revLabel}`, async () => {
        const { updateJobStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: `revision_deploy_r${revisionNumber}` });

        const files = await loadBundleFilesFromR2(this.env, revisionBundle.buildManifestR2Key);
        const uploadJwt = await uploadAssets(this.env, revisionBundle.workerName, files);
        await createWorker(this.env, revisionBundle.workerName, uploadJwt, intake.clientEmail);
        const url = await getWorkerPreviewUrl(this.env, revisionBundle.workerName);

        return {
          previewUrl: url,
          buildManifestR2Key: revisionBundle.buildManifestR2Key,
        };
      });

      currentPreviewUrl = newDeploy.previewUrl;
      currentBuildManifestR2Key = newDeploy.buildManifestR2Key;

      const revVersionRecord = await step.do<{ versionId: string }>(`6.3.${revisionNumber}g record revised version ${revLabel}`, async () => {
        const { updateJobStatus, createSiteVersion, updateSiteCurrentVersion, updateSitePreviewUrl, createPageSpec, createProvenanceArtifact } = await import("../lib/db");
        const { generateId } = await import("../lib/crypto");
        const { validateProvenanceManifest } = await import("../lib/provenance");

        await updateJobStatus(this.env.DB, jobId, "running", { current_step: `revision_record_r${revisionNumber}` });
        await updateSitePreviewUrl(this.env.DB, siteId, newDeploy.previewUrl);

        const newVersionId = `site-version:${revisionBundle.provenance.id}`;
        await createSiteVersion(this.env.DB, {
          id: newVersionId,
          site_id: siteId,
          version_number: verNum,
          source_type: "revision",
          source_job_id: jobId,
          build_manifest_r2_key: `${clientSlug}/versions/v${verNum}/bundle/manifest.json`,
          static_bundle_r2_prefix: `${clientSlug}/versions/v${verNum}/bundle`,
          deployed_worker_name: revisionBundle.workerName,
          preview_url: newDeploy.previewUrl,
          qa_report_id: null,
        });
        await updateSiteCurrentVersion(this.env.DB, siteId, newVersionId);
        await createProvenanceArtifact(this.env.DB, {
          id: revisionBundle.provenance.id,
          job_id: jobId,
          site_version_id: newVersionId,
          site_version: verNum,
          schema_version: revisionBundle.provenance.schemaVersion,
          parent_artifact_id: revisionBundle.provenance.parentArtifactId,
          r2_key: revisionBundle.provenanceR2Key,
          manifest_json: JSON.stringify(revisionBundle.provenance),
          validation_json: JSON.stringify(validateProvenanceManifest(revisionBundle.provenance)),
          created_at: revisionBundle.provenance.createdAt,
        });

        for (const page of revisedSpec.pages) {
          await createPageSpec(this.env.DB, {
            id: generateId(),
            site_version_id: newVersionId,
            page_name: page.name,
            slug: page.slug,
            seo_title: page.seoTitle,
            meta_description: page.metaDescription,
            h1: page.h1,
            spec_json: JSON.stringify(page),
            html_r2_key: null,
          });
        }

        return { versionId: newVersionId };
      });

      currentVersionId = revVersionRecord.versionId;

      const newQa = await step.do(`6.3.${revisionNumber}i re-run QA checks ${revLabel}`, async () => {
        const { updateJobStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: `revision_qa_r${revisionNumber}` });
        return runQaReview(this.env, newDeploy.previewUrl, clientSlug, verNum, revisedSpec, revisionBundle.provenance, blueprintDesign, blueprintInteraction, 1);
      });

      currentQa = newQa;

      await step.do(`6.3.${revisionNumber}j persist QA report ${revLabel}`, async () => {
        const { createQaReport, createQaIssue } = await import("../lib/db");
        const { generateId } = await import("../lib/crypto");

        const reportId = generateId();
        await createQaReport(this.env.DB, {
          id: reportId,
          site_version_id: currentVersionId,
          status: newQa.verdict,
          summary: newQa.summary,
          report_json: JSON.stringify(newQa),
          desktop_screenshot_r2_key: newQa.screenshots.desktop.home ?? null,
          mobile_screenshot_r2_key: newQa.screenshots.mobile.home ?? null,
        });

        for (const issue of newQa.issues) {
          await createQaIssue(this.env.DB, {
            id: generateId(),
            qa_report_id: reportId,
            severity: issue.severity,
            category: issue.category,
            page_slug: issue.page,
            selector: issue.selector,
            issue_text: issue.issue,
            screenshot_r2_key: newQa.screenshots.desktop[issue.page === "/" ? "home" : issue.page.replace(/^\//, "")] ?? null,
          });
        }
        await this.env.DB.prepare(
          `INSERT INTO quality_gate_attempts (id, job_id, site_version_id, site_version, attempt_number, score, threshold, status, report_r2_key, interaction_evidence_r2_key, created_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
        ).bind(
          generateId(), jobId, currentVersionId, verNum, newQa.qualityGate.score, newQa.qualityGate.threshold,
          newQa.qualityGate.publishable ? "pass" : "failed", newQa.qualityGate.reportR2Key,
          newQa.qualityGate.interactionEvidenceR2Key, new Date().toISOString()
        ).run();
        await this.env.DB.prepare("UPDATE site_versions SET qa_report_id = ? WHERE id = ?").bind(reportId, currentVersionId).run();
      });

      if (!newQa.qualityGate.publishable) {
        await step.do(`6.3.${revisionNumber}k block failed visual quality gate ${revLabel}`, async () => {
          const { updateJobStatus } = await import("../lib/db");
          await updateJobStatus(this.env.DB, jobId, "failed_validation", {
            current_step: `visual_quality_gate_r${revisionNumber}`,
            error_code: "VISUAL_QUALITY_GATE_FAILED",
            error_message: newQa.summary,
          });
        });
        return;
      }

      await step.do(`6.3.${revisionNumber}k send revised preview email ${revLabel}`, async () => {
        const { updateJobStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "waiting_approval", { current_step: `awaiting_human_review_r${revisionNumber}` });

        const approveToken = await signApprovalToken(this.env, {
          jobId,
          action: "approve",
          exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });
        const reviseToken = await signApprovalToken(this.env, {
          jobId,
          action: "revise",
          exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });
        const rejectToken = await signApprovalToken(this.env, {
          jobId,
          action: "reject",
          exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        await sendPreviewEmail(this.env, {
          companyName: intake.companyName,
          previewUrl: newDeploy.previewUrl,
          jobId,
          qaVerdict: newQa.verdict,
          criticalCount: newQa.issues.filter((i) => i.severity === "critical").length,
          topIssues: newQa.issues.slice(0, 3).map((i) => ({
            severity: i.severity,
            page: i.page,
            issue: i.issue,
          })),
          approveToken,
          reviseToken,
          rejectToken,
        });
      });

      approval = await step.waitForEvent<ApprovalEvent>(`6.${revisionNumber + 2} await human decision after revision ${revLabel}`, {
        type: "human-approval",
        timeout: `${this.env.APPROVAL_TIMEOUT_DAYS ?? "7"} days` as `${number} days`,
      });
    }

    if (approval.payload.status === "revise_requested") {
      await step.do("6.9 stop after revision limit", async () => {
        const { updateJobStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "failed_validation", {
          current_step: "revision_limit",
          error_code: "REVISION_LIMIT_EXHAUSTED",
          error_message: `The bounded revision limit of ${maxRevisionAttempts} was exhausted before the site passed QA and received approval.`,
        });
      });
      return;
    }

    // ======== PHASE 7: FINAL STATUS RESOLUTION ========

    if (approval.payload.status === "approved") {
      await step.do("7.1 push approved site to GitHub for production", async () => {
        const { updateJobStatus } = await import("../lib/db");
        const { generateId, nowIso } = await import("../lib/crypto");
        await updateJobStatus(this.env.DB, jobId, "running", { current_step: "production_github_push" });

        const files = await loadBundleFilesFromR2(this.env, currentBuildManifestR2Key);

        const result = await pushSiteToGitHub(this.env, {
          repoOwner: this.env.GITHUB_REPO_OWNER,
          repoName: this.env.GITHUB_REPO_NAME,
          branch: this.env.GITHUB_BRANCH,
          clientSlug,
          version: revisionNumber + 1,
          siteId,
          jobId,
          files,
          siteSpecJson: JSON.stringify(currentSpec, null, 2),
        });

        await this.env.DB.prepare(
          "UPDATE site_versions SET github_commit_sha = ?, github_ref = ?, production_status = 'deploying' WHERE id = ?"
        ).bind(result.commitSha, this.env.GITHUB_BRANCH, currentVersionId).run();

        await this.env.DB.prepare(
          `INSERT INTO deployments (id, site_id, site_version_id, environment, trigger_source, status, github_run_id, started_at)
           VALUES (?, ?, ?, 'production', 'workflow', 'in_progress', ?, ?)`
        ).bind(generateId(), siteId, currentVersionId, null, nowIso()).run();
      });

      await step.do("7.2 schedule preview worker cleanup (30-day TTL)", async () => {
        const deleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await this.env.DB.prepare(
          `UPDATE site_versions SET worker_status = 'scheduled_delete', preview_worker_deleted_at = ? WHERE deployed_worker_name = ?`
        ).bind(deleteAt.toISOString(), currentWorkerName).run();
      });

      await step.do("7.3 finalize build as completed", async () => {
        const { updateJobStatus } = await import("../lib/db");
        const { updateSiteStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "completed", { current_step: "done" });
        await updateSiteStatus(this.env.DB, siteId, "approved");
      });

      await step.do("7.4 send production deployment notification", async () => {
        await sendInternalNotification(this.env, {
          subject: `Production deployment initiated — ${intake.companyName}`,
          htmlBody: `<p>Job ${jobId} approved. Production deployment via GitHub Actions has been initiated.</p><p>Client: ${intake.companyName} (${intake.clientEmail})</p><p>Revisions: ${revisionNumber}</p>`,
        });
      });

    } else if (approval.payload.status === "rejected") {
      await step.do("7.1 delete preview worker", async () => {
        const now = new Date().toISOString();
        try {
          await deleteWorker(this.env, currentWorkerName);
          await this.env.DB.prepare(
            `UPDATE site_versions SET worker_status = 'deleted', preview_worker_deleted_at = ? WHERE deployed_worker_name = ?`
          ).bind(now, currentWorkerName).run();
        } catch {
          // worker deletion failure is non-blocking
        }
      });

      await step.do("7.2 finalize build as rejected", async () => {
        const { updateJobStatus, updateSiteStatus } = await import("../lib/db");
        await updateJobStatus(this.env.DB, jobId, "rejected", { current_step: "rejected" });
        await updateSiteStatus(this.env.DB, siteId, "rejected");
      });
    }
  }
}
