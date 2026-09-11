import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyWebhookSignature } from "../lib/crypto";
import { RevisionError, createRevisionBuild, getRevisionRequestView } from "../domain/revision";

// V2 Revision Request intake (issue #5).
//
// A human-requested change that preserves Reference and Build Mode starts a
// new Build derived from a parent Build. Design-origin changes are rejected
// here with DESIGN_ORIGIN_IMMUTABLE and require a new Site Generation.

const ERROR_STATUS: Record<RevisionError["code"], number> = {
  BUILD_NOT_FOUND: 404,
  GENERATION_NOT_FOUND: 404,
  REVISION_INVALID: 400,
  DESIGN_ORIGIN_IMMUTABLE: 422,
  FACT_UPDATE_INVALID: 400,
  ORIGINAL_DESIGN_NOT_ENABLED: 423,
};

export function revisionErrorResponse(error: RevisionError): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: ERROR_STATUS[error.code] ?? 400 }
  );
}

export async function createRevisionRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  const rawBody = await c.req.text();
  const signature = c.req.header("X-Signature");
  if (!(await verifyWebhookSignature(c.env.WEBHOOK_SECRET, rawBody, signature ?? null))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: { revisionRequest?: unknown };
  try {
    body = JSON.parse(rawBody) as { revisionRequest?: unknown };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const buildId = c.req.param("buildId");
  if (!buildId) {
    return c.json({ error: "Missing buildId" }, 400);
  }

  try {
    const created = await createRevisionBuild(c.env, {
      parentBuildId: buildId,
      payload: body.revisionRequest,
    });
    return c.json(
      {
        revisionRequestId: created.revisionRequestId,
        buildId: created.buildId,
        buildVersionId: created.buildVersionId,
        buildVersionNumber: created.buildVersionNumber,
        factUpdateCount: created.factUpdateCount,
        effectiveFacts: created.effectiveFacts,
      },
      201
    );
  } catch (error) {
    if (error instanceof RevisionError) return revisionErrorResponse(error);
    throw error;
  }
}

export async function getRevisionRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  const buildId = c.req.param("buildId");
  if (!buildId) {
    return c.json({ error: "Missing buildId" }, 400);
  }
  const view = await getRevisionRequestView(c.env, buildId);
  if (!view) {
    return c.json({ error: { code: "REVISION_NOT_FOUND", message: "Build has no Revision Request" } }, 404);
  }
  return c.json(view);
}
