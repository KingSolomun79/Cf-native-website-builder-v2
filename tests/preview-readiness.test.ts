import { describe, expect, it } from "vitest";
import { PreviewReadinessError, waitForPreviewReadiness } from "../src/lib/browser-run";

describe("preview readiness", () => {
  it("waits until every required route returns a successful response", async () => {
    let attempt = 0;
    const requests: string[] = [];
    await waitForPreviewReadiness("https://preview.example/", {
      attempts: 3,
      delayMs: 0,
      sleep: async () => { attempt++; },
      fetcher: async (url) => {
        requests.push(url);
        const ready = attempt > 0 || url.endsWith("/services");
        return { ok: ready, status: ready ? 200 : 404 };
      },
    });

    expect(requests).toHaveLength(8);
    expect(requests).toContain("https://preview.example/contact");
  });

  it("fails with per-route evidence after the bounded retry budget", async () => {
    await expect(waitForPreviewReadiness("https://preview.example", {
      attempts: 2,
      delayMs: 0,
      sleep: async () => undefined,
      fetcher: async (url) => ({ ok: !url.endsWith("/about"), status: url.endsWith("/about") ? 404 : 200 }),
    })).rejects.toMatchObject<Partial<PreviewReadinessError>>({
      name: "PreviewReadinessError",
      statuses: { "/about": 404 },
    });
  });
});
