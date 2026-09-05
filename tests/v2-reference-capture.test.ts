import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { runReferenceIntake, createProductionReferenceCapture, flatteningSignal, type ReferenceCaptureOutput } from "../src/domain/reference-intake";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { createFixtureAdapter, type FixtureAdapter } from "./helpers/browser-fixtures";
import type { BrowserAdapter, RawLayout } from "../src/lib/browser-adapter";
import { REFERENCE_VIEWPORTS } from "../src/lib/viewports";
import { putObject } from "../src/lib/assets";
import { buildPng } from "./helpers/png";

// Production reference capture (issue #40):
//   1. the Worker environment/BROWSER binding reaches the adapter launch —
//      the exact seam where `playwrightAdapter.launch(undefined)` used to
//      crash every production URL intake;
//   2. the capture is a bounded multi-signal sequence (overlay dismissal
//      probes, real scroll sweep with settle waits, viewport checkpoints,
//      canonical full page, bounded mobile pass), never one stitched shot;
//   3. non-flattenable designs are recorded for Reference Suitability.

const env = providedEnv as unknown as Env;

function launchRecordingAdapter(inner: FixtureAdapter): { adapter: BrowserAdapter; launchedWith: unknown[] } {
  const launchedWith: unknown[] = [];
  const adapter: BrowserAdapter = {
    async launch(adapterEnv) {
      launchedWith.push(adapterEnv);
      return inner.launch(adapterEnv);
    },
  };
  return { adapter, launchedWith };
}

function baseLayout(): RawLayout {
  return {
    finalUrl: "https://fixture.test/sweep",
    title: "Sweep",
    lang: "en",
    description: "fixture",
    viewportMeta: "width=device-width",
    sections: [
      { order: 0, tag: "header", role: "banner", heading: "One", text: "One", bounds: { x: 0, y: 0, width: 1440, height: 700 }, evidenceId: "cf-s0", dataRegion: null },
      { order: 1, tag: "section", role: null, heading: "Two", text: "Two", bounds: { x: 0, y: 700, width: 1440, height: 800 }, evidenceId: "cf-s1", dataRegion: null },
      { order: 2, tag: "section", role: null, heading: "Three", text: "Three", bounds: { x: 0, y: 1500, width: 1440, height: 900 }, evidenceId: "cf-s2", dataRegion: null },
    ],
    typography: [{ element: "h1", fontFamily: "Display", fontSize: "64px", fontWeight: "700", lineHeight: "1.1", letterSpacing: "normal", textTransform: "none", evidenceId: "cf-h1" }],
    colors: { background: "rgb(255,255,255)", text: "rgb(17,17,17)", accents: ["rgb(98,0,238)"] },
    nav: [],
    images: [],
    spacing: { sectionPadding: "64px 0", sectionMargin: "0", rhythm: "32px", evidenceId: "cf-s0" },
    contrastSamples: [],
    consentDetected: false,
  };
}

