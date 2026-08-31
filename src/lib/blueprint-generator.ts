import type { Env } from "../env.d";
import type {
  BlueprintPair,
  BlueprintReviewIssue,
  BlueprintValidationResult,
  DesignBlueprint,
  GatewayMeta,
  InteractionBlueprint,
  EvidenceInteractionManifest,
  InteractionManifest,
  ReferenceCaptureManifest,
} from "../types";
import { generateWithGateway } from "./ai-gateway";
import { putObject } from "./assets";
import { designBlueprintKey, interactionBlueprintKey, blueprintValidationKey } from "./assets";
import { upsertBlueprint } from "./db";
import { generateId, nowIso } from "./crypto";
import {
  BLUEPRINT_PROMPT_VERSION,
  BLUEPRINT_SCHEMA_VERSION,
  reviewBlueprints,
  validateBlueprints,
} from "./blueprint-schema";

export interface BlueprintClientFacts {
  companyName: string;
  businessType: string | null;
  businessDescription: string | null;
  idealClientProfile: string | null;
  mode: "light" | "dark";
}

export interface BlueprintInputs {
  jobId: string;
  siteId: string;
  clientSlug: string;
  styleKey: string;
  clientFacts: BlueprintClientFacts;
  captureManifest: ReferenceCaptureManifest | null;
  interactionManifest: InteractionManifest | EvidenceInteractionManifest | null;
  screenshotR2Key: string | null;
}

export interface GeneratedPair {
  design: DesignBlueprint;
  interaction: InteractionBlueprint;
  model: string | null;
}

export type BlueprintGenerateFn = (
  inputs: BlueprintInputs,
  attempt: number,
  priorFeedback: string[]
) => Promise<GeneratedPair>;

export type BlueprintPersistFn = (
  env: Env,
  inputs: BlueprintInputs,
  generated: GeneratedPair,
  validation: BlueprintValidationResult,
  reviewIssues: BlueprintReviewIssue[],
  attempt: number
) => Promise<void>;

export class BlueprintValidationError extends Error {
  validation: BlueprintValidationResult;
  reviewIssues: BlueprintReviewIssue[];
  constructor(validation: BlueprintValidationResult, reviewIssues: BlueprintReviewIssue[], attempts: number) {
    super(`Blueprint validation failed after ${attempts} attempt(s): ${validation.errors.length} error(s), ${reviewIssues.length} review issue(s)`);
    this.name = "BlueprintValidationError";
    this.validation = validation;
    this.reviewIssues = reviewIssues;
  }
}

const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;

export async function generateValidatedBlueprints(
  env: Env,
  inputs: BlueprintInputs,
  options?: {
    generate?: BlueprintGenerateFn;
    persist?: BlueprintPersistFn;
    maxRepairAttempts?: number;
  }
): Promise<BlueprintPair> {
  const generate = options?.generate ?? ((i, attempt, feedback) => generateViaGateway(env, i, attempt, feedback));
  const persist = options?.persist ?? ((e, i, g, v, r, a) => persistBlueprintArtifacts(e, i, g, v, r, a));
  const maxRepair = options?.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;

  let attempt = 0;
  let feedback: string[] = [];
  let lastValidation: BlueprintValidationResult = { valid: false, errors: [], rendererSpecificStrings: [] };
  let lastReview: BlueprintReviewIssue[] = [];
  let pair: GeneratedPair | null = null;

  for (attempt = 1; attempt <= maxRepair + 1; attempt++) {
    const generated = await generate(inputs, attempt, feedback);
    pair = generated;
    lastValidation = validateBlueprints(generated.design, generated.interaction);
    lastReview = reviewBlueprints(generated.design, generated.interaction);

    await persist(env, inputs, generated, lastValidation, lastReview, attempt);

    const blockingReview = lastReview.filter((r) => r.severity === "critical" || r.severity === "major");
    if (lastValidation.valid && blockingReview.length === 0) {
      return {
        design: generated.design,
        interaction: generated.interaction,
        validation: lastValidation,
        reviewIssues: lastReview,
        schemaVersion: BLUEPRINT_SCHEMA_VERSION,
        promptVersion: BLUEPRINT_PROMPT_VERSION,
        model: generated.model,
        attempts: attempt,
      };
    }

    feedback = [
      ...lastValidation.errors.map((e) => `[${e.severity}] ${e.code}: ${e.message} (${e.path})`),
      ...lastValidation.rendererSpecificStrings.map((s) => `[critical] RENDERER_SPECIFIC: remove renderer-specific string '${s}'`),
      ...blockingReview.map((r) => `[${r.severity}] ${r.category}: ${r.message}`),
    ];
  }

  void pair;
  throw new BlueprintValidationError(lastValidation, lastReview, attempt - 1);
}

