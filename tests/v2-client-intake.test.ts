// Public client intake (operator GO 2026-09-12): the public form creates a
// MUTABLE Intake Draft and can NEVER start a Site Generation. Protected by
// Turnstile + strict origin allowlist + hashed-IP rate limiting — never
// WEBHOOK_SECRET.

import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import { submitClientIntake, preflightClientIntake } from "../src/routes/public-client-intake";
import { canonicalStructuredFacts } from "./helpers/canonical-facts";

function runtimeEnv(): Env {
  return {
    ...(providedEnv as unknown as Env),
    WEBHOOK_SECRET: "test-webhook-secret",
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    WAZIBIZ_SENDER_EMAIL: "notifications@wazibiz.ke",
    WAZIBIZ_ADMIN_EMAIL: "admin@wazibiz.ke",
  };
}

function app(_env: Env): Hono<{ Bindings: Env }> {
  const hono = new Hono<{ Bindings: Env }>();
  hono.post("/api/public/client-intakes", submitClientIntake);
  hono.on("OPTIONS", "/api/public/client-intakes", preflightClientIntake);
  return hono;
}

const ORIGIN = "https://wazibiz.ke";

function draftPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    submitter: { name: "Jane Submitter", email: "jane@submitter.example" },
    business: {
      businessName: "Harbour Lights Cafe",
      contactEmail: "hello@harbourlights.example",
      businessType: "Neighbourhood cafe",
      businessDescription: "Small cafe serving breakfast and filter coffee by the water.",
      city: "Mombasa",
      country: "Kenya",
      ...canonicalStructuredFacts(),
    },
    designPreferences: { direction: "Nautical but restrained: navy, cream, old rope details" },
    turnstileToken: "valid-token",
    ...overrides,
  };
}

async function post(app: Hono<{ Bindings: Env }>, env: Env, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request("https://test.example.com/api/public/client-intakes", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  }, env);
}

async function draftCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM client_intake_drafts").first<{ n: number }>();
  return row?.n ?? 0;
}

beforeAll(async () => {
  // Deterministic Turnstile success for most tests (individual tests re-stub).
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
});

