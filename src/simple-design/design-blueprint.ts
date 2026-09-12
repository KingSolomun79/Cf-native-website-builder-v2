// SIMPLE stage 1: the Design Blueprint (spec sections 10/12/28-31).
//
// ONE multimodal schema-validated call: Reference screenshots in, ONE rich
// implementation-ready design document out. The screenshot stays the visual
// authority — the blueprint is its interpretation, never a replacement (spec
// section 26), so the builder later receives BOTH.
//
// Deterministic quality gate (spec section 30): structural checks only. The
// schema boundary already spent the ONE targeted structural repair; a
// blueprint that still fails the gate (or the schema) is a terminal stage
// error the pipeline escalates to HUMAN_REVIEW_REQUIRED. No second semantic
// generation, ever.

import type { Env } from "../env.d";
import { getObject } from "../lib/assets";
import {
  runSchemaValidatedAiStage,
  AiStageSchemaInvalidError,
  type AiProvenance,
  type AiStageAttemptRecord,
  type RawAiGenerate,
} from "../domain/ai-boundary";
import { storeBuildStageArtifactIdempotent, getBuildStageArtifact } from "../domain/stage-artifacts";
import { putImmutableObjectTolerant } from "../lib/assets";
import { buildVersionRoot } from "../domain/artifact-keys";
import {
  DESIGN_BLUEPRINT_V2_SCHEMA_VERSION,
  DesignBlueprintV2Schema,
  evaluateBlueprintQualityGateV2,
  storedBlueprintToV2,
  validateDesignBlueprintV2,
  type DesignBlueprintV2,
  type HeroMediaLinkCanonicalization,
  type HeroMediaLinkCanonicalizationEntry,
} from "./contracts";
import { renderDesignBlueprintV2Markdown } from "./render-blueprint-v2";
import { bytesToBase64, createSimpleVisionGenerate, mimeForKey } from "./vision";
import type { CreativeDirectionContext } from "../domain/creative-direction";
import { renderCreativeDirectionBrief } from "../domain/creative-direction";

export class SimpleDesignBlueprintError extends Error {
  constructor(readonly code: "SCHEMA_INVALID" | "QUALITY_GATE_FAILED" | "NO_VISUAL_INPUT", message: string) {
    super(message);
    this.name = "SimpleDesignBlueprintError";
  }
}

export interface SimpleBlueprintVisualInput {
  kind: string;
  artifact: string;
  sha256: string;
  width: number;
  height: number;
}

// ORIGINAL_DESIGN inputs (issue #24): the blueprint is INVENTED from Business
// Facts + Creative Direction — no Reference exists, no screenshots are
// attached, and the stage runs on the ORIGINAL_DESIGN prompt while emitting
// the SAME design-blueprint/2 schema.
export interface OriginalDesignBlueprintInput {
  /** Deterministic creative-direction context derived from the frozen Onboarding Submission. */
  creativeDirection: CreativeDirectionContext;
  /** sha256 of the frozen creative-direction input — provenance (GO §30). */
  creativeDirectionSha256: string;
  /** The owning immutable Onboarding Submission. */
  onboardingSubmissionId: string;
}

export interface RunSimpleDesignBlueprintInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  businessFactsRef: string;
  /** Replacement business context the DESIGN may adapt to — never content. */
  replacementBusiness: { name: string; type?: string; description?: string; brandPaletteHint?: string };
  referenceUrl?: string;
  /** Normalized model-facing Reference visual inputs (from frozen intake
   *  evidence). Full-page desktop first when present. REQUIRED for
   *  REFERENCE_BOUND; ORIGINAL_DESIGN attaches none. */
  visualInputs?: SimpleBlueprintVisualInput[];
  /** ORIGINAL_DESIGN mode: invent the blueprint from creative direction. */
  originalDesign?: OriginalDesignBlueprintInput;
  generate?: RawAiGenerate;
}

export interface SimpleDesignBlueprintResult {
  blueprint: DesignBlueprintV2;
  schemaVersion: string;
  artifactR2Key: string;
  markdownR2Key: string;
  provenance: AiProvenance | null;
  attempts: AiStageAttemptRecord[];
  /** v2 artifacts never canonicalize; only the v1 frozen-artifact compat
   *  path (which runs the retained v1 canonicalizer for safe reading) can
   *  report applied links here. */
  heroMediaLinkCanonicalization: HeroMediaLinkCanonicalization;
}

