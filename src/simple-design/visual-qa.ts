// SIMPLE stage 3: visual QA (spec sections 41-46).
//
// ONE multimodal comparative judgement: Reference vs Candidate (desktop +
// mobile when available). No canonical region graph — the scores and at most
// 5 impact-ranked findings ARE the output, and those findings are the entire
// brief for the ONE repair.

import type { Env } from "../env.d";
import { getObject } from "../lib/assets";
import { runSchemaValidatedAiStage, type AiProvenance, type RawAiGenerate } from "../domain/ai-boundary";
import {
  SIMPLE_VISUAL_QA_SCHEMA_VERSION,
  VisualQaReportSchema,
  type DesignBlueprint,
  type VisualQaReport,
} from "./contracts";
import { bytesToBase64, createSimpleVisionGenerate, mimeForKey } from "./vision";
import type { SimpleBuilderVisualInput } from "./website-builder";

export interface RunSimpleVisualQaInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  blueprint: DesignBlueprint;
  referenceVisualInputs: SimpleBuilderVisualInput[];
  candidateDesktopR2Key: string;
  candidateMobileR2Key?: string;
  generate?: RawAiGenerate;
}

export interface SimpleVisualQaResult {
  report: VisualQaReport;
  provenance: AiProvenance | null;
}

function buildVisualQaUserPrompt(input: RunSimpleVisualQaInput): string {
  return `Compare the CANDIDATE renders against the REFERENCE screenshots for design-identity fidelity. The replacement business's copy, identity, services and photo subjects are INTENTIONALLY different — judge only the design: silhouette, section order and mass, hero composition, typography, spacing rhythm, surface/color rhythm, image treatment, component language, the blueprint's signature elements, and responsive character.

FOUR-PAGE HERO MEDIA: verify that each routed page opens with meaningful photographic hero treatment consistent with the Reference design language — a typography-only page header on any of home/about/services/contact is a finding.

DESIGN BLUEPRINT (the intent the candidate must realize — acceptance checklist included):
${JSON.stringify(input.blueprint)}

ATTACHED IMAGES, in order:
1. REFERENCE desktop full page
2. CANDIDATE desktop full page
${input.candidateMobileR2Key ? "3. REFERENCE mobile full page\n4. CANDIDATE mobile full page" : "(mobile reference/candidate not available — judge responsive from the blueprint's responsive spec and desktop evidence)"}

Return the scored report per the output contract. At most 5 findings, ranked by visual impact, each with a concrete repair direction.`;
}

export async function runSimpleVisualQaStage(env: Env, input: RunSimpleVisualQaInput): Promise<SimpleVisualQaResult> {
  const images: Array<{ base64: string; mimeType: string }> = [];
  const load = async (key: string, mimeType: string) => {
    const body = await getObject(env, key);
    if (!body) throw new Error(`visual QA input ${key} is missing from storage`);
    images.push({ base64: bytesToBase64(new Uint8Array(await new Response(body).arrayBuffer())), mimeType });
  };
  // Fixed order matches the prompt's numbered list.
  const referenceFullPage =
    input.referenceVisualInputs.find((entry) => entry.kind === "full-page") ?? input.referenceVisualInputs[0];
  await load(referenceFullPage.artifact, mimeForKey(referenceFullPage.artifact));
  await load(input.candidateDesktopR2Key, "image/png");
  if (input.candidateMobileR2Key) {
    const referenceMobile = input.referenceVisualInputs.find((entry) => /mobile/i.test(entry.kind));
    if (referenceMobile) await load(referenceMobile.artifact, mimeForKey(referenceMobile.artifact));
    await load(input.candidateMobileR2Key, "image/png");
  }

  const generate: RawAiGenerate =
    input.generate ??
    createSimpleVisionGenerate(
      env,
      images,
      { buildId: input.buildId, stage: "simple-visual-qa", buildVersionNumber: input.buildVersionNumber },
      { maxTokens: 4096 }
    );

  const run = await runSchemaValidatedAiStage<unknown>(env, {
    stage: "simple-visual-qa",
    schema: VisualQaReportSchema,
    schemaVersion: SIMPLE_VISUAL_QA_SCHEMA_VERSION,
    userPrompt: buildVisualQaUserPrompt(input),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [referenceFullPage.sha256],
    maxTokens: 4096,
    generate,
  });

  return { report: run.value as VisualQaReport, provenance: run.provenance };
}
