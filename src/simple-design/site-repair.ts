// SIMPLE stage 4: the ONE site repair (spec sections 49-53).
//
// Maximum ONE semantic repair call per Build. The repair agent is one
// coherent owner of HTML/CSS/JS; its preservation set (Business Facts,
// contact details, form contract, Accepted Image identities, Blueprint
// direction) is frozen. The output is the COMPLETE repaired bundle stored as
// a new immutable Build Version's site bundle — never a mutation of the
// failed version.

import type { Env } from "../env.d";
import { getObject } from "../lib/assets";
import {
  runSchemaValidatedAiStage,
  type AiProvenance,
  type RawAiGenerate,
} from "../domain/ai-boundary";
import { getBuildStageArtifact, storeBuildStageArtifactIdempotent } from "../domain/stage-artifacts";
import type { BusinessFacts } from "../domain/lifecycle-schema";
import {
  SITE_BUNDLE_SCHEMA_VERSION,
  SiteBundleSchema,
  type DesignBlueprint,
  type QaPackage,
  type SiteBundle,
} from "./contracts";
import { bytesToBase64, createSimpleVisionGenerate, mimeForKey } from "./vision";
import type { SimpleBuilderVisualInput } from "./website-builder";

export class SimpleRepairBudgetExceededError extends Error {
  constructor() {
    super("the SIMPLE pipeline allows at most ONE semantic repair call per Build");
    this.name = "SimpleRepairBudgetExceededError";
  }
}

export interface RunSimpleSiteRepairInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  bundle: SiteBundle;
  blueprint: DesignBlueprint;
  facts: BusinessFacts;
  qaPackage: QaPackage;
  acceptedImages: Array<{ slotId: string; altText: string; aspectRatio: string }>;
  formServiceEndpoint: string;
  siteFormId: string;
  referenceVisualInputs: SimpleBuilderVisualInput[];
  candidateDesktopR2Key?: string;
  candidateMobileR2Key?: string;
  generate?: RawAiGenerate;
}

export interface SimpleSiteRepairResult {
  bundle: SiteBundle;
  artifactR2Key: string;
  provenance: AiProvenance | null;
}

function buildRepairUserPrompt(input: RunSimpleSiteRepairInput): string {
  const images = input.acceptedImages
    .map((image) => `- ${image.slotId} [${image.aspectRatio}] — alt: ${image.altText}`)
    .join("\n");
  return `CURRENT SITE BUNDLE (repair target — you own HTML/CSS/JS whole):
${JSON.stringify(input.bundle)}

QA PACKAGE (complete repair brief):
${JSON.stringify(input.qaPackage)}

PRESERVATION SET (absolute — spec section 50): Business Facts below, contact details, Accepted Image identities (IMG: slot mappings), Blueprint design direction, and the FORM CONTRACT exactly:
- form action: ${input.formServiceEndpoint}
- hidden input: <input type="hidden" name="siteFormId" value="${input.siteFormId}">
- fields exactly: name, email, message with labels; no other delivery-control fields

ACCEPTED IMAGES (unchanged mappings): 
${input.acceptedImages.length > 0 ? images : "(none — keep the bundle image-free)"}

BUSINESS FACTS (unchanged content authority):
${JSON.stringify(input.facts)}

${input.candidateDesktopR2Key ? "Attached images, in order: 1) REFERENCE desktop, 2) CANDIDATE desktop current render, then reference/candidate mobile when available. " : ""}Fix the highest-impact visual findings first; clear every truth and technical finding. Smallest coherent change set that materially increases fidelity. Return the COMPLETE repaired bundle per the output contract.`;
}

export async function runSimpleSiteRepairStage(env: Env, input: RunSimpleSiteRepairInput): Promise<SimpleSiteRepairResult> {
  // The caller (pipeline) owns the budget truth: it must have already proven
  // via D1 that this Build has no repair site bundle yet. This guard keeps a
  // miswired caller honest; the pipeline check is the authoritative one.
  const existing = await getBuildStageArtifact<SiteBundle>(env, input.buildVersionId, "site_bundle");
  if (existing) {
    // This version already HAS its (repaired) bundle — reuse, never re-repair.
    return { bundle: existing.value, artifactR2Key: existing.artifactR2Key, provenance: existing.provenance };
  }

  const images: Array<{ base64: string; mimeType: string }> = [];
  const referenceFullPage =
    input.referenceVisualInputs.find((entry) => entry.kind === "full-page") ?? input.referenceVisualInputs[0];
  if (input.candidateDesktopR2Key) {
    for (const [key, mime] of [
      [referenceFullPage.artifact, mimeForKey(referenceFullPage.artifact)],
      [input.candidateDesktopR2Key, "image/png"],
      ...(input.candidateMobileR2Key ? [[input.candidateMobileR2Key, "image/png"] as const] : []),
    ] as Array<[string, string]>) {
      const body = await getObject(env, key);
      if (!body) continue;
      images.push({ base64: bytesToBase64(new Uint8Array(await new Response(body).arrayBuffer())), mimeType: mime });
    }
  }

  const generate: RawAiGenerate | undefined =
    input.generate ??
    (images.length > 0
      ? createSimpleVisionGenerate(
          env,
          images,
          { buildId: input.buildId, stage: "simple-site-repair", buildVersionNumber: input.buildVersionNumber },
          { maxTokens: 32000 }
        )
      : undefined);

  const run = await runSchemaValidatedAiStage<unknown>(env, {
    stage: "simple-site-repair",
    schema: SiteBundleSchema,
    schemaVersion: SITE_BUNDLE_SCHEMA_VERSION,
    userPrompt: buildRepairUserPrompt(input),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [referenceFullPage.sha256],
    maxTokens: 32000,
    ...(generate ? { generate } : {}),
  });

  const bundle = run.value as SiteBundle;
  // Stored on the NEW Build Version the pipeline created for this repair —
  // a material repair is a new immutable Build Version, never a mutation.
  const stored = await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "site_bundle",
    schemaVersion: SITE_BUNDLE_SCHEMA_VERSION,
    value: bundle,
    provenance: run.provenance,
  });
  return { bundle, artifactR2Key: stored.artifactR2Key, provenance: run.provenance };
}
