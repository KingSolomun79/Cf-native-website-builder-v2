import { afterEach, describe, expect, it, vi } from "vitest";
import { handleEmailRouterRequest, type EmailRouterEnv } from "../src/email-router/index";

// Contract tests for the WAZIBIZ outbound email router (issue #28). The
// router must satisfy the Form Service transport contract exactly:
//   2xx = delivered, 5xx = transient, other 4xx = permanent
// and must never place credentials anywhere except the outbound ESP request.

const ROUTER_URL = "https://wazibiz-email-router.wazibizwebsites.workers.dev/send";

const CONFIGURED: EmailRouterEnv = {
  WAZIBIZ_EMAIL_TRANSPORT_TOKEN: "transport-shared-token",
  SMTP2GO_API_KEY: "provider-key",
};

function transportBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    to: "owner@riftvalleyroasters.example",
    from: "noreply@mail.wazibiz.example",
    replyTo: "jane@visitor.example",
    subject: "New contact message from Jane",
    text: "Hello, I would like to ask about your services.",
    ...overrides,
  };
}

function send(overrides: Record<string, unknown>, env: EmailRouterEnv = CONFIGURED, token = "transport-shared-token"): Promise<Response> {
  return handleEmailRouterRequest(
    new Request(ROUTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(overrides),
    }),
    env
  );
}

interface SeenDownstream {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function stubDownstream(
  respond: (url: string) => { status: number; body?: unknown } | { throw: true }
): SeenDownstream[] {
  const seen: SeenDownstream[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      seen.push({
        url: target,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        headers: (init?.headers as Record<string, string> | undefined) ?? {},
      });
      const outcome = respond(target);
      if ("throw" in outcome) throw new Error("network down");
      return new Response(JSON.stringify(outcome.body ?? {}), { status: outcome.status });
    })
  );
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WAZIBIZ outbound email router (issue #28)", () => {
  it("accepts the platform transport contract and forwards to the ESP with Reply-To preserved", async () => {
    const seen = stubDownstream(() => ({ status: 200, body: { data: { email_id: "smtp-1" } } }));
    const response = await send(transportBody());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.smtp2go.com/v2/email/send");
    expect(seen[0].body.api_key).toBe("provider-key");
    expect(seen[0].body.sender).toBe("noreply@mail.wazibiz.example");
    expect(seen[0].body.to).toEqual(["owner@riftvalleyroasters.example"]);
    expect(seen[0].body.custom_headers).toEqual([{ name: "Reply-To", value: "jane@visitor.example" }]);
    expect(seen[0].body.subject).toBe("New contact message from Jane");
  });

  it("fails closed 503 while the router cannot authenticate at all", async () => {
    const response = await send(transportBody(), { SMTP2GO_API_KEY: "provider-key" } as EmailRouterEnv, "whatever");
    expect(response.status).toBe(503);
  });

  it("fails closed 503 for authenticated callers while the provider leg is unwired", async () => {
    const response = await send(transportBody(), {
      WAZIBIZ_EMAIL_TRANSPORT_TOKEN: "transport-shared-token",
    } as EmailRouterEnv);
    expect(response.status).toBe(503);
  });

  it("rejects missing, malformed and wrong bearer tokens with 401", async () => {
    expect((await send(transportBody(), CONFIGURED, "")).status).toBe(401);
    const malformed = await handleEmailRouterRequest(
      new Request(ROUTER_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Basic dXNlcjpwYXNz" },
        body: JSON.stringify(transportBody()),
      }),
      CONFIGURED
    );
    expect(malformed.status).toBe(401);
    expect((await send(transportBody(), CONFIGURED, "wrong-token")).status).toBe(401);
  });

  it("rejects contract violations permanently (422)", async () => {
    stubDownstream(() => ({ status: 200, body: { data: {} } }));
    const missing = await send(transportBody({ replyTo: undefined }));
    expect(missing.status).toBe(422);

    const extra = await send(transportBody({ template: "welcome" }));
    expect(extra.status).toBe(422);

    const injected = await send(transportBody({ to: "owner@example.example\r\nBcc: attacker@evil.example" }));
    expect(injected.status).toBe(422);

    const nonAddress = await send(transportBody({ from: "WAZIBIZ <nope>" }));
    expect(nonAddress.status).toBe(422);

    const tooLong = await send(transportBody({ text: "x".repeat(20_001) }));
    expect(tooLong.status).toBe(422);
  });

  it("maps ESP-level rejections to permanent 422", async () => {
    stubDownstream(() => ({ status: 200, body: { data: { error: { code: "E411", message: "unverified sender" } } } }));
    const response = await send(transportBody());
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("upstream rejected the send");
  });

  it("keeps router-side provider misconfiguration transient (5xx)", async () => {
    stubDownstream(() => ({ status: 401 }));
    expect((await send(transportBody())).status).toBe(500);

    stubDownstream(() => ({ status: 503, body: { data: { error: { code: "temporary" } } } }));
    expect((await send(transportBody())).status).toBe(502);
  });

  it("keeps network failure transient", async () => {
    stubDownstream(() => ({ throw: true }));
    expect((await send(transportBody())).status).toBe(502);
  });

  it("never places the shared bearer token in the outbound ESP request or responses", async () => {
    const seen = stubDownstream(() => ({ status: 200, body: { data: {} } }));
    const response = await send(transportBody());
    const responseText = await response.clone().text();
    expect(responseText).not.toContain("transport-shared-token");
    expect(responseText).not.toContain("provider-key");
    expect(JSON.stringify(seen[0].body)).not.toContain("transport-shared-token");
    expect(JSON.stringify(seen[0].headers)).not.toContain("transport-shared-token");
  });

  it("serves liveness without configuration state and nothing else unauthenticated", async () => {
    const health = await handleEmailRouterRequest(
      new Request("https://wazibiz-email-router.wazibizwebsites.workers.dev/health"),
      {} as EmailRouterEnv
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const other = await handleEmailRouterRequest(
      new Request("https://wazibiz-email-router.wazibizwebsites.workers.dev/other"),
      CONFIGURED
    );
    expect(other.status).toBe(404);

    const wrongMethod = await handleEmailRouterRequest(
      new Request(ROUTER_URL, { method: "GET" }),
      CONFIGURED
    );
    expect(wrongMethod.status).toBe(405);
  });
});
