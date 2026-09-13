// Fail-closed Cloudflare Access verification (2026-09-12 integration blocker
// 2): the application-level admin guard must deny EVERY request that is not a
// cryptographically verified Access JWT for the configured team and audience.
// Missing verification configuration denies with 503
// ADMIN_ACCESS_NOT_CONFIGURED; a manufactured header can never pass.

import { beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import { listDrafts } from "../src/routes/admin-api";
import { registerAdminPageRoutes } from "../src/routes/admin-pages";
import { createAccessHarness, type AccessHarness } from "./helpers/access-test";

const access: AccessHarness = await createAccessHarness("admin-access");

const app = new Hono<{ Bindings: Env }>();
app.get("/api/admin/intake-drafts", listDrafts);
registerAdminPageRoutes(app);

function envWith(overrides: Record<string, string | undefined> = {}): Env {
  return { ...(providedEnv as unknown as Env), ...access.envVars, ...overrides } as unknown as Env;
}

const LIST_URL = "https://admin-test.example.com/api/admin/intake-drafts";

async function get(url: string, headers: Record<string, string> = {}, env: Env = envWith()): Promise<Response> {
  return await app.request(url, { method: "GET", headers }, env);
}

async function deniedDetail(response: Response): Promise<string> {
  const body = (await response.json()) as { error: string | { message?: string } };
  return typeof body.error === "string" ? body.error : body.error.message ?? "";
}

beforeAll(() => {
  access.stubFetch();
});

describe("fail-closed Cloudflare Access admin guard", () => {
  it("accepts a correctly signed, unexpired token for the configured team and audience", async () => {
    const response = await get(LIST_URL, await access.validHeaders());
    expect(response.status).toBe(200);
  });

  it("denies a missing assertion", async () => {
    const response = await get(LIST_URL);
    expect(response.status).toBe(401);
  });

  it("denies a manufactured fake header", async () => {
    const response = await get(LIST_URL, { "Cf-Access-Jwt-Assertion": "test-assertion" });
    expect(response.status).toBe(401);
    expect(await deniedDetail(response)).toContain("unparseable");
  });

  it("denies a structurally valid token signed by a key the team does not publish (bad signature)", async () => {
    const token = await access.signToken({}, access.attacker);
    const response = await get(LIST_URL, { "Cf-Access-Jwt-Assertion": token });
    expect(response.status).toBe(401);
    expect(await deniedDetail(response)).toMatch(/signature|key id/);
  });

  it("denies an expired token", async () => {
    const token = await access.signToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    const response = await get(LIST_URL, { "Cf-Access-Jwt-Assertion": token });
    expect(response.status).toBe(401);
    expect(await deniedDetail(response)).toContain("expired");
  });

  it("denies a token whose issuer is another Access team", async () => {
    const token = await access.signToken({ iss: "https://other-team.cloudflareaccess.com" });
    const response = await get(LIST_URL, { "Cf-Access-Jwt-Assertion": token });
    expect(response.status).toBe(401);
    expect(await deniedDetail(response)).toContain("issuer");
  });

  it("denies a valid expected token whose audience is another Access application", async () => {
    const token = await access.signToken({ aud: "some-other-application-aud" });
    const response = await get(LIST_URL, { "Cf-Access-Jwt-Assertion": token });
    expect(response.status).toBe(401);
    expect(await deniedDetail(response)).toContain("audience");
  });

  it("denies when CF_ACCESS_TEAM_DOMAIN is missing — even with a valid token", async () => {
    const response = await get(LIST_URL, await access.validHeaders(), envWith({ CF_ACCESS_TEAM_DOMAIN: undefined }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ADMIN_ACCESS_NOT_CONFIGURED");
  });

  it("denies when CF_ACCESS_AUD is missing — even with a valid token", async () => {
    const response = await get(LIST_URL, await access.validHeaders(), envWith({ CF_ACCESS_AUD: undefined }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ADMIN_ACCESS_NOT_CONFIGURED");
  });

  it("denies when both verification variables are missing — even without any assertion", async () => {
    const response = await get(LIST_URL, {}, envWith({ CF_ACCESS_TEAM_DOMAIN: undefined, CF_ACCESS_AUD: undefined }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ADMIN_ACCESS_NOT_CONFIGURED");
  });

  it("applies the identical contract to the /admin page surface", async () => {
    const denied = await get("https://admin-test.example.com/admin/intakes");
    expect(denied.status).toBe(401);
    const unconfigured = await get(
      "https://admin-test.example.com/admin/intakes",
      {},
      envWith({ CF_ACCESS_TEAM_DOMAIN: undefined, CF_ACCESS_AUD: undefined })
    );
    expect(unconfigured.status).toBe(503);
  });
});
