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
  /** Blueprint hero-link canonicalization (operator GO, 2026-09-10):
   *  which duplicated hero mediaSlotId references deterministic code resolved
   *  from the blueprint's own image-slot plan. Provenance only — the raw
   *  model output stays untouched in the ai-stage run artifact. */
  heroMediaLinkCanonicalization?: {
    applied: boolean;
    links: Array<{ page: string; supplied: string | null; resolved: string; reason: string }>;
  };
  /** Stage-routed model policy provenance: the exact reasoning-control
   *  setting the Builder transport sent for the routed model (model-routing
   *  GO §8; carried into the file-realization transport). */
  reasoningControl?: string;
}

export interface RawAiGenerateResult {
  content: string;
  provider: string;
  model: string;
  tokenUsage?: unknown;
  /** Provider finish reason when the transport reports one; null/absent when
   *  the provider omits it. */
  finishReason?: string | null;
  /** Exact reasoning-control setting the transport sent (model-routing GO §8:
   *  e.g. "chat_template_kwargs.enable_thinking=false") — provenance only. */
  reasoningControl?: string;
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

/** Raw file-realization stages: ONE semantic generation whose payload fails
 *  the deterministic per-file validation. Never retried here, never persisted
 *  as a stage value. */
export class AiStageFileInvalidError extends Error {
  constructor(
    readonly stage: string,
    readonly runId: string,
    readonly attempts: AiStageAttemptRecord[],
    readonly failures: string[]
  ) {
    super(
      `AI file stage '${stage}' failed deterministic file validation after ${attempts.length} attempt(s) (run ${runId}): ${failures.join("; ").slice(0, 600)}`
    );
    this.name = "AiStageFileInvalidError";
  }
}

// ── Parsing ─────────────────────────────────────────────────────────────────

export function parseModelJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {  let text = raw.trim();
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

// Deterministic single-file normalization (file-realization GO §6): a raw
// file realization is accepted as-is; models sometimes add exactly one
// surrounding Markdown code fence despite instructions, so that ONE fence
// pair is tolerated and stripped. Anything else fence-shaped (an unterminated
// opening fence, or a closing fence without an opening one where content
// ends mid-fence) is refused — never heuristic-repaired.
export function parseSingleFileSource(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  let text = raw.trim();
  // The GLM chat template on this provider prepends the model's reasoning to
  // the answer in sync output, terminated by the template's FIXED `</think>`
  // delimiter (observed live 2026-09-11 even with enable_thinking=false; the
  // same template behavior leaked `</think>` debris into structured output in
  // the 1af7cc5 qualification). The answer is everything after the LAST
  // delimiter; a payload without one is already the pure answer. Deterministic
  // framing tolerance — never content surgery.
  const thinkEnd = text.lastIndexOf("</think>");
  if (thinkEnd !== -1) text = text.slice(thinkEnd + "</think>".length).trim();
  if (text.length === 0) return { ok: false, error: "empty file realization" };
  if (!text.startsWith("```")) return { ok: true, value: text };
  // The content opens with a fence: it must open on a line of its own
  // (optional language tag), have a newline, and terminate with a fence on
  // the final line.
  const firstLineEnd = text.indexOf("\n");
  if (firstLineEnd === -1) return { ok: false, error: "fence opened but never closed" };
  const opening = text.slice(0, firstLineEnd).trim();
  if (!/^```[\w-]*$/.test(opening)) return { ok: false, error: `malformed opening fence: '${opening.slice(0, 16)}'` };
  if (!text.endsWith("```")) return { ok: false, error: "fence opened but never closed" };
  const inner = text.slice(firstLineEnd + 1, text.length - 3);
  // Exactly ONE surrounding fence is tolerated: interior fences mean the
  // framing is ambiguous and the payload is refused, never heuristic-split.
  if (inner.includes("```")) return { ok: false, error: "more than one code fence in the realization" };
  // The closing fence must sit on its own line.
  if (inner.endsWith("\n")) {
    return { ok: true, value: inner.slice(0, -1).trimEnd() };
  }
  return { ok: false, error: "malformed closing fence" };
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
  /** Native transport-level structured output (schema-convergence brief §3):
   *  the supplied `generate` seam already carries the JSON Schema in the
   *  request's response_format, so the boundary must NOT duplicate it as
   *  prompt prose ("Output contract") — the prompt explains intent, the
   *  transport enforces structure. The ONE targeted structural repair stays
   *  available for genuine residual errors. */
  nativeJsonSchema?: boolean;
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

  // The output shape is governed by the stage's versioned runtime schema.
  // Default mode: state it explicitly in prose so the model's first answer
  // already targets the right object shape (live evidence, issue #30). With
  // nativeJsonSchema the transport carries the schema instead (§3) — the
  // prose contract would only duplicate it and dilute design attention.
  const outputContract = options.nativeJsonSchema
    ? ""
    : `\n\n## Output contract\nReturn ONE JSON object that satisfies this JSON Schema exactly (no extra properties, every required property present, correct types). Do not wrap it in markdown or prose:\n${JSON.stringify(options.schema)}`;

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

// ── Raw file-realization boundary (file-realization GO §5) ──────────────────
//
// Generated source files are NOT JSON: each Builder call realizes exactly one
// file as plain model output. This runner keeps the boundary discipline of
// runSchemaValidatedAiStage — provenance, ai_stage_runs persistence, immutable
// run artifacts — while replacing schema validation with the caller's
// deterministic per-file validation. ONE semantic generation per call: a
// validation failure fails the stage closed (the file never re-enters a
// "rewrite the whole thing" loop); the stage-failure classifier routes it to
// deterministic review.

export interface RunAiFileStageOptions {
  stage: PromptStageKey;
  /** Versioned file contract id, e.g. "builder-file/site-css/1". */
  schemaVersion: string;
  userPrompt: string;
  buildId: string;
  siteGenerationId?: string;
  buildVersionId: string;
  buildVersionNumber: number;
  inputArtifactIds?: string[];
  /** Deterministic per-file validation (structural completeness). Empty
   *  array = valid. Failures fail the stage closed. */
  validate?: (value: string) => string[];
  generate: RawAiGenerate;
}

export interface AiFileStageRunResult {
  value: string;
  runId: string;
  artifactR2Key: string;
  provenance: AiProvenance;
  attempts: AiStageAttemptRecord[];
  /** Provider finish reason of the accepted attempt (transport reporting;
   *  null when the provider omitted it). */
  finishReason: string | null;
}

export async function runAiFileStage(
  env: Env,
  options: RunAiFileStageOptions
): Promise<AiFileStageRunResult> {
  const composed = composeStagePrompt(options.stage);
  const runId = generateId();
  const inputArtifactIds = options.inputArtifactIds ?? [];
  const createdAt = nowIso();
  const attempts: AiStageAttemptRecord[] = [];

  const raw = await options.generate(composed.systemPrompt, options.userPrompt, 1);
  const parsed = parseSingleFileSource(raw.content);
  let outcome: AiStageAttemptRecord["outcome"];
  let errorSummary: string | null = null;
  let value: string | null = null;

  if (!parsed.ok) {
    outcome = "invalid";
    errorSummary = `file normalization refused the payload: ${parsed.error}`;
  } else {
    const failures = options.validate ? options.validate(parsed.value) : [];
    if (failures.length > 0) {
      outcome = "invalid";
      errorSummary = `file validation failed: ${failures.join("; ").slice(0, 500)}`;
    } else {
      value = parsed.value;
      outcome = "valid";
    }
  }

  attempts.push({ attempt: 1, outcome, errorSummary });

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
      1,
      outcome,
      raw.tokenUsage === undefined ? null : JSON.stringify(raw.tokenUsage),
      null,
      JSON.stringify(inputArtifactIds),
      value !== null ? aiStageArtifactKey(options.buildId, options.buildVersionNumber, options.stage, runId) : null,
      errorSummary,
      createdAt
    )
    .run();

  if (value === null) {
    throw new AiStageFileInvalidError(options.stage, runId, attempts, errorSummary ? [errorSummary] : ["file validation failed"]);
  }

  const provenance: AiProvenance = {
    promptId: composed.promptId,
    promptVersion: composed.promptVersion,
    promptDomainContractVersion: composed.promptDomainContractVersion,
    model: raw.model,
    schemaVersion: options.schemaVersion,
    attempt: 1,
    inputArtifactIds,
    tokenUsage: raw.tokenUsage,
    ...(raw.reasoningControl ? { reasoningControl: raw.reasoningControl } : {}),
  };

  const artifactR2Key = aiStageArtifactKey(options.buildId, options.buildVersionNumber, options.stage, runId);
  await putImmutableObject(
    env,
    artifactR2Key,
    JSON.stringify({
      schemaVersion: options.schemaVersion,
      stage: options.stage,
      value,
      provenance,
      createdAt,
    })
  );

  return { value, runId, artifactR2Key, provenance, attempts, finishReason: raw.finishReason ?? null };
}
