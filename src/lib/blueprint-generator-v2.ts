// Phase 16.R4: immutable, bounded, screenshot-grounded blueprint generator.
//
// Replaces the weak Phase 16.4 path. Each generation/repair attempt is
// immutable (its own attempt id + R2 prefix + D1 row). The generator:
//   1. Builds a bounded prompt input from the evidence registry.
//   2. Calls the model through AI Gateway (provider/model captured).
//   3. Parses into unknown JSON (no type casts, no schemaVersion rewrite).
//   4. Runtime schema validation (TypeBox).
//   5. Provenance validation (evidence ids resolve to the registry).
//   6. Review.
//   7. On failure, feeds structured diagnostics back as repair guidance and
//      tries again with a NEW attempt id (bounded). Each attempt is persisted
//      immutably; earlier attempts are never overwritten.
//   8. On acceptance (runtime + provenance valid, no blocking/major review),
//      promote the accepted pointer — only if newer.
//   9. On repair-limit exhaustion, mark the final attempt failed, leave the
//      accepted pointer unchanged, and stop before rendering.

import type { Env } from "../env.d";
import type { GatewayMeta } from "../types";
import type {
  BlueprintRuntimeValidation,
  BlueprintReviewResult,
  DesignBlueprintV2,
  EvidenceRegistry,
  InteractionBlueprintV2,
} from "./blueprint-schema-v2";
import { BLUEPRINT_PROMPT_VERSION_V2, BLUEPRINT_SCHEMA_VERSION_V2 } from "./blueprint-schema-v2";
import { renderableInteractionPairsDescription } from "./renderable-interactions";
import {
  decideAcceptance,
  parseBlueprintJson,
  BlueprintParseError,
  validateProvenance,
  validateRuntime,
  reviewBlueprints,
  type AcceptanceDecision,
  type BlueprintPairV2,
  type ProvenanceResult,
} from "./blueprint-validation";
import { generateWithGatewayDetailed } from "./ai-gateway";
import {
  blueprintAttemptDesignKey,
  blueprintAttemptInteractionKey,
  blueprintAttemptPromptInputKey,
  blueprintAttemptReviewKey,
  blueprintAttemptValidationKey,
  putObject,
} from "./assets";
import {
  completeBlueprintAttempt,
  createBlueprintAttempt,
  promoteBlueprintAttempt,
} from "./db";
import { generateId, nowIso } from "./crypto";

export interface GenerateBlueprintsParams {
  jobId: string;
  siteId: string;
  clientSlug: string;
  siteVersion: number;
  referenceUrl?: string;
  registryId: string;
  registryR2Key: string;
  registry: EvidenceRegistry;
}

export interface AttemptOutcome {
  attemptId: string;
  attemptNumber: number;
  accepted: boolean;
  pair: BlueprintPairV2 | null;
  runtime: BlueprintRuntimeValidation | null;
  provenance: ProvenanceResult | null;
  review: BlueprintReviewResult | null;
  decision: AcceptanceDecision | null;
  failureCode: string | null;
  failureDiagnostics: string | null;
  provider: string | null;
  model: string | null;
}

export interface GenerateBlueprintsResult {
  attempts: AttemptOutcome[];
  accepted: AttemptOutcome | null;
  failureCode: string | null;
}

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;

export class BlueprintGenerationFailedError extends Error {
  result: GenerateBlueprintsResult;
  constructor(message: string, result: GenerateBlueprintsResult) {
    super(message);
    this.name = "BlueprintGenerationFailedError";
    this.result = result;
  }
}

export type BlueprintGenerateRawFn = (
  env: Env,
  params: GenerateBlueprintsParams,
  attempt: number,
  priorFeedback: string[]
) => Promise<{ content: string; provider: string; model: string }>;

