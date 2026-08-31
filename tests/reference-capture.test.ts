import { describe, expect, it } from "vitest";
import type { ReferenceCapture } from "../src/types";
import {
  classifyCaptureFailure,
  deriveOverallStatus,
  diffResponsiveCaptures,
  failedCapture,
  normalizeCapture,
} from "../src/lib/reference-capture";
import type { ReferenceViewport } from "../src/lib/viewports";

const desktop: ReferenceViewport = { name: "desktop", width: 1440, height: 900 };
const tablet: ReferenceViewport = { name: "tablet", width: 768, height: 1024 };
const mobile: ReferenceViewport = { name: "mobile", width: 375, height: 812 };

function rawExtraction(overrides: Partial<{
  sections: number;
  nav: number;
  consentDetected: boolean;
  redirectCount: number;
  fontSize: string;
}> = {}) {
  const sectionCount = overrides.sections ?? 5;
  return {
    finalUrl: "https://example.com/home",
    title: "Example",
    lang: "en",
    description: "An example site",
    viewportMeta: "width=device-width",
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      order: i,
      tag: i === 0 ? "header" : "section",
      role: null,
      heading: `Section ${i}`,
      text: `Text ${i}`,
      bounds: { x: 0, y: i * 200, width: 1440, height: 200 },
      selector: i === 0 ? "header" : "section",
    })),
    typography: [
      {
        element: "body",
        fontFamily: "Arial",
        fontSize: overrides.fontSize ?? "16px",
        fontWeight: "400",
        lineHeight: "1.5",
        letterSpacing: "normal",
        textTransform: "none",
        selector: "body",
      },
    ],
    colors: { background: "rgb(255,255,255)", text: "rgb(0,0,0)", accents: ["rgb(0,123,255)"] },
    nav: Array.from({ length: overrides.nav ?? 6 }, (_, i) => ({ href: `/p${i}`, text: `P${i}`, external: false })),
    images: [],
    consentDetected: overrides.consentDetected ?? false,
    redirectCount: overrides.redirectCount ?? 0,
  };
}

describe("reference capture normalization", () => {
  it("maps raw extraction to evidence-backed capture", () => {
    const capture = normalizeCapture(rawExtraction(), desktop, "https://example.com", "slug/v1/ref/desktop.png", "2026-01-01T00:00:00Z");
    expect(capture.status).toBe("captured");
    expect(capture.sections).toHaveLength(5);
    expect(capture.sections[0].evidence).toEqual({
      viewport: "desktop",
      selector: "header",
      screenshotR2Key: "slug/v1/ref/desktop.png",
    });
    expect(capture.colors.evidence.viewport).toBe("desktop");
    expect(capture.finalUrl).toBe("https://example.com/home");
    expect(capture.failure).toBeNull();
  });

  it("flags partial status when a consent overlay is detected", () => {
    const capture = normalizeCapture(rawExtraction({ consentDetected: true }), desktop, "https://example.com", "k", "t");
    expect(capture.status).toBe("partial");
    expect(capture.limitations.some((l) => l.includes("consent"))).toBe(true);
  });

  it("records redirect limitations without dropping the capture", () => {
    const capture = normalizeCapture(rawExtraction({ redirectCount: 2 }), desktop, "https://example.com", "k", "t");
    expect(capture.status).toBe("partial");
    expect(capture.redirects).toHaveLength(1);
    expect(capture.limitations.some((l) => l.includes("2 redirect"))).toBe(true);
  });

  it("failedCapture yields a non-empty failed record", () => {
    const capture = failedCapture(mobile, "https://down.example", { code: "DNS_FAILURE", message: "no resolve" }, "t");
    expect(capture.status).toBe("failed");
    expect(capture.failure?.code).toBe("DNS_FAILURE");
    expect(capture.sections).toHaveLength(0);
  });
});

describe("reference capture failure classification", () => {
  it.each([
    ["net::ERR_TIMED_OUT", "NAVIGATION_TIMEOUT"],
    ["Page.goto: Timeout 30000ms exceeded", "NAVIGATION_TIMEOUT"],
    ["getaddrinfo ENOTFOUND example.invalid", "DNS_FAILURE"],
    ["fetch failed with 404", "HTTP_4XX"],
    ["server returned 503 Service Unavailable", "HTTP_5XX"],
  ])("classifies %s -> %s", (message, code) => {
    const failure = classifyCaptureFailure(new Error(message), { phase: "navigate" });
    expect(failure.code).toBe(code);
  });

  it("classifies launch-phase errors as BROWSER_UNAVAILABLE", () => {
    const failure = classifyCaptureFailure(new Error("playwright launch failed"), { phase: "launch" });
    expect(failure.code).toBe("BROWSER_UNAVAILABLE");
  });

  it("falls back to UNKNOWN for unrecognized errors", () => {
    const failure = classifyCaptureFailure(new Error("something weird"), { phase: "evaluate" });
    expect(failure.code).toBe("UNKNOWN");
  });
});

describe("responsive diffing", () => {
  function buildCapture(vp: ReferenceViewport, opts: Partial<{ nav: number; sections: number; fontSize: string }>): ReferenceCapture {
    return normalizeCapture(rawExtraction(opts), vp, "https://example.com", `k/${vp.name}`, "t");
  }

  it("detects navigation collapse between desktop and mobile", () => {
    const desktopCapture = buildCapture(desktop, { nav: 8 });
    const mobileCapture = buildCapture(mobile, { nav: 2 });
    const diffs = diffResponsiveCaptures([desktopCapture, buildCapture(tablet, { nav: 8 }), mobileCapture]);
    expect(diffs.some((d) => d.kind === "nav")).toBe(true);
  });

  it("detects responsive font-size changes", () => {
    const d = buildCapture(desktop, { fontSize: "16px" });
    const m = buildCapture(mobile, { fontSize: "14px" });
    const t = buildCapture(tablet, { fontSize: "16px" });
    const diffs = diffResponsiveCaptures([d, t, m]);
    expect(diffs.some((diff) => diff.kind === "typography")).toBe(true);
  });

  it("produces no diffs when viewports are structurally identical", () => {
    const captures = [desktop, tablet, mobile].map((vp) => buildCapture(vp, {}));
    expect(diffResponsiveCaptures(captures)).toHaveLength(0);
  });

  it("skips diffs when a viewport failed", () => {
    const d = buildCapture(desktop, { nav: 8 });
    const failed = failedCapture(mobile, "https://example.com", { code: "DNS_FAILURE", message: "x" }, "t");
    expect(diffResponsiveCaptures([d, failed])).toHaveLength(0);
  });
});

describe("overall status derivation", () => {
  it("returns captured only when every viewport succeeded cleanly", () => {
    const all = [desktop, tablet, mobile].map((vp) => normalizeCapture(rawExtraction(), vp, "u", "k", "t"));
    expect(deriveOverallStatus(all)).toBe("captured");
  });

  it("returns failed when every viewport failed", () => {
    const all = [desktop, tablet, mobile].map((vp) => failedCapture(vp, "u", { code: "X", message: "y" }, "t"));
    expect(deriveOverallStatus(all)).toBe("failed");
  });

  it("returns partial for mixed results", () => {
    const ok = normalizeCapture(rawExtraction(), desktop, "u", "k", "t");
    const bad = failedCapture(mobile, "u", { code: "X", message: "y" }, "t");
    expect(deriveOverallStatus([ok, bad])).toBe("partial");
  });
});
