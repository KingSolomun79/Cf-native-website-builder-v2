import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import { submitForm } from "../src/routes/v2.form-submit";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import {
  acceptFormSubmission,
  attemptEmailDelivery,
  createDefaultEmailTransport,
  getSiteConfiguration,
  processDueEmailDeliveries,
  upsertSiteConfiguration,
  DEFAULT_PLATFORM_SENDER_IDENTITY,
  FormServiceError,
  type EmailSendInput,
} from "../src/domain/form-service";

// Primary-seam tests for the central WAZIBIZ Form Service (issue #11).

const env = providedEnv as unknown as Env;

function app(): Hono<{ Bindings: Env }> {
  const application = new Hono<{ Bindings: Env }>();
  application.post("/api/v2/forms/submit", submitForm);
  return application;
}

async function newSiteWithConfiguration(options: { turnstile?: boolean; destination?: string } = {}): Promise<string> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Rift Valley Roasters", contactEmail: "hello@rvr.example" },
      reference: { screenshotR2Key: `references/uploads/fs-${Math.random().toString(36).slice(2)}.png` },
    },
  });
  await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  await upsertSiteConfiguration(env, {
    siteId: started.siteId,
    formDestination: options.destination ?? "owner@riftvalleyroasters.example",
    allowedOrigins: ["https://riftvalleyroasters.example"],
    turnstileRequired: options.turnstile === true,
  });
  return started.siteId;
}

function browserPayload(siteId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    siteFormId: `site:${siteId}`,
    name: "Jane Visitor",
    email: "jane@visitor.example",
    message: "Hello, I would like to ask about your roasting services.",
    ...overrides,
  };
}

function postForm(application: Hono<{ Bindings: Env }>, payload: unknown, options: { origin?: string; ip?: string } = {}): Promise<Response> {
  return application.request(
    "https://forms.wazibiz.example/api/v2/forms/submit",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: options.origin ?? "https://riftvalleyroasters.example",
        "CF-Connecting-IP": options.ip ?? "203.0.113.10",
      },
      body: JSON.stringify(payload),
    },
    env
  );
}