// ── Bounded prompt input ────────────────────────────────────────────────────
export function buildBoundedPromptInput(registry: EvidenceRegistry, registryR2Key: string): Record<string, unknown> {
  const bySource = new Map<string, typeof registry.entries>();
  for (const e of registry.entries) {
    const arr = bySource.get(e.source) ?? [];
    arr.push(e);
    bySource.set(e.source, arr);
  }
  const cap = (arr: typeof registry.entries, n: number) => arr.slice(0, n).map((e) => ({
    id: e.id, source: e.source, viewport: e.viewport ?? null,
    selector: e.selector ?? null, classification: e.classification,
    artifactKey: e.artifactKey, screenshotRegion: e.screenshotRegion ?? null,
    observation: e.observation, confidence: e.confidence,
  }));
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION_V2,
    registryVersion: registry.registryVersion,
    registryR2Key,
    screenshot: cap(bySource.get("screenshot") ?? [], 12),
    capture: cap(bySource.get("capture") ?? [], 16),
    interaction: cap(bySource.get("interaction") ?? [], 12),
    clientFacts: cap(bySource.get("client_facts") ?? [], 6),
    note: "Every material decision MUST cite evidenceIds above and mirror the first cited entry in its evidence object.",
  };
}

export function buildEvidenceRefTemplates(registry: EvidenceRegistry): Record<string, Record<string, unknown>> {
  return Object.fromEntries(registry.entries.map((entry) => [entry.id, {
    source: entry.source,
    artifactKey: entry.artifactKey,
    ...(entry.viewport === undefined ? {} : { viewport: entry.viewport }),
    ...(entry.selector === undefined ? {} : { selector: entry.selector }),
    ...(entry.screenshotRegion === undefined ? {} : { screenshotRegion: entry.screenshotRegion }),
  }]));
}

