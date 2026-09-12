// TEMPORARY CANARY (final secret hygiene, 2026-09-12) — REMOVED BEFORE MERGE.
//
// Exists ONLY to run small Z.AI Coding Plan canaries (glm-5.3 text,
// glm-5.3-flash vision) against PREVIEW VERSIONS (wrangler versions upload
// --preview-alias) of the sandbox and production Workers, proving the
// canonical ZAI_CODING_API_KEY credential works before the legacy alias is
// deleted from the Workers. Never deployed to traffic; the route is deleted
// in the same branch before merge, so the merged production surface stays
// exactly as clean as before.
//
// Gate: HMAC X-Signature over the raw body with WEBHOOK_SECRET — the same
// intake-class HMAC gate every operator route uses. Responses carry verdicts
// and provider metadata only — never credential material, never prompt
// content beyond the fixed canary phrase.

import { Context } from "hono";
import type { Env } from "../env.d";
import { generateZaiCodingPlan, ZaiCodingPlanTransportError } from "../lib/zai-coding-plan";

// 1x1 transparent PNG — the smallest valid image input for the vision canary.
const CANARY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export async function tmpLlmCanary(c: Context<{ Bindings: Env }>): Promise<Response> {
  // Gated by an EPHEMERAL random token injected as a version var for this
  // throwaway probe only (the sandbox WEBHOOK_SECRET predates the local V2
  // .dev.vars and must not be touched). The var and this route are removed
  // before merge.
  const token = c.req.header("X-Canary-Token");
  if (!c.env.TMP_CANARY_TOKEN || token !== c.env.TMP_CANARY_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: { op?: string };
  try {
    body = JSON.parse(await c.req.text()) as { op?: string };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const zaiConfigured = Boolean(c.env.ZAI_CODING_API_KEY);
  if (body.op === "text") {
    const started = Date.now();
    try {
      const result = await generateZaiCodingPlan(c.env, {
        model: "glm-5.3",
        messages: [
          { role: "system", content: "You are a transport canary. Reply with exactly the requested text and nothing else." },
          { role: "user", content: "Reply with exactly: ok" },
        ],
        maxTokens: 32,
        stream: false,
        label: "tmp-canary-text",
      });
      return c.json({
        op: "text",
        zaiConfigured,
        verdict: result.contentChars > 0 ? "PASS" : "EMPTY_CONTENT",
        model: result.model,
        providerModel: result.providerModel,
        finishReason: result.finishReason,
        contentOk: result.content.trim() === "ok",
        contentChars: result.contentChars,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      return c.json({
        op: "text",
        zaiConfigured,
        verdict: "FAIL",
        errorClass: error instanceof ZaiCodingPlanTransportError ? "TRANSPORT" : "UNKNOWN",
        error: (error as Error).message.slice(0, 200),
        durationMs: Date.now() - started,
      });
    }
  }

  if (body.op === "vision") {
    const started = Date.now();
    try {
      const result = await generateZaiCodingPlan(c.env, {
        model: "glm-5.3-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/png;base64,${CANARY_PNG_BASE64}` } },
              { type: "text", text: "Reply with exactly: ok" },
            ],
          },
        ],
        maxTokens: 64,
        stream: false,
        label: "tmp-canary-vision",
      });
      return c.json({
        op: "vision",
        zaiConfigured,
        verdict: result.contentChars > 0 ? "PASS" : "EMPTY_CONTENT",
        model: result.model,
        providerModel: result.providerModel,
        finishReason: result.finishReason,
        contentOk: result.content.trim().toLowerCase().includes("ok"),
        contentChars: result.contentChars,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      return c.json({
        op: "vision",
        zaiConfigured,
        verdict: "FAIL",
        errorClass: error instanceof ZaiCodingPlanTransportError ? "TRANSPORT" : "UNKNOWN",
        error: (error as Error).message.slice(0, 200),
        durationMs: Date.now() - started,
      });
    }
  }

  return c.json({ error: "Unknown op (text|vision)" }, 400);
}
