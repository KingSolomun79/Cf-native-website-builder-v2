import { beforeAll, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { CloudflareEmailMessage, CloudflareEmailSender, Env } from "../src/env.d";
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

describe("platform email transport wiring (native Cloudflare Email Service binding, issue #28)", () => {
  function sendInput(): EmailSendInput {
    return {
      to: "owner@riftvalleyroasters.example",
      from: DEFAULT_PLATFORM_SENDER_IDENTITY,
      replyTo: "jane@visitor.example",
      subject: "New contact message",
      text: "Hello",
    };
  }

  function codedError(code: string): Error & { code: string } {
    const error = new Error(`email service error ${code}`) as Error & { code: string };
    error.code = code;
    return error;
  }

  /** Email Service binding double: records every send() and answers per call. */
  function emailBinding(behavior: (message: CloudflareEmailMessage, call: number) => Promise<{ messageId: string }>): {
    binding: CloudflareEmailSender;
    sent: CloudflareEmailMessage[];
  } {
    const sent: CloudflareEmailMessage[] = [];
    let call = 0;
    return {
      sent,
      binding: {
        send: async (message: CloudflareEmailMessage) => {
          call += 1;
          sent.push(message);
          return behavior(message, call);
        },
      },
    };
  }

  it("fails closed as transient when the Email Service binding is not configured", async () => {
    const transport = createDefaultEmailTransport({} as Env);
    const outcome = await transport(sendInput());
    expect(outcome).toEqual({ ok: false, classification: "transient", error: "email transport not configured" });
  });

  it("delivers through the native binding with platform-resolved recipient, sender and Reply-To", async () => {
    const { binding, sent } = emailBinding(async () => ({ messageId: "msg-1" }));
    const outcome = await createDefaultEmailTransport({ EMAIL: binding } as Env)(sendInput());
    expect(outcome).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    // The binding receives only platform-resolved values: destination from
    // Site Configuration, the platform Sender Identity as From, and the
    // validated visitor address strictly as Reply-To.
    expect(sent[0]).toEqual({
      to: "owner@riftvalleyroasters.example",
      from: DEFAULT_PLATFORM_SENDER_IDENTITY,
      replyTo: "jane@visitor.example",
      subject: "New contact message",
      text: "Hello",
    });
  });

  it("classifies documented Email Service error codes into transient/permanent ledger semantics", async () => {
    // Documented quota/service/availability codes: bounded retry can heal.
    for (const code of ["E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED", "E_INTERNAL_SERVER_ERROR", "E_DELIVERY_FAILED", "E_SENDER_DOMAIN_NOT_AVAILABLE"]) {
      const failing = emailBinding(async () => {
        throw codedError(code);
      });
      const outcome = await createDefaultEmailTransport({ EMAIL: failing.binding } as Env)(sendInput());
      expect(outcome).toEqual({ ok: false, classification: "transient", error: code });
    }

    // Documented validation/sender/recipient codes: retrying cannot change them.
    for (const code of ["E_SENDER_NOT_VERIFIED", "E_RECIPIENT_NOT_ALLOWED", "E_RECIPIENT_SUPPRESSED", "E_VALIDATION_ERROR", "E_FIELD_MISSING", "E_CONTENT_TOO_LARGE", "E_HEADER_NOT_ALLOWED"]) {
      const failing = emailBinding(async () => {
        throw codedError(code);
      });
      const outcome = await createDefaultEmailTransport({ EMAIL: failing.binding } as Env)(sendInput());
      expect(outcome).toEqual({ ok: false, classification: "permanent", error: code });
    }

    // Undocumented or code-less errors: permanence is unproven, so the
    // narrowest defensible mapping keeps them transient (bounded).
    const unknown = emailBinding(async () => {
      throw codedError("E_SOME_FUTURE_CODE");
    });
    expect(await createDefaultEmailTransport({ EMAIL: unknown.binding } as Env)(sendInput())).toMatchObject({
      ok: false,
      classification: "transient",
      error: "E_SOME_FUTURE_CODE",
    });
    const codeless = emailBinding(async () => {
      throw new Error("network glitch");
    });
    expect(await createDefaultEmailTransport({ EMAIL: codeless.binding } as Env)(sendInput())).toEqual({
      ok: false,
      classification: "transient",
      error: "email send failed without a documented code",
    });
  });

  it("wires the native binding into acceptance end to end", async () => {
    const { binding, sent } = emailBinding(async () => ({ messageId: "accepted-1" }));
    const wiredEnv = { ...env, EMAIL: binding } as Env;

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
    expect(sent[0].to).toBe("owner@riftvalleyroasters.example");
    expect(sent[0].from).toBe(DEFAULT_PLATFORM_SENDER_IDENTITY);
    expect(sent[0].replyTo).toBe("jane@visitor.example");
  });

  it("fires bounded server-side retries through the scheduled sweep without a new submission (issue #28)", async () => {
    // Acceptance hits a transient Email Service condition (quota).
    const throttled = emailBinding(async () => {
      throw codedError("E_RATE_LIMIT_EXCEEDED");
    });
    const acceptEnv = { ...env, EMAIL: throttled.binding } as Env;

    const siteId = await newSiteWithConfiguration();
    const accepted = await acceptFormSubmission(acceptEnv, {
      origin: "https://riftvalleyroasters.example",
      remoteAddress: "203.0.113.201",
      payload: browserPayload(siteId),
    });
    const firstAttempt = await env.DB.prepare(
      "SELECT id, status FROM email_deliveries WHERE form_submission_id = ?"
    )
      .bind(accepted.submissionId)
      .first<{ id: string; status: string }>();
    expect(firstAttempt!.status).toBe("transient_failure");

    // Make the backoff window due; the cron sweep retries through a now
    // healthy Email Service using the SAME Accepted Submission.
    await env.DB.prepare("UPDATE email_deliveries SET scheduled_retry_at = ? WHERE form_submission_id = ?")
      .bind(new Date(Date.now() - 60_000).toISOString(), accepted.submissionId)
      .run();
    const recovered = emailBinding(async () => ({ messageId: "retry-1" }));
    const { scheduled } = await import("../src/index");
    await scheduled({ cron: "*/10 * * * *" } as unknown as ScheduledController, { ...env, EMAIL: recovered.binding } as Env);

    const attempts = await env.DB.prepare(
      "SELECT attempt_number, status FROM email_deliveries WHERE form_submission_id = ? ORDER BY attempt_number"
    )
      .bind(accepted.submissionId)
      .all<{ attempt_number: number; status: string }>();
    expect(attempts.results.map((row) => row.status)).toEqual(["transient_failure", "delivered"]);
    expect(recovered.sent).toHaveLength(1);
    const submissions = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM form_submissions WHERE id = ?"
    )
      .bind(accepted.submissionId)
      .first<{ n: number }>();
    expect(submissions!.n).toBe(1);
  });

  it("never resends a completed Email Delivery (sweep idempotency)", async () => {
    const { binding, sent } = emailBinding(async () => ({ messageId: "once-1" }));
    const wiredEnv = { ...env, EMAIL: binding } as Env;

    const siteId = await newSiteWithConfiguration();
    const accepted = await acceptFormSubmission(wiredEnv, {
      origin: "https://riftvalleyroasters.example",
      remoteAddress: "203.0.113.202",
      payload: browserPayload(siteId),
    });
    expect(sent).toHaveLength(1);

    // Even with the retry window artificially due, a delivered ledger row
    // is never re-selected and the binding is never invoked again.
    await env.DB.prepare("UPDATE email_deliveries SET scheduled_retry_at = ? WHERE form_submission_id = ?")
      .bind(new Date(Date.now() - 60_000).toISOString(), accepted.submissionId)
      .run();
    const { scheduled } = await import("../src/index");
    await scheduled({ cron: "*/10 * * * *" } as unknown as ScheduledController, wiredEnv);

    expect(sent).toHaveLength(1);
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_deliveries WHERE form_submission_id = ?"
    )
      .bind(accepted.submissionId)
      .first<{ n: number }>();
    expect(attempts!.n).toBe(1);
  });

  it("registers both handlers on the default export object (cron sweep is reachable)", async () => {
    // Regression: a bare `export default app` leaves the cron trigger
    // handlerless ("Handler does not export a scheduled() function" —
    // caught live on the staging deployment), because the runtime ignores
    // named exports beside a default export.
    const worker = (await import("../src/index")).default as Record<string, unknown>;
    expect(typeof worker.fetch).toBe("function");
    expect(typeof worker.scheduled).toBe("function");
  });
});
