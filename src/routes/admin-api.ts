import { Context, Hono } from "hono";
import type { Env } from "../env.d";
import { requireCloudflareAccess } from "../domain/admin-access";
import {
  IntakeDraftError,
  editIntakeDraft,
  getIntakeDraft,
  listIntakeDrafts,
  setDraftReferenceScreenshot,
  validateAndGenerateFromDraft,
  type DraftConversionInput,
  type DraftEditInput,
} from "../domain/intake-draft";
import {
  AdminRevisionError,
  addSiteNote,
  generateRevisionFromNotes,
} from "../domain/admin-site-notes";
import { getAdminSiteReview } from "../domain/admin-review";
import { parseCreativeDirection } from "../domain/creative-direction";

// Operator admin APIs (operator GO 2026-09-12). Every route is gated by the
// Cloudflare Access guard (assertion header; signature verified when
// CF_ACCESS_TEAM_DOMAIN is configured). The admin hostname itself must sit
// behind Cloudflare Access at the edge — the guard is defense in depth, not
// the primary authz. Approval/Publication stay on their canonical
// capability-token routes; the dashboard only DISPLAYS state in this ticket.

function draftErrorResponse(error: IntakeDraftError): Response {
  const status = error.code === "DRAFT_NOT_FOUND" ? 404 : error.code === "DRAFT_IMMUTABLE" || error.code === "DRAFT_ALREADY_CONVERTED" ? 409 : 400;
  return Response.json({ error: { code: error.code, message: error.message } }, { status });
}

function revisionErrorResponse(error: AdminRevisionError): Response {
  const status =
    error.code === "SITE_NOT_FOUND" || error.code === "NOTE_NOT_FOUND" || error.code === "BUILD_NOT_FOUND" ? 404 : 400;
  return Response.json({ error: { code: error.code, message: error.message } }, { status });
}

async function guard(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  return await requireCloudflareAccess(c.env, c.req.raw);
}

// ── Intake drafts ────────────────────────────────────────────────────────────

export async function listDrafts(c: Context<{ Bindings: Env }>): Promise<Response> {
  const denied = await guard(c);
  if (denied) return denied;
  const drafts = await listIntakeDrafts(c.env, { limit: Number(c.req.query("limit") ?? 100) });
  return c.json({ drafts });
}

export async function getDraft(c: Context<{ Bindings: Env }>): Promise<Response> {
  const denied = await guard(c);
  if (denied) return denied;
  const draft = await getIntakeDraft(c.env, c.req.param("draftId") as string);
  if (!draft) return c.json({ error: { code: "DRAFT_NOT_FOUND", message: "Intake Draft not found" } }, 404);
  return c.json({ draft });
}

export async function patchDraft(c: Context<{ Bindings: Env }>): Promise<Response> {
  const denied = await guard(c);
  if (denied) return denied;
  let body: DraftEditInput;
  try {
    body = (await c.req.json()) as DraftEditInput;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  try {
    const draft = await editIntakeDraft(c.env, c.req.param("draftId") as string, body);
    return c.json({ draft });
  } catch (error) {
    if (error instanceof IntakeDraftError) return draftErrorResponse(error);
    throw error;
  }
}

export async function uploadDraftReferenceScreenshot(c: Context<{ Bindings: Env }>): Promise<Response> {
  const denied = await guard(c);
  if (denied) return denied;
  const draftId = c.req.param("draftId") as string;
  let body: { filename?: unknown; contentBase64?: unknown };
  try {
    body = (await c.req.json()) as { filename?: unknown; contentBase64?: unknown };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const contentBase64 = typeof body.contentBase64 === "string" ? body.contentBase64 : "";
  const filename = typeof body.filename === "string" ? body.filename : "reference.png";
  if (contentBase64.length === 0 || contentBase64.length > 12 * 1024 * 1024) {
    return c.json({ error: "Screenshot must be between 1 byte and 9 MB (base64)" }, 400);
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(contentBase64), (character) => character.charCodeAt(0));
  } catch {
    return c.json({ error: "contentBase64 is not valid base64" }, 400);
  }
  // Type/size validation on the DECODED bytes: PNG or JPEG magic only.
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isPng && !isJpeg) return c.json({ error: "Only PNG and JPEG reference screenshots are accepted" }, 400);
  if (bytes.byteLength > 9 * 1024 * 1024) return c.json({ error: "Screenshot exceeds 9 MB" }, 413);

  const extension = isPng ? "png" : "jpg";
  const r2Key = `reference-screenshots/drafts/${draftId}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}.${extension}`;
  await c.env.SITE_BUCKET.put(r2Key, bytes);
  try {
    const draft = await setDraftReferenceScreenshot(c.env, draftId, r2Key);
    return c.json({ draft, referenceScreenshotR2Key: r2Key }, 201);
  } catch (error) {
    if (error instanceof IntakeDraftError) return draftErrorResponse(error);
    throw error;
  }
}

