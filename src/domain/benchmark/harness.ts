// The frozen five-site REFERENCE_BOUND benchmark harness (issue #17, PRD
// sections 43-45, FINAL-DECISION-RECORD 130-131).
//
// The harness owns four responsibilities and nothing else:
//   1. FREEZE — persist/verify the five frozen case definitions (canonical
//      R2 screenshot + immutable benchmark_cases row) and detect drift.
//   2. RUN — drive the CANONICAL production pipeline seam (startSiteGeneration
//      -> createInitialBuild -> runBuildPipeline) with the frozen inputs.
//      No benchmark-specific generator, prompt, gate relaxation or retry.
//   3. RECORD — one append-only benchmark_runs row pinning the definition
//      hash the run actually used, the pipeline outcome, PASS calculation,
//      QA/scores, cost, provenance and the evidence retention class.
//   4. PASS — deterministic calculator: automated RELEASE_READY + zero
//      manual source edits + KIE spend within the USD 3 hard gate. Approval
//      and Publication are NOT required; HUMAN_REVIEW_REQUIRED / FAILED /
//      DEGRADED / budget violation / manual edit are all FAIL. There is no
//      partial-pass state.
//
// The harness is invoked for the five canonical validations one case at a
// time in issues #18-#22; #17 freezes it and proves its deterministic
// contracts. There is no HTTP route for it and never was one (the retired
// experiment driver remains repository history).

import type { Env } from "../../env.d";
import { generateId, sha256Hex } from "../../lib/crypto";
import { getObjectWithMetadata, putImmutableObject } from "../../lib/assets";
import { normalizeBusinessFacts } from "../lifecycle-schema";
import { startSiteGeneration, createInitialBuild, type SiteGenerationStarted } from "../lifecycle";
import { runBuildPipeline, type BuildPipelineDeps, type BuildPipelineOutcome } from "../build-pipeline";
import { BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS } from "../retention";
import { BENCHMARK_CASE_DEFINITIONS, assertBenchmarkShape, type BenchmarkCaseDefinition } from "./definitions";
import { FROZEN_SCREENSHOTS } from "./generated-frozen-screenshots";

/** KIE image hard gate per completed Site (PRD 27) — Benchmark PASS bound. */
export const BENCHMARK_IMAGE_SPEND_LIMIT_USD = 3;
/** Per-run bulky benchmark evidence retention class (FDR 130.B). */
export { BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS };

export class BenchmarkHarnessError extends Error {
  readonly code: "UNKNOWN_CASE" | "FROZEN_INPUT_DRIFT" | "RUN_INPUT_INVALID";
  constructor(code: BenchmarkHarnessError["code"], message: string) {
    super(message);
    this.name = "BenchmarkHarnessError";
    this.code = code;
  }
}

// Canonical JSON (sorted keys, recursive) — the same stable-stringify contract
// the lifecycle uses to checksum frozen Onboarding Submissions.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

// Deterministic benchmark-definition hash over the canonical FROZEN inputs
// exactly (GO issue #17 §5): case identity, Reference screenshot identity,
// Reference evidence identity (for SCREENSHOT_ONLY cases the evidence
// identity IS the screenshot identity), normalized Business Facts, Build
// Mode, the Adaptation Contract where applicable, and the definition version.
// Prompt/model settings are deliberately NOT hash inputs: they are recorded
// per case (prompt_model_schema_json) and per run (ai_stage_runs provenance),
// so a runtime prompt/model evolution is distinguishable from an input change.
export async function benchmarkDefinitionHash(definition: BenchmarkCaseDefinition): Promise<string> {
  const normalizedFacts = normalizeBusinessFacts(definition.facts);
  return sha256Hex(
    stableStringify({
      caseId: definition.caseId,
      slot: definition.slot,
      archetype: definition.archetype,
      definitionVersion: definition.definitionVersion,
      buildMode: "REFERENCE_BOUND",
      reference: {
        screenshotR2Key: definition.reference.screenshotR2Key,
        screenshotChecksum: definition.reference.screenshotChecksum,
        evidenceChecksum: definition.reference.screenshotChecksum,
      },
      facts: normalizedFacts,
      adaptationContract: definition.adaptationContract,
    })
  );
}