export function buildSystemPrompt(): string {
  return [
    "You generate renderer-independent design and interaction blueprints for a website builder.",
    "Output STRICT JSON with exactly two top-level keys: \"design\" and \"interaction\".",
    `Both must set schemaVersion to exactly ${BLUEPRINT_SCHEMA_VERSION_V2}.`,
    "Blueprints MUST be semantic and renderer-independent: never include Tailwind utility classes, shadcn references, React/JSX, className, or any style-package key (e.g. minimalist-monochrome).",
    "Every material decision (sections, typography, color roles, spacing, surfaces, icons, interactions) MUST carry an evidenceIds array referencing ids from the supplied registry, plus an evidence object and a numeric confidence between 0 and 1.",
    "The evidence object MUST exactly mirror the source, artifactKey, viewport, selector, and screenshotRegion of the first entry in evidenceIds; omit only optional fields that are absent from that registry entry.",
    "Never emit null for any string field. For evidence.viewport, evidence.selector, evidence.screenshotR2Key, and evidence.screenshotRegion, omit the key entirely when the cited registry entry does not provide it; never use null. The only nullable fields are design.source.finalUrl, design.source.captureManifestR2Key, design.source.interactionManifestR2Key, design.source.screenshotR2Key, and design.layout.sections[].role.",
    "For every evidenceIds[0], copy the exact matching object from the Canonical evidence references map into evidence. Include every key that map contains and no key it omits. Never infer, shorten, or substitute a viewport, selector, artifact key, or screenshot region.",
    "design.source MUST include registryR2Key and registryVersion from the supplied registry.",
    "The interaction blueprint MUST define a top-level reducedMotionStrategy and every interaction MUST include a non-empty reducedMotionBehavior and a boolean observed reflecting whether the behavior was observed (true) or inferred (false).",
    `Interaction selectors are fixed renderer capability labels, not selectors copied from the reference site. Use only these exact trigger and selector pairs: ${renderableInteractionPairsDescription()}. Omit an interaction that cannot use one of these pairs. Never use data-cf-evidence-id selectors or reference-site-only controls.`,
    "interaction.interactions MUST include focus, hover, and scroll-reveal items. Use focus on .btn, hover on .btn or .card, and scroll-reveal on [data-reveal]. When a behavior was not captured live, add a restrained inferred interaction with observed false and inferred interaction evidence. The fallback must still provide visible focus, relevant hover feedback, button active feedback through the hover item, and section reveal motion. Every imagery subject must describe a natural editorial photographic scene, never a website, interface, screen, mockup, poster, collage, infographic, or text-bearing composition.",
    "Observed interactions must reference interaction evidence with classification 'observed'; inferred ones reference inferred evidence.",
    "Do NOT claim screenshot grounding unless you cite a screenshot: evidence id.",
    "Color values must be hex (#rgb or #rrggbb) or rgb()/hsl() functions.",
    "Section types are semantic (hero, features, about, services, stats, testimonials, cta, contact, footer, navigation).",
    "design.layout.sections MUST contain at least 3 items. Their order values must be distinct non-negative integers beginning at 0 and increasing without gaps (0, 1, 2, ...).",
    "design.typography.headings MUST contain exactly one h1 item.",
    "design.imagery.slots MUST be an evidence-backed page plan with at least 3 slots for /, 3 for /services, 1 for /about, and 1 for /contact. Every page must have one hero placement; additional slots use section placement. Subjects must be relevant to client facts, contain no invented claims, and use the reference only for visual treatment.",
    "Use this exact object shape. Do not rename, omit, flatten, or replace any listed key: " + JSON.stringify({
      design: {
        schemaVersion: 1,
        source: { referenceUrl: "string", finalUrl: null, captureManifestR2Key: null, interactionManifestR2Key: null, screenshotR2Key: null, registryR2Key: "exact registry key", registryVersion: 1 },
        layout: { navStyle: "string", footerStyle: "string", gridSystem: "string", sections: [{ id: "string", type: "hero", role: null, order: 0, composition: "string", evidenceIds: ["registry id"], evidence: { source: "screenshot", artifactKey: "exact artifact key" }, confidence: 0.9 }] },
        typography: { body: { element: "body", fontFamily: "string", fontSize: "string", fontWeight: "string", lineHeight: "string", evidenceIds: ["registry id"], evidence: { source: "screenshot", artifactKey: "exact artifact key" }, confidence: 0.9 }, headings: [{ element: "h1", fontFamily: "string", fontSize: "string", fontWeight: "string", lineHeight: "string", evidenceIds: ["registry id"], evidence: { source: "screenshot", artifactKey: "exact artifact key" }, confidence: 0.9 }], scale: "string" },
        colors: { roles: [{ role: "primary", value: "#000000", evidenceIds: ["registry id"], evidence: { source: "screenshot", artifactKey: "exact artifact key" }, confidence: 0.9 }] },
        spacing: { sectionPadding: "string", rhythm: "string", evidenceIds: ["registry id"], evidence: { source: "screenshot", artifactKey: "exact artifact key" }, confidence: 0.9 },
        surfaces: { cards: "string", buttons: "string", inputs: "string", evidenceIds: ["registry id"], evidence: { source: "screenshot", artifactKey: "exact artifact key" }, confidence: 0.9 },
        imagery: { treatment: "string", slots: [{ id: "home-hero", page: "/", placement: "hero", aspectRatio: "16:9", subject: "client-relevant visual subject", evidenceIds: ["registry id"], evidence: { source: "screenshot", artifactKey: "exact artifact key" }, confidence: 0.9 }] },
        navigation: { structure: "string", items: ["Home"], responsiveBehavior: "string" },
        responsive: { breakpoints: [768], changes: ["string"] },
        icons: { intents: [{ slot: "service-1", intent: "community", evidenceIds: ["registry id"], evidence: { source: "screenshot", artifactKey: "exact artifact key" }, confidence: 0.9 }] },
        confidence: 0.9,
      },
      interaction: {
        schemaVersion: 1,
        source: { registryR2Key: "exact registry key", registryVersion: 1 },
        interactions: [{ trigger: "hover", target: "card", selector: ".card", property: "transform", duration: "180ms", easing: "ease-out", delay: "0ms", hover: "translateY(-2px)", focus: "visible focus ring", active: "translateY(0)", scrollBehavior: "none", reducedMotionBehavior: "remove transform", observed: false, evidenceIds: ["registry id"], evidence: { source: "screenshot", artifactKey: "exact artifact key" }, confidence: 0.9 }],
        reducedMotionStrategy: "Remove transform motion and retain visible state changes.",
        confidence: 0.9,
      },
    }),
  ].join(" ");
}

// ── Default gateway generation fn ───────────────────────────────────────────
export const defaultGenerateRaw: BlueprintGenerateRawFn = async (env, params, attempt, priorFeedback) => {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = [
    "Generate the design and interaction blueprints from the following evidence registry.",
    `Attempt ${attempt}.`,
    `Set design.source.referenceUrl to this exact value: ${JSON.stringify(params.referenceUrl ?? "https://reference.invalid/")}.`,
    priorFeedback.length > 0 ? `Previous attempt problems to fix:\n${priorFeedback.map((f) => `- ${f}`).join("\n")}` : "",
    "Canonical evidence references (copy the matching value exactly into each evidence object):",
    JSON.stringify(buildEvidenceRefTemplates(params.registry)),
    "Registry:",
    JSON.stringify(buildBoundedPromptInput(params.registry, params.registryR2Key), null, 2),
  ].filter(Boolean).join("\n\n");

  const meta: GatewayMeta = {
    job_id: params.jobId,
    site_id: params.siteId,
    client_slug: params.clientSlug,
    prompt_type: "blueprint_generation",
    style_key: "reference-driven",
  };

  const result = await generateWithGatewayDetailed(env, systemPrompt, userPrompt, meta, {
    temperature: 0.4,
    maxTokens: 8192,
    jsonMode: true,
  });
  const content = result.response.choices[0]?.message?.content;
  if (!content) throw new Error("Blueprint generation returned empty content");
  return { content, provider: result.provider, model: result.model };
};

