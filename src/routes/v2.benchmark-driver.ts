import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyOperatorCapability } from "../lib/operator-capability";
import {
  BENCHMARK_IMAGE_SPEND_LIMIT_USD,
  BenchmarkHarnessError,
  freezeBenchmarkCases,
  getBenchmarkCaseDefinition,
  getBenchmarkRunRecord,
  benchmarkDefinitionHash,
  recordBenchmarkRun,
  verifyBenchmarkCaseInputs,
} from "../domain/benchmark/harness";
import { startSiteGeneration } from "../domain/lifecycle";
import type { BuildPipelineOutcome, PipelineTerminalStatus } from "../domain/build-pipeline";
import { BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS } from "../domain/retention";

// Operator benchmark-driver route (issue #18; executes the frozen #17 harness
// for the canonical validations of issues #18-#22, one case at a time).
//
// Execution model — the PRODUCTION durable engine, not the in-request seam:
// the run phase performs the harness drift gate, freezes the immutable
// Onboarding Submission + Site Generation from the frozen definition (the
// exact payload startBenchmarkRun uses) and starts ONE production
// WebsiteBuildWorkflow instance. Every pipeline stage then executes as its own
// durable step with the production retry policy (transient provider faults —
// e.g. a Z.AI 429 — retry with backoff) and real step.sleep image-poll waits,
// exactly as every client Site Generation runs. (Live evidence 2026-09-16:
// an earlier in-request direct-seam execution of the same frozen inputs was
// aborted by a provider rate limit the durable engine would have retried —
// the seam lacks the engine, so it is not a valid benchmark transport.)
//
// Providers are never searable here: there is deliberately NO mock mode and
// NO provider override — the pipeline runs the production defaults (real Z.AI
// coding-plan models, real KIE image provider, real preview deployment, real
// browser-backed QA capture) against real V2 D1/R2.
//
// The record phase completes the run: once the instance reaches a terminal
// state, the observed outcome is reconstructed from the durable workflow
// result (or Build state) and persisted through the UNCHANGED #17
// recordBenchmarkRun — one append-only benchmark_runs row pinning the
// definition hash, PASS calculation, scores, spend, provenance and evidence
// retention class.
//
// Access model (mirrors the Approval/Publication/Rollback routes): an
// offline-minted, action-bound operator capability ("benchmark", bound to the
// exact caseId) is required for every endpoint; denial fails closed — 401 for
// a missing/invalid/expired token, 403 for a token that does not bind this
// exact action AND caseId. The route is never public, mints nothing, and
// never echoes secret VALUES (presence booleans and configuration names only).

const DRIVER_ERROR_STATUS: Record<BenchmarkHarnessError["code"], 400 | 404 | 409> = {
  RUN_INPUT_INVALID: 400,
  UNKNOWN_CASE: 404,
  FROZEN_INPUT_DRIFT: 409,
};

function driverErrorResponse(c: Context<{ Bindings: Env }>, error: BenchmarkHarnessError): Response {
  return c.json({ error: { code: error.code, message: error.message } }, DRIVER_ERROR_STATUS[error.code]);
}

