import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyWebhookSignature } from "../lib/crypto";
import { LifecycleError, startSiteGeneration } from "../domain/lifecycle";

// V2 Onboarding Submission intake (issue #4).
//
// One fresh immutable Onboarding Submission starts exactly one new Site
// Generation for one stable Site/Business. Authenticated by the same HMAC
// scheme the V1 webhook used (X-Signature = HMAC-SHA256 of the raw body);
// Fluent-Forms-specific field names and the V1 client/job model are gone.

const ERROR_STATUS: Record<LifecycleError["code"], number> = {
  SUBMISSION_INVALID: 400,
  SITE_NOT_FOUND: 404,
  GENERATION_NOT_FOUND: 404,
  BUILD_NOT_FOUND: 404,
  SITE_MISMATCH: 409,
  BUILD_VERSION_MISMATCH: 409,
  INITIAL_BUILD_ALREADY_EXISTS: 409,
};

export function lifecycleErrorResponse(error: LifecycleError): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: ERROR_STATUS[error.code] ?? 400 }
  );
}

export async function submitOnboardingSubmission(c: Context<{ Bindings: Env }>): Promise<Response> {
  const rawBody = await c.req.text();
  const signature = c.req.header("X-Signature");
  if (!(await verifyWebhookSignature(c.env.WEBHOOK_SECRET, rawBody, signature ?? null))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: { siteId?: unknown; submission?: unknown };
  try {
    body = JSON.parse(rawBody) as { siteId?: unknown; submission?: unknown };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body.siteId !== "string" && body.siteId !== undefined) {
    return c.json({ error: "siteId must be a string when provided" }, 400);
  }

  try {
    const started = await startSiteGeneration(c.env, {
      siteId: body.siteId ?? null,
      payload: body.submission,
    });
    return c.json(
      {
        businessId: started.businessId,
        siteId: started.siteId,
        onboardingSubmissionId: started.onboardingSubmissionId,
        siteGenerationId: started.siteGenerationId,
        buildMode: started.buildMode,
        sequenceNumber: started.sequenceNumber,
      },
      201
    );
  } catch (error) {
    if (error instanceof LifecycleError) return lifecycleErrorResponse(error);
    throw error;
  }
}
