import { describe, expect, it } from "vitest";
import { uploadReferenceScreenshot } from "../src/routes/reference.upload";
import { handleFluentFormsWebhook } from "../src/routes/webhook.fluentforms";
import { hmacSha256 } from "../src/lib/crypto";
import { buildPng } from "./helpers/png";
import type { Env } from "../src/env.d";

async function sign(secret: string, body: string): Promise<string> {
  return hmacSha256(secret, body);
}

interface MemoryR2 {
  data: Map<string, { body: ArrayBuffer; httpMetadata?: Record<string, unknown>; customMetadata?: Record<string, string> }>;
  putShouldFail?: boolean;
  deleteShouldFail?: boolean;
}

function makeR2(mem: MemoryR2): R2Bucket {
  return {
    async get(key) {
      const entry = mem.data.get(key);
      if (!entry) return null;
      const body = entry.body.slice(0);
      return {
        body,
        etag: "etag",
        httpEtag: "etag",
        size: body.byteLength,
        httpMetadata: (entry.httpMetadata ?? {}) as R2HTTPMetadata,
        customMetadata: (entry.customMetadata ?? {}) as Record<string, string>,
        writeHttpMetadata() {},
        arrayBuffer: () => Promise.resolve(body),
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({}),
        blob: () => Promise.resolve(new Blob([body])),
      } as unknown as R2ObjectBody;
    },
    async put(key, value) {
      if (mem.putShouldFail) throw new Error("R2 put failed (simulated)");
      const buf = value instanceof ArrayBuffer
        ? value
        : value instanceof ReadableStream
          ? await new Response(value).arrayBuffer()
          : new TextEncoder().encode(String(value)).buffer;
      mem.data.set(key, { body: buf });
      return {} as R2Object;
    },
    async delete() {
      if (mem.deleteShouldFail) throw new Error("R2 delete failed (simulated)");
    },
  } as unknown as R2Bucket;
}

interface FakeDbState {
  referenceAssets: Map<string, Record<string, unknown>>;
  insertShouldFail?: boolean;
}

function makeDb(state: FakeDbState): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    const stmt: D1PreparedStatement = {
      bind(..._values: unknown[]) {
        return stmt;
      },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        const lower = sql.toLowerCase();
        if (lower.includes("from reference_assets")) {
          if (lower.includes("site_version")) {
            for (const row of state.referenceAssets.values()) {
              return row as unknown as T;
            }
          }
          for (const row of state.referenceAssets.values()) {
            return row as unknown as T;
          }
        }
        if (lower.includes("from clients")) {
          return null;
        }
        return null;
      },
      async all<T = Record<string, unknown>>() {
        return { results: [...state.referenceAssets.values()] as T[], success: true, meta: {} } as D1Result<T[]>;
      },
      async run() {
        if (state.insertShouldFail && sql.toLowerCase().includes("insert into reference_assets")) {
          throw new Error("D1 insert failed (simulated)");
        }
        return { success: true, meta: {} } as D1Result;
      },
      async raw() {
        return [];
      },
    };
    return stmt;
  };

  return { prepare, batch: async (stmts) => stmts.map((s) => s.run() as unknown as D1Result), exec: async () => ({ count: 0, duration: 0 }) } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: makeDb({ referenceAssets: new Map() }),
    SITE_BUCKET: makeR2({ data: new Map() }),
    WEBHOOK_SECRET: "test-webhook-secret",
    APPROVAL_SECRET: "test-approval-secret",
    PUBLIC_APP_URL: "https://test.example.com",
    SITE_BUILD_WORKFLOW: { create: async () => ({ id: "wf-1" }) } as unknown as Workflow,
    SMTP2GO_API_KEY: "",
    INTERNAL_NOTIFICATION_EMAIL: "test@example.com",
    CF_ACCOUNT_ID: "",
    CF_AI_GATEWAY_ID: "",
    CF_AIG_TOKEN: "",
    CF_DEPLOY_API_TOKEN: "",
    KIE_API_URL: "",
    KIE_API_KEY: "",
    KIE_MODEL: "",
    WEBSITE_AGENT: {} as unknown as DurableObjectNamespace,
    BROWSER: {} as unknown as never,
    GITHUB_TOKEN: "",
    GITHUB_WEBHOOK_SECRET: "",
    GITHUB_REPO_OWNER: "",
    GITHUB_REPO_NAME: "",
    GITHUB_BRANCH: "main",
    OPENROUTER_API_KEY: "",
    APPROVAL_TIMEOUT_DAYS: "7",
    MAX_REVISIONS: "3",
    ...overrides,
  } as Env;
}