// ── Persist one attempt immutably ───────────────────────────────────────────
async function persistAttempt(
  env: Env,
  params: GenerateBlueprintsParams,
  outcome: AttemptOutcome,
  design: unknown,
  interaction: unknown,
  promptInput: Record<string, unknown>
): Promise<void> {
  const designKey = blueprintAttemptDesignKey(params.clientSlug, params.siteVersion, outcome.attemptId);
  const interactionKey = blueprintAttemptInteractionKey(params.clientSlug, params.siteVersion, outcome.attemptId);
  const validationKey = blueprintAttemptValidationKey(params.clientSlug, params.siteVersion, outcome.attemptId);
  const reviewKey = blueprintAttemptReviewKey(params.clientSlug, params.siteVersion, outcome.attemptId);
  const promptInputKey = blueprintAttemptPromptInputKey(params.clientSlug, params.siteVersion, outcome.attemptId);

  await putObject(env, designKey, JSON.stringify(design, null, 2), { httpMetadata: { contentType: "application/json" } });
  await putObject(env, interactionKey, JSON.stringify(interaction, null, 2), { httpMetadata: { contentType: "application/json" } });
  await putObject(env, validationKey, JSON.stringify({ runtime: outcome.runtime, provenance: outcome.provenance }, null, 2), { httpMetadata: { contentType: "application/json" } });
  await putObject(env, reviewKey, JSON.stringify(outcome.review, null, 2), { httpMetadata: { contentType: "application/json" } });
  await putObject(env, promptInputKey, JSON.stringify(promptInput, null, 2), { httpMetadata: { contentType: "application/json" } });

  await createBlueprintAttempt(env.DB, {
    id: outcome.attemptId,
    registry_id: params.registryId,
    job_id: params.jobId,
    client_slug: params.clientSlug,
    site_version: params.siteVersion,
    attempt_number: outcome.attemptNumber,
    schema_version: BLUEPRINT_SCHEMA_VERSION_V2,
    prompt_version: BLUEPRINT_PROMPT_VERSION_V2,
    provider: outcome.provider,
    model: outcome.model,
    design_r2_key: designKey,
    interaction_r2_key: interactionKey,
    validation_r2_key: validationKey,
    review_r2_key: reviewKey,
    prompt_input_r2_key: promptInputKey,
    overall_confidence: outcome.pair ? (outcome.pair.design.confidence + outcome.pair.interaction.confidence) / 2 : null,
    status: outcome.accepted ? "accepted" : outcome.failureCode ? "failed" : "generated",
    failure_code: outcome.failureCode,
    failure_diagnostics: outcome.failureDiagnostics,
    started_at: nowIso(),
    completed_at: nowIso(),
    created_at: nowIso(),
  });
}

function diagnosticsToFeedback(runtime: BlueprintRuntimeValidation | null, provenance: ProvenanceResult | null, review: BlueprintReviewResult | null): string[] {
  const out: string[] = [];
  if (runtime) {
    out.push(...runtime.diagnostics.map((d) => `[${d.severity}] ${d.code}: ${d.message} (${d.path})`));
    out.push(...runtime.rendererSpecificStrings.map((s) => `[blocking] RENDERER_SPECIFIC: remove renderer-specific string '${s.slice(0, 60)}'`));
  }
  if (provenance) out.push(...provenance.diagnostics.map((d) => `[${d.severity}] ${d.code}: ${d.message} (${d.path})`));
  if (review) out.push(...review.findings.filter((f) => f.severity === "blocking" || f.severity === "major").map((f) => `[${f.severity}] ${f.category}: ${f.message}`));
  return out;
}

