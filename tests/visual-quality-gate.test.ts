import { describe, expect, it } from "vitest";
import {
  canPublishQualityGate,
  compareLayoutToBlueprint,
  calculateContrastRatio,
  inspectIconMarkup,
  runVisualQualityGate,
  selectCandidateForInteraction,
  scoreQualityGate,
  waitForBrowserPreviewReadiness,
} from "../src/lib/visual-quality-gate";
import { makeDesign, makeInteraction } from "./helpers/blueprint-fixtures";
import { createFixtureAdapter } from "./helpers/browser-fixtures";
import type { QaIssue } from "../src/types";
import type { RawCandidate, RawLayout } from "../src/lib/browser-adapter";
import type { Env } from "../src/env.d";

function finding(severity: QaIssue["severity"]): QaIssue {
  return {
    severity,
    category: "visual",
    page: "/",
    selector: "main",
    issue: "finding",
    recommendedFix: "fix",
  };
}

function layout(overrides: Partial<RawLayout> = {}): RawLayout {
  return {
    finalUrl: "https://preview.example",
    title: "Preview",
    lang: "en",
    description: "Preview description",
    viewportMeta: "width=device-width, initial-scale=1",
    sections: [0, 1, 2, 3, 4].map((order) => ({
      order,
      tag: "section",
      role: null,
      heading: `Section ${order}`,
      text: `Section ${order}`,
      bounds: { x: 0, y: order * 400, width: 1440, height: 380 },
      evidenceId: `cf-${order}`,
    })),
    typography: [
      { element: "body", fontFamily: "Inter", fontSize: "16px", fontWeight: "400", lineHeight: "24px", letterSpacing: "0px", textTransform: "none", evidenceId: null },
      { element: "h1", fontFamily: "Playfair Display", fontSize: "40px", fontWeight: "700", lineHeight: "46px", letterSpacing: "0px", textTransform: "none", evidenceId: "cf-h1" },
    ],
    colors: { background: "rgb(255, 255, 255)", text: "rgb(17, 17, 17)", accents: ["rgb(17, 17, 17)", "rgb(37, 99, 235)"] },
    nav: [],
    images: [0, 1, 2].map((index) => ({ src: `/image-${index}.webp`, alt: `Image ${index}`, naturalWidth: 1200, naturalHeight: 675, displayedWidth: 900, inMain: true, evidenceId: `cf-img-${index}` })),
    spacing: { sectionPadding: "80px 0px", sectionMargin: "0px", rhythm: "24px", evidenceId: "cf-0" },
    contrastSamples: [{ selector: "body", evidenceId: null, text: "Preview", color: "rgb(17, 17, 17)", backgroundColor: "rgb(255, 255, 255)", fontSize: "16px", fontWeight: "400" }],
    consentDetected: false,
    ...overrides,
  };
}

function qualityEnv(): { env: Env; stored: Map<string, ArrayBuffer> } {
  const stored = new Map<string, ArrayBuffer>();
  const bucket = {
    async put(key: string, value: ArrayBuffer | ReadableStream | string) {
      const buffer = value instanceof ArrayBuffer
        ? value
        : typeof value === "string"
          ? new TextEncoder().encode(value).buffer
          : await new Response(value).arrayBuffer();
      stored.set(key, buffer);
      return { key } as R2Object;
    },
  } as unknown as R2Bucket;
  return { env: { SITE_BUCKET: bucket, VISUAL_QA_MIN_SCORE: "80" } as Env, stored };
}