// Fixed denial order: absent/invalid/expired token is 401; a validly signed
// token whose action or caseId binding does not match THIS request is 403.
async function authorize(c: Context<{ Bindings: Env }>, caseId: string): Promise<Response | null> {
  const authorization = c.req.header("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  const capability = await verifyOperatorCapability(c.env, bearer);
  if (!capability) {
    console.warn("benchmark driver: denied — missing, invalid or expired capability");
    return c.json({ error: { code: "CAPABILITY_REQUIRED", message: "A valid, unexpired operator capability token is required" } }, 401);
  }
  if (capability.action !== "benchmark") {
    console.warn("benchmark driver: denied — capability action is not benchmark");
    return c.json({ error: { code: "CAPABILITY_INSUFFICIENT", message: "This capability does not authorize benchmark operations" } }, 403);
  }
  if (capability.caseId !== caseId) {
    console.warn(`benchmark driver: denied — capability does not bind case ${caseId}`);
    return c.json({ error: { code: "CAPABILITY_INSUFFICIENT", message: "This capability does not authorize this benchmark case" } }, 403);
  }
  return null;
}

// POST /api/v2/operator/benchmarks/:caseId/freeze
// Freezes (first time) or verifies (every later time) the frozen case inputs:
// canonical R2 screenshot + immutable benchmark_cases row. Never mutates an
// already-frozen case; drift is a 409, never a silent overwrite.
export async function runBenchmarkFreeze(c: Context<{ Bindings: Env }>): Promise<Response> {
  const caseId = c.req.param("caseId") as string;
  const denied = await authorize(c, caseId);
  if (denied) return denied;
  try {
    const reports = await freezeBenchmarkCases(c.env, [caseId]);
    return c.json(reports[0]);
  } catch (error) {
    if (error instanceof BenchmarkHarnessError) return driverErrorResponse(c, error);
    throw error;
  }
}

// POST /api/v2/operator/benchmarks/:caseId/preflight
// The pre-run validation gate (GO issue #18 §2): proves the frozen inputs
// (definition hash, R2 bytes, DB row) and reports the runtime identity the
// run would use — provider secret NAMES present (never values), bindings,
// configured model IDs, the USD 3 image hard gate and the evidence retention
// class — BEFORE any provider budget is spent.
export async function runBenchmarkPreflight(c: Context<{ Bindings: Env }>): Promise<Response> {
  const caseId = c.req.param("caseId") as string;
  const denied = await authorize(c, caseId);
  if (denied) return denied;
  const definition = getBenchmarkCaseDefinition(caseId);
  const prior = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM benchmark_runs WHERE benchmark_case_id = ?")
    .bind(caseId)
    .first<{ n: number }>();
  try {
    const { definitionHash } = await verifyBenchmarkCaseInputs(c.env, caseId);
    return c.json({
      caseId,
      definitionHash,
      definitionVersion: definition.definitionVersion,
      archetype: definition.archetype,
      buildMode: "REFERENCE_BOUND" as const,
      frozenInputsVerified: true,
      providers: {
        zaiCodingApiKeyPresent: typeof c.env.ZAI_CODING_API_KEY === "string" && c.env.ZAI_CODING_API_KEY.length > 0,
        kieApiKeyPresent: typeof c.env.KIE_API_KEY === "string" && c.env.KIE_API_KEY.length > 0,
        cfDeployApiTokenPresent: typeof c.env.CF_DEPLOY_API_TOKEN === "string" && c.env.CF_DEPLOY_API_TOKEN.length > 0,
        browserBindingPresent: Boolean(c.env.BROWSER),
        d1BindingPresent: Boolean(c.env.DB),
        r2BindingPresent: Boolean(c.env.SITE_BUCKET),
      },
      runtimeIdentity: {
        kieApiUrl: c.env.KIE_API_URL ?? null,
        kieModel: c.env.KIE_MODEL ?? null,
        zaiCodingBaseUrl: c.env.ZAI_CODING_BASE_URL ?? null,
        zaiCodingModel: c.env.ZAI_CODING_MODEL ?? null,
        zaiMultimodalModel: c.env.ZAI_MULTIMODAL_MODEL ?? null,
        kieTaskCostUsdConfigured: c.env.KIE_TASK_COST_USD ?? null,
        costLedger: "image_attempts.cost_usd (SUM per build)",
      },
      budget: {
        imageSpendLimitUsd: BENCHMARK_IMAGE_SPEND_LIMIT_USD,
        costAccountingActive: true,
      },
      evidenceRetention: { class: "benchmark-run-evidence", days: BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS },
      priorRunsForCase: prior?.n ?? 0,
      manualSourceEdits: "declared per /run request; a canonical benchmark run declares 0",
    });
  } catch (error) {
    if (error instanceof BenchmarkHarnessError) return driverErrorResponse(c, error);
    throw error;
  }
}

// Shared run-input validation: the code revision pinned on the run record and
// the operator's manual-source-edit attestation (W17-1: declare 0 only
// honestly).
function parseRunInput(body: { codeRevision?: unknown; manualSourceEdits?: unknown }):
  | { ok: true; codeRevision: string; manualSourceEdits: number }
  | { ok: false; message: string } {
  if (typeof body.codeRevision !== "string" || !/^[0-9a-f]{40}$/.test(body.codeRevision)) {
    return { ok: false, message: "codeRevision is required: the exact 40-hex committed Git SHA executing this run" };
  }
  let manualSourceEdits = 0;
  if (body.manualSourceEdits !== undefined) {
    if (typeof body.manualSourceEdits !== "number" || !Number.isInteger(body.manualSourceEdits) || body.manualSourceEdits < 0) {
      return { ok: false, message: "manualSourceEdits must be a non-negative integer when provided" };
    }
    manualSourceEdits = body.manualSourceEdits;
  }
  return { ok: true, codeRevision: body.codeRevision, manualSourceEdits };
}

async function readJsonBody(c: Context<{ Bindings: Env }>): Promise<Record<string, unknown> | "INVALID_JSON"> {
  try {
    const raw = await c.req.text();
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return "INVALID_JSON";
  }
}

// POST /api/v2/operator/benchmarks/:caseId/run
// ONE canonical benchmark run, phase 1 (seed): drift gate -> immutable
// Onboarding Submission + Site Generation from the frozen definition -> ONE
// production WebsiteBuildWorkflow instance (the same engine, retry policy and
// durable image-poll sleeps every client Site Generation runs). Resolves
// immediately; the pipeline runs durably on the edge until a terminal state.
// Phase 2 is the /record endpoint below.
export async function runBenchmarkStart(c: Context<{ Bindings: Env }>): Promise<Response> {
  const caseId = c.req.param("caseId") as string;
  const denied = await authorize(c, caseId);
  if (denied) return denied;

  const body = await readJsonBody(c);
  if (body === "INVALID_JSON") {
    return c.json({ error: { code: "RUN_INPUT_INVALID", message: "Request body must be JSON" } }, 400);
  }
  const input = parseRunInput(body as { codeRevision?: unknown; manualSourceEdits?: unknown });
  if (!input.ok) {
    return c.json({ error: { code: "RUN_INPUT_INVALID", message: input.message } }, 400);
  }

  try {
    // The same drift gate + frozen-submission payload startBenchmarkRun uses.
    const { definitionHash } = await verifyBenchmarkCaseInputs(c.env, caseId);
    const definition = getBenchmarkCaseDefinition(caseId);
    const started = await startSiteGeneration(c.env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: definition.facts,
        reference: {
          screenshotR2Key: definition.reference.screenshotR2Key,
          ...(definition.adaptationContract ? { adaptationContract: definition.adaptationContract } : {}),
        },
      },
    });
    const instance = await c.env.WEBSITE_BUILD_WORKFLOW.create({
      params: { siteGenerationId: started.siteGenerationId },
    });
    return c.json(
      {
        caseId,
        definitionHash,
        siteGenerationId: started.siteGenerationId,
        siteId: started.siteId,
        buildMode: started.buildMode,
        workflowInstanceId: instance.id,
        codeRevision: input.codeRevision,
        manualSourceEdits: input.manualSourceEdits,
      },
      202
    );
  } catch (error) {
    if (error instanceof BenchmarkHarnessError) return driverErrorResponse(c, error);
    throw error;
  }
}

