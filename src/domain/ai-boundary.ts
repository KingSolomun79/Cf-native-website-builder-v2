// V2 AI boundary (issue #6, PRD sections 19-21).
//
// Every V2 AI stage executes through this boundary:
//
//   model result -> parse -> runtime validate against a versioned schema
//     -> valid: continue
//     -> invalid: ONE targeted structural repair attempt
//     -> still invalid: fail the stage
//
// Malformed output can never propagate downstream as a valid artifact. Each
// attempt persists prompt/model/schema provenance; the accepted output is
// persisted as an immutable R2 artifact under builds/{buildId}/v{n}/ai/.

import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../env.d";
import { generateWithGatewayDetailed, repairTruncatedJson } from "../lib/ai-gateway";
import { putImmutableObject } from "../lib/assets";
import { generateId, nowIso } from "../lib/crypto";
import { aiStageArtifactKey } from "./artifact-keys";
import { composeStagePrompt, type PromptStageKey } from "./prompt-contract";

// PRD section 21.
export interface AiProvenance {
  promptId: string;
  promptVersion: string;
  promptDomainContractVersion: string;
  model: string;
  schemaVersion: string;
  attempt: number;
  inputArtifactIds: string[];
  tokenUsage?: unknown;
  estimatedCost?: number;
  /** Issue #52: for informed regeneration artifacts (assembly repair), the
   *  sha256 of the full deterministic repair request (inputs + directives).
   *  Engine retries reuse a stored repair ONLY when this fingerprint matches
   *  the current request; a mismatch is terminal corruption, never a rewrite. */
  repairRequestFingerprint?: string;
  /** Issue #69 §19: WHY this repair exists — the deterministic finding ids
   *  that triggered it and the mutation authority granted. Provenance only;
   *  no raw prompt content. */
  repairTriggerFindingIds?: string[];
  repairScopeSummary?: string;
}

export interface RawAiGenerateResult {
  content: string;
  provider: string;
  model: string;
  tokenUsage?: unknown;
}

export type RawAiGenerate = (systemPrompt: string, userPrompt: string, attempt: number) => Promise<RawAiGenerateResult>;

export interface AiStageAttemptRecord {
  attempt: number;
  outcome: "valid" | "repaired" | "invalid";
  errorSummary: string | null;
}

export interface AiStageRunResult<T> {
  value: T;
  runId: string;
  artifactR2Key: string;
  provenance: AiProvenance;
  attempts: AiStageAttemptRecord[];
}

export class AiStageSchemaInvalidError extends Error {
  constructor(
    readonly stage: string,
    readonly runId: string,
    readonly attempts: AiStageAttemptRecord[]
  ) {
    super(
      `AI stage '${stage}' produced schema-invalid output after ${attempts.length} attempt(s) (run ${runId}); no artifact was persisted`
    );
    this.name = "AiStageSchemaInvalidError";
  }
}

// ── Parsing ─────────────────────────────────────────────────────────────────

export function parseModelJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // fall through to prose/markdown extraction
  }
  // Models frequently wrap the JSON object in headings or prose (a markdown
  // title before the payload, "Here is the JSON:" around it, no code fence).
  // Extract the outermost brace span before any truncation repair.
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const span = text.slice(firstBrace, lastBrace + 1);
    try {
      return { ok: true, value: JSON.parse(span) };
    } catch {
      try {
        return { ok: true, value: JSON.parse(repairTruncatedJson(span)) };
      } catch {
        // fall through to repairing the whole text
      }
    }
  }
  try {
    return { ok: true, value: JSON.parse(repairTruncatedJson(text)) };
  } catch (error) {
    return { ok: false, error: `unparseable JSON: ${(error as Error).message}` };
  }
}

// Models render absent optional properties as explicit nulls; the V2 stage
// schemas express absence through Optional (not nullable) properties. Strip
// nulls from parsed model output before validation so the common pattern
// validates instead of tripping "Expected string" on null.
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === null) continue;
      out[key] = stripNulls(entry);
    }
    return out;
  }
  return value;
}

// Same normalization philosophy for empty strings (issue #59, production
// evidence 2026-09-06: models rendered "no image role" as imageRoleId: ""
// against an Optional string). Absence — never "" — is the canonical
// representation of "not present"; stripping is not semantic fabrication,
// the model already said the field is empty.
function stripEmptyStrings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEmptyStrings);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === "") continue;
      out[key] = stripEmptyStrings(entry);
    }
    return out;
  }
  return value;
}

export function schemaErrorSummary(schema: TSchema, value: unknown): string {
  const issues: string[] = [];
  for (const error of Value.Errors(schema, value)) {
    issues.push(`${error.path}: ${error.message}`);
    if (issues.length >= 8) break;
  }
  return issues.join("; ") || "schema validation failed";
}

// ── Boundary runner ─────────────────────────────────────────────────────────