function buildSystemPrompt(referenceAccessible: boolean): string {
  return [
    "You generate renderer-independent design and interaction blueprints for a website builder.",
    "Output STRICT JSON with exactly two top-level keys: \"design\" and \"interaction\".",
    `Both must set schemaVersion to ${BLUEPRINT_SCHEMA_VERSION}.`,
    "Blueprints MUST be semantic and renderer-independent: never include Tailwind utility classes, shadcn references, React/JSX, className, or any style-package key (e.g. minimalist-monochrome).",
    "Every material decision (sections, color roles, typography specs, interactions) MUST carry an evidence object with source one of: capture, interaction, screenshot, client_facts.",
    "Every material decision MUST carry a numeric confidence between 0 and 1.",
    "The interaction blueprint MUST define a top-level reducedMotionStrategy and every interaction MUST include a non-empty reducedMotionBehavior.",
    "Every interaction MUST set observed (boolean) to reflect whether the behavior was observed on the live reference or inferred.",
    referenceAccessible
      ? "The live reference was reachable; prefer evidence from the capture."
      : "The live reference was NOT reachable; derive the blueprint from the supplied screenshot and client facts, mark evidence source as screenshot or client_facts, and set confidence below 0.6.",
    "Color values must be hex (#rgb or #rrggbb) or rgb()/hsl() functions.",
    "Section types are semantic (hero, features, about, services, stats, testimonials, cta, contact, footer, navigation).",
    "Icon intent is semantic only (education, health, community, location, contact, security, growth, support, accessibility).",
  ].join(" ");
}

function summarizeInputs(inputs: BlueprintInputs): string {
  const capture = inputs.captureManifest;
  const interaction = inputs.interactionManifest;
  const refAccessible = !!capture && capture.overallStatus !== "failed";

  const sections = capture?.viewports
    .find((v) => v.viewport.name === "desktop")?.sections
    .map((s) => `${s.tag}(${s.role ?? "-"}):${s.heading ?? ""}`)
    .slice(0, 12) ?? [];
  const colors = capture?.viewports
    .find((v) => v.viewport.name === "desktop")?.colors ?? null;
  const nav = capture?.viewports
    .find((v) => v.viewport.name === "desktop")?.nav
    .map((n) => n.text ?? n.href)
    .slice(0, 10) ?? [];
  const interactions = interaction?.viewports
    .find((v) => v.viewport.name === "desktop" && (!("motionMode" in v) || v.motionMode === "default"))?.observations
    .slice(0, 20)
    .map((o) => {
      const classification = "classification" in o
        ? o.classification
        : o.observed
          ? "observed"
          : "inferred";
      return `${o.trigger}:${o.selector} dur=${o.duration ?? "-"} classification=${classification}`;
    }) ?? [];
  const reducedMotion = interaction?.viewports.some((v) =>
    "motionMode" in v ? v.motionMode === "reduced" : v.reducedMotionDetected
  ) ?? false;

  return JSON.stringify({
    client: inputs.clientFacts,
    styleKey: inputs.styleKey,
    referenceAccessible: refAccessible,
    referenceUrl: inputs.captureManifest?.referenceUrl ?? null,
    finalUrl: inputs.captureManifest?.finalUrl ?? null,
    screenshotAvailable: !!inputs.screenshotR2Key,
    captureStatus: capture?.overallStatus ?? null,
    desktopSections: sections,
    desktopColors: colors,
    desktopNav: nav,
    desktopInteractions: interactions,
    reducedMotionDetected: reducedMotion,
    responsiveDiffs: capture?.responsiveDiffs.slice(0, 8) ?? [],
  }, null, 2);
}