function buildBlueprintUserPrompt(input: RunSimpleDesignBlueprintInput): string {
  const { replacementBusiness } = input;
  return `Study the attached Reference screenshots (design authority only) and produce the Design Blueprint for the REPLACEMENT business below. Describe the design, never the reference business.

REPLACEMENT BUSINESS (context for [ADAPTATION] decisions only — you receive no other business content and must not invent any):
- Name: ${replacementBusiness.name}
- Type/industry: ${replacementBusiness.type ?? "not specified — infer an appropriate framing from the reference's design language, but express it generically"}
${replacementBusiness.description ? `- Description: ${replacementBusiness.description}` : ""}
${replacementBusiness.brandPaletteHint ? `- Brand palette preference: ${replacementBusiness.brandPaletteHint} — adapt the reference accent role toward this while preserving its visual frequency; mark [ADAPTATION]` : ""}
${input.referenceUrl ? `- Reference URL (supplemental behavioral evidence): ${input.referenceUrl}` : ""}
BUSINESS FACTS POINTER (provenance only — repeat verbatim in businessFactsRef): ${input.businessFactsRef}

TRUTH CONSTRAINT ON TRUST SECTIONS (build fails on violation — live evidence 2026-09-11: a Reference testimonial band was blueprinted and realized as fabricated trust content): the Reference may display testimonials, star ratings, client names or logos, awards and metric claims. These are design PATTERNS only. A trust section (testimonial quotes, ratings, client rosters, awards, metric claims) may be specified ONLY when the Business Facts explicitly contain that content — for provenance-free facts, they never do. Where the Reference shows one, specify instead a fact-backed section with the SAME visual role (services/capability band, process band, values band), marked [ADAPTATION], and carry its imagery spec over to the replacement section. Never blueprint quotes, names, ratings, awards or metric claims.

Prioritize the desktop full-page screenshot as the primary composition authority; use any mobile capture for the responsive spec; use detail slices for precision on typography, spacing and color values.`;
}

// ORIGINAL_DESIGN user prompt (issue #24): the Creative Direction brief is the
// design-intent authority; Business Facts exist as a provenance pointer only
// (the blueprint is never the content authority). No screenshots are attached.
function buildOriginalBlueprintUserPrompt(input: RunSimpleDesignBlueprintInput): string {
  const original = input.originalDesign!;
  const { replacementBusiness } = input;
  return `Invent the Original Design Blueprint for the business below. There is NO reference website: you are the design authority. Create ONE coherent visual concept specifically for this business — not a safe generic website.

CREATIVE DIRECTION (design-intent authority):
${renderCreativeDirectionBrief(original.creativeDirection)}

BUSINESS CONTEXT (design framing only — you receive no business content and must not invent any):
- Name: ${replacementBusiness.name}
${replacementBusiness.type ? `- Type/industry: ${replacementBusiness.type}` : ""}
${replacementBusiness.description ? `- Description: ${replacementBusiness.description}` : ""}
BUSINESS FACTS POINTER (provenance only — repeat verbatim in businessFactsRef): ${input.businessFactsRef}
ONBOARDING SUBMISSION (provenance only): ${original.onboardingSubmissionId}
CREATIVE DIRECTION SHA-256 (provenance only): ${original.creativeDirectionSha256}

TRUTH CONSTRAINT ON TRUST SECTIONS (build fails on violation): a trust section (testimonial quotes, ratings, client rosters, awards, metric claims) may be specified ONLY when the Business Facts explicitly contain that content — you receive no business content, so they never do. Where your concept wants social proof, express it with non-factual brand messaging or omit the section. Never blueprint quotes, names, ratings, awards or metric claims.

The rendered site is later judged against YOUR blueprint by a separate visual QA stage — make every rule falsifiable and every measurement concrete.`;
}

