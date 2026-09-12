// Capture-session marker proof (sandbox evidence 2026-09-12): workers.dev
// propagation is eventually consistent ACROSS browser sessions, so the
// readiness pre-poll passing in one session does not guarantee the capture
// session serves the candidate — repaired-version captures photographed the
// Cloudflare "There is nothing here yet" placeholder and Visual QA correctly
// condemned a site it never saw. The page about to be screenshotted must
// prove ITSELF to be the expected Build Version first.

import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.d";
import { createProductionQaCapture, PreviewNotReadyError } from "../src/domain/qa-capture";
import type { PageCapture } from "../src/domain/qa-evidence";

// The mock factory is hoisted above the imports — resolve the adapter through
// a closure so the holder assigned inside each test is the one used at call time.
const launchHolder = vi.hoisted(() => ({
  adapter: undefined as unknown as { launch: (env: unknown) => Promise<unknown> },
}));

vi.mock("../src/lib/browser-adapter", () => ({
  playwrightAdapter: {
    launch: (env: unknown) => launchHolder.adapter.launch(env),
  },
}));

function makePage(spec: { markerMatches: number }) {
  return {
    goto: vi.fn(async () => ({ failedResources: [] as Array<{ reason: string; url: string }> })),
    waitForImages: vi.fn(async () => {}),
    countMatches: vi.fn(async () => spec.markerMatches),
    extractLayout: vi.fn(async () => ({
      sections: [
        { bounds: { y: 0, height: 900 }, dataRegion: "hero" },
        { bounds: { y: 900, height: 900 }, dataRegion: "statement" },
      ],
      images: [{ displayedWidth: 100, naturalWidth: 200, naturalHeight: 100 }],
    })),
    screenshot: vi.fn(async () => new Uint8Array([9, 9, 9])),
    close: vi.fn(async () => {}),
  };
}

type FakePage = ReturnType<typeof makePage>;

function makeEnv(pages: FakePage[]): { env: Env; browser: { close: ReturnType<typeof vi.fn>; newPage: ReturnType<typeof vi.fn> } } {
  const browser = {
    newPage: vi.fn(async () => {
      const page = pages.shift();
      if (!page) throw new Error("no more fake pages");
      return page;
    }),
    close: vi.fn(async () => {}),
  };
  launchHolder.adapter = { launch: vi.fn(async () => browser) };
  return { env: { BROWSER: {} } as unknown as Env, browser };
}

const SPEC = [
  { page: "home" as const, viewportWidth: 1440, firstViewport: true },
  { page: "about" as const, viewportWidth: 390, firstViewport: false },
];

describe("QA capture capture-session marker proof", () => {
  it("throws PREVIEW_NOT_READY before screenshotting when the capture session serves a placeholder", async () => {
    // Page 1: the readiness pre-poll session — marker present, check passes.
    // Page 2: the capture session — workers.dev propagation lag serves the
    // placeholder (no marker).
    const readinessPage = makePage({ markerMatches: 1 });
    const capturePage = makePage({ markerMatches: 0 });
    const { env, browser } = makeEnv([readinessPage, capturePage]);

    const capture = createProductionQaCapture(env, "https://b-test-v2.wazibizwebsites.workers.dev/", {
      expectedBuildVersionId: "bv-expected",
    });

    await expect(capture(SPEC)).rejects.toBeInstanceOf(PreviewNotReadyError);
    // The placeholder page must never be photographed.
    expect(capturePage.screenshot).not.toHaveBeenCalled();
    expect(capturePage.extractLayout).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it("captures normally when the capture session serves the exact Build Version", async () => {
    const readinessPage = makePage({ markerMatches: 1 });
    const capturePages = [makePage({ markerMatches: 1 }), makePage({ markerMatches: 1 })];
    const { env } = makeEnv([readinessPage, ...capturePages]);

    const capture = createProductionQaCapture(env, "https://b-test-v2.wazibizwebsites.workers.dev/", {
      expectedBuildVersionId: "bv-expected",
    });

    const captures = (await capture(SPEC)) as PageCapture[];
    expect(captures).toHaveLength(2);
    expect(captures[0].page).toBe("home");
    expect(captures[1].viewportWidth).toBe(390);
    for (const page of capturePages) {
      expect(page.screenshot).toHaveBeenCalled();
    }
  });
});
