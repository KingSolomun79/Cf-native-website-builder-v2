import { describe, expect, it } from "vitest";
import { evaluateReferenceEvidenceSufficiency } from "../src/domain/reference-sufficiency";
import type { ReferenceEvidence } from "../src/domain/reference-evidence-schema";

// Issue #46 — RankForge/Morabeza negative regression (frozen case).
//
// The exact failure frozen by the 2026-09-05 forensic investigation: a
// dimensions-only evidence package (1440x3752 screenshot; regions [], no
// measured structure) produced an invented 5-region blueprint, a 5-section
// candidate with a 2.6-viewport silhouette (reference: ~10 visual masses
// across ~8.5 viewports), a fabricated "geometry similarity 75" against an
// empty reference profile, and Release Ready at 92.
//
// These assertions use the FROZEN numbers from that case. They exist so this
// exact failure can never pass again — and they contain no Morabeza-specific
// product rules: everything asserted here is deterministic gate behavior on
// the frozen measurements.

const FROZEN = {
  screenshotMetadata: { pixelWidth: 1440, pixelHeight: 3752, likelyCssViewportWidth: 1440 },
  /** The invented candidate: 5 sections, 2.6 viewports total. */
  candidateRegions: [
    { id: "hero", height: 900, viewportHeightRatio: 1.014 },
    { id: "services", height: 720, viewportHeightRatio: 0.8 },
    { id: "about", height: 640, viewportHeightRatio: 0.711 },
    { id: "process", height: 600, viewportHeightRatio: 0.667 },
    { id: "contact", height: 380, viewportHeightRatio: 0.422 },
  ],
  /** What the reference screenshot actually measured (post-#41 extraction):
   *  ~9 major masses across ~8.5 viewports. */
  referenceMassCount: 9,
  referenceViewportSum: 8.5,
} as const;

function dimensionsOnlyEvidence(): ReferenceEvidence {
  return {
    version: "1",
    screenshotId: "frozen/rankforge/reference/screenshot.png",
    screenshotMetadata: { ...FROZEN.screenshotMetadata },
    captures: [],
    regions: [],
    measuredElements: [
      {
        selectorHint: "screenshot",
        role: "canonical-reference-screenshot",
        computed: { pixelWidth: 1440, pixelHeight: 3752, likelyCssViewportWidth: 1440 },
        confidence: "HIGH",
        source: "SCREENSHOT",
      },
    ],
    responsiveObservations: [],
    motionObservations: [],
    discrepancies: [],
  };
}

describe("frozen RankForge negative regression (issue #46)", () => {
  it("the frozen dimensions-only evidence FAILS the sufficiency gate — no blueprint generation", () => {
    const verdict = evaluateReferenceEvidenceSufficiency(dimensionsOnlyEvidence());
    expect(verdict.sufficiency).toBe("INSUFFICIENT");
    expect(verdict.missingBlocking).toEqual(["region_structure", "measured_elements"]);
  });
});
