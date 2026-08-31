import { Context } from "hono";
import type { Env } from "../env.d";
import { createWorker, getWorkerPreviewUrl, uploadAssets } from "../lib/publish";

type SmokeBody = {
  r2Key?: string;
  cleanup?: boolean;
};

export async function runDeploySmokeTest(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = c.req.header("Authorization")?.replace("Bearer ", "") ?? "";
  if (auth !== c.env.APPROVAL_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body: SmokeBody = await c.req.json<SmokeBody>().catch(() => ({} as SmokeBody));
  const r2Key = body.r2Key ?? "mikaranja-dz8s/versions/v1/bundle/services/index.html";
  const cleanup = body.cleanup ?? false;

  const object = await c.env.SITE_BUCKET.get(r2Key);
  if (!object) {
    return c.json({ error: `R2 object not found: ${r2Key}` }, 404);
  }

  const html = await object.text();
  const workerName = `smoke-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const files = new Map<string, string | ArrayBuffer>([["index.html", html]]);

  console.log("Starting Cloudflare deploy smoke test", {
    r2Key,
    workerName,
    cleanup,
    accountId: c.env.CF_ACCOUNT_ID,
  });

  const uploadJwt = await uploadAssets(c.env, workerName, files);
  await createWorker(c.env, workerName, uploadJwt, "smoke-test@wazibizwebsites.com");
  const previewUrl = await getWorkerPreviewUrl(c.env, workerName);

  if (cleanup) {
    const { deleteWorker } = await import("../lib/publish");
    await deleteWorker(c.env, workerName);
  }

  return c.json({
    ok: true,
    r2Key,
    workerName,
    previewUrl,
    cleanedUp: cleanup,
  });
}
