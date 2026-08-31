import { Context } from "hono";
import type { Env } from "../env.d";
import { putObject, pageImageKey } from "../lib/assets";

export async function handleKieCallback(c: Context<{ Bindings: Env }>): Promise<Response> {
  const body = await c.req.json();

  const taskId = body.data?.taskId;
  const state = body.data?.state;
  const resultJson = body.data?.resultJson;

  if (!taskId || !state) {
    return c.json({ error: "Missing taskId or state" }, 400);
  }

  const dbStatus = state === "success" ? "complete" : "failed";

  await c.env.DB.prepare(
    `UPDATE image_assets SET status = ? WHERE source_job_ref = ?`
  ).bind(dbStatus, taskId).run();

  if (state === "success" && resultJson) {
    try {
      const parsed = JSON.parse(resultJson) as { resultUrls?: string[] };
      const imageUrl = parsed.resultUrls?.[0];

      if (imageUrl) {
        const imageAsset = await c.env.DB.prepare(
          `SELECT id, page_name, slot_name, site_version_id FROM image_assets WHERE source_job_ref = ?`
        ).bind(taskId).first<{
          id: string;
          page_name: string;
          slot_name: string;
          site_version_id: string;
        }>();

        if (imageAsset) {
          const imageResp = await fetch(imageUrl);
          if (imageResp.ok) {
            const imageData = await imageResp.arrayBuffer();

            const siteVersion = await c.env.DB.prepare(
              `SELECT site_id, version_number FROM site_versions WHERE id = ?`
            ).bind(imageAsset.site_version_id).first<{
              site_id: string;
              version_number: number;
            }>();

            if (siteVersion) {
              const site = await c.env.DB.prepare(
                `SELECT client_id FROM sites WHERE id = ?`
              ).bind(siteVersion.site_id).first<{ client_id: string }>();

              if (site) {
                const client = await c.env.DB.prepare(
                  `SELECT slug FROM clients WHERE id = ?`
                ).bind(site.client_id).first<{ slug: string }>();

                if (client) {
                  const r2Key = pageImageKey(
                    client.slug,
                    siteVersion.version_number,
                    imageAsset.page_name,
                    `${imageAsset.slot_name}-01.webp`
                  );

                  await putObject(c.env, r2Key, imageData, {
                    httpMetadata: { contentType: "image/png" },
                  });

                  await c.env.DB.prepare(
                    `UPDATE image_assets SET r2_key = ?, mime_type = ?, width = 1200, height = 675 WHERE id = ?`
                  ).bind(r2Key, "image/png", imageAsset.id).run();
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`Failed to download image for callback task ${taskId}:`, err);
    }
  }

  return c.json({ ok: true });
}
