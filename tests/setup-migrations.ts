import { beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { MIGRATION_FILES } from "./_generated-migrations";

// Applies D1 migrations to the shared test storage (isolatedStorage: false).
//
// A migration file is skipped when every object it creates already exists —
// this covers both files recorded in `_test_migrations_applied` and schema
// persisted by the older all-or-nothing setup, which kept no per-file record.
// Partially applied files are not tolerated: applying one fails loudly.
beforeAll(async () => {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS _test_migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
  ).run();

  const existingObjects = new Set(
    (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')"
      ).all<{ name: string }>()
    ).results.map((row) => row.name)
  );

  for (const file of MIGRATION_FILES) {
    const recorded = await env.DB.prepare("SELECT name FROM _test_migrations_applied WHERE name = ?")
      .bind(file.name)
      .first<{ name: string }>();

    const alreadyCreated =
      file.objects.length > 0 && file.objects.every((object) => existingObjects.has(object));

    if (recorded || alreadyCreated) {
      if (!recorded) {
        await env.DB.prepare("INSERT INTO _test_migrations_applied (name, applied_at) VALUES (?, ?)")
          .bind(file.name, new Date().toISOString())
          .run();
      }
      continue;
    }

    for (const query of file.queries) {
      await env.DB.prepare(query).run();
    }
    for (const object of file.objects) existingObjects.add(object);
    await env.DB.prepare("INSERT INTO _test_migrations_applied (name, applied_at) VALUES (?, ?)")
      .bind(file.name, new Date().toISOString())
      .run();
  }
});