function makeContext(env: Env, init: { method?: string; url?: string; rawBody?: string; headers?: Record<string, string>; formData?: () => Promise<FormData> } = {}) {
  const headers = new Headers(init.headers);
  const req = {
    method: init.method ?? "POST",
    url: init.url ?? "https://test.example.com/api/webhooks/fluentforms",
    header: (name: string) => headers.get(name),
    async text() { return init.rawBody ?? ""; },
    async parseBody() {
      if (!init.formData) return {} as Record<string, unknown>;
      const fd = await init.formData();
      const obj: Record<string, unknown> = {};
      fd.forEach((value, key) => { obj[key] = value; });
      return obj;
    },
  } as unknown as import("hono").Context<{ Bindings: Env }>["req"];
  return { env, req, json: (data: unknown, status?: number) => new Response(JSON.stringify(data), { status: status ?? 200, headers: { "content-type": "application/json" } }), html: (html: string) => new Response(html, { headers: { "content-type": "text/html" } }), text: (text: string, status?: number) => new Response(text, { status: status ?? 200 }) } as unknown as import("hono").Context<{ Bindings: Env }>;
}

describe("reference upload route", () => {
  it("rejects without the webhook bearer token", async () => {
    const env = makeEnv();
    const png = buildPng({ width: 1440, height: 2500 });
    const formData = new FormData();
    formData.append("screenshot", new File([png], "home.png", { type: "image/png" }));
    const c = makeContext(env, { formData: async () => formData, headers: {} });
    const res = await uploadReferenceScreenshot(c);
    expect(res.status).toBe(401);
  });

  it("stages a valid screenshot and returns an uploadId", async () => {
    const env = makeEnv();
    const png = buildPng({ width: 1440, height: 2500 });
    const formData = new FormData();
    formData.append("screenshot", new File([png], "home.png", { type: "image/png" }));
    const c = makeContext(env, {
      formData: async () => formData,
      headers: { Authorization: "Bearer test-webhook-secret" },
    });
    const res = await uploadReferenceScreenshot(c);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.uploadId).toBeTruthy();
    expect(body.r2Key).toContain("_staging/reference-uploads/");
  });

  it("rejects a corrupt/truncated PNG at upload", async () => {
    const env = makeEnv();
    const truncated = buildPng({ width: 1440, height: 2500, omitIend: true });
    const formData = new FormData();
    formData.append("screenshot", new File([truncated], "home.png", { type: "image/png" }));
    const c = makeContext(env, {
      formData: async () => formData,
      headers: { Authorization: "Bearer test-webhook-secret" },
    });
    const res = await uploadReferenceScreenshot(c);
    expect(res.status).toBe(415);
  });
});

describe("fluent forms webhook reference intake", () => {
  function validPayload(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      company_name: "Example Co",
      client_email: "owner@example.com",
      reference_site_url: "https://example.com/",
      reference_homepage_screenshot: "upload-123",
      ...overrides,
    });
  }

  it("rejects an invalid webhook signature", async () => {
    const env = makeEnv();
    const c = makeContext(env, { rawBody: validPayload(), headers: { "X-WF-Signature": "bogus" } });
    const res = await handleFluentFormsWebhook(c);
    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON", async () => {
    const env = makeEnv();
    const body = "{not json";
    const c = makeContext(env, {
      rawBody: body,
      headers: { "X-WF-Signature": await sign(env.WEBHOOK_SECRET, body) },
    });
    const res = await handleFluentFormsWebhook(c);
    expect(res.status).toBe(400);
  });

  it("rejects when required intake fields are missing", async () => {
    const env = makeEnv();
    const body = JSON.stringify({ company_name: "", client_email: "owner@example.com" });
    const c = makeContext(env, {
      rawBody: body,
      headers: { "X-WF-Signature": await sign(env.WEBHOOK_SECRET, body) },
    });
    const res = await handleFluentFormsWebhook(c);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details).toContainEqual({ field: "company_name", message: "Company name is required" });
  });
});

describe("intake normalization (both-inputs contract)", () => {
  it("treats inspiration_url as a normalized alias of reference_site_url", async () => {
    const { normalizeIntake } = await import("../src/lib/validation");
    const normalized = normalizeIntake({
      company_name: "Example",
      client_email: "owner@example.com",
      inspiration_url: "https://example.com",
    });
    expect(normalized.referenceSiteUrl).toBe("https://example.com/");
    expect(normalized.referenceHomeScreenshotUploadId).toBeNull();
  });

  it("prefers the canonical reference_site_url over the legacy alias", async () => {
    const { normalizeIntake } = await import("../src/lib/validation");
    const normalized = normalizeIntake({
      company_name: "Example",
      client_email: "owner@example.com",
      reference_site_url: "https://preferred.example.com",
      inspiration_url: "https://legacy.example.com",
    });
    expect(normalized.referenceSiteUrl).toBe("https://preferred.example.com/");
  });
});