export async function runSimpleDesignBlueprintStage(
  env: Env,
  input: RunSimpleDesignBlueprintInput
): Promise<SimpleDesignBlueprintResult> {
  // Workflow-retry safety: the frozen blueprint IS the stage result. Existing
  // v2 artifacts return as stored; historical design-blueprint/1 artifacts
  // resume through the read-only compat path (GO section 17) — the stored R2
  // artifact and D1 row are never rewritten.
  const existing = await getBuildStageArtifact<unknown>(env, input.buildVersionId, "design_blueprint");
  if (existing) {
    if (isDesignBlueprintV2Artifact(existing.value)) {
      return {
        blueprint: existing.value,
        schemaVersion: DESIGN_BLUEPRINT_V2_SCHEMA_VERSION,
        artifactR2Key: existing.artifactR2Key,
        markdownR2Key: markdownKey(input.buildId, input.buildVersionNumber),
        provenance: existing.provenance,
        attempts: [],
        heroMediaLinkCanonicalization: storedHeroLinkCanonicalization(existing.provenance),
      };
    }
    const { blueprint: adapted, canonicalization } = adaptStoredV1Blueprint(existing.value, existing.provenance);
    return {
      blueprint: adapted,
      schemaVersion: DESIGN_BLUEPRINT_V2_SCHEMA_VERSION,
      artifactR2Key: existing.artifactR2Key,
      markdownR2Key: markdownKey(input.buildId, input.buildVersionNumber),
      provenance: existing.provenance,
      attempts: [],
      heroMediaLinkCanonicalization: canonicalization,
    };
  }

  // ORIGINAL_DESIGN attaches NO screenshots: the creative direction is the
  // visual authority and the stage runs text-only on the same multimodal
  // transport. The NO_VISUAL_INPUT gate is a REFERENCE_BOUND gate.
  const isOriginalDesign = Boolean(input.originalDesign);
  if (!isOriginalDesign && (input.visualInputs?.length ?? 0) === 0) {
    throw new SimpleDesignBlueprintError("NO_VISUAL_INPUT", "no Reference visual inputs available for the Design Blueprint");
  }

  const stageKey = isOriginalDesign ? "simple-original-design-blueprint" : "simple-design-blueprint";

  // Attach up to 4 reference visuals: full-page desktop, full-page mobile,
  // then the first detail slices.
  const ordered = isOriginalDesign
    ? []
    : [
        ...(input.visualInputs ?? []).filter((entry) => entry.kind === "full-page"),
        ...(input.visualInputs ?? []).filter((entry) => entry.kind !== "full-page"),
      ].slice(0, 4);
  const images: Array<{ base64: string; mimeType: string }> = [];
  for (const entry of ordered) {
    const body = await getObject(env, entry.artifact);
    if (!body) continue;
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    images.push({ base64: bytesToBase64(bytes), mimeType: mimeForKey(entry.artifact) });
  }
  if (!isOriginalDesign && images.length === 0) {
    throw new SimpleDesignBlueprintError("NO_VISUAL_INPUT", "Reference visual inputs could not be loaded from storage");
  }

  const generate: RawAiGenerate =
    // Coding Plan transport (GO 2026-09-11): json_object mode; the response
  // shape travels in the boundary's prose output contract — the Coding Plan
  // endpoint does NOT enforce native response_format json_schema (live
  // end-to-end evidence 2026-09-11: schemaignored, v1-shaped output).
  input.generate ?? createSimpleVisionGenerate(env, images, { buildId: input.buildId, stage: stageKey, buildVersionNumber: input.buildVersionNumber }, { maxTokens: 12288, temperature: 0.3 });

  let run;
  try {
    run = await runSchemaValidatedAiStage<unknown>(env, {
      stage: stageKey,
      schema: DesignBlueprintV2Schema,
      schemaVersion: DESIGN_BLUEPRINT_V2_SCHEMA_VERSION,
      userPrompt: isOriginalDesign ? buildOriginalBlueprintUserPrompt(input) : buildBlueprintUserPrompt(input),
      buildId: input.buildId,
      siteGenerationId: input.siteGenerationId,
      buildVersionId: input.buildVersionId,
      buildVersionNumber: input.buildVersionNumber,
      // Reference mode: the sha256 of each attached visual. ORIGINAL_DESIGN:
      // the frozen creative-direction checksum is the sole external input
      // identity (GO §30 provenance).
      inputArtifactIds: isOriginalDesign ? [input.originalDesign!.creativeDirectionSha256] : ordered.map((entry) => entry.sha256),
      generate,
      // json_object rides response_format; the JSON Schema itself travels in
      // the boundary's prose output contract (Coding Plan evidence above).
    });
  } catch (error) {
    // The boundary already spent its ONE targeted structural repair (spec
    // section 30) — a persisting schema failure is a review escalation, not a
    // retry storm.
    if (error instanceof AiStageSchemaInvalidError) {
      throw new SimpleDesignBlueprintError("SCHEMA_INVALID", error.message);
    }
    throw error;
  }

  const validated = validateDesignBlueprintV2(run.value);
  if (!validated.valid) {
    throw new SimpleDesignBlueprintError("SCHEMA_INVALID", `design blueprint failed schema validation: ${validated.errors}`);
  }
  // design-blueprint/2 has NO hero-link canonicalization: the schema
  // structurally requires every page hero and its image brief, and identity
  // (slot ids, page ownership, priority) is deterministic domain
  // construction. There is no referential lottery left to repair. The
  // model's raw output stays preserved in the ai-stage run artifact
  // (ai_stage_runs.artifact_r2_key).
  const blueprint = validated.value;

  const gate = evaluateBlueprintQualityGateV2(blueprint);
  if (!gate.passed) {
    throw new SimpleDesignBlueprintError(
      "QUALITY_GATE_FAILED",
      `design blueprint failed the deterministic quality gate: ${gate.failures.join("; ")}`
    );
  }

  const stored = await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "design_blueprint",
    schemaVersion: DESIGN_BLUEPRINT_V2_SCHEMA_VERSION,
    value: blueprint,
    provenance: run.provenance,
  });

  const markdownKeyFinal = markdownKey(input.buildId, input.buildVersionNumber);
  await putImmutableObjectTolerant(env, markdownKeyFinal, renderDesignBlueprintV2Markdown(blueprint), {
    httpMetadata: { contentType: "text/markdown" },
  });

  return {
    blueprint,
    schemaVersion: DESIGN_BLUEPRINT_V2_SCHEMA_VERSION,
    artifactR2Key: stored.artifactR2Key,
    markdownR2Key: markdownKeyFinal,
    provenance: run.provenance,
    attempts: run.attempts,
    heroMediaLinkCanonicalization: { applied: false, links: [] },
  };
}

