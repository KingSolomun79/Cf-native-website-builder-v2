import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyOperatorCapability } from "../lib/operator-capability";
import {
  BENCHMARK_IMAGE_SPEND_LIMIT_USD,
  BenchmarkHarnessError,
  freezeBenchmarkCases,
  getBenchmarkCaseDefinition,
  getBenchmarkRunRecord,
  startBenchmarkRun,
  verifyBenchmarkCaseInputs,
} from "../domain/benchmark/harness";
import { BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS } from "../domain/retention";

// Operator benchmark-driver route (issue #18; executes the frozen #17 harness
// for the canonical validations of issues #18-#22, one case at a time).
//
// This is the ONLY execution vehicle for the harness outside tests: the
// pipeline is the unmodified canonical production seam (startBenchmarkRun with
// no provider deps — real Z.AI coding-plan models, real KIE image provider,
// real preview deployment and real browser-backed QA capture), against the
// real V2 D1/R2. There is deliberately NO mock mode and NO provider override
// here: a benchmark run that could be driven by anything but the production
// providers would be worthless as evidence.
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

// POST /api/v2/operator/benchmarks/:caseId/run
// ONE canonical benchmark run: drift gate -> immutable Onboarding Submission ->
// Site Generation -> initial Build -> the unmodified production pipeline
// (real providers, no deps seam) -> append-only benchmark_runs record. The
// request resolves only when the pipeline reaches a terminal state (typically
// tens of minutes). codeRevision is the exact committed Git SHA of the code
// executing the run and is pinned on the run record.
export async function runBenchmarkStart(c: Context<{ Bindings: Env }>): Promise<Response> {
  const caseId = c.req.param("caseId") as string;
  const denied = await authorize(c, caseId);
  if (denied) return denied;

  let body: { codeRevision?: unknown; manualSourceEdits?: unknown } = {};
  try {
    const raw = await c.req.text();
    if (raw) body = JSON.parse(raw) as typeof body;
  } catch {
    return c.json({ error: { code: "RUN_INPUT_INVALID", message: "Request body must be JSON" } }, 400);
  }
  if (typeof body.codeRevision !== "string" || !/^[0-9a-f]{40}$/.test(body.codeRevision)) {
    return c.json(
      { error: { code: "RUN_INPUT_INVALID", message: "codeRevision is required: the exact 40-hex committed Git SHA executing this run" } },
      400
    );
  }
  let manualSourceEdits = 0;
  if (body.manualSourceEdits !== undefined) {
    if (typeof body.manualSourceEdits !== "number" || !Number.isInteger(body.manualSourceEdits) || body.manualSourceEdits < 0) {
      return c.json({ error: { code: "RUN_INPUT_INVALID", message: "manualSourceEdits must be a non-negative integer when provided" } }, 400);
    }
    manualSourceEdits = body.manualSourceEdits;
  }

  try {
    const record = await startBenchmarkRun(c.env, {
      caseId,
      codeRevision: body.codeRevision,
      manualSourceEdits,
    });
    return c.json(record);
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