describe("public client intake", () => {
  it("accepts a valid brief as a SUBMITTED draft and never starts a Site Generation", async ({ task }) => {
    const env = runtimeEnv();
    const before = await draftCount(env);
    const response = await post(app(env), env, draftPayload());
    expect(response.status).toBe(201);
    const body = (await response.json()) as { draftId: string; status: string };
    expect(body.status).toBe("SUBMITTED");

    // Draft persisted (queried by id — D1 test storage is shared across suites).
    expect(await draftCount(env)).toBe(before + 1);
    const row = await env.DB.prepare("SELECT status, submitter_name, business_name FROM client_intake_drafts WHERE id = ?")
      .bind(body.draftId)
      .first<{ status: string; submitter_name: string; business_name: string }>();
    expect(row?.submitter_name).toBe("Jane Submitter");
    expect(row?.business_name).toBe("Harbour Lights Cafe");

    // NO canonical generation artifacts exist for this draft: a public
    // submission never creates a Site Generation or Build.
    expect(
      await env.DB.prepare("SELECT converted_site_generation_id FROM client_intake_drafts WHERE id = ?")
        .bind(body.draftId)
        .first<{ converted_site_generation_id: string | null }>()
    ).toMatchObject({ converted_site_generation_id: null });

    // An admin notification was enqueued for the new brief (dedupe key present).
    const notification = await env.DB.prepare(
      "SELECT kind FROM admin_notifications WHERE dedupe_key = ?"
    )
      .bind(`intake-new:${body.draftId}`)
      .first<{ kind: string }>();
    expect(notification?.kind).toBe("INTAKE_NEW");
    void task;
  });

  it("rejects fewer than three services", async () => {
    const env = runtimeEnv();
    const payload = draftPayload();
    (payload.business as Record<string, unknown>).services = [{ name: "Only One" }];
    const response = await post(app(env), env, payload);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { issues: Array<{ path: string }> } };
    expect(body.error.issues.some((issue) => issue.path.includes("services"))).toBe(true);
  });

  it("accepts three or more services and an optional competitive differentiator", async () => {
    const env = runtimeEnv();
    const withDifferentiator = draftPayload();
    expect((await post(app(env), env, withDifferentiator)).status).toBe(201);

    const withoutDifferentiator = JSON.parse(JSON.stringify(draftPayload())) as Record<string, unknown>;
    (withoutDifferentiator.business as Record<string, unknown>).businessName = "Differentiator Optional Cafe";
    delete (withoutDifferentiator.business as Record<string, unknown>).competitiveDifferentiator;
    expect((await post(app(env), env, withoutDifferentiator)).status).toBe(201);
  });

  it("requires all seven business-hour days and rejects malformed OPEN windows", async () => {
    const env = runtimeEnv();

    const missingSunday = JSON.parse(JSON.stringify(draftPayload())) as Record<string, unknown>;
    delete ((missingSunday.business as Record<string, unknown>).businessHours as Record<string, unknown>).sunday;
    expect((await post(app(env), env, missingSunday)).status).toBe(400);

    const badTime = JSON.parse(JSON.stringify(draftPayload())) as Record<string, unknown>;
    ((badTime.business as Record<string, unknown>).businessHours as Record<string, unknown>).monday = {
      status: "OPEN",
      open: "25:00",
      close: "17:00",
    };
    expect((await post(app(env), env, badTime)).status).toBe(400);

    const closedDay = JSON.parse(JSON.stringify(draftPayload())) as Record<string, unknown>;
    ((closedDay.business as Record<string, unknown>).businessHours as Record<string, unknown>).sunday = { status: "CLOSED" };
    expect((await post(app(env), env, closedDay)).status).toBe(201);
  });

  it("answers the CORS preflight for the allowlisted origin only", async () => {
    const env = runtimeEnv();
    const preflight = await app(env).request("https://test.example.com/api/public/client-intakes", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    }, env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");

    const foreign = await app(env).request("https://test.example.com/api/public/client-intakes", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    }, env);
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("marks success and error responses readable for the allowlisted origin", async () => {
    const env = runtimeEnv();
    const accepted = await post(app(env), env, draftPayload(), { "CF-Connecting-IP": crypto.randomUUID() });
    expect(accepted.status).toBe(201);
    expect(accepted.headers.get("access-control-allow-origin")).toBe(ORIGIN);

    // A Turnstile rejection is still READABLE by the mapper (CORS header
    // present) — fail closed, not fail opaque.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
    const rejected = await post(app(env), env, draftPayload(), { "CF-Connecting-IP": crypto.randomUUID() });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("rejects a TURNSTILE failure before any durable write", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
    const env = runtimeEnv();
    const before = await draftCount(env);
    const noToken = JSON.parse(JSON.stringify(draftPayload())) as Record<string, unknown>;
    noToken.turnstileToken = "";
    const failed = await post(app(env), env, noToken);
    const missing = await post(app(env), env, (({ turnstileToken: _token, ...rest }) => rest)(JSON.parse(JSON.stringify(draftPayload())) as Record<string, unknown>));
    expect(failed.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await draftCount(env)).toBe(before);
  });

  it("rejects origins outside the allowlist", async () => {
    const env = runtimeEnv();
    const response = await app(env).request("https://test.example.com/api/public/client-intakes", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify(draftPayload()),
    }, env);
    expect(response.status).toBe(403);
    const noOrigin = await app(env).request("https://test.example.com/api/public/client-intakes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draftPayload()),
    }, env);
    expect(noOrigin.status).toBe(403);
  });

  it("rate limits by hashed remote address within the window", async () => {
    const env = runtimeEnv();
    const headers = { "CF-Connecting-IP": "203.0.113.10" };
    for (let i = 0; i < 5; i++) {
      const unique = draftPayload();
      (unique.business as Record<string, unknown>).businessName = `Rate Limit Cafe ${i}`;
      (unique.submitter as Record<string, unknown>).email = `rl${i}@submitter.example`;
      expect((await post(app(env), env, unique, headers)).status).toBe(201);
    }
    const sixth = draftPayload();
    (sixth.business as Record<string, unknown>).businessName = "Rate Limit Cafe 6";
    const response = await post(app(env), env, sixth, headers);
    expect(response.status).toBe(429);
    // No raw IP anywhere in the rate table.
    const rows = await env.DB.prepare("SELECT hashed_ip FROM public_intake_rate_limits").all<{ hashed_ip: string }>();
    for (const row of rows.results ?? []) expect(row.hashed_ip).not.toContain("203.0.113.10");
  });
});
