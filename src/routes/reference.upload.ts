import { Context } from "hono";
import type { Env } from "../env.d";
import { generateId } from "../lib/crypto";
import { putObject, referenceUploadStagingKey } from "../lib/assets";
import { MAX_SCREENSHOT_BYTES, REFERENCE_SCREENSHOT_MIME, validateScreenshot } from "../lib/reference-input";

export async function uploadReferenceScreenshot(c: Context<{ Bindings: Env }>): Promise<Response> {
  const authHeader = c.req.header("Authorization");
  const expected = `Bearer ${c.env.WEBHOOK_SECRET}`;
  if (!authHeader || authHeader !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.parseBody();
  const file = body["screenshot"];

  if (!(file instanceof File)) {
    return c.json({ error: "Missing 'screenshot' file field." }, 400);
  }

  if (file.size > MAX_SCREENSHOT_BYTES) {
    return c.json({ error: `Screenshot exceeds the ${MAX_SCREENSHOT_BYTES} byte limit.` }, 413);
  }

  const data = await file.arrayBuffer();
  const result = validateScreenshot({
    data,
    byteSize: file.size,
    mimeType: file.type || REFERENCE_SCREENSHOT_MIME,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, 415);
  }

  const uploadId = generateId();
  const stagingKey = referenceUploadStagingKey(uploadId);

  await putObject(c.env, stagingKey, data, {
    httpMetadata: { contentType: REFERENCE_SCREENSHOT_MIME },
    customMetadata: { "original-filename": file.name || "" },
  });

  return c.json({
    uploadId,
    r2Key: stagingKey,
    width: result.metadata.width,
    height: result.metadata.height,
    byteSize: result.metadata.byteSize,
    mimeType: result.metadata.mimeType,
  }, 201);
}
