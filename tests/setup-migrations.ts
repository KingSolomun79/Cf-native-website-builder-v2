import { beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { MIGRATION_QUERIES } from "./_generated-migrations";

beforeAll(async () => {
  const applied = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reference_assets'"
  ).first<{ name: string }>();
  if (applied) return;
  for (const query of MIGRATION_QUERIES) {
    await env.DB.prepare(query).run();
  }
});
