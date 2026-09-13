// Admin notification ledger (operator GO 2026-09-12): idempotent per logical
// event, bounded cron retry, and email failure never rolls back the
// triggering write (draft acceptance / terminal build state).

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import { submitClientIntake } from "../src/routes/public-client-intake";
import {
  attemptAdminNotificationSend,
  enqueueAdminNotification,
  notifyBuildTerminal,
  processDueAdminNotifications,
} from "../src/domain/admin-notifications";
import { canonicalStructuredFacts } from "./helpers/canonical-facts";

function adminTransportCalls(): Array<{ to: string; from: string; subject: string }> {
  const calls = (globalThis as unknown as { __adminEmailCalls?: Array<{ to: string; from: string; subject: string }> }).__adminEmailCalls ?? [];
  return calls;
}

function runtimeEnv(options: { adminSend?: () => Promise<void>; withAdminTransport?: boolean; withAdminRecipient?: boolean } = {}): Env {
  const calls: Array<{ to: string; from: string; subject: string }> = [];
  (globalThis as unknown as { __adminEmailCalls?: Array<{ to: string; from: string; subject: string }> }).__adminEmailCalls = calls;
  const adminEmail = options.withAdminTransport === false
    ? undefined
    : {
        send: async (message: { to: string; from: string; subject: string }) => {
          if (options.adminSend) await options.adminSend();
          calls.push(message);
          return { messageId: "test-message-id" };
        },
      };
  return {
    ...(providedEnv as unknown as Env),
    WEBHOOK_SECRET: "test-webhook-secret",
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    WAZIBIZ_SENDER_EMAIL: "notifications@wazibiz.ke",
    ...(options.withAdminRecipient === false ? {} : { WAZIBIZ_ADMIN_EMAIL: "admin@wazibiz.ke" }),
    ADMIN_DASHBOARD_BASE_URL: "https://admin-builder.wazibiz.ke",
    ADMIN_EMAIL: adminEmail as unknown as Env["ADMIN_EMAIL"],
  };
}

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
});

afterEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
});

async function submitOneDraft(env: Env, businessName: string): Promise<string> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/api/public/client-intakes", submitClientIntake);
  const response = await app.request("https://test.example.com/api/public/client-intakes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "https://wazibiz.ke",
      "CF-Connecting-IP": crypto.randomUUID(),
    },
    body: JSON.stringify({
      submitter: { name: "Notify Tester", email: "notify@submitter.example" },
      business: {
        businessName,
        contactEmail: `hello@${businessName.toLowerCase().replace(/[^a-z]/g, "")}.example`,
        ...canonicalStructuredFacts(),
      },
      turnstileToken: "valid-token",
    }),
  }, env);
  expect(response.status).toBe(201);
  const body = (await response.json()) as { draftId: string };
  return body.draftId;
}

