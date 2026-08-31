import { describe, expect, it } from "vitest";
import type { InteractionCapture, InteractionObservation } from "../src/types";
import {
  buildFallbackCapture,
  classifyMotionSafety,
  dedupeAndRank,
  deriveInteractionStatus,
  fallbackProfile,
  isMotionSafe,
  normalizeInteractions,
} from "../src/lib/interaction-capture";
import type { ReferenceViewport } from "../src/lib/viewports";

const desktop: ReferenceViewport = { name: "desktop", width: 1440, height: 900 };
const mobile: ReferenceViewport = { name: "mobile", width: 375, height: 812 };

function rawDetection(overrides: Partial<{
  reducedMotion: boolean;
  candidateCount: number;
  sticky: string[];
  reveal: Array<{ selector: string; properties: string[]; duration: string; easing: string; delay: string }>;
}> = {}) {
  return {
    reducedMotion: overrides.reducedMotion ?? false,
    candidates: Array.from({ length: overrides.candidateCount ?? 3 }, (_, i) => ({
      selector: i === 0 ? "nav a" : i === 1 ? "button.cta" : "a.link",
      tag: i === 1 ? "button" : "a",
      role: null,
      text: `Item ${i}`,
      triggers: (i === 1 ? ["hover", "focus", "active"] : ["hover", "focus", "active"]) as InteractionObservation["trigger"][],
      transitionProperties: ["color", "background-color"],
      transitionDuration: "200ms",
      transitionTimingFunction: "ease-out",
      transitionDelay: "0s",
      hasAnimation: false,
      animationName: "",
      resting: {},
      bounds: { x: 0, y: i * 40, width: 100, height: 30 },
    })),
    sticky: overrides.sticky ?? [],
    revealCandidates: overrides.reveal ?? [],
    finalUrl: "https://example.com/home",
  };
}

describe("interaction normalization", () => {
  it("produces observed evidence for interactive candidates", () => {
    const observations = normalizeInteractions(rawDetection({ candidateCount: 2 }), desktop);
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((o) => o.observed)).toBe(true);
    expect(observations.some((o) => o.trigger === "hover")).toBe(true);
    expect(observations.some((o) => o.trigger === "focus")).toBe(true);
    observations.forEach((o) => {
      expect(o.evidence.viewport).toBe("desktop");
      expect(o.duration).toBe("200ms");
      expect(o.easing).toBe("ease-out");
    });
  });

  it("records sticky and scroll-reveal observations separately", () => {
    const observations = normalizeInteractions(
      rawDetection({ candidateCount: 0, sticky: [".navbar"], reveal: [{ selector: ".hero", properties: ["opacity"], duration: "600ms", easing: "ease", delay: "0s" }] }),
      desktop
    );
    expect(observations.some((o) => o.trigger === "sticky" && o.selector === ".navbar")).toBe(true);
    expect(observations.some((o) => o.trigger === "scroll-reveal" && o.selector === ".hero")).toBe(true);
  });
});

describe("observed vs inferred", () => {
  it("marks live-captured observations as observed", () => {
    const observations = normalizeInteractions(rawDetection(), desktop);
    expect(observations.every((o) => o.observed === true)).toBe(true);
  });

  it("marks fallback profile observations as inferred", () => {
    const fallback = fallbackProfile(mobile);
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback.every((o) => o.observed === false)).toBe(true);
    expect(fallback.some((o) => o.trigger === "hover")).toBe(true);
    expect(fallback.some((o) => o.trigger === "focus")).toBe(true);
  });

  it("fallback capture carries a documented reason and is non-empty", () => {
    const capture = buildFallbackCapture(mobile, "https://down.example", "slug", 1, { code: "DNS_FAILURE", message: "no resolve" }, "t");
    expect(capture.observations.length).toBeGreaterThan(0);
    expect(capture.observations.every((o) => !o.observed)).toBe(true);
    expect(capture.fallbackReason?.code).toBe("DNS_FAILURE");
    expect(capture.status).toBe("partial");
  });
});

describe("dedupe and rank", () => {
  it("dedupes identical trigger+selector and sorts by relevance", () => {
    const a: InteractionObservation = {
      id: "1", trigger: "hover", target: "a", selector: "nav a", viewport: "desktop", role: null,
      observed: true, changedProperties: [], before: {}, after: {}, duration: "200ms", easing: "ease",
      delay: "0s", motionSafe: true, relevance: 3, evidence: { viewport: "desktop", selector: "nav a", screenshotR2Key: null },
    };
    const b = { ...a, id: "2", relevance: 5, after: { color: "red" } };
    const ranked = dedupeAndRank([a, b]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].relevance).toBe(5);
  });
});

describe("motion safety", () => {
  it("flags long scroll-reveal as not motion-safe", () => {
    expect(isMotionSafe("scroll-reveal", "1200ms", false)).toBe(false);
    expect(isMotionSafe("scroll-reveal", "400ms", false)).toBe(true);
  });

  it("derives partial status when reduced motion is detected", () => {
    const observations = normalizeInteractions(rawDetection(), desktop);
    expect(deriveInteractionStatus(observations, true)).toBe("partial");
  });

  it("derives failed status when nothing was observed", () => {
    expect(deriveInteractionStatus([], false)).toBe("failed");
  });

  it("produces safety notes for unsafe motion and reduced-motion references", () => {
    const capture: InteractionCapture = {
      viewport: { name: "desktop", width: 1440, height: 900 },
      referenceUrl: "https://example.com",
      status: "partial",
      reducedMotionDetected: true,
      fallbackReason: null,
      observations: [
        {
          id: "x", trigger: "scroll-reveal", target: "section", selector: ".hero", viewport: "desktop", role: null,
          observed: true, changedProperties: [], before: {}, after: {}, duration: "1200ms", easing: "ease",
          delay: "0s", motionSafe: false, relevance: 3, evidence: { viewport: "desktop", selector: ".hero", screenshotR2Key: null },
        },
      ],
      screenshotR2Key: null,
      interactionsR2Key: "k",
      capturedAt: "t",
    };
    const notes = classifyMotionSafety([capture]);
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes.some((n) => n.includes("prefers-reduced-motion"))).toBe(true);
    expect(notes.some((n) => n.includes(".hero"))).toBe(true);
  });
});