export interface RunSchemaValidatedAiStageOptions {
  stage: PromptStageKey;
  schema: TSchema;
  schemaVersion: string;
  userPrompt: string;
  buildId: string;
  siteGenerationId?: string;
  buildVersionId: string;
  buildVersionNumber: number;
  inputArtifactIds?: string[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  estimatedCostUsd?: number;
  generate?: RawAiGenerate;
}

export async function runSchemaValidatedAiStage<T>(
  env: Env,
  options: RunSchemaValidatedAiStageOptions
): Promise<AiStageRunResult<T>> {
  const composed = composeStagePrompt(options.stage);
  const runId = generateId();
  const inputArtifactIds = options.inputArtifactIds ?? [];
  const createdAt = nowIso();

  const generate: RawAiGenerate =
    options.generate ??
    (async (systemPrompt, userPrompt, attempt) => {
      const result = await generateWithGatewayDetailed(
        env,
        systemPrompt,
        userPrompt,
        {
          build_id: options.buildId,
          site_generation_id: options.siteGenerationId,
          build_version_id: options.buildVersionId,
          stage: options.stage,
          prompt_id: composed.promptId,
          prompt_version: composed.promptVersion,
          attempt,
        },
        {
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          jsonMode: true,
          model: options.model,
        }
      );
      return {
        content: result.response.choices[0]?.message?.content ?? "",
        provider: result.provider,
        model: result.model,
        tokenUsage: result.response.usage,
      };
    });

  const attempts: AiStageAttemptRecord[] = [];
  let accepted: { value: T; attempt: number; raw: RawAiGenerateResult } | null = null;

  // The output shape is governed by the stage's versioned runtime schema; the
  // boundary states it explicitly so the model's first answer already targets
  // the right object shape (live evidence, issue #30: without it the model
  // followed the legacy shape in the retained prompt body and needed the
  // repair attempt on every stage).
  const outputContract = `\n\n## Output contract\nReturn ONE JSON object that satisfies this JSON Schema exactly (no extra properties, every required property present, correct types). Do not wrap it in markdown or prose:\n${JSON.stringify(options.schema)}`;

  for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
    const userPrompt =
      attempt === 1
        ? options.userPrompt + outputContract
        : `${options.userPrompt}${outputContract}

## Targeted structural repair

Your previous response failed runtime schema validation:
${attempts[attempt - 2]?.errorSummary ?? "schema validation failed"}

Return ONLY the corrected JSON object. Do not change the semantic content beyond what the schema violation requires.`;

    const raw = await generate(composed.systemPrompt, userPrompt, attempt);
    const parsed = parseModelJson(raw.content);

    let outcome: AiStageAttemptRecord["outcome"];
    let errorSummary: string | null = null;
    let value: T | null = null;

    if (!parsed.ok) {
      outcome = "invalid";
      errorSummary = parsed.error;
    } else {
      const candidate = stripEmptyStrings(stripNulls(parsed.value));
      if (!Value.Check(options.schema, candidate)) {
        outcome = "invalid";
        errorSummary = schemaErrorSummary(options.schema, candidate);
      } else {
        value = candidate as T;
        outcome = attempt === 1 ? "valid" : "repaired";
      }
    }

    attempts.push({ attempt, outcome, errorSummary });

    await env.DB.prepare(
      `INSERT INTO ai_stage_runs (
         id, run_id, build_id, build_version_id, stage, prompt_id, prompt_version,
         prompt_domain_contract_version, model, provider, schema_version, attempt, outcome,
         token_usage_json, estimated_cost_usd, input_artifact_ids_json, artifact_r2_key, error_summary, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        generateId(),
        runId,
        options.buildId,
        options.buildVersionId,
        options.stage,
        composed.promptId,
        composed.promptVersion,
        composed.promptDomainContractVersion,
        raw.model,
        raw.provider,
        options.schemaVersion,
        attempt,
        outcome,
        raw.tokenUsage === undefined ? null : JSON.stringify(raw.tokenUsage),
        options.estimatedCostUsd ?? null,
        JSON.stringify(inputArtifactIds),
        value !== null ? aiStageArtifactKey(options.buildId, options.buildVersionNumber, options.stage, runId) : null,
        errorSummary,
        createdAt
      )
      .run();

    if (value !== null) {
      accepted = { value, attempt, raw };
    }
  }

  if (!accepted) {
    throw new AiStageSchemaInvalidError(options.stage, runId, attempts);
  }

  const provenance: AiProvenance = {
    promptId: composed.promptId,
    promptVersion: composed.promptVersion,
    promptDomainContractVersion: composed.promptDomainContractVersion,
    model: accepted.raw.model,
    schemaVersion: options.schemaVersion,
    attempt: accepted.attempt,
    inputArtifactIds,
    tokenUsage: accepted.raw.tokenUsage,
    estimatedCost: options.estimatedCostUsd,
  };

  const artifactR2Key = aiStageArtifactKey(
    options.buildId,
    options.buildVersionNumber,
    options.stage,
    runId
  );
  await putImmutableObject(
    env,
    artifactR2Key,
    JSON.stringify({
      schemaVersion: options.schemaVersion,
      stage: options.stage,
      value: accepted.value,
      provenance,
      createdAt,
    })
  );

  return { value: accepted.value, runId, artifactR2Key, provenance, attempts };
}
