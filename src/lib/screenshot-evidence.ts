// Phase 16.R4: persist screenshot-derived vision evidence.
//
// Reads the accepted homepage screenshot from its persisted R2 key, sends the
// actual image bytes through a vision-capable AI Gateway call, parses the
// structured observations, schema-validates them, and persists a
// ScreenshotEvidenceArtifact with provider + model provenance. The model can
// never claim screenshot grounding when this artifact does not exist: if vision
// evidence cannot be produced, fail closed.

import type { Env } from "../env.d";
import type { GatewayMeta } from "../types";
import type { ScreenshotEvidenceArtifact, ScreenshotObservation } from "./blueprint-schema-v2";
import { getObject, putImmutableObject, visionAttemptDiagnosticsKey } from "./assets";
import { generateVisionWithGateway, VisionGatewayError } from "./ai-gateway";
import { checkScreenshotArtifact } from "./blueprint-schema-v2";
import { nowIso } from "./crypto";
import { prepareVisionInput, VisionInputPreparationError } from "./vision-input";

export interface ScreenshotEvidenceParams {
  jobId: string;
  siteId: string;
  clientSlug: string;
  screenshotR2Key: string;
  artifactR2Key: string;
}

export interface ScreenshotEvidenceResult {
  artifact: ScreenshotEvidenceArtifact;
  artifactR2Key: string;
}

export const MAX_SCREENSHOT_ANALYSIS_ATTEMPTS = 2;

export function buildScreenshotAnalysisPrompt(previousFailure?: string): string {
  return `You are analyzing a full-page homepage screenshot for a website builder.
Output STRICT JSON with one top-level key "observations": an array of structured observations about the
visible design. Each observation MUST be an object with fields:
- id: a stable id prefixed "screenshot:" then category and index, e.g. "screenshot:layout:0"
- source: the literal string "screenshot"
- category: one of layout, typography, color, spacing, imagery, navigation, surfaces, interaction, overall
- region: { label, x, y, width, height } where x/y/width/height are NORMALIZED fractions 0..1 of the image
- observation: a concise factual description of what is visible
- confidence: a number from 0 to 1
- artifactKey: leave as empty string

The region object is REQUIRED for every observation and MUST contain all five fields exactly: label (string),
x (number), y (number), width (number), height (number). Each numeric region value must be between 0 and 1.
Never use null for a required field. For example: {"id":"screenshot:layout:0","source":"screenshot","category":"layout","region":{"label":"hero","x":0,"y":0.1,"width":1,"height":0.4},"observation":"Split hero with copy and an image","confidence":0.9,"artifactKey":""}.

Cover at minimum: hero/layout, navigation structure, primary typography, the dominant color scheme,
section spacing rhythm, and any visible interactive elements (buttons, menus, accordions). Do NOT invent
details you cannot see. Do NOT include any renderer-specific tokens (no Tailwind, shadcn, React, className).
${previousFailure ? `Your previous response was invalid: ${previousFailure}. Correct every listed problem.` : ""}
Return ONLY the JSON object.`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function parseScreenshotObservations(content: string): ScreenshotObservation[] {
  const cleaned = content.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { observations?: ScreenshotObservation[] };
  const observations = Array.isArray(parsed.observations) ? parsed.observations : [];
  return observations.map((o, i) => ({
    id: o.id && typeof o.id === "string" ? o.id : `screenshot:${o.category ?? "overall"}:${i}`,
    source: "screenshot" as const,
    category: o.category ?? "overall",
    region: o.region,
    observation: typeof o.observation === "string" ? o.observation : "",
    confidence: typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0.5,
    artifactKey: "",
  }));
}

export async function produceScreenshotEvidence(
  env: Env,
  params: ScreenshotEvidenceParams
): Promise<ScreenshotEvidenceResult> {
  let visionInput: Awaited<ReturnType<typeof prepareVisionInput>>;
  try {
    visionInput = await prepareVisionInput(env, { ...params, siteVersion: 1 });
  } catch (error) {
    if (error instanceof VisionInputPreparationError) {
      throw new ScreenshotEvidenceUnavailableError(error.code, error.message);
    }
    throw error;
  }
  const base64 = arrayBufferToBase64(visionInput.data);

  const meta: GatewayMeta = {
    job_id: params.jobId,
    site_id: params.siteId,
    client_slug: params.clientSlug,
    prompt_type: "vision_analysis",
    style_key: "reference-driven",
  };

  let failure: string | null = null;
  for (let attempt = 1; attempt <= MAX_SCREENSHOT_ANALYSIS_ATTEMPTS; attempt++) {
    let result: Awaited<ReturnType<typeof generateVisionWithGateway>>;
    try {
      result = await generateVisionWithGateway(env, base64, visionInput.artifact.mimeType, buildScreenshotAnalysisPrompt(failure ?? undefined), meta, {
        maxTokens: 4096,
        jsonMode: true,
        diagnosticR2Key: visionAttemptDiagnosticsKey(params.clientSlug, 1, params.jobId, "screenshot-evidence", crypto.randomUUID()),
        stage: "screenshot-evidence",
        visionInput: visionInput.artifact,
      });
    } catch (error) {
      if (error instanceof VisionGatewayError) {
        throw new ScreenshotEvidenceUnavailableError("VISION_EVIDENCE_EXHAUSTED", `All vision providers failed; diagnostic artifact: ${error.diagnosticR2Key ?? "unavailable"}`);
      }
      throw error;
    }

    try {
      const observations = parseScreenshotObservations(result.content);
      if (observations.length === 0) {
        failure = "Screenshot vision produced no observations";
        continue;
      }
      const artifact: ScreenshotEvidenceArtifact = {
        schemaVersion: 1,
        screenshotR2Key: params.screenshotR2Key,
        visionInput: visionInput.artifact,
        provider: result.provider,
        model: result.model,
        observations,
        createdAt: nowIso(),
      };
      const check = checkScreenshotArtifact(artifact);
      if (!check.ok) {
        failure = `Screenshot artifact failed schema validation: ${check.diagnostics.map((d) => d.message).join("; ")}`;
        continue;
      }
      await putImmutableObject(env, params.artifactR2Key, JSON.stringify(artifact, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
      return { artifact, artifactR2Key: params.artifactR2Key };
    } catch (err) {
      failure = `Screenshot vision returned unparseable JSON: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new ScreenshotEvidenceUnavailableError("VISION_EVIDENCE_INVALID", failure ?? "Screenshot evidence unavailable");
}

export class ScreenshotEvidenceUnavailableError extends Error {
  constructor(readonly code: "SCREENSHOT_INPUT_UNAVAILABLE" | "VISION_EVIDENCE_EXHAUSTED" | "VISION_EVIDENCE_INVALID" | "VISION_INPUT_UNAVAILABLE" | "VISION_INPUT_UNSUPPORTED" | "VISION_INPUT_CORRUPT" | "VISION_INPUT_DERIVATIVE_FAILED", message: string) {
    super(message);
    this.name = "ScreenshotEvidenceUnavailableError";
  }
}

// Load a previously persisted screenshot evidence artifact (used by the registry builder).
export async function loadScreenshotEvidence(env: Env, artifactR2Key: string): Promise<ScreenshotEvidenceArtifact | null> {
  const body = await getObject(env, artifactR2Key);
  if (!body) return null;
  return new Response(body).json() as Promise<ScreenshotEvidenceArtifact>;
}
