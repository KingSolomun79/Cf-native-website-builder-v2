// Spy test for the production Playwright adapter wiring (R3 correction #9).
// Proves the fixture adapter can't pass while the production adapter calls the
// wrong API: verifies playwrightAdapter.launch invokes @cloudflare/playwright's
// launch with env.BROWSER, newPage receives viewport + reducedMotion, and the
// page methods delegate to the underlying Playwright Page.

import { describe, expect, it, vi } from "vitest";

const pageListeners = new Map<string, Array<(value: never) => void>>();
const mouseSpies = {
  move: vi.fn(async () => {}),
  down: vi.fn(async () => {}),
  up: vi.fn(async () => {}),
};
const locatorSpies = {
  boundingBox: vi.fn(async () => ({ x: 10, y: 20, width: 100, height: 40 })),
};

const pageSpies = {
  goto: vi.fn(async () => ({ status: () => 200, url: () => "https://x.test", request: () => ({ redirectedFrom: null }) })),
  url: vi.fn(() => "https://x.test"),
  evaluate: vi.fn(async () => ({})),
  hover: vi.fn(async () => {}),
  focus: vi.fn(async () => {}),
  click: vi.fn(async () => {}),
  waitForTimeout: vi.fn(async () => {}),
  screenshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
  reload: vi.fn(async () => null),
  locator: vi.fn(() => locatorSpies),
  mouse: mouseSpies,
  close: vi.fn(async () => {}),
  on: vi.fn((event: string, listener: (value: never) => void) => {
    const listeners = pageListeners.get(event) ?? [];
    listeners.push(listener);
    pageListeners.set(event, listeners);
  }),
};

const browserSpies = {
  newPage: vi.fn(async () => pageSpies),
  close: vi.fn(async () => {}),
};

const launchSpy = vi.fn(async () => browserSpies);

vi.mock("@cloudflare/playwright", () => ({
  launch: launchSpy,
  // re-export the spy module path used by the production adapter
}));