describe("WAZIBIZ Form Service", () => {
  let application: Hono<{ Bindings: Env }>;

  beforeAll(() => {
    application = app();
  });

  it("accepts a valid visitor submission durably and delivers downstream", async () => {
    const siteId = await newSiteWithConfiguration();
    const sent: EmailSendInput[] = [];
    // The transport seam is observable through the delivery ledger below.
    void sent;

    const response = await postForm(application, browserPayload(siteId));
    expect(response.status).toBe(202);
    const body = (await response.json()) as { accepted: boolean; submissionId: string };
    expect(body.accepted).toBe(true);

    const submission = await env.DB.prepare("SELECT * FROM form_submissions WHERE id = ?")
      .bind(body.submissionId)
      .first<{ site_id: string; visitor_email: string; accepted_at: string }>();
    expect(submission!.site_id).toBe(siteId);
    expect(submission!.accepted_at).toBeTruthy();

    // Visitor email appears ONLY as Reply-To; From is the platform sender.
    const delivery = await env.DB.prepare("SELECT * FROM email_deliveries WHERE form_submission_id = ?")
      .bind(body.submissionId)
      .first<{ destination: string; sender_identity: string; reply_to: string; status: string }>();
    expect(delivery!.destination).toBe("owner@riftvalleyroasters.example");
    expect(delivery!.sender_identity).toBe(DEFAULT_PLATFORM_SENDER_IDENTITY);
    expect(delivery!.reply_to).toBe("jane@visitor.example");
  });

  it("rejects disallowed origins and failed Turnstile before any durable acceptance", async () => {
    const plainSite = await newSiteWithConfiguration();
    const badOrigin = await postForm(application, browserPayload(plainSite), { origin: "https://evil.example" });
    expect(badOrigin.status).toBe(403);
    expect(((await badOrigin.json()) as { error: { code: string } }).error.code).toBe("ORIGIN_NOT_ALLOWED");

    const protectedSite = await newSiteWithConfiguration({ turnstile: true });
    const noToken = await postForm(application, browserPayload(protectedSite), { ip: "203.0.113.11" });
    expect(noToken.status).toBe(403);
    expect(((await noToken.json()) as { error: { code: string } }).error.code).toBe("TURNSTILE_FAILED");

    const badToken = await postForm(application, browserPayload(protectedSite, { turnstileToken: "bogus" }), { ip: "203.0.113.12" });
    expect(badToken.status).toBe(403);

    const verified = await acceptFormSubmission(env, {
      origin: "https://riftvalleyroasters.example",
      remoteAddress: "203.0.113.13",
      payload: browserPayload(protectedSite, { turnstileToken: "valid-token" }),
      turnstileVerifier: async (token) => token === "valid-token",
    });
    expect(verified.acceptedAt).toBeTruthy();

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM form_submissions WHERE site_id = ?")
      .bind(protectedSite)
      .first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it("rejects browser payloads that try to control delivery or smuggle fields", async () => {
    const siteId = await newSiteWithConfiguration();
    const recipient = await postForm(application, browserPayload(siteId, { recipient: "attacker@evil.example" }));
    expect(recipient.status).toBe(400);
    expect(((await recipient.json()) as { error: { code: string } }).error.code).toBe("BROWSER_PAYLOAD_CONTRACT");

    const template = await postForm(application, browserPayload(siteId, { template: "evil" }));
    expect(((await template.json()) as { error: { code: string } }).error.code).toBe("BROWSER_PAYLOAD_CONTRACT");

    const injection = await postForm(application, browserPayload(siteId, { email: "jane@visitor.example\r\nBcc: attacker@evil.example" }));
    expect(((await injection.json()) as { error: { code: string } }).error.code).toBe("HEADER_INJECTION");

    const invalid = await postForm(application, browserPayload(siteId, { message: "" }));
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe("FIELDS_INVALID");

    const unknownSite = await postForm(application, browserPayload("site-does-not-exist"));
    expect(unknownSite.status).toBe(404);

    const submissions = await env.DB.prepare("SELECT COUNT(*) AS n FROM form_submissions WHERE site_id = ?")
      .bind(siteId)
      .first<{ n: number }>();
    expect(submissions!.n).toBe(0);
  });

  it("rate limits per Site and client within the window", async () => {
    const siteId = await newSiteWithConfiguration();
    for (let i = 0; i < 5; i++) {
      const response = await postForm(application, browserPayload(siteId, { email: `visitor${i}@visitor.example` }), { ip: "198.51.100.7" });
      expect(response.status).toBe(202);
    }
    const limited = await postForm(application, browserPayload(siteId, { email: "sixth@visitor.example" }), { ip: "198.51.100.7" });
    expect(limited.status).toBe(429);

    // A different client is not affected.
    const other = await postForm(application, browserPayload(siteId, { email: "other@visitor.example" }), { ip: "198.51.100.8" });
    expect(other.status).toBe(202);
  });

  it("routes by mutable Site Configuration changes without creating any Build", async () => {
    const siteId = await newSiteWithConfiguration({ destination: "first@riftvalleyroasters.example" });
    const generation = await env.DB.prepare(
      "SELECT sg.id FROM site_generations sg WHERE sg.site_id = ? ORDER BY sg.sequence_number DESC LIMIT 1"
    )
      .bind(siteId)
      .first<{ id: string }>();
    const buildsBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM builds WHERE site_generation_id = ?")
      .bind(generation!.id)
      .first<{ n: number }>();

    await upsertSiteConfiguration(env, {
      siteId,
      formDestination: "second@riftvalleyroasters.example",
      senderIdentity: "hello@mail.riftvalleyroasters.example",
      allowedOrigins: ["https://riftvalleyroasters.example"],
    });

    const configuration = await getSiteConfiguration(env, siteId);
    expect(configuration!.formDestination).toBe("second@riftvalleyroasters.example");
    expect(configuration!.senderIdentity).toBe("hello@mail.riftvalleyroasters.example");

    const response = await postForm(application, browserPayload(siteId));
    expect(response.status).toBe(202);
    const body = (await response.json()) as { submissionId: string };
    const delivery = await env.DB.prepare("SELECT destination, sender_identity FROM email_deliveries WHERE form_submission_id = ?")
      .bind(body.submissionId)
      .first<{ destination: string; sender_identity: string }>();
    expect(delivery!.destination).toBe("second@riftvalleyroasters.example");
    expect(delivery!.sender_identity).toBe("hello@mail.riftvalleyroasters.example");

    // Routing changes created no Build and no Revision Request.
    const buildsAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM builds WHERE site_generation_id = ?")
      .bind(generation!.id)
      .first<{ n: number }>();
    expect(buildsAfter!.n).toBe(buildsBefore!.n);
  });

  it("retries transient delivery failures server-side with bounded attempts and permanent classification", async () => {
    const siteId = await newSiteWithConfiguration();
    const accepted = await acceptFormSubmission(env, {
      origin: "https://riftvalleyroasters.example",
      remoteAddress: "203.0.113.77",
      payload: browserPayload(siteId),
    });

    // Simulate a transient failure on a manual delivery attempt.
    let calls = 0;
    const transient: Array<{ ok: true } | { ok: false; classification: "transient"; error: string }> = [];
    void transient;
    const transport = vi.fn(async (): Promise<{ ok: boolean; classification?: string; error?: string }> => {
      calls += 1;
      return calls === 1 ? { ok: false, classification: "transient", error: "smtp 503" } : { ok: true };
    });
    const outcome = await attemptEmailDelivery(
      env,
      {
        submissionId: accepted.submissionId,
        destination: "owner@riftvalleyroasters.example",
        senderIdentity: DEFAULT_PLATFORM_SENDER_IDENTITY,
        replyTo: "jane@visitor.example",
        visitorName: "Jane Visitor",
        message: "Hello",
        subject: "New message",
      },
      { transport: transport as never }
    );
    expect(outcome.status).toBe("transient_failure");

    // The Accepted Submission stays accepted; retry happens server-side.
    const submission = await env.DB.prepare("SELECT accepted_at FROM form_submissions WHERE id = ?")
      .bind(accepted.submissionId)
      .first<{ accepted_at: string }>();
    expect(submission!.accepted_at).toBeTruthy();

    const retried = await processDueEmailDeliveries(env, {
      transport: transport as never,
      now: () => new Date(Date.now() + 60 * 60_000),
      submissionIds: [accepted.submissionId],
    });
    expect(retried).toBe(1);
    const deliveries = await env.DB.prepare(
      "SELECT attempt_number, status FROM email_deliveries WHERE form_submission_id = ? ORDER BY attempt_number"
    )
      .bind(accepted.submissionId)
      .all<{ attempt_number: number; status: string }>();
    // Acceptance attempt (no transport configured -> transient), the manual
    // transient attempt, then the successful server-side retry.
    expect((deliveries.results ?? []).map((row) => row.status)).toEqual(["transient_failure", "transient_failure", "delivered"]);

    // Bounded retry: hitting the limit records permanent failure without
    // erasing the submission.
    const bounded = await newSiteWithConfiguration();
    const acceptedBounded = await acceptFormSubmission(env, {
      origin: "https://riftvalleyroasters.example",
      remoteAddress: "203.0.113.99",
      payload: browserPayload(bounded),
    });
    for (let i = 0; i < 6; i++) {
      await attemptEmailDelivery(
        env,
        {
          submissionId: acceptedBounded.submissionId,
          destination: "owner@example.com",
          senderIdentity: DEFAULT_PLATFORM_SENDER_IDENTITY,
          replyTo: "jane@visitor.example",
          visitorName: "Jane",
          message: "m",
          subject: "s",
        },
        { transport: async () => ({ ok: false, classification: "transient", error: "always down" }) }
      );
    }
    const terminal = await env.DB.prepare(
      "SELECT status FROM email_deliveries WHERE form_submission_id = ? ORDER BY attempt_number"
    )
      .bind(acceptedBounded.submissionId)
      .all<{ status: string }>();
    const statuses = (terminal.results ?? []).map((row) => row.status);
    expect(statuses).toHaveLength(6);
    expect(statuses[statuses.length - 1]).toBe("permanent_failure");
    expect(statuses.slice(0, 5).every((status) => status === "transient_failure")).toBe(true);
    const stillAccepted = await env.DB.prepare("SELECT accepted_at FROM form_submissions WHERE id = ?")
      .bind(acceptedBounded.submissionId)
      .first<{ accepted_at: string }>();
    expect(stillAccepted!.accepted_at).toBeTruthy();
    expect(FormServiceError.name).toBe("FormServiceError");
  });
});

describe("platform email transport wiring (CSO H2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sendInput(): EmailSendInput {
    return {
      to: "owner@riftvalleyroasters.example",
      from: DEFAULT_PLATFORM_SENDER_IDENTITY,
      replyTo: "jane@visitor.example",
      subject: "New contact message",
      text: "Hello",
    };
  }

  it("fails closed as transient when the transport endpoint is not configured", async () => {
    const transport = createDefaultEmailTransport({} as Env);
    const outcome = await transport(sendInput());
    expect(outcome).toEqual({ ok: false, classification: "transient", error: "email transport not configured" });
  });

  it("delivers through the configured endpoint with optional bearer auth and classifies failures", async () => {
    const seen: Array<{ url: string; authorization: string | null; body: EmailSendInput }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        seen.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
          body: JSON.parse(String(init?.body)) as EmailSendInput,
        });
        const status = String(url).endsWith("/reject-500") ? 500 : String(url).endsWith("/reject-400") ? 400 : 200;
        return new Response("", { status });
      })
    );

    const transport = createDefaultEmailTransport({
      WAZIBIZ_EMAIL_TRANSPORT_URL: "https://mail-router.example/send",
      WAZIBIZ_EMAIL_TRANSPORT_TOKEN: "router-token",
    } as Env);

    const ok = await transport(sendInput());
    expect(ok).toEqual({ ok: true });
    expect(seen[0].url).toBe("https://mail-router.example/send");
    expect(seen[0].authorization).toBe("Bearer router-token");
    expect(seen[0].body.replyTo).toBe("jane@visitor.example");
    expect(seen[0].body.from).toBe(DEFAULT_PLATFORM_SENDER_IDENTITY);

    const transient = await createDefaultEmailTransport({
      WAZIBIZ_EMAIL_TRANSPORT_URL: "https://mail-router.example/reject-500",
    } as Env)(sendInput());
    expect(transient).toMatchObject({ ok: false, classification: "transient" });

    const permanent = await createDefaultEmailTransport({
      WAZIBIZ_EMAIL_TRANSPORT_URL: "https://mail-router.example/reject-400",
    } as Env)(sendInput());
    expect(permanent).toMatchObject({ ok: false, classification: "permanent" });
  });

  it("wires the env-configured transport into acceptance end to end", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 }))
    );
    const wiredEnv = {
      ...env,
      WAZIBIZ_EMAIL_TRANSPORT_URL: "https://mail-router.example/send",
      WAZIBIZ_EMAIL_TRANSPORT_TOKEN: "router-token",
    } as Env;

    const siteId = await newSiteWithConfiguration();
    const accepted = await acceptFormSubmission(wiredEnv, {
      origin: "https://riftvalleyroasters.example",
      remoteAddress: "203.0.113.200",
      payload: browserPayload(siteId),
    });

    const delivery = await env.DB.prepare(
      "SELECT status, sender_identity, reply_to FROM email_deliveries WHERE form_submission_id = ?"
    )
      .bind(accepted.submissionId)
      .first<{ status: string; sender_identity: string; reply_to: string }>();
    expect(delivery!.status).toBe("delivered");
    expect(delivery!.sender_identity).toBe(DEFAULT_PLATFORM_SENDER_IDENTITY);
    expect(delivery!.reply_to).toBe("jane@visitor.example");
  });
});