describe("production capture wiring (issue #40)", () => {
  it("threads the Worker environment into the adapter launch — launch(undefined) is unreachable", async () => {
    const fixture = createFixtureAdapter({ name: "wiring", httpStatus: 200 });
    const { adapter, launchedWith } = launchRecordingAdapter(fixture);
    const sentinelEnv = { BROWSER: { stub: "binding" } } as unknown as Env;
    const capture = createProductionReferenceCapture(sentinelEnv, { adapter });

    await capture({ referenceUrl: "https://fixture.test/wiring", hasSuppliedScreenshot: false });

    expect(launchedWith).toHaveLength(1);
    expect(launchedWith[0]).toBe(sentinelEnv);
    expect((launchedWith[0] as { BROWSER: unknown }).BROWSER).toBeDefined();
  });

  it("fails with a precise error before launch when the BROWSER binding is missing", async () => {
    const fixture = createFixtureAdapter({ name: "no-browser", httpStatus: 200 });
    const { adapter, launchedWith } = launchRecordingAdapter(fixture);
    const capture = createProductionReferenceCapture({} as Env, { adapter });

    await expect(capture({ referenceUrl: "https://fixture.test/no-browser", hasSuppliedScreenshot: false }))
      .rejects.toThrow(/BROWSER binding/);
    expect(launchedWith).toHaveLength(0);
  });

  it("the intake default capture path is env-bound: URL-only intake without BROWSER fails closed, not with launch(undefined)", async () => {
    const screenshotKey = `references/uploads/wire-${Math.random().toString(36).slice(2)}.png`;
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Capture Wire Co", contactEmail: "wire@capture.example" },
        reference: { url: "https://fixture.test/intake-default" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    // Test env carries no BROWSER binding; the old defect surfaced here as an
    // opaque adapter crash. It must now be the precise guard error.
    await expect(
      runReferenceIntake(env, {
        siteGenerationId: started.siteGenerationId,
        buildId: created.buildId,
        buildVersionId: created.buildVersionId,
        buildVersionNumber: 1,
      })
    ).rejects.toThrow(/BROWSER binding/);
    void screenshotKey;
    await putObject(env, screenshotKey, new Uint8Array(buildPng({ width: 400, height: 300 })));
  });
});

describe("multi-signal capture sequence (issue #40)", () => {
  it("dismisses overlays (bounded), sweeps with checkpoints, captures mobile, records flattening check", async () => {
    const scenario = {
      name: "sweep",
      httpStatus: 200,
      consentOverlay: true,
      hasReveal: true,
      hasStickyHeader: true,
      sections: baseLayout().sections,
    };
    const fixture = createFixtureAdapter(scenario);
    const { adapter } = launchRecordingAdapter(fixture);
    const capture = createProductionReferenceCapture({ BROWSER: "stub" } as unknown as Env, { adapter });

    const output: ReferenceCaptureOutput = await capture({ referenceUrl: "https://fixture.test/sweep", hasSuppliedScreenshot: false });

    // ── Multi-signal captures: canonical + checkpoints + mobile ────────────
    expect(output.captures.length).toBeGreaterThanOrEqual(3);
    // canonical full page first, viewport checkpoints next, mobile last.
    expect(output.captures[0].viewportWidth).toBe(REFERENCE_VIEWPORTS[0].width);
    const mobileCapture = output.captures[output.captures.length - 1];
    expect(mobileCapture.viewportWidth).toBe(REFERENCE_VIEWPORTS[2].width);

    // ── Ledger: real scrolling + settles + dismissal probes happened ───────
    const kinds = fixture.ledger.map((entry) => entry.kind);
    expect(kinds.filter((kind) => kind === "scrollTo").length).toBeGreaterThanOrEqual(3);
    expect(kinds.filter((kind) => kind === "settle").length).toBeGreaterThanOrEqual(3);
    const dismissProbes = fixture.ledger.filter((entry) => entry.kind === "countMatches" && String(entry.selector).includes("cookie"));
    expect(dismissProbes.length).toBeGreaterThanOrEqual(1);
    const screenshots = fixture.ledger.filter((entry) => entry.kind === "screenshot");
    expect(screenshots.some((entry) => entry.detail === true)).toBe(true);
    expect(screenshots.some((entry) => entry.detail === false)).toBe(true);

    // ── Desktop + mobile pages, all closed, session closed ─────────────────
    expect(fixture.pagesOpened).toBe(2);
    expect(fixture.pagesClosed).toBe(2);
    expect(fixture.sessionsClosed).toBe(1);

    // ── Measured evidence: sections + typography + surfaces + spacing ──────
    const roles = output.measuredElements.map((element) => element.role);
    expect(roles).toContain("surface");
    expect(roles).toContain("spacing");
    expect(output.regions.length).toBeGreaterThanOrEqual(3);

    // ── Observations recorded, never invented ──────────────────────────────
    const observationKinds = output.responsiveObservations.map((entry) => (entry as { kind: string }).kind);
    expect(observationKinds).toContain("viewport_checkpoints");
    expect(observationKinds).toContain("mobile_capture");
    const discrepancyKinds = output.discrepancies.map((entry) => (entry as { kind: string }).kind);
    expect(discrepancyKinds).toContain("flattening_check");
  });
});

describe("flattening signal (issue #40)", () => {
  it("flags a material section-topology change under scroll as unstable", () => {
    const pre = baseLayout();
    const post = { ...baseLayout(), sections: pre.sections.slice(0, 1) };
    const signal = flatteningSignal(pre, post);
    expect(signal.unstable).toBe(true);
    expect(signal.detail).toContain("unreliable");
  });

  it("keeps a stable topology non-flagged", () => {
    const pre = baseLayout();
    const post = { ...baseLayout(), sections: [...pre.sections, { ...pre.sections[2], order: 3 }] };
    expect(flatteningSignal(pre, post).unstable).toBe(false);
  });
});

describe("unreliable flattening affects Reference Suitability (issue #40)", () => {
  it("classifies a scroll-transform capture as SUPPORTED_WITH_LIMITATIONS, requiring an Adaptation Contract", async () => {
    const screenshotKey = `references/uploads/flat-${Math.random().toString(36).slice(2)}.png`;
    await putObject(env, screenshotKey, new Uint8Array(buildPng({ width: 1200, height: 3000, idatBytes: 77 })));
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Flatten Probe Co", contactEmail: "flat@probe.example" },
        reference: { screenshotR2Key: screenshotKey, url: "https://fixture.test/scroll-jacked" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    const captureOutput = {
      canonicalScreenshot: { content: new Uint8Array(buildPng({ width: 1440, height: 900 })), mimeType: "image/png", pixelWidth: 1440, likelyCssViewportWidth: 1440 },
      captures: [{ viewportWidth: 1440, viewportHeight: 900, content: new Uint8Array(buildPng({ width: 1440, height: 900 })), mimeType: "image/png" }],
      regions: [{ id: "region-0", startY: 0, endY: 700, height: 700, viewportHeightRatio: 0.778 }],
      measuredElements: [
        { selectorHint: "header", role: "banner", boundingBox: { x: 0, y: 0, width: 1440, height: 700 }, confidence: "HIGH" as const, source: "DOM" as const },
      ],
      responsiveObservations: [{ kind: "viewport_checkpoints", count: 3 }],
      motionObservations: [{ kind: "unreliable_scroll_flattening", detail: "section topology changed under scrolling (4 -> 1 sections)" }],
      discrepancies: [],
    } satisfies ReferenceCaptureOutput;

    // Without a contract the limitation blocks intake (SWL semantics)…
    await expect(
      runReferenceIntake(env, {
        siteGenerationId: started.siteGenerationId,
        buildId: created.buildId,
        buildVersionId: created.buildVersionId,
        buildVersionNumber: 1,
        capture: async () => captureOutput,
      })
    ).rejects.toMatchObject({ code: "ADAPTATION_CONTRACT_REQUIRED" });

    // …and with the contract the limitation is declared, not hidden.
    const frozen = await runReferenceIntake(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      buildVersionNumber: 1,
      capture: async () => captureOutput,
      adaptationContract: {
        version: "1",
        unsupportedFeatures: [{ feature: "unreliable_scroll_flattening", reason: "scroll-transform layout; checkpoints carry composition" }],
        acceptedApproximations: [{ replaces: "unreliable_scroll_flattening", substituteOutcome: "viewport checkpoints authoritative for motion bands" }],
        qaExceptions: [],
      },
    });
    expect(frozen.suitability).toBe("SUPPORTED_WITH_LIMITATIONS");
    expect(frozen.suitabilityReasons.join(" ")).toContain("unreliable_scroll_flattening");
  });
});
