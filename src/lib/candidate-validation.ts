import type { Context } from "hono";
import type { Env } from "../env.d";
import { candidateValidationArtifactKey, putImmutableObject } from "./assets";
import { generateVisionWithGateway, type VisionChatRequester } from "./ai-gateway";
import { completeCandidateValidationRun, createCandidateValidationRun } from "./db";
import { generateId, nowIso, verifyCandidateValidationCapability } from "./crypto";
import { prepareVisionInput, VisionInputPreparationError } from "./vision-input";

export type CandidateValidationScenarioName = "normal_screenshot" | "oversized_derivative" | "corrupt_input" | "hung_provider_fallback";

export interface CandidateValidationScenario {
  name: CandidateValidationScenarioName;
  status: "passed";
  evidenceR2Keys: string[];
  details: Record<string, unknown>;
}

export interface CandidateValidationReport {
  schemaVersion: 1;
  runId: string;
  status: "passed" | "failed";
  createdAt: string;
  completedAt: string;
  scenarios: CandidateValidationScenario[];
  failure?: string;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + data.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.byteLength, false);
  for (let index = 0; index < 4; index++) bytes[4 + index] = type.charCodeAt(index);
  bytes.set(data, 8);
  view.setUint32(bytes.byteLength - 4, crc32(bytes.slice(4, bytes.byteLength - 4)), false);
  return bytes;
}

function zlibStored(raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let offset = 0; offset < raw.byteLength;) {
    const length = Math.min(65535, raw.byteLength - offset);
    const block = new Uint8Array(5 + length);
    block[0] = offset + length === raw.byteLength ? 1 : 0;
    const view = new DataView(block.buffer);
    view.setUint16(1, length, true);
    view.setUint16(3, (~length) & 0xffff, true);
    block.set(raw.slice(offset, offset + length), 5);
    parts.push(block);
    offset += length;
  }
  const checksum = new Uint8Array(4);
  new DataView(checksum.buffer).setUint32(0, adler32(raw), false);
  parts.push(checksum);
  return concatenate(parts);
}

function candidatePng(extraMetadataBytes = 0): ArrayBuffer {
  const width = 1024;
  const height = 768;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const line = y * (1 + width * 3);
    raw[line] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = line + 1 + x * 3;
      raw[pixel] = (x + y) % 255;
      raw[pixel + 1] = (x * 2) % 255;
      raw[pixel + 2] = (y * 2) % 255;
    }
  }
  const parts = [new Uint8Array(PNG_SIGNATURE), pngChunk("IHDR", header), pngChunk("IDAT", zlibStored(raw))];
  if (extraMetadataBytes > 0) {
    const metadata = new Uint8Array(extraMetadataBytes + 5);
    metadata.set(new TextEncoder().encode("note\0"));
    metadata.fill(120, 5);
    parts.push(pngChunk("tEXt", metadata));
  }
  parts.push(pngChunk("IEND", new Uint8Array()));
  return concatenate(parts).slice().buffer as ArrayBuffer;
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function hungThenFallbackRequester(): VisionChatRequester {
  return async (_env, _body, _meta, provider, signal) => {
    if (provider === "openrouter") {
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Candidate primary request aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new DOMException("Candidate primary request aborted", "AbortError")), { once: true });
      });
    }
    return Response.json({ choices: [{ message: { content: "{\"result\":\"fallback-ok\"}" } }] });
  };
}

function validationEnv(env: Env): Env {
  return {
    ...env,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY || "candidate-validation-openrouter",
    CF_AIG_TOKEN: env.CF_AIG_TOKEN || "candidate-validation-gateway",
    CF_ACCOUNT_ID: env.CF_ACCOUNT_ID || "candidate-validation-account",
    CF_AI_GATEWAY_ID: env.CF_AI_GATEWAY_ID || "candidate-validation-gateway",
    VISION_PRIMARY_PROVIDER: "openrouter",
    VISION_PRIMARY_MODEL: "candidate-primary",
    VISION_FALLBACK_PROVIDER: "ai-gateway",
    VISION_FALLBACK_MODEL: "candidate-fallback",
    VISION_REQUEST_TIMEOUT_MS: "1000",
    VISION_MAX_ATTEMPTS_PER_PROVIDER: "1",
    VISION_RETRY_DELAY_MS: "0",
    VISION_INPUT_MAX_BYTES: "4194304",
    VISION_INPUT_MAX_WIDTH: "1920",
    VISION_INPUT_MAX_HEIGHT: "12000",
  };
}

async function storeFixture(env: Env, runId: string, name: string, data: ArrayBuffer): Promise<string> {
  const key = candidateValidationArtifactKey(runId, `inputs/${name}.png`);
  await putImmutableObject(env, key, data, { httpMetadata: { contentType: "image/png" } });
  return key;
}

