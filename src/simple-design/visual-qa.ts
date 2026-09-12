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
  type DesignBlueprintV2,
  type VisualQaReport,
} from "./contracts";
import { bytesToBase64, createSimpleVisionGenerate, mimeForKey } from "./vision";
import type { SimpleBuilderVisualInput } from "./contracts";

export interface RunSimpleVisualQaInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  blueprint: DesignBlueprintV2;
  /** Reference visual inputs — REFERENCE_BOUND only. ORIGINAL_DESIGN has no
   *  Reference and must not fake one (issue #24). */
  referenceVisualInputs?: SimpleBuilderVisualInput[];
  candidateDesktopR2Key: string;
  candidateMobileR2Key?: string;
  /** ORIGINAL_DESIGN mode: the rendered candidate is judged against the
   *  Blueprint + Creative Direction (no Reference screenshots attached). */
  originalDesign?: { creativeDirectionBrief: string };
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

// ORIGINAL_DESIGN visual QA prompt (issue #24): the Blueprint + Creative
// Direction are the authority; no Reference exists or is expected.
function buildOriginalVisualQaUserPrompt(input: RunSimpleVisualQaInput): string {
  return `Judge the CANDIDATE renders of an ORIGINAL_DESIGN website. There is NO reference website: the DESIGN BLUEPRINT and CREATIVE DIRECTION below are the authority. The rendered site must faithfully realize the Blueprint as a distinctive, coherent, professional website for the intended business — without collapsing into generic AI-template design.

${input.originalDesign!.creativeDirectionBrief}

DESIGN BLUEPRINT (the intent the candidate must realize — acceptance checklist and signature elements included):
${JSON.stringify(input.blueprint)}

DISTINCTIVENESS IS GRADED: penalize generic template feel, repeated identical card grids, weak hierarchy, default-looking section stacks, random design effects, visual inconsistency, unmotivated gradients, generic AI imagery treatment, and mobile layouts that become anonymous. A technically clean but bland site must NOT receive 90+.

FOUR-PAGE HERO MEDIA: verify that each routed page opens with meaningful photographic hero treatment per the Blueprint — a typography-only page header on any of home/about/services/contact is a finding.

ATTACHED IMAGES, in order:
1. CANDIDATE desktop full page
${input.candidateMobileR2Key ? "2. CANDIDATE mobile full page" : "(mobile candidate not available — judge responsive from the blueprint's responsive spec and desktop evidence)"}

Return the scored report per the output contract. At most 5 findings, ranked by visual impact, each with a concrete repair direction.`;
}

export async function runSimpleVisualQaStage(env: Env, input: RunSimpleVisualQaInput): Promise<SimpleVisualQaResult> {
  const isOriginalDesign = Boolean(input.originalDesign);
  const stageKey = isOriginalDesign ? "simple-original-design-visual-qa" : "simple-visual-qa";
  const images: Array<{ base64: string; mimeType: string }> = [];
  const load = async (key: string, mimeType: string) => {
    const body = await getObject(env, key);
    if (!body) throw new Error(`visual QA input ${key} is missing from storage`);
    images.push({ base64: bytesToBase64(new Uint8Array(await new Response(body).arrayBuffer())), mimeType });
  };
  // Fixed order matches the prompt's numbered list.
  let inputArtifactIds: string[] = [];
  const referenceFullPage = isOriginalDesign
    ? null
    : (input.referenceVisualInputs?.find((entry) => entry.kind === "full-page") ?? input.referenceVisualInputs?.[0]);
  if (isOriginalDesign) {
    await load(input.candidateDesktopR2Key, "image/png");
    if (input.candidateMobileR2Key) await load(input.candidateMobileR2Key, "image/png");
  } else {
    if (!referenceFullPage) throw new Error("REFERENCE_BOUND visual QA requires Reference visual inputs");
    await load(referenceFullPage.artifact, mimeForKey(referenceFullPage.artifact));
    await load(input.candidateDesktopR2Key, "image/png");
    if (input.candidateMobileR2Key) {
      const referenceMobile = input.referenceVisualInputs?.find((entry) => /mobile/i.test(entry.kind));
      if (referenceMobile) await load(referenceMobile.artifact, mimeForKey(referenceMobile.artifact));
      await load(input.candidateMobileR2Key, "image/png");
    }
    inputArtifactIds = [referenceFullPage.sha256];
  }

  const generate: RawAiGenerate =
    input.generate ??
    createSimpleVisionGenerate(
      env,
      images,
      { buildId: input.buildId, stage: stageKey, buildVersionNumber: input.buildVersionNumber },
      // Strict report schema — pinned below the provider default like the
      // blueprint stage (temp 0.7 produced schema-invalid output twice, live
      // evidence 2026-09-11).
      { maxTokens: 4096, temperature: 0.3 }
    );

  const run = await runSchemaValidatedAiStage<unknown>(env, {
    stage: stageKey,
    schema: VisualQaReportSchema,
    schemaVersion: SIMPLE_VISUAL_QA_SCHEMA_VERSION,
    userPrompt: isOriginalDesign ? buildOriginalVisualQaUserPrompt(input) : buildVisualQaUserPrompt(input),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds,
    generate,
  });

  return { report: run.value as VisualQaReport, provenance: run.provenance };
}