export async function validateAndGenerateDraft(c: Context<{ Bindings: Env }>): Promise<Response> {
  const denied = await guard(c);
  if (denied) return denied;
  let body: { buildMode?: unknown; creativeDirection?: unknown; referenceUrl?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const buildMode = body.buildMode;
  if (buildMode !== "ORIGINAL_DESIGN" && buildMode !== "REFERENCE_BOUND") {
    return c.json({ error: { code: "DRAFT_INVALID", message: "buildMode must be ORIGINAL_DESIGN or REFERENCE_BOUND (the admin decides, never the client)" } }, 400);
  }
  const creativeDirection = body.creativeDirection === undefined ? undefined : parseCreativeDirection(body.creativeDirection) ?? undefined;
  if (body.creativeDirection !== undefined && !creativeDirection) {
    return c.json({ error: { code: "DRAFT_INVALID", message: "creativeDirection failed schema validation" } }, 400);
  }
  const conversion: DraftConversionInput = {
    buildMode,
    ...(creativeDirection ? { creativeDirection } : {}),
    ...(typeof body.referenceUrl === "string" && body.referenceUrl ? { referenceUrl: body.referenceUrl } : {}),
  };

  try {
    const { converted, alreadyConverted } = await validateAndGenerateFromDraft(c.env, c.req.param("draftId") as string, conversion, async (siteGenerationId) => {
      const instance = await c.env.WEBSITE_BUILD_WORKFLOW.create({ params: { siteGenerationId } });
      return instance.id;
    });
    return c.json(
      { ...converted, alreadyConverted },
      alreadyConverted ? 200 : 201
    );
  } catch (error) {
    if (error instanceof IntakeDraftError) return draftErrorResponse(error);
    throw error;
  }
}

// ── Site review + revision notes ─────────────────────────────────────────────

export async function getSiteReview(c: Context<{ Bindings: Env }>): Promise<Response> {
  const denied = await guard(c);
  if (denied) return denied;
  const review = await getAdminSiteReview(c.env, c.req.param("siteId") as string);
  if (!review) return c.json({ error: { code: "SITE_NOT_FOUND", message: "Site not found" } }, 404);
  return c.json({ review });
}

export async function postSiteNote(c: Context<{ Bindings: Env }>): Promise<Response> {
  const denied = await guard(c);
  if (denied) return denied;
  let body: { note?: unknown };
  try {
    body = (await c.req.json()) as { note?: unknown };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  try {
    const note = await addSiteNote(c.env, c.req.param("siteId") as string, typeof body.note === "string" ? body.note : "");
    return c.json({ note }, 201);
  } catch (error) {
    if (error instanceof AdminRevisionError) return revisionErrorResponse(error);
    throw error;
  }
}

export async function postGenerateRevision(c: Context<{ Bindings: Env }>): Promise<Response> {
  const denied = await guard(c);
  if (denied) return denied;
  let body: { noteIds?: unknown; factPatch?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  try {
    const result = await generateRevisionFromNotes(c.env, {
      siteId: c.req.param("siteId") as string,
      ...(Array.isArray(body.noteIds) ? { noteIds: body.noteIds.filter((id): id is string => typeof id === "string") } : {}),
      ...(body.factPatch !== undefined ? { factPatch: body.factPatch } : {}),
      startsWorkflow: async (siteGenerationId, buildId) => {
        const instance = await c.env.WEBSITE_BUILD_WORKFLOW.create({ params: { siteGenerationId, buildId } });
        return instance.id;
      },
    });
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof AdminRevisionError) return revisionErrorResponse(error);
    throw error;
  }
}

export function registerAdminApiRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/api/admin/intake-drafts", listDrafts);
  app.get("/api/admin/intake-drafts/:draftId", getDraft);
  app.patch("/api/admin/intake-drafts/:draftId", patchDraft);
  app.post("/api/admin/intake-drafts/:draftId/reference-screenshot", uploadDraftReferenceScreenshot);
  app.post("/api/admin/intake-drafts/:draftId/validate-and-generate", validateAndGenerateDraft);
  app.get("/api/admin/sites/:siteId", getSiteReview);
  app.post("/api/admin/sites/:siteId/notes", postSiteNote);
  app.post("/api/admin/sites/:siteId/generate-revision", postGenerateRevision);
}