const TERMINAL_BUILD_STATES: Set<string> = new Set(["RELEASE_READY", "APPROVED", "PUBLISHING", "PUBLISHED", "HUMAN_REVIEW_REQUIRED", "DEGRADED", "FAILED"]);

// The record phase may only translate states the pipeline itself sets.
const BUILD_STATE_TO_TERMINAL: Record<string, PipelineTerminalStatus> = {
  RELEASE_READY: "RELEASE_READY",
  APPROVED: "RELEASE_READY",
  PUBLISHING: "RELEASE_READY",
  PUBLISHED: "RELEASE_READY",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  DEGRADED: "DEGRADED",
  FAILED: "FAILED",
};

// POST /api/v2/operator/benchmarks/:caseId/record
// ONE canonical benchmark run, phase 2 (record): the instance has reached a
// terminal state; the observed outcome is reconstructed from the durable
// workflow result (or, for an errored instance, the Build state the pipeline
// recorded) and persisted through the UNCHANGED #17 recordBenchmarkRun —
// spend from the D1 ledger, provenance from ai_stage_runs, the PASS
// calculation, and the evidence retention class.
export async function recordBenchmarkRunEndpoint(c: Context<{ Bindings: Env }>): Promise<Response> {
  const caseId = c.req.param("caseId") as string;
  const denied = await authorize(c, caseId);
  if (denied) return denied;

  const body = await readJsonBody(c);
  if (body === "INVALID_JSON") {
    return c.json({ error: { code: "RUN_INPUT_INVALID", message: "Request body must be JSON" } }, 400);
  }
  const input = parseRunInput(body as { codeRevision?: unknown; manualSourceEdits?: unknown });
  if (!input.ok) {
    return c.json({ error: { code: "RUN_INPUT_INVALID", message: input.message } }, 400);
  }
  const siteGenerationId = typeof body.siteGenerationId === "string" ? body.siteGenerationId : "";
  const workflowInstanceId = typeof body.workflowInstanceId === "string" ? body.workflowInstanceId : "";
  const startedAt = typeof body.startedAt === "string" ? body.startedAt : new Date().toISOString();
  if (!siteGenerationId || !workflowInstanceId) {
    return c.json({ error: { code: "RUN_INPUT_INVALID", message: "siteGenerationId and workflowInstanceId are required" } }, 400);
  }

  try {
    const definition = getBenchmarkCaseDefinition(caseId);
    const definitionHash = (await verifyBenchmarkCaseInputs(c.env, caseId)).definitionHash;

    // The Build must belong to THIS Site Generation and be terminal.
    const build = await c.env.DB.prepare(
      "SELECT b.id, b.state FROM builds b WHERE b.site_generation_id = ?1 AND b.kind = 'initial' ORDER BY b.created_at LIMIT 1"
    )
      .bind(siteGenerationId)
      .first<{ id: string; state: string }>();
    if (!build) {
      return c.json({ error: { code: "RUN_INPUT_INVALID", message: `No initial Build exists for Site Generation ${siteGenerationId}` } }, 404);
    }
    if (!TERMINAL_BUILD_STATES.has(build.state)) {
      return c.json(
        { error: { code: "BUILD_NOT_TERMINAL", message: `Build ${build.id} is still '${build.state}' — record only after the workflow reaches a terminal state` } },
        409
      );
    }

    // Preferred outcome source: the durable workflow result. Fallback: the
    // Build state the pipeline/reconciliation recorded before the instance
    // died (the same evidence the #56 sweep uses).
    let terminal: PipelineTerminalStatus = BUILD_STATE_TO_TERMINAL[build.state];
    let reasons: string[] = [];
    let releaseReadyBuildVersionId: string | null = null;
    let artifactManifestHash: string | null = null;
    let previewUrl: string | null = null;
    try {
      const instance = await c.env.WEBSITE_BUILD_WORKFLOW.get(workflowInstanceId);
      const status = (await instance.status()) as {
        status: string;
        output?: {
          terminal?: string;
          reasons?: string[];
          releaseReadyBuildVersionId?: string | null;
          artifactManifestHash?: string | null;
          previewUrl?: string | null;
        };
      };
      if (status.status === "complete" && status.output?.terminal) {
        terminal = status.output.terminal as PipelineTerminalStatus;
        reasons = status.output.reasons ?? [];
        releaseReadyBuildVersionId = status.output.releaseReadyBuildVersionId ?? null;
        artifactManifestHash = status.output.artifactManifestHash ?? null;
        previewUrl = status.output.previewUrl ?? null;
      }
    } catch {
      // Instance unreachable (e.g. preview session recycling): the Build
      // state and terminal workflow event remain the durable truth.
    }
    if (!releaseReadyBuildVersionId && terminal === "RELEASE_READY") {
      const ready = await c.env.DB.prepare(
        "SELECT id FROM build_versions WHERE build_id = ?1 ORDER BY version_number DESC LIMIT 1"
      )
        .bind(build.id)
        .first<{ id: string }>();
      releaseReadyBuildVersionId = ready?.id ?? null;
    }
    if (reasons.length === 0 && terminal !== "RELEASE_READY") {
      const lastEvent = await c.env.DB.prepare(
        "SELECT detail FROM build_workflow_events WHERE build_id = ?1 ORDER BY created_at DESC LIMIT 1"
      )
        .bind(build.id)
        .first<{ detail: string }>();
      if (lastEvent?.detail) reasons = [lastEvent.detail];
    }

    const versionCount = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?1")
      .bind(build.id)
      .first<{ n: number }>();
    const outcome: BuildPipelineOutcome = {
      terminal,
      reasons,
      siteGenerationId,
      siteId: "",
      buildId: build.id,
      releaseReadyBuildVersionId,
      artifactManifestHash,
      previewUrl,
      qaA: null,
      qaB: null,
      repairApplied: (versionCount?.n ?? 1) > 1,
    };

    const recorded = await recordBenchmarkRun(c.env, {
      definition,
      definitionHash,
      codeRevision: input.codeRevision,
      manualSourceEdits: input.manualSourceEdits,
      outcome,
      startedAt,
    });
    return c.json({
      runId: recorded.runId,
      caseId,
      definitionHash: await benchmarkDefinitionHash(definition),
      buildId: build.id,
      terminal: outcome.terminal,
      pass: recorded.pass,
      passReason: recorded.passReason,
      imageSpendUsd: recorded.imageSpendUsd,
    });
  } catch (error) {
    if (error instanceof BenchmarkHarnessError) return driverErrorResponse(c, error);
    throw error;
  }
}