export function getBenchmarkCaseDefinition(caseId: string): BenchmarkCaseDefinition {
  const definition = BENCHMARK_CASE_DEFINITIONS.find((c) => c.caseId === caseId);
  if (!definition) {
    throw new BenchmarkHarnessError(
      "UNKNOWN_CASE",
      `No frozen benchmark case '${caseId}'; the frozen set is exactly: ${BENCHMARK_CASE_DEFINITIONS.map((c) => c.caseId).join(", ")}`
    );
  }
  return definition;
}

function decodeFrozenScreenshot(definition: BenchmarkCaseDefinition): Uint8Array {
  const frozen = FROZEN_SCREENSHOTS[definition.caseId];
  if (!frozen) {
    throw new BenchmarkHarnessError("FROZEN_INPUT_DRIFT", `No frozen screenshot bytes embedded for ${definition.caseId}`);
  }
  const binary = atob(frozen.base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Freeze / drift verification ─────────────────────────────────────────────

export interface FreezeReport {
  caseId: string;
  status: "frozen" | "verified";
  definitionHash: string;
}

interface BenchmarkCaseRow {
  id: string;
  slot: number;
  archetype: string;
  reference_url: string | null;
  evidence_checksum: string;
  screenshot_checksum: string;
  replacement_brief_json: string;
  adaptation_contract_json: string | null;
  prompt_model_schema_json: string;
  frozen_at: string;
}

function expectDefinitionJson(definition: BenchmarkCaseDefinition): string {
  return stableStringify(normalizeBusinessFacts(definition.facts));
}

async function verifyFrozenScreenshotBytes(env: Env, definition: BenchmarkCaseDefinition): Promise<void> {
  const bytes = decodeFrozenScreenshot(definition);
  const embeddedChecksum = await digestHex(bytes);
  if (embeddedChecksum !== definition.reference.screenshotChecksum) {
    throw new BenchmarkHarnessError(
      "FROZEN_INPUT_DRIFT",
      `Frozen screenshot bytes for ${definition.caseId} do not match the pinned checksum — a frozen Reference must never be silently replaced`
    );
  }
  const stored = await getObjectWithMetadata(env, definition.reference.screenshotR2Key);
  if (!stored) {
    await putImmutableObject(env, definition.reference.screenshotR2Key, bytes);
    return;
  }
  const storedBytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
  const storedChecksum = await digestHex(storedBytes);
  if (storedChecksum !== definition.reference.screenshotChecksum) {
    throw new BenchmarkHarnessError(
      "FROZEN_INPUT_DRIFT",
      `Canonical screenshot at ${definition.reference.screenshotR2Key} does not match the pinned checksum for ${definition.caseId}`
    );
  }
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function expectStoredCaseRow(definition: BenchmarkCaseDefinition, row: BenchmarkCaseRow, definitionHash: string): void {
  const expectedBrief = expectDefinitionJson(definition);
  const drift: string[] = [];
  if (row.slot !== definition.slot) drift.push("slot");
  if (row.archetype !== definition.archetype) drift.push("archetype");
  if (row.screenshot_checksum !== definition.reference.screenshotChecksum) drift.push("screenshot_checksum");
  if (row.evidence_checksum !== definition.reference.screenshotChecksum) drift.push("evidence_checksum");
  if (row.replacement_brief_json !== expectedBrief) drift.push("replacement_brief_json");
  const expectedContract = definition.adaptationContract ? stableStringify(definition.adaptationContract) : null;
  if (row.adaptation_contract_json !== expectedContract) drift.push("adaptation_contract_json");
  if (row.prompt_model_schema_json !== stableStringify(definition.promptModelSchema)) drift.push("prompt_model_schema_json");
  if (drift.length > 0) {
    throw new BenchmarkHarnessError(
      "FROZEN_INPUT_DRIFT",
      `Frozen benchmark case ${definition.caseId} drifted in: ${drift.join(", ")} (definition hash ${definitionHash}) — version the case explicitly instead of mutating it`
    );
  }
}

// Idempotent freeze: verifies the embedded bytes, freezes the canonical R2
// screenshot (immutable), and inserts or verifies the immutable benchmark_cases
// row. A second freeze never mutates — it verifies.
export async function freezeBenchmarkCases(env: Env, caseIds?: string[]): Promise<FreezeReport[]> {
  assertBenchmarkShape();
  const selected = caseIds
    ? BENCHMARK_CASE_DEFINITIONS.filter((c) => caseIds.includes(c.caseId))
    : [...BENCHMARK_CASE_DEFINITIONS];
  const reports: FreezeReport[] = [];
  for (const definition of selected) {
    const definitionHash = await benchmarkDefinitionHash(definition);
    await verifyFrozenScreenshotBytes(env, definition);
    const existing = await env.DB.prepare("SELECT * FROM benchmark_cases WHERE id = ?")
      .bind(definition.caseId)
      .first<BenchmarkCaseRow>();
    if (existing) {
      expectStoredCaseRow(definition, existing, definitionHash);
      reports.push({ caseId: definition.caseId, status: "verified", definitionHash });
      continue;
    }
    await env.DB.prepare(
      `INSERT INTO benchmark_cases (id, slot, archetype, reference_url, evidence_checksum, screenshot_checksum, replacement_brief_json, adaptation_contract_json, prompt_model_schema_json, frozen_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        definition.caseId,
        definition.slot,
        definition.archetype,
        definition.reference.screenshotChecksum,
        definition.reference.screenshotChecksum,
        expectDefinitionJson(definition),
        definition.adaptationContract ? stableStringify(definition.adaptationContract) : null,
        stableStringify(definition.promptModelSchema),
        new Date().toISOString()
      )
      .run();
    reports.push({ caseId: definition.caseId, status: "frozen", definitionHash });
  }
  return reports;
}

// Pre-run drift gate: the case row and the canonical R2 screenshot must still
// match the frozen definition (and the embedded bytes must match the pinned
// checksum) before a run may claim the canonical case identity.
export async function verifyBenchmarkCaseInputs(env: Env, caseId: string): Promise<{ definitionHash: string }> {
  assertBenchmarkShape();
  const definition = getBenchmarkCaseDefinition(caseId);
  const definitionHash = await benchmarkDefinitionHash(definition);
  await verifyFrozenScreenshotBytes(env, definition);
  const row = await env.DB.prepare("SELECT * FROM benchmark_cases WHERE id = ?")
    .bind(definition.caseId)
    .first<BenchmarkCaseRow>();
  if (!row) {
    throw new BenchmarkHarnessError("FROZEN_INPUT_DRIFT", `Benchmark case ${caseId} has not been frozen yet — run the freeze step first`);
  }
  expectStoredCaseRow(definition, row, definitionHash);
  return { definitionHash };
}

// ── PASS calculator ─────────────────────────────────────────────────────────

export interface BenchmarkPassInput {
  terminal: BuildPipelineOutcome["terminal"];
  imageSpendUsd: number;
  manualSourceEdits: number;
}

export interface BenchmarkPassVerdict {
  pass: boolean;
  reason: string;
}

// Benchmark PASS (PRD 44, GO issue #17 §7): the exact candidate reached
// RELEASE_READY through the automated pipeline, zero manual source edits,
// KIE spend within the USD 3 hard gate. HUMAN_REVIEW_REQUIRED, FAILED and
// DEGRADED are FAIL; any budget violation is FAIL; a manual-edit marker is
// FAIL. Approval and Publication are NOT inputs. No partial pass exists.
export function evaluateBenchmarkPass(input: BenchmarkPassInput): BenchmarkPassVerdict {
  if (input.terminal !== "RELEASE_READY") {
    return { pass: false, reason: `terminal ${input.terminal} is not RELEASE_READY — Benchmark FAIL` };
  }
  if (input.manualSourceEdits !== 0) {
    return { pass: false, reason: `manual source edits recorded (${input.manualSourceEdits}) — Benchmark FAIL` };
  }
  if (Number.isFinite(input.imageSpendUsd) && input.imageSpendUsd > BENCHMARK_IMAGE_SPEND_LIMIT_USD) {
    return {
      pass: false,
      reason: `KIE image spend $${input.imageSpendUsd.toFixed(2)} exceeds the $${BENCHMARK_IMAGE_SPEND_LIMIT_USD.toFixed(2)} hard gate — Benchmark FAIL`,
    };
  }
  return { pass: true, reason: "automated RELEASE_READY, zero manual source edits, image spend within the hard gate" };
}

// ── Run + record ────────────────────────────────────────────────────────────

export interface StartBenchmarkRunInput {
  caseId: string;
  /** Provider seams for deterministic tests; production runs omit this. */
  deps?: BuildPipelineDeps;
  /** Code/revision identity recorded with the run for honest comparison. */
  codeRevision?: string;
  /** Declared manual source-edit marker (operator-recorded, default 0). */
  manualSourceEdits?: number;
}

export interface BenchmarkRunRecord {
  runId: string;
  caseId: string;
  definitionHash: string;
  terminal: BuildPipelineOutcome["terminal"];
  pass: boolean;
  passReason: string;
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  finalBuildVersionId: string | null;
}

export async function startBenchmarkRun(env: Env, input: StartBenchmarkRunInput): Promise<BenchmarkRunRecord> {
  const definition = getBenchmarkCaseDefinition(input.caseId);
  const { definitionHash } = await verifyBenchmarkCaseInputs(env, input.caseId);
  const manualSourceEdits = input.manualSourceEdits ?? 0;
  if (!Number.isInteger(manualSourceEdits) || manualSourceEdits < 0) {
    throw new BenchmarkHarnessError("RUN_INPUT_INVALID", "manualSourceEdits must be a non-negative integer");
  }

  const started: SiteGenerationStarted = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: definition.facts,
      reference: {
        screenshotR2Key: definition.reference.screenshotR2Key,
        ...(definition.adaptationContract ? { adaptationContract: definition.adaptationContract } : {}),
      },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  const startedAt = new Date().toISOString();

  const outcome = await runBuildPipeline(env, {
    siteGenerationId: started.siteGenerationId,
    buildId: created.buildId,
    deps: input.deps ?? {},
  });

  const recorded = await recordBenchmarkRun(env, {
    definition,
    definitionHash,
    codeRevision: input.codeRevision ?? "",
    manualSourceEdits,
    outcome,
    startedAt,
  });

  return {
    runId: recorded.runId,
    caseId: definition.caseId,
    definitionHash,
    terminal: outcome.terminal,
    pass: recorded.pass,
    passReason: recorded.passReason,
    siteGenerationId: started.siteGenerationId,
    siteId: started.siteId,
    buildId: created.buildId,
    finalBuildVersionId: outcome.releaseReadyBuildVersionId,
  };
}

export interface RecordBenchmarkRunInput {
  definition: BenchmarkCaseDefinition;
  definitionHash: string;
  codeRevision: string;
  manualSourceEdits: number;
  outcome: BuildPipelineOutcome;
  startedAt: string;
}

export interface RecordedBenchmarkRun {
  runId: string;
  pass: boolean;
  passReason: string;
  imageSpendUsd: number;
}

// Persists ONE canonical append-only benchmark_runs row. Compact by design:
// canonical lifecycle IDs (site generation, build, final version) allow
// retrieval, so the row pins only identity + results + provenance summary +
// the evidence retention class (FDR 130.B/C) — never bulky artifacts.
export async function recordBenchmarkRun(env: Env, input: RecordBenchmarkRunInput): Promise<RecordedBenchmarkRun> {
  const { definition, outcome } = input;
  // The run's final Build Version: the released version on success, else the
  // last (highest-numbered) version the pipeline produced before terminating.
  const finalVersion = outcome.releaseReadyBuildVersionId
    ? outcome.releaseReadyBuildVersionId
    : (
        await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1")
          .bind(outcome.buildId)
          .first<{ id: string }>()
      )?.id ?? null;
  const spend = await env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM image_attempts WHERE build_id = ?")
    .bind(outcome.buildId)
    .first<{ total: number }>();
  const imageSpendUsd = Number((spend?.total ?? 0).toFixed(2));
  const accepted = finalVersion
    ? await env.DB.prepare("SELECT COUNT(*) AS n FROM accepted_images WHERE build_version_id = ?")
        .bind(finalVersion)
        .first<{ n: number }>()
    : null;
  const suitability = await env.DB.prepare("SELECT suitability FROM reference_evidence_packages WHERE build_id = ? ORDER BY frozen_at DESC LIMIT 1")
    .bind(outcome.buildId)
    .first<{ suitability: string }>();

  const release = finalVersion
    ? await env.DB.prepare(
        "SELECT qa_a_visual_score, qa_a_content_score, qa_b_technical_score FROM build_release_records WHERE build_version_id = ?"
      )
        .bind(finalVersion)
        .first<{ qa_a_visual_score: number; qa_a_content_score: number; qa_b_technical_score: number }>()
    : null;

  const provenanceRows = await env.DB.prepare(
    "SELECT DISTINCT stage, prompt_id, prompt_version, model, schema_version FROM ai_stage_runs WHERE build_id = ? ORDER BY stage"
  )
    .bind(outcome.buildId)
    .all<{ stage: string; prompt_id: string; prompt_version: string; model: string; schema_version: string }>();

  const evidenceKeys = await indexBenchmarkEvidenceKeys(env, outcome.buildId, finalVersion);

  const verdict = evaluateBenchmarkPass({
    terminal: outcome.terminal,
    imageSpendUsd,
    manualSourceEdits: input.manualSourceEdits,
  });
  const rootCause =
    outcome.terminal === "RELEASE_READY"
      ? null
      : (outcome.reasons.join(" | ") || `terminal ${outcome.terminal}`).slice(0, 1000);

  const runId = generateId();
  await env.DB.prepare(
    `INSERT INTO benchmark_runs (
       id, benchmark_case_id, site_generation_id, build_id, build_version_id,
       status, release_ready, image_spend_usd, manual_source_edits, root_cause,
       qa_summary_json, provenance_json, started_at, finished_at,
       definition_hash, definition_version, code_revision, repair_consumed,
       accepted_images, reference_suitability, evidence_keys_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      runId,
      definition.caseId,
      outcome.siteGenerationId,
      outcome.buildId,
      finalVersion,
      verdict.pass ? "pass" : "fail",
      outcome.terminal === "RELEASE_READY" ? 1 : 0,
      imageSpendUsd,
      input.manualSourceEdits,
      rootCause,
      JSON.stringify({
        terminal: outcome.terminal,
        reasons: outcome.reasons,
        scores: release
          ? { visual: release.qa_a_visual_score, content: release.qa_a_content_score, technical: release.qa_b_technical_score }
          : null,
        passReason: verdict.reason,
      }),
      JSON.stringify({
        pipelineVersion: definition.promptModelSchema.pipelineVersion,
        prompts: provenanceRows.results ?? [],
        definitionVersion: definition.definitionVersion,
      }),
      input.startedAt,
      new Date().toISOString(),
      input.definitionHash,
      definition.definitionVersion,
      input.codeRevision,
      outcome.repairApplied ? 1 : 0,
      accepted?.n ?? 0,
      suitability?.suitability ?? null,
      JSON.stringify({ retentionClass: "benchmark-run-evidence", retentionDays: BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS, keys: evidenceKeys })
    )
    .run();

  return { runId, pass: verdict.pass, passReason: verdict.reason, imageSpendUsd };
}

// Bulky evidence keys belonging to the 180-day benchmark evidence class for
// one run: stage artifacts + reference evidence + image assets of the run's
// final Build Version (exact D1-indexed keys — never prefix deletion).
async function indexBenchmarkEvidenceKeys(env: Env, buildId: string, buildVersionId: string | null): Promise<string[]> {
  const keys: string[] = [];
  if (buildVersionId) {
    const stageArtifacts = await env.DB.prepare("SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ?")
      .bind(buildVersionId)
      .all<{ artifact_r2_key: string }>();
    for (const row of stageArtifacts.results ?? []) keys.push(row.artifact_r2_key);
    const images = await env.DB.prepare("SELECT r2_key FROM image_attempts WHERE build_version_id = ? AND r2_key IS NOT NULL")
      .bind(buildVersionId)
      .all<{ r2_key: string }>();
    for (const row of images.results ?? []) keys.push(row.r2_key);
  }
  const evidence = await env.DB.prepare("SELECT evidence_r2_key FROM reference_evidence_packages WHERE build_id = ?")
    .bind(buildId)
    .all<{ evidence_r2_key: string }>();
  for (const row of evidence.results ?? []) keys.push(row.evidence_r2_key);
  return keys;
}

export async function getBenchmarkRunRecord(env: Env, runId: string) {
  return env.DB.prepare("SELECT * FROM benchmark_runs WHERE id = ?").bind(runId).first();
}
