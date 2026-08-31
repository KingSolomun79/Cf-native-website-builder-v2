// Minimal worker entry for the @cloudflare/vitest-pool-workers test project.
// The persistence tests run as test modules inside this worker and read the
// DB / SITE_BUCKET bindings declared in wrangler.test.jsonc. We deliberately do
// NOT import src/index.ts here: that pulls in Durable Object / Workflow / Browser
// bindings that require live secrets, which the persistence tests do not need.
export default {
  async fetch() {
    return new Response("ok", { status: 200 });
  },
};
