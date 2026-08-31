import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContactWorker } from "../src/builders/contact-worker-builder";
import { sendEmail } from "../src/lib/mail";
import type { Env } from "../src/env.d";

interface GeneratedWorker {
  fetch(request: Request, env: Record<string, unknown>): Promise<Response>;
}

function loadWorker(source: string): GeneratedWorker {
  return new Function(source.replace("export default", "return"))() as GeneratedWorker;
}

function contactRequest(): Request {
  return new Request("https://site.example/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Amina", email: "amina@example.com", message: "Hello" }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("generated contact Worker", () => {
  it("returns success for the current SMTP2GO success response", async () => {
    const smtpFetch = vi.fn(async () => Response.json({
      request_id: "request-1",
      data: { succeeded: 1, failed: 0, failures: [], email_id: "email-1" },
    }));
    vi.stubGlobal("fetch", smtpFetch);
    const worker = loadWorker(buildContactWorker({ recipient: { type: "literal", value: "client@example.com" } }));

    const response = await worker.fetch(contactRequest(), { SMTP2GO_API_KEY: "secret" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    const requestBody = JSON.parse(String((smtpFetch.mock.calls[0]?.[1] as RequestInit).body));
    expect(requestBody.to).toEqual(["client@example.com"]);
  });

  it("does not misread a legacy zero error code as a delivery failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: { error_code: "0", email_id: "email-legacy" },
    })));
    const worker = loadWorker(buildContactWorker({ recipient: { type: "literal", value: "client@example.com" } }));

    const response = await worker.fetch(contactRequest(), { SMTP2GO_API_KEY: "secret" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("fails closed when SMTP2GO rejects the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: { error_code: "E_REJECTED", error: "Rejected" },
    }, { status: 400 })));
    const worker = loadWorker(buildContactWorker({ recipient: { type: "binding", name: "CLIENT_EMAIL" } }));

    const response = await worker.fetch(contactRequest(), {
      SMTP2GO_API_KEY: "secret",
      CLIENT_EMAIL: "client@example.com",
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Failed to send email" });
  });
});

describe("factory SMTP2GO helper", () => {
  it("accepts a successful response without error_code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: { succeeded: 1, failed: 0, email_id: "email-2" },
    })));

    const result = await sendEmail({ SMTP2GO_API_KEY: "secret" } as Env, {
      to: "client@example.com",
      subject: "Subject",
      htmlBody: "<p>Body</p>",
    });

    expect(result).toEqual({ success: true, emailId: "email-2" });
  });
});