function markdownKey(buildId: string, buildVersionNumber: number): string {
  return `${buildVersionRoot(buildId, buildVersionNumber)}/design-blueprint/DESIGN-BLUEPRINT.md`;
}

// Re-narrow the loose provenance record back to the canonicalization type; unknown
// entries are dropped, never guessed.
const ROUTED_PAGES = new Set(["home", "about", "services", "contact"]);
function storedHeroLinkCanonicalization(provenance: AiProvenance | null): HeroMediaLinkCanonicalization {
  const recorded = provenance?.heroMediaLinkCanonicalization;
  if (!recorded?.applied || !Array.isArray(recorded.links)) return { applied: false, links: [] };
  const links: HeroMediaLinkCanonicalizationEntry[] = [];
  for (const link of recorded.links) {
    if (typeof link === "object" && link !== null && ROUTED_PAGES.has(link.page) && typeof link.resolved === "string" && link.reason === "UNIQUE_PAGE_HERO_SLOT") {
      links.push({ page: link.page as HeroMediaLinkCanonicalizationEntry["page"], supplied: link.supplied ?? null, resolved: link.resolved, reason: "UNIQUE_PAGE_HERO_SLOT" });
    }
  }
  return links.length > 0 ? { applied: true, links } : { applied: false, links: [] };
}

function isDesignBlueprintV2Artifact(value: unknown): value is DesignBlueprintV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === "2" &&
    (value as { imagery?: { pageHeroes?: unknown } }).imagery?.pageHeroes !== undefined
  );
}

// Explicit compat seam (GO section 17): historical design-blueprint/1
// artifacts resume through storedBlueprintToV2; unexpected shapes refuse
// loudly instead of flowing garbage downstream. The reported canonicalization
// is the one recorded on the STORED artifact's provenance (v1-era), never a
// new transformation.
function adaptStoredV1Blueprint(value: unknown, provenance: AiProvenance | null): { blueprint: DesignBlueprintV2; canonicalization: HeroMediaLinkCanonicalization } {
  try {
    return { blueprint: storedBlueprintToV2(value as never), canonicalization: storedHeroLinkCanonicalization(provenance) };
  } catch (error) {
    throw new SimpleDesignBlueprintError("QUALITY_GATE_FAILED", `stored design-blueprint/1 artifact could not be resumed: ${(error as Error).message}`);
  }
}