export async function runCandidateValidation(env: Env, runId: string): Promise<CandidateValidationReport> {
  const startedAt = nowIso();
  const activeEnv = validationEnv(env);
  const normalFixture = candidatePng();
  const normalKey = await storeFixture(activeEnv, runId, "normal", normalFixture);
  const normal = await prepareVisionInput(activeEnv, { clientSlug: "candidate-validation", siteVersion: 1, jobId: runId, screenshotR2Key: normalKey });
  if (normal.artifact.derived) throw new Error("Normal screenshot unexpectedly created a derivative");

  const oversizedFixture = candidatePng(2 * 1024 * 1024);
  const oversizedKey = await storeFixture(activeEnv, runId, "oversized", oversizedFixture);
  const oversized = await prepareVisionInput(activeEnv, { clientSlug: "candidate-validation", siteVersion: 1, jobId: runId, screenshotR2Key: oversizedKey });
  if (!oversized.artifact.derived) throw new Error("Oversized screenshot did not create a derivative");

  const corrupt = new Uint8Array(candidatePng());
  corrupt[corrupt.byteLength - 1] ^= 0xff;
  const corruptKey = await storeFixture(activeEnv, runId, "corrupt", corrupt.slice().buffer as ArrayBuffer);
  let corruptCode: string | null = null;
  try {
    await prepareVisionInput(activeEnv, { clientSlug: "candidate-validation", siteVersion: 1, jobId: runId, screenshotR2Key: corruptKey });
  } catch (error) {
    if (error instanceof VisionInputPreparationError) corruptCode = error.code;
    else throw error;
  }
  if (corruptCode !== "VISION_INPUT_CORRUPT") throw new Error(`Corrupt screenshot did not fail closed: ${corruptCode ?? "unknown"}`);

  const fallbackDiagnosticsKey = candidateValidationArtifactKey(runId, "vision/hung-provider-fallback.json");
  const fallback = await generateVisionWithGateway(
    activeEnv,
    toBase64(normal.data),
    normal.artifact.mimeType,
    "Return a JSON confirmation.",
    { job_id: runId, site_id: "candidate-validation", client_slug: "candidate-validation", style_key: "candidate-validation", prompt_type: "vision_analysis" },
    { jsonMode: true, diagnosticR2Key: fallbackDiagnosticsKey, stage: "candidate-validation", visionInput: normal.artifact, requester: hungThenFallbackRequester() }
  );
  if (fallback.provider !== "ai-gateway") throw new Error(`Hung primary did not fall back: ${fallback.provider}`);

  const completedAt = nowIso();
  return {
    schemaVersion: 1,
    runId,
    status: "passed",
    createdAt: startedAt,
    completedAt,
    scenarios: [
      { name: "normal_screenshot", status: "passed", evidenceR2Keys: [normalKey], details: { derived: normal.artifact.derived, byteSize: normalFixture.byteLength } },
      { name: "oversized_derivative", status: "passed", evidenceR2Keys: [oversizedKey, oversized.artifact.r2Key], details: { derived: oversized.artifact.derived, sourceByteSize: oversizedFixture.byteLength, derivativeByteSize: oversized.artifact.byteSize } },
      { name: "corrupt_input", status: "passed", evidenceR2Keys: [corruptKey], details: { failureCode: corruptCode } },
      { name: "hung_provider_fallback", status: "passed", evidenceR2Keys: [fallbackDiagnosticsKey], details: { provider: fallback.provider, model: fallback.model } },
    ],
  };
}

export async function handleCandidateValidation(c: Context<{ Bindings: Env }>): Promise<Response> {
  if (c.env.CANDIDATE_VALIDATION_ENABLED !== "true") return c.json({ error: "Not found" }, 404);
  if (!c.env.CANDIDATE_VALIDATION_SECRET) return c.json({ error: "Candidate validation is not configured" }, 503);
  const token = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const capability = await verifyCandidateValidationCapability(c.env, token);
  if (!capability) return c.json({ error: "Unauthorized" }, 401);

  const runId = generateId();
  const reportR2Key = candidateValidationArtifactKey(runId, "report.json");
  const createdAt = nowIso();
  const created = await createCandidateValidationRun(c.env.DB, {
    id: runId,
    nonce: capability.nonce,
    status: "running",
    report_r2_key: reportR2Key,
    summary_json: "{}",
    created_at: createdAt,
    completed_at: null,
  });
  if (!created) return c.json({ error: "Capability already used" }, 409);

  let report: CandidateValidationReport;
  try {
    report = await runCandidateValidation(c.env, runId);
  } catch (error) {
    report = { schemaVersion: 1, runId, status: "failed", createdAt, completedAt: nowIso(), scenarios: [], failure: error instanceof Error ? error.message : "Candidate validation failed" };
  }
  await putImmutableObject(c.env, reportR2Key, JSON.stringify(report, null, 2), { httpMetadata: { contentType: "application/json" } });
  await completeCandidateValidationRun(c.env.DB, runId, { status: report.status, summary_json: JSON.stringify({ status: report.status, scenarios: report.scenarios.map((scenario) => scenario.name), failure: report.failure ?? null }), completed_at: report.completedAt });
  return c.json({ runId, status: report.status, reportR2Key, scenarios: report.scenarios }, report.status === "passed" ? 200 : 500);
}