// ── Orchestrator ────────────────────────────────────────────────────────────
export async function generateValidatedBlueprintsV2(
  env: Env,
  params: GenerateBlueprintsParams,
  options?: { generate?: BlueprintGenerateRawFn; maxRepairAttempts?: number }
): Promise<GenerateBlueprintsResult> {
  const generate = options?.generate ?? defaultGenerateRaw;
  const maxRepair = options?.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;

  const attempts: AttemptOutcome[] = [];
  let feedback: string[] = [];
  let accepted: AttemptOutcome | null = null;

  for (let attemptNumber = 1; attemptNumber <= maxRepair + 1; attemptNumber++) {
    const attemptId = generateId();
    const outcome: AttemptOutcome = {
      attemptId, attemptNumber, accepted: false, pair: null,
      runtime: null, provenance: null, review: null, decision: null,
      failureCode: null, failureDiagnostics: null, provider: null, model: null,
    };

    let rawDesign: unknown = null;
    let rawInteraction: unknown = null;

    try {
      const gen = await generate(env, params, attemptNumber, feedback);
      outcome.provider = gen.provider;
      outcome.model = gen.model;
      const parsed = parseBlueprintJson(gen.content);
      rawDesign = parsed.design;
      rawInteraction = parsed.interaction;

      const runtime = validateRuntime(rawDesign, rawInteraction);
      outcome.runtime = runtime;

      let provenance: ProvenanceResult | null = null;
      let review: BlueprintReviewResult | null = null;
      let pair: BlueprintPairV2 | null = null;

      if (runtime.valid) {
        pair = { design: rawDesign as DesignBlueprintV2, interaction: rawInteraction as InteractionBlueprintV2 };
        provenance = validateProvenance(pair.design, pair.interaction, params.registry, params.registryR2Key);
        outcome.provenance = provenance;
        if (provenance.valid) {
          review = reviewBlueprints(pair.design, pair.interaction);
          outcome.review = review;
        }
      }

      const decision = decideAcceptance(runtime, provenance ?? { valid: false, diagnostics: [] }, review ?? { findings: [] });
      outcome.decision = decision;
      outcome.pair = pair;

      await persistAttempt(env, params, outcome, rawDesign, rawInteraction, buildBoundedPromptInput(params.registry, params.registryR2Key));
      attempts.push(outcome);

      if (decision.accept && pair) {
        const promoted = await promoteBlueprintAttempt(env.DB, attemptId, nowIso());
        outcome.accepted = promoted;
        if (promoted) {
          accepted = outcome;
          await completeBlueprintAttempt(env.DB, attemptId, { status: "accepted", overallConfidence: outcome.pair ? (outcome.pair.design.confidence + outcome.pair.interaction.confidence) / 2 : null, completedAt: nowIso() });
          return { attempts, accepted, failureCode: null };
        }
      }

      feedback = diagnosticsToFeedback(runtime, provenance, review);
    } catch (err) {
      outcome.failureCode = err instanceof BlueprintParseError ? "PARSE_ERROR" : "GENERATION_ERROR";
      outcome.failureDiagnostics = err instanceof BlueprintParseError
        ? JSON.stringify(err.diagnostics)
        : JSON.stringify([{ message: err instanceof Error ? err.message : String(err) }]);
      await persistAttempt(env, params, outcome, rawDesign, rawInteraction, buildBoundedPromptInput(params.registry, params.registryR2Key));
      attempts.push(outcome);
      feedback = err instanceof BlueprintParseError
        ? err.diagnostics.map((d) => `[${d.severity}] ${d.code}: ${d.message} (${d.path})`)
        : [`[blocking] GENERATION_ERROR: ${err instanceof Error ? err.message : String(err)}`];
    }
  }

  // Repair limit exhausted: mark the final attempt failed, do not promote.
  const last = attempts[attempts.length - 1];
  if (last) {
    await completeBlueprintAttempt(env.DB, last.attemptId, {
      status: "failed",
      overallConfidence: null,
      completedAt: nowIso(),
      failureCode: "REPAIR_LIMIT_EXHAUSTED",
      failureDiagnostics: JSON.stringify({ feedback }),
    });
    last.failureCode = "REPAIR_LIMIT_EXHAUSTED";
    last.failureDiagnostics = JSON.stringify({ feedback });
  }

  return { attempts, accepted: null, failureCode: "REPAIR_LIMIT_EXHAUSTED" };
}