describe("pre-push visual quality gate", () => {
  it("blocks critical issues even when the numeric score is above threshold", () => {
    const issues = [finding("critical")];
    const score = scoreQualityGate(issues);
    expect(score).toBe(65);
    expect(canPublishQualityGate(score, 60, issues)).toBe(false);
  });

  it("blocks a score below the configured threshold", () => {
    const issues = [finding("major"), finding("major")];
    const score = scoreQualityGate(issues);
    expect(score).toBe(76);
    expect(canPublishQualityGate(score, 80, issues)).toBe(false);
  });

  it("accepts a structurally sound responsive layout", () => {
    const issues = compareLayoutToBlueprint(layout(), makeDesign(), { name: "desktop", width: 1440 }, "/");
    expect(issues).toEqual([]);
  });

  it("emits evidence-backed overflow and hierarchy findings", () => {
    const bad = layout({
      sections: [{ order: 0, tag: "section", role: null, heading: "Only", text: "Only", bounds: { x: -10, y: 0, width: 1500, height: 400 }, evidenceId: "cf-bad" }],
    });
    const issues = compareLayoutToBlueprint(bad, makeDesign(), { name: "mobile", width: 375 }, "/");
    expect(issues.some((entry) => entry.issue.includes("hierarchy"))).toBe(true);
    expect(issues.some((entry) => entry.issue.includes("overflows"))).toBe(true);
    expect(issues.every((entry) => entry.expected && entry.actual && entry.evidence && entry.recommendedFix)).toBe(true);
  });

  it("enforces build-time, restrained, accessible Lucide markup", () => {
    const valid = '<article><svg class="icon" aria-hidden="true" focusable="false"></svg></article>';
    expect(inspectIconMarkup(valid, "/")).toEqual([]);

    const excessive = Array.from({ length: 7 }, () => '<svg class="icon"></svg>').join("");
    const issues = inspectIconMarkup(`${excessive}<script src="https://unpkg.com/lucide"></script>`, "/");
    expect(issues.some((entry) => entry.issue.includes("overused"))).toBe(true);
    expect(issues.some((entry) => entry.issue.includes("accessible"))).toBe(true);
    expect(issues.some((entry) => entry.issue.includes("runtime"))).toBe(true);
  });

  it("captures every page and viewport while exercising and resetting interactions", async () => {
    const { env, stored } = qualityEnv();
    const adapter = createFixtureAdapter({
      name: "preview",
      httpStatus: 200,
      duplicateButtons: 1,
      hoverChangesColor: true,
      hasReveal: true,
      reducedMotionRemovesMotion: true,
    });
    const report = await runVisualQualityGate(env, {
      previewUrl: "https://preview.example",
      clientSlug: "client",
      version: 2,
      attempt: 1,
      design: makeDesign(),
      interaction: makeInteraction(),
      adapter,
      browserReadiness: { attempts: 1 },
    });

    expect(Object.keys(report.screenshots.desktop)).toHaveLength(4);
    expect(Object.keys(report.screenshots.tablet)).toHaveLength(4);
    expect(Object.keys(report.screenshots.mobile)).toHaveLength(4);
    expect(adapter.ledger.some((entry) => entry.kind === "hover")).toBe(true);
    expect(adapter.ledger.some((entry) => entry.kind === "scrollTo")).toBe(true);
    expect(adapter.ledger.some((entry) => entry.kind === "reset")).toBe(true);
    const firstImageWait = adapter.ledger.findIndex((entry) => entry.kind === "waitForImages");
    const firstLayoutRead = adapter.ledger.findIndex((entry) => entry.kind === "extractLayout");
    const firstRevealFlush = adapter.ledger.findIndex((entry) => entry.kind === "showAllRevealElements");
    const firstScreenshot = adapter.ledger.findIndex((entry) => entry.kind === "screenshot");
    expect(firstImageWait).toBeGreaterThanOrEqual(0);
    expect(firstImageWait).toBeLessThan(firstLayoutRead);
    expect(firstRevealFlush).toBeLessThan(firstScreenshot);
    expect(adapter.pagesOpened).toBe(adapter.pagesClosed);
    expect(adapter.sessionsClosed).toBe(1);
    expect(stored.has(report.reportR2Key)).toBe(true);
    expect(stored.has(report.interactionEvidenceR2Key)).toBe(true);
  });

  it("matches interaction evidence to the exact renderable blueprint selector", () => {
    const candidate = (evidenceId: string, capabilitySelectors: string[]): RawCandidate => ({
      evidenceId,
      tag: "article",
      role: null,
      text: evidenceId,
      href: null,
      external: false,
      selector: `[data-cf-evidence-id="${evidenceId}"]`,
      capabilitySelectors,
      triggers: ["hover"],
      transitionProperties: ["transform"],
      transitionDuration: "200ms",
      transitionTimingFunction: "ease",
      transitionDelay: "0ms",
      hasAnimation: false,
      isToggle: false,
      isSticky: false,
      isReveal: false,
      isSafeFormControl: false,
      resting: {},
      bounds: { x: 0, y: 0, width: 100, height: 40 },
    });
    const selected = selectCandidateForInteraction(
      [candidate("card", [".card"]), candidate("button", [".btn"])],
      makeInteraction().interactions.find((entry) => entry.trigger === "hover")!
    );
    expect(selected?.evidenceId).toBe("button");
  });

  it("calculates WCAG contrast and blocks unreadable rendered text", () => {
    expect(calculateContrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(21, 2);
    const issues = compareLayoutToBlueprint(layout({
      contrastSamples: [{ selector: ".lead", evidenceId: "cf-lead", text: "Unreadable", color: "rgb(119, 119, 119)", backgroundColor: "rgb(136, 136, 136)", fontSize: "16px", fontWeight: "400" }],
    }), makeDesign(), { name: "desktop", width: 1440 }, "/");
    const contrast = issues.find((entry) => entry.issue.includes("sufficient contrast"));
    expect(contrast?.severity).toBe("critical");
    expect(contrast?.selector).toBe(".lead");
  });

  it("blocks missing and undecodable required page imagery", () => {
    const issues = compareLayoutToBlueprint(layout({
      images: [{ src: "/broken.webp", alt: "Broken", naturalWidth: 0, naturalHeight: 0, displayedWidth: 900, inMain: true, evidenceId: "cf-broken" }],
    }), makeDesign(), { name: "desktop", width: 1440 }, "/");
    expect(issues.some((entry) => entry.issue.includes("missing or did not load"))).toBe(true);
    expect(issues.some((entry) => entry.issue.includes("failed to load"))).toBe(true);
    expect(issues.filter((entry) => entry.category === "images").every((entry) => entry.severity === "critical")).toBe(true);
  });

  it("waits for Browser Run route propagation before visual QA begins", async () => {
    const adapter = createFixtureAdapter({
      name: "eventual-preview",
      httpStatus: 200,
      httpStatusSequence: [404, 404, 404, 404, 200, 200, 200, 200],
    });
    const session = await adapter.launch({});
    await waitForBrowserPreviewReadiness(session, "https://preview.example", { attempts: 2, delayMs: 0, sleep: async () => undefined });
    expect(adapter.ledger.filter((entry) => entry.kind === "goto")).toHaveLength(8);
    expect(adapter.pagesOpened).toBe(adapter.pagesClosed);
    await session.close();
  });

  it("blocks an inaccessible preview and still closes every browser resource", async () => {
    const { env } = qualityEnv();
    const adapter = createFixtureAdapter({ name: "inaccessible", httpStatus: 200, inaccessible: true });
    const report = await runVisualQualityGate(env, {
      previewUrl: "https://preview.example",
      clientSlug: "client",
      version: 1,
      attempt: 1,
      design: makeDesign(),
      interaction: makeInteraction(),
      adapter,
      browserReadiness: { attempts: 1 },
    });

    expect(report.publishable).toBe(false);
    expect(report.issues.some((entry) => entry.severity === "critical")).toBe(true);
    expect(adapter.pagesOpened).toBe(adapter.pagesClosed);
    expect(adapter.sessionsClosed).toBe(1);
  });
});