// GET /api/v2/operator/benchmarks/runs/:runId
// Read-back of one append-only benchmark run record. The capability must bind
// the case the run belongs to.
export async function getBenchmarkRun(c: Context<{ Bindings: Env }>): Promise<Response> {
  const runId = c.req.param("runId") as string;
  const authorization = c.req.header("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  const capability = await verifyOperatorCapability(c.env, bearer);
  if (!capability) {
    console.warn("benchmark driver: denied — missing, invalid or expired capability");
    return c.json({ error: { code: "CAPABILITY_REQUIRED", message: "A valid, unexpired operator capability token is required" } }, 401);
  }
  if (capability.action !== "benchmark") {
    console.warn("benchmark driver: denied — capability action is not benchmark");
    return c.json({ error: { code: "CAPABILITY_INSUFFICIENT", message: "This capability does not authorize benchmark operations" } }, 403);
  }
  const run = await getBenchmarkRunRecord(c.env, runId);
  if (!run) {
    return c.json({ error: { code: "RUN_NOT_FOUND", message: `Benchmark run ${runId} does not exist` } }, 404);
  }
  const boundCaseId = (run as { benchmark_case_id?: string }).benchmark_case_id;
  if (boundCaseId !== capability.caseId) {
    console.warn(`benchmark driver: denied — capability does not bind case ${boundCaseId}`);
    return c.json({ error: { code: "CAPABILITY_INSUFFICIENT", message: "This capability does not authorize this benchmark case" } }, 403);
  }
  return c.json(run);
}