describe("playwright production adapter wiring (spy)", () => {
  it("launch calls @cloudflare/playwright.launch with env.BROWSER", async () => {
    const { playwrightAdapter } = await import("../src/lib/browser-adapter");
    const fakeBrowser = { kind: "BrowserWorker" } as never;
    const env = { BROWSER: fakeBrowser } as never;
    const session = await playwrightAdapter.launch(env);
    expect(launchSpy).toHaveBeenCalledWith(fakeBrowser);
    launchSpy.mockClear();
    void session;
  });

  it("newPage forwards viewport + reducedMotion to browser.newPage", async () => {
    const { playwrightAdapter } = await import("../src/lib/browser-adapter");
    const session = await playwrightAdapter.launch({ BROWSER: {} } as never);
    browserSpies.newPage.mockClear();
    await session.newPage({ viewport: { name: "mobile", width: 375, height: 812 }, reducedMotion: true });
    expect(browserSpies.newPage).toHaveBeenCalledWith({
      viewport: { width: 375, height: 812 },
      reducedMotion: "reduce",
    });
  });

  it("page action methods delegate to the underlying Playwright page", async () => {
    const { playwrightAdapter } = await import("../src/lib/browser-adapter");
    const session = await playwrightAdapter.launch({ BROWSER: {} } as never);
    const page = await session.newPage({ viewport: { name: "desktop", width: 1440, height: 900 }, reducedMotion: false });
    pageSpies.hover.mockClear();
    pageSpies.focus.mockClear();
    pageSpies.click.mockClear();
    pageSpies.close.mockClear();
    await page.hover("[data-cf-evidence-id=\"x\"]");
    await page.focus("[data-cf-evidence-id=\"x\"]");
    await page.click("[data-cf-evidence-id=\"x\"]");
    await page.close();
    expect(pageSpies.hover).toHaveBeenCalledWith('[data-cf-evidence-id="x"]');
    expect(pageSpies.focus).toHaveBeenCalledWith('[data-cf-evidence-id="x"]');
    expect(pageSpies.click).toHaveBeenCalledWith('[data-cf-evidence-id="x"]');
    expect(pageSpies.close).toHaveBeenCalledTimes(1);
  });

  it("session.close delegates to browser.close", async () => {
    const { playwrightAdapter } = await import("../src/lib/browser-adapter");
    const session = await playwrightAdapter.launch({ BROWSER: {} } as never);
    browserSpies.close.mockClear();
    await session.close();
    expect(browserSpies.close).toHaveBeenCalledTimes(1);
  });

  it("uses a real pointer press and reload reset for isolated active-state capture", async () => {
    const { playwrightAdapter } = await import("../src/lib/browser-adapter");
    const session = await playwrightAdapter.launch({ BROWSER: {} } as never);
    const page = await session.newPage({ viewport: { name: "desktop", width: 1440, height: 900 }, reducedMotion: false });
    await page.pressPointerDown('[data-cf-evidence-id="x"]');
    expect(locatorSpies.boundingBox).toHaveBeenCalled();
    expect(mouseSpies.move).toHaveBeenCalledWith(60, 40);
    expect(mouseSpies.down).toHaveBeenCalled();
    await page.reset();
    expect(mouseSpies.up).toHaveBeenCalled();
    expect(pageSpies.reload).toHaveBeenCalledWith({ waitUntil: "load" });
  });

  it("collects redirect, failed-resource, and blocked-resource diagnostics", async () => {
    const oldRequest = {
      url: () => "https://x.test/old",
      redirectedFrom: () => null,
      response: async () => ({ status: () => 301 }),
      resourceType: () => "document",
      failure: () => null,
    };
    const finalRequest = {
      url: () => "https://x.test/final",
      redirectedFrom: () => oldRequest,
      response: async () => ({ status: () => 200 }),
      resourceType: () => "document",
      failure: () => null,
    };
    pageSpies.goto.mockImplementationOnce(async () => {
      const failedResponse = {
        status: () => 404,
        url: () => "https://x.test/missing.png",
        request: () => ({ resourceType: () => "image" }),
      };
      for (const listener of pageListeners.get("response") ?? []) listener(failedResponse as never);
      const blockedRequest = {
        url: () => "https://tracker.test/pixel",
        failure: () => ({ errorText: "net::ERR_BLOCKED_BY_CLIENT" }),
        resourceType: () => "image",
      };
      for (const listener of pageListeners.get("requestfailed") ?? []) listener(blockedRequest as never);
      return { status: () => 200, request: () => finalRequest };
    });
    pageSpies.url.mockReturnValue("https://x.test/final");
    const { playwrightAdapter } = await import("../src/lib/browser-adapter");
    const session = await playwrightAdapter.launch({ BROWSER: {} } as never);
    const page = await session.newPage({ viewport: { name: "desktop", width: 1440, height: 900 }, reducedMotion: false });
    const diagnostics = await page.goto("https://x.test/old", { timeoutMs: 1000, waitUntil: "load" });
    expect(diagnostics.redirectChain).toEqual([{ url: "https://x.test/old", status: 301 }]);
    expect(diagnostics.failedResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: "https://x.test/missing.png", type: "image" }),
    ]));
    expect(diagnostics.blockedResources).toEqual([
      { url: "https://tracker.test/pixel", reason: "net::ERR_BLOCKED_BY_CLIENT" },
    ]);
  });

  it("buildNavDiagnostics shapes the structured navigation result", async () => {
    const { buildNavDiagnostics } = await import("../src/lib/browser-adapter");
    const nav = buildNavDiagnostics({
      initialUrl: "https://a.test",
      finalUrl: "https://b.test",
      httpStatus: 200,
      redirectChain: [{ url: "https://a.test", status: 301 }],
      failedResources: [],
      blockedResources: [],
      timedOut: false,
      overlayLimitations: [],
    });
    expect(nav.httpStatus).toBe(200);
    expect(nav.redirectChain).toHaveLength(1);
  });
});