export async function generateViaGateway(
  env: Env,
  inputs: BlueprintInputs,
  attempt: number,
  priorFeedback: string[]
): Promise<GeneratedPair> {
  const referenceAccessible = !!inputs.captureManifest && inputs.captureManifest.overallStatus !== "failed";
  const systemPrompt = buildSystemPrompt(referenceAccessible);
  const userPrompt = [
    "Generate the design and interaction blueprints from the following evidence.",
    `Attempt ${attempt}.`,
    priorFeedback.length > 0 ? `Previous attempt problems to fix:\n${priorFeedback.map((f) => `- ${f}`).join("\n")}` : "",
    "Evidence summary:",
    summarizeInputs(inputs),
  ].filter(Boolean).join("\n\n");

  const meta: GatewayMeta = {
    job_id: inputs.jobId,
    site_id: inputs.siteId,
    client_slug: inputs.clientSlug,
    prompt_type: "blueprint_generation",
    style_key: inputs.styleKey,
  };

  const response = await generateWithGateway(env, systemPrompt, userPrompt, meta, {
    temperature: 0.4,
    maxTokens: 8192,
    jsonMode: true,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Blueprint generation returned empty content");

  return parseGeneratedPair(content);
}

export function parseGeneratedPair(content: string): GeneratedPair {
  const cleaned = content.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { design: DesignBlueprint; interaction: InteractionBlueprint };
  if (!parsed.design || !parsed.interaction) {
    throw new Error("Blueprint JSON missing 'design' or 'interaction' key");
  }
  parsed.design.schemaVersion = 1;
  parsed.interaction.schemaVersion = 1;
  return { design: parsed.design, interaction: parsed.interaction, model: null };
}

async function persistBlueprintArtifacts(
  env: Env,
  inputs: BlueprintInputs,
  generated: GeneratedPair,
  validation: BlueprintValidationResult,
  reviewIssues: BlueprintReviewIssue[],
  attempt: number
): Promise<void> {
  const designKey = designBlueprintKey(inputs.clientSlug, 1);
  const interactionKey = interactionBlueprintKey(inputs.clientSlug, 1);
  const validationKey = blueprintValidationKey(inputs.clientSlug, 1);

  await putObject(env, designKey, JSON.stringify(generated.design, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  await putObject(env, interactionKey, JSON.stringify(generated.interaction, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  await putObject(env, validationKey, JSON.stringify({ validation, reviewIssues, attempt }, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  const baseRow = {
    job_id: inputs.jobId,
    client_slug: inputs.clientSlug,
    site_version: 1,
    schema_version: BLUEPRINT_SCHEMA_VERSION,
    prompt_version: BLUEPRINT_PROMPT_VERSION,
    model: generated.model,
    validation_valid: validation.valid ? 1 : 0,
    validation_errors: JSON.stringify(validation.errors),
    review_issues: JSON.stringify(reviewIssues),
    status: validation.valid ? "valid" : "invalid",
    created_at: nowIso(),
  };

  await upsertBlueprint(env.DB, {
    ...baseRow,
    id: generateId(),
    kind: "design",
    r2_key: designKey,
    confidence: typeof generated.design.confidence === "number" ? generated.design.confidence : null,
  });
  await upsertBlueprint(env.DB, {
    ...baseRow,
    id: generateId(),
    kind: "interaction",
    r2_key: interactionKey,
    confidence: typeof generated.interaction.confidence === "number" ? generated.interaction.confidence : null,
  });
}
