import type { Env } from "../env.d";

export async function scheduleWorkerDeletion(env: Env, workerName: string, siteId: string): Promise<void> {
  const now = new Date();
  const deleteAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await env.DB.prepare(
    `UPDATE site_versions SET worker_status = 'scheduled_delete', preview_worker_deleted_at = ? WHERE deployed_worker_name = ?`
  ).bind(deleteAt.toISOString(), workerName).run();
}

export async function cleanupExpiredWorkers(env: Env): Promise<number> {
  const now = new Date().toISOString();

  const result = await env.DB.prepare(
    `SELECT deployed_worker_name FROM site_versions
     WHERE worker_status = 'scheduled_delete' AND preview_worker_deleted_at <= ?`
  ).bind(now).all<{ deployed_worker_name: string }>();

  if (!result.results?.length) return 0;

  const { deleteWorker } = await import("./publish");
  let deleted = 0;

  for (const row of result.results) {
    try {
      await deleteWorker(env, row.deployed_worker_name);
      await env.DB.prepare(
        `UPDATE site_versions SET worker_status = 'deleted' WHERE deployed_worker_name = ?`
      ).bind(row.deployed_worker_name).run();
      deleted++;
    } catch {
      // skip failed deletions, will retry next run
    }
  }

  return deleted;
}