describe("admin notifications", () => {
  it("sends the new-brief email once even when the draft notification path runs twice", async () => {
    const env = runtimeEnv();
    const draftId = await submitOneDraft(env, "Notify Once Cafe");
    // The route already enqueued + sent once; a repeated enqueue + inline send
    // (workflow retry analogue) must be a no-op.
    await enqueueAdminNotification(env, {
      kind: "INTAKE_NEW",
      dedupeKey: `intake-new:${draftId}`,
      subject: "duplicate",
      bodyText: "duplicate",
    });
    await attemptAdminNotificationSend(env, `intake-new:${draftId}`);
    const briefEmails = adminTransportCalls().filter((call) => call.subject.includes("Notify Once Cafe"));
    expect(briefEmails.length).toBe(1);
    expect(briefEmails[0].subject).toBe("New Wazibiz website brief — Notify Once Cafe");
    expect(briefEmails[0].to).toBe("admin@wazibiz.ke");
    expect(briefEmails[0].from).toBe("notifications@wazibiz.ke");
    const row = await env.DB.prepare("SELECT status FROM admin_notifications WHERE dedupe_key = ?")
      .bind(`intake-new:${draftId}`)
      .first<{ status: string }>();
    expect(row?.status).toBe("SENT");
  });

  it("does not roll the draft back when the admin transport is unavailable; the cron sweep retries and delivers", async () => {
    const failing = runtimeEnv({ adminSend: async () => { throw Object.assign(new Error("smtp down"), { code: "E_INTERNAL_SERVER_ERROR" }); } });
    const draftId = await submitOneDraft(failing, "Retry Delivery Studio");
    // Draft is durably accepted despite the failed email.
    const draft = await failing.DB.prepare("SELECT status FROM client_intake_drafts WHERE id = ?").bind(draftId).first<{ status: string }>();
    expect(draft?.status).toBe("SUBMITTED");
    const pending = await failing.DB.prepare("SELECT status, attempts FROM admin_notifications WHERE dedupe_key = ?")
      .bind(`intake-new:${draftId}`)
      .first<{ status: string; attempts: number }>();
    expect(pending?.status).toBe("PENDING");
    expect(pending?.attempts).toBe(1);

    // Time passes (backoff elapses): the retry becomes due.
    await failing.DB.prepare("UPDATE admin_notifications SET next_attempt_after = ? WHERE dedupe_key = ?")
      .bind(new Date(Date.now() - 1000).toISOString(), `intake-new:${draftId}`)
      .run();

    // Cron sweep against a HEALTHY transport delivers the pending notice.
    const healthy = runtimeEnv();
    const processed = await processDueAdminNotifications(healthy);
    expect(processed).toBeGreaterThanOrEqual(1);
    const delivered = await healthy.DB.prepare("SELECT status FROM admin_notifications WHERE dedupe_key = ?")
      .bind(`intake-new:${draftId}`)
      .first<{ status: string }>();
    expect(delivered?.status).toBe("SENT");
  });

  it("classifies permanent email failures as PERMANENT_FAILED without unbounded retries", async () => {
    // Binding present but recipient/sender unresolvable -> permanent
    // configuration failure.
    const env = runtimeEnv({ withAdminRecipient: false });
    await enqueueAdminNotification(env, {
      kind: "INTAKE_NEW",
      dedupeKey: "perm:test-case",
      subject: "permanent case",
      bodyText: "body",
    });
    await processDueAdminNotifications(env);
    const row = await env.DB.prepare("SELECT status FROM admin_notifications WHERE dedupe_key = 'perm:test-case'").first<{ status: string }>();
    expect(row?.status).toBe("PERMANENT_FAILED");
  });

  it("notifies RELEASE_READY and HUMAN_REVIEW_REQUIRED terminals exactly once each", async () => {
    const env = runtimeEnv();
    const siteId = "notify-site-terminal";
    await env.DB.prepare("INSERT INTO businesses (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind("notify-business", "Terminal Notice Co", new Date().toISOString(), new Date().toISOString())
      .run();
    await env.DB.prepare("INSERT INTO site_identities (id, business_id, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(siteId, "notify-business", new Date().toISOString(), new Date().toISOString())
      .run();

    const base = { siteId, previewUrl: "https://b-test-v1.example.wazibizwebsites.workers.dev/" };
    await notifyBuildTerminal(env, { buildId: "notify-build-ready", terminal: "RELEASE_READY", buildVersionId: null, ...base, reasons: ["Release Ready assigned (visual 93, content 95, technical 95)"] });
    // Workflow-retry analogue: the same terminal again must not duplicate.
    await notifyBuildTerminal(env, { buildId: "notify-build-ready", terminal: "RELEASE_READY", buildVersionId: null, ...base, reasons: ["Release Ready assigned (visual 93, content 95, technical 95)"] });
    await notifyBuildTerminal(env, { buildId: "notify-build-review", terminal: "HUMAN_REVIEW_REQUIRED", buildVersionId: null, ...base, reasons: ["SIMPLE QA found: visual fidelity 87 < 90"] });

    const rows = await env.DB.prepare(
      "SELECT kind, dedupe_key, subject, status FROM admin_notifications WHERE dedupe_key LIKE 'build-terminal:notify-build-%' ORDER BY dedupe_key"
    ).all<{ kind: string; dedupe_key: string; subject: string; status: string }>();
    expect(rows.results ?? []).toHaveLength(2);
    const ready = (rows.results ?? []).find((row) => row.dedupe_key.endsWith(":RELEASE_READY"));
    const review = (rows.results ?? []).find((row) => row.dedupe_key.endsWith(":HUMAN_REVIEW_REQUIRED"));
    expect(ready?.subject).toBe("Website ready for approval — Terminal Notice Co");
    expect(ready?.status).toBe("SENT");
    expect(review?.subject).toBe("Website ready for human review — Terminal Notice Co");
    const bodyRow = await env.DB.prepare("SELECT body_text FROM admin_notifications WHERE dedupe_key = ?").bind(ready!.dedupe_key).first<{ body_text: string }>();
    expect(bodyRow?.body_text).toContain("Visual score: 93");
    expect(bodyRow?.body_text).toContain("https://b-test-v1.example.wazibizwebsites.workers.dev/");
    expect(bodyRow?.body_text).toContain("https://admin-builder.wazibiz.ke/admin/sites/");
    expect(bodyRow?.body_text).toContain("NOT an Approval");
  });

  it("failure notifications dedupe through the same ledger", async () => {
    const env = runtimeEnv();
    await env.DB.prepare("INSERT INTO businesses (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind("notify-failed-business", "Failed Notice Co", new Date().toISOString(), new Date().toISOString())
      .run();
    await env.DB.prepare("INSERT INTO site_identities (id, business_id, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind("notify-failed-site", "notify-failed-business", new Date().toISOString(), new Date().toISOString())
      .run();
    const input = { buildId: "notify-build-failed", siteId: "notify-failed-site", buildVersionId: null, previewUrl: null, reasons: ["WORKFLOW_TERMINATED"] };
    await notifyBuildTerminal(env, { ...input, terminal: "FAILED" });
    await notifyBuildTerminal(env, { ...input, terminal: "FAILED" });
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_notifications WHERE dedupe_key = 'build-terminal:notify-build-failed:FAILED'").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });
});
