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
import type { PageId } from "./site-generator";
import type { QaCaptureFn, PageCapture } from "./qa-evidence";
import { geometryFromRegions } from "./qa-evidence";
import { playwrightAdapter, type RawLayout } from "../lib/browser-adapter";
import { withBrowser } from "../lib/browser-lifecycle";
import type { ViewportName } from "../lib/viewports";

const PAGE_PATHS: Record<PageId, string> = {
  home: "",
  about: "about",
  services: "services",
  contact: "contact",
};

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

export function createProductionQaCapture(env: Env, previewUrl: string): QaCaptureFn {
  const base = previewUrl.replace(/\/$/, "");
  return async (spec) => {
    const session = await playwrightAdapter.launch(env);
    return withBrowser(session, async (browser) => {
      const captures: PageCapture[] = [];
      for (const entry of spec) {
        const page = await browser.newPage({
          viewport: { name: viewportName(entry.viewportWidth), width: entry.viewportWidth, height: 900 },
          reducedMotion: false,
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
