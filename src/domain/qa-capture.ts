// Production standardized QA capture (issue #13 production wiring, PRD
// section 26).
//
// Drives the real Cloudflare browser binding through the typed no-evaluate
// adapter to produce the standard capture matrix against a Preview
// deployment: full-page + first-viewport screenshots per spec entry,
// geometry from extracted layout sections (the same regions mapping the
// reference capture uses, so the geometry comparator sees comparable
// profiles), and network failures from navigation diagnostics. Console-error
// collection is not exposed by the typed adapter boundary; the capture
// reports an empty console list and QA-B judges runtime cleanliness from the
// recorded network evidence plus the rendered captures.

import type { Env } from "../env.d";
import type { PageId } from "./site-contracts";
import type { QaCaptureFn, PageCapture } from "./qa-evidence";
import { geometryFromRegions } from "./qa-evidence";
import { playwrightAdapter, type RawLayout } from "../lib/browser-adapter";
import { withBrowser } from "../lib/browser-lifecycle";
import type { ViewportName } from "../lib/viewports";
import { PREVIEW_MARKER_META_NAME } from "./assembly";

const PAGE_PATHS: Record<PageId, string> = {
  home: "",
  about: "about",
  services: "services",
  contact: "contact",
};

// Preview readiness (benchmark hardening F1): a freshly deployed preview
// Worker can briefly serve the platform placeholder while assets propagate.
// Captures may begin ONLY after the preview proves it serves THIS candidate —
// proven by the build-version meta marker assembly injected into every page.
// Bounded wait; a preview that never proves itself fails as PREVIEW_NOT_READY
// instead of feeding a placeholder page into Visual QA. No semantic retries.
export class PreviewNotReadyError extends Error {
  constructor(
    readonly previewUrl: string,
    readonly expectedBuildVersionId: string,
    readonly timeoutMs: number,
    readonly lastStatus: number | null
  ) {
    super(
      `PREVIEW_NOT_READY: ${previewUrl} did not serve the expected ${PREVIEW_MARKER_META_NAME}=${expectedBuildVersionId} marker within ${timeoutMs}ms (last status ${lastStatus ?? "n/a"})`
    );
    this.name = "PreviewNotReadyError";
  }
}

function previewMarkerNeedle(buildVersionId: string): string {
  return `name="${PREVIEW_MARKER_META_NAME}" content="${buildVersionId}"`;
}

