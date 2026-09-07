import type { Env } from "../../src/env.d";

export async function versionIdOf(env: Env, buildId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ?1 ORDER BY version_number DESC LIMIT 1")
    .bind(buildId)
    .first<{ id: string }>();
  if (!row) throw new Error(`no build version for ${buildId}`);
  return row.id;
}
