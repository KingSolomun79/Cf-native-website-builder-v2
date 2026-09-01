import { Context } from "hono";
import type { Env } from "../env.d";
import { FormServiceError, acceptFormSubmission } from "../domain/form-service";

// Public browser endpoint of the central WAZIBIZ Form Service (issue #11).
//
// The browser sends only the public site/form identity plus visitor fields
// and an optional Turnstile token. Acceptance is answered ONLY after the
// platform has durably committed the Accepted Submission; Email Delivery is
// downstream with bounded server-side retry.

export async function submitForm(c: Context<{ Bindings: Env }>): Promise<Response> {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: { code: "BROWSER_PAYLOAD_CONTRACT", message: "Body must be JSON" } }, 400);
  }

  try {
    const accepted = await acceptFormSubmission(c.env, {
      origin: c.req.header("Origin") ?? null,
      remoteAddress: c.req.header("CF-Connecting-IP") ?? null,
      payload,
    });
    return c.json({ accepted: true, submissionId: accepted.submissionId }, 202);
  } catch (error) {
    if (error instanceof FormServiceError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400 | 403 | 404 | 429);
    }
    throw error;
  }
}