export async function waitForPreviewMarker(options: {
  previewUrl: string;
  buildVersionId: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  // Cache-buster: a placeholder response must not be served from an edge cache.
  const url = `${options.previewUrl.replace(/\/$/, "")}/?preview-readiness=${Date.now()}`;
  const deadline = Date.now() + timeoutMs;
  let lastStatus: number | null = null;
  for (;;) {
    try {
      const response = await fetchImpl(url, { headers: { "cache-control": "no-cache" } });
      lastStatus = response.status;
      if (response.ok && (await response.text()).includes(previewMarkerNeedle(options.buildVersionId))) {
        return;
      }
    } catch {
      // Connection refused while the deployment propagates — keep polling.
    }
    if (Date.now() >= deadline) {
      throw new PreviewNotReadyError(options.previewUrl, options.buildVersionId, timeoutMs, lastStatus);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Browser-context marker verification (final benchmark fix, 2026-09-09): the
// Workers Runtime cannot fetch *.workers.dev hosts from inside a Worker at
// all — Cloudflare answers with loopback error 1042 (live evidence: the gate
// 404'd for 45+ minutes on a preview external clients served fine). The
// browser binding is a REAL client and reaches the preview; the gate's
// semantics are unchanged: poll until the EXACT Build Version marker meta is
// present, fail as PREVIEW_NOT_READY otherwise.
export async function waitForPreviewMarkerViaBrowser(
  env: Env,
  options: { previewUrl: string; buildVersionId: string; timeoutMs?: number; intervalMs?: number }
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 5_000;
  const base = options.previewUrl.replace(/\/$/, "");
  const session = await playwrightAdapter.launch(env);
  await withBrowser(session, async (browser) => {
    const page = await browser.newPage({
      viewport: { name: "desktop", width: 1440, height: 900 },
      reducedMotion: true,
    });
    try {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        try {
          // Cache-buster, same rationale as the fetch probe.
          await page.goto(`${base}/?preview-readiness=${Date.now()}`, { timeoutMs: 30_000, waitUntil: "networkidle" });
          const markers = await page.countMatches(
            `meta[name="${PREVIEW_MARKER_META_NAME}"][content="${options.buildVersionId}"]`
          );
          if (markers > 0) return;
        } catch {
          // Navigation hiccup while the deployment propagates — keep polling.
        }
        if (Date.now() >= deadline) break;
        await page.settle(intervalMs);
      }
      throw new PreviewNotReadyError(base, options.buildVersionId, timeoutMs, null);
    } finally {
      await page.close();
    }
  });
}

function viewportName(width: number): ViewportName {
  if (width <= 500) return "mobile";
  if (width <= 900) return "tablet";
  return "desktop";
}

// Canonical region segmentation (issue #37): generated home pages expose the
// Blueprint topology via <section data-region> attributes — those canonical
// ids are the comparable region identity, NOT positional landmarks. Nested or
// repeated landmark sections inside one canonical region collapse into it
// (max height, first-occurrence document order), so harmless internal
// segmentation never fabricates extra canonical regions. Pages without
// data-region (inner pages, external references on QA captures) keep the
// positional landmark mapping so their geometry profiles stay populated.
export function regionsFromLayout(layout: RawLayout, viewportHeight: number): Array<{ id: string; height: number; viewportHeightRatio: number }> {
  const canonicalHeights = new Map<string, number>();
  for (const section of layout.sections) {
    if (!section.dataRegion) continue;
    const existing = canonicalHeights.get(section.dataRegion);
    canonicalHeights.set(section.dataRegion, Math.max(existing ?? 0, section.bounds.height));
  }
  if (canonicalHeights.size > 0) {
    return [...canonicalHeights.entries()].map(([id, height]) => ({
      id,
      height,
      viewportHeightRatio: Number((height / viewportHeight).toFixed(3)),
    }));
  }
  return layout.sections.map((section, index) => ({
    id: `region-${index + 1}`,
    height: section.bounds.height,
    viewportHeightRatio: Number((section.bounds.height / viewportHeight).toFixed(3)),
  }));
}

export interface ProductionQaCaptureOptions {
  /** When set, captures wait until the preview proves it serves THIS Build
   *  Version (marker poll) and fail as PREVIEW_NOT_READY otherwise. */
  expectedBuildVersionId?: string;
  readinessTimeoutMs?: number;
}

export function createProductionQaCapture(env: Env, previewUrl: string, options?: ProductionQaCaptureOptions): QaCaptureFn {
  const base = previewUrl.replace(/\/$/, "");
  return async (spec) => {
    if (options?.expectedBuildVersionId) {
      // In the Workers Runtime the fetch-based poll can never pass on a
      // workers.dev preview (loopback error 1042) — verify through the
      // browser binding when present; the fetch path remains for
      // browserless contexts and tests.
      if (env.BROWSER) {
        await waitForPreviewMarkerViaBrowser(env, {
          previewUrl: base,
          buildVersionId: options.expectedBuildVersionId,
          ...(options.readinessTimeoutMs ? { timeoutMs: options.readinessTimeoutMs } : {}),
        });
      } else {
        await waitForPreviewMarker({
          previewUrl: base,
          buildVersionId: options.expectedBuildVersionId,
          ...(options.readinessTimeoutMs ? { timeoutMs: options.readinessTimeoutMs } : {}),
        });
      }
    }
    const session = await playwrightAdapter.launch(env);
    return withBrowser(session, async (browser) => {
      const captures: PageCapture[] = [];
      for (const entry of spec) {
        const page = await browser.newPage({
          viewport: { name: viewportName(entry.viewportWidth), width: entry.viewportWidth, height: 900 },
          // Reduced motion for QA captures: scroll/entrance animation must
          // never suppress content in a static screenshot (progressive
          // enhancement is asserted separately by the bundle gate).
          reducedMotion: true,
        });
        try {
          const diagnostics = await page.goto(`${base}/${PAGE_PATHS[entry.page]}`, {
            timeoutMs: 45_000,
            waitUntil: "networkidle",
          });
          await page.waitForImages(10_000);
          const layout = await page.extractLayout();

          const imageMassRatio = layout.images.length > 0
            ? Number(Math.min(
                0.9,
                layout.images.reduce((sum, image) => sum + image.displayedWidth * (image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 0.667), 0) /
                  Math.max(1, layout.sections.reduce((sum, section) => sum + section.bounds.height, 0) * entry.viewportWidth)
              ).toFixed(3))
            : 0;

          const capture: PageCapture = {
            page: entry.page,
            viewportWidth: entry.viewportWidth,
            fullPageScreenshot: await page.screenshot({ fullPage: true }),
            geometry: geometryFromRegions(regionsFromLayout(layout, 900), imageMassRatio),
            runtime: {
              consoleErrors: [],
              failedRequests: diagnostics.failedResources.map((resource) => `${resource.reason} ${resource.url}`),
            },
          };
          if (entry.firstViewport) {
            capture.firstViewportScreenshot = await page.screenshot({ fullPage: false });
          }
          captures.push(capture);
        } finally {
          await page.close();
        }
      }
      return captures;
    });
  };
}
