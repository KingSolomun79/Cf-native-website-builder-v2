import { canonicalStructuredFacts } from "./helpers/canonical-facts";
import { beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import {
  ReferenceIntakeError,
  runReferenceIntake,
  getFrozenReferenceEvidence,
  type ReferenceCaptureFn,
  type ReferenceCaptureOutput,
} from "../src/domain/reference-intake";
import {
  classifyReferenceSuitability,
  deriveSuitabilitySignals,
  validateAdaptationContract,
  type StructuredObservation,
} from "../src/domain/reference-evidence-schema";
import { getObject, putObject } from "../src/lib/assets";

// Primary-seam tests for Reference intake, deterministic suitability and the
// frozen versioned Reference Evidence package (issue #7).

const env = providedEnv as unknown as Env;

import { buildPng } from "./helpers/png";

// QA-F2: submitted screenshots must pass structural validation, so fixtures
// are real (distinct, valid) PNGs; the idat seed keeps them byte-distinct.
function screenshotBytes(seed: string): Uint8Array {
  return new Uint8Array(buildPng({ width: 1200, height: 3000, idatBytes: 40 + seed.length }));
}

async function expectStoredBytes(body: ReadableStream, fixture: Uint8Array): Promise<void> {
  const stored = new Uint8Array(await new Response(body).arrayBuffer());
  expect(stored.byteLength).toBe(fixture.byteLength);
  for (let i = 0; i < fixture.length; i++) expect(stored[i]).toBe(fixture[i]);
}

function baseCapture(overrides: Partial<ReferenceCaptureOutput> = {}): ReferenceCaptureOutput {
  return {
    canonicalScreenshot: {
      content: screenshotBytes("canonical-live"),
      mimeType: "image/png",
      pixelWidth: 1440,
      pixelHeight: 5200,
      likelyCssViewportWidth: 1440,
    },
    captures: [
      { viewportWidth: 1440, viewportHeight: 900, content: screenshotBytes("live-1440"), mimeType: "image/png" },
      { viewportWidth: 390, content: screenshotBytes("live-390"), mimeType: "image/png" },
    ],
    regions: [
      { id: "region-1", startY: 0, endY: 760, height: 760, viewportHeightRatio: 0.844 },
      { id: "region-2", startY: 760, endY: 1800, height: 1040, viewportHeightRatio: 1.156 },
    ],
    measuredElements: [
      {
        selectorHint: "header nav",
        role: "navigation",
        boundingBox: { x: 0, y: 0, width: 1440, height: 88 },
        confidence: "HIGH",
        source: "DOM",
      },
      {
        selectorHint: "h1",
        role: "typography",
        computed: { fontFamily: "'Editorial Serif'", fontSize: "72px" },
        confidence: "MEDIUM",
        source: "COMPUTED_STYLE",
      },
    ],
    responsiveObservations: [{ kind: "viewport_matrix", viewports: ["desktop", "mobile"] }],
    motionObservations: [],
    discrepancies: [],
    ...overrides,
  };
}

function captureFn(output: ReferenceCaptureOutput): ReferenceCaptureFn {
  return async () => output;
}

async function newGeneration(options: {
  reference?: Record<string, unknown>;
  putScreenshot?: string | null;
}): Promise<{ siteGenerationId: string; buildId: string; buildVersionId: string }> {
  const screenshotKey = `references/uploads/ref-${Math.random().toString(36).slice(2)}.png`;
  if (options.putScreenshot !== null) {
    await putObject(env, options.putScreenshot ?? screenshotKey, screenshotBytes("submitted"));
  }
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Rift Valley Roasters", contactEmail: "hello@rvr.example" , ...(canonicalStructuredFacts()) },
      reference:
        options.reference === undefined
          ? { screenshotR2Key: options.putScreenshot ?? screenshotKey }
          : options.reference,
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { siteGenerationId: started.siteGenerationId, buildId: created.buildId, buildVersionId: created.buildVersionId };
}

function intakeInput(context: { siteGenerationId: string; buildId: string; buildVersionId: string }) {
  return {
    siteGenerationId: context.siteGenerationId,
    buildId: context.buildId,
    buildVersionId: context.buildVersionId,
    buildVersionNumber: 1,
  };
}

const ADAPTATION_CONTRACT = {
  version: "1",
  unsupportedFeatures: [{ feature: "complex_slider", reason: "multi-track draggable slider" }],
  acceptedApproximations: [
    { replaces: "complex_slider", substituteOutcome: "justified lightweight slider with same frame rhythm" },
  ],
  qaExceptions: ["slider track count reduced to 3"],
};

describe("deterministic suitability classification", () => {
  it("classifies clean references as SUPPORTED", () => {
    const decision = classifyReferenceSuitability([]);
    expect(decision.suitability).toBe("SUPPORTED");
  });

  it("classifies adaptable limitations as SUPPORTED_WITH_LIMITATIONS", () => {
    const observations: StructuredObservation[] = [{ kind: "complex_slider" }, { kind: "custom_cursor" }];
    const decision = classifyReferenceSuitability(deriveSuitabilitySignals(observations));
    expect(decision.suitability).toBe("SUPPORTED_WITH_LIMITATIONS");
    expect(decision.signals.map((signal) => signal.feature)).toEqual(["complex_slider", "custom_cursor"]);
  });

  it("classifies capability-envelope violations as UNSUPPORTED, identity-defining or not", () => {
    for (const kind of ["canvas_webgl_primary", "authenticated_behavior", "dominant_video", "unsupported_scale"]) {
      expect(classifyReferenceSuitability(deriveSuitabilitySignals([{ kind }])).suitability).toBe("UNSUPPORTED");
    }
  });

  it("requires the Adaptation Contract to cover every accepted limitation", () => {
    const decision = classifyReferenceSuitability(deriveSuitabilitySignals([{ kind: "complex_slider" }, { kind: "heavy_parallax" }]));
    const partial = validateAdaptationContract(ADAPTATION_CONTRACT, decision);
    expect(partial.valid).toBe(false);
    if (!partial.valid) expect(partial.uncovered).toEqual(["heavy_parallax"]);

    const full = validateAdaptationContract(
      {
        ...ADAPTATION_CONTRACT,
        unsupportedFeatures: [...ADAPTATION_CONTRACT.unsupportedFeatures, { feature: "heavy_parallax", reason: "x" }],
      },
      decision
    );
    expect(full.valid).toBe(true);
  });
});

describe("Reference intake and evidence freeze", () => {
  it("accepts screenshot-only References without any URL capture", async () => {
    const context = await newGeneration({});
    let captureCalled = false;
    const frozen = await runReferenceIntake(env, {
      ...intakeInput(context),
      capture: async () => {
        captureCalled = true;
        return baseCapture();
      },
    });

    expect(captureCalled).toBe(false);
    expect(frozen.inputMode).toBe("SCREENSHOT_ONLY");
    expect(frozen.suitability).toBe("SUPPORTED");
    expect(frozen.alreadyFrozen).toBe(false);

    // The canonical screenshot is the submitted screenshot, frozen immutably.
    const stored = await env.SITE_BUCKET.get(frozen.canonicalScreenshotR2Key);
    expect(stored).not.toBeNull();
    await expectStoredBytes(stored!.body, screenshotBytes("submitted"));

    const read = await getFrozenReferenceEvidence(env, context.siteGenerationId);
    expect(read!.evidence.version).toBe("2");
    expect(read!.evidence.regions).toHaveLength(0);
  });

  it("converts URL-only References into canonical frozen screenshot/evidence before downstream analysis", async () => {
    const context = await newGeneration({ reference: { url: "https://reference.example.com/" }, putScreenshot: null as unknown as string });
    const capture = baseCapture();
    const frozen = await runReferenceIntake(env, { ...intakeInput(context), capture: captureFn(capture) });

    expect(frozen.inputMode).toBe("URL_ONLY");
    const stored = await env.SITE_BUCKET.get(frozen.canonicalScreenshotR2Key);
    await expectStoredBytes(stored!.body, screenshotBytes("canonical-live"));

    const read = await getFrozenReferenceEvidence(env, context.siteGenerationId);
    expect(read!.evidence.referenceUrl).toBe("https://reference.example.com/");
    expect(read!.evidence.screenshotMetadata.pixelWidth).toBe(1440);
    expect(read!.evidence.captures).toHaveLength(2);
    expect(read!.evidence.captures[0].screenshotArtifact).toContain("captures/1-1440");
    // Deterministic measurements captured BEFORE interpretation are versioned in.
    expect(read!.evidence.regions).toHaveLength(2);
    expect(read!.evidence.measuredElements[1].source).toBe("COMPUTED_STYLE");
  });

  it("keeps the frozen Reference Screenshot authoritative when live URL evidence conflicts", async () => {
    const context = await newGeneration({ reference: { url: "https://reference.example.com/", screenshotR2Key: "references/uploads/conflict.png" }, putScreenshot: "references/uploads/conflict.png" });
    const capture = baseCapture({
      discrepancies: [
        { kind: "first_viewport_region_order", detail: "live shows cookie banner above hero not present in frozen screenshot" },
      ],
    });
    const frozen = await runReferenceIntake(env, { ...intakeInput(context), capture: captureFn(capture) });

    expect(frozen.inputMode).toBe("SCREENSHOT_AND_URL");
    // Canonical = submitted screenshot, NOT the live capture.
    const stored = await env.SITE_BUCKET.get(frozen.canonicalScreenshotR2Key);
    await expectStoredBytes(stored!.body, screenshotBytes("submitted"));

    const read = await getFrozenReferenceEvidence(env, context.siteGenerationId);
    const recorded = read!.evidence.discrepancies as Array<Record<string, unknown>>;
    expect(recorded.some((entry) => entry.kind === "first_viewport_region_order")).toBe(true);
    expect(recorded.every((entry) => entry.resolution === "REFERENCE_SCREENSHOT_AUTHORITATIVE")).toBe(true);
  });

  it("requires a concrete Adaptation Contract for SUPPORTED_WITH_LIMITATIONS before generation continues", async () => {
    const limited = baseCapture({ motionObservations: [{ kind: "complex_slider" }] });
    const context = await newGeneration({ reference: { url: "https://reference.example.com/" }, putScreenshot: null });

    await expect(runReferenceIntake(env, { ...intakeInput(context), capture: captureFn(limited) })).rejects.toMatchObject({
      code: "ADAPTATION_CONTRACT_REQUIRED",
    });

    const incomplete = await newGeneration({ reference: { url: "https://reference.example.com/" }, putScreenshot: null });
    await expect(
      runReferenceIntake(env, {
        ...intakeInput(incomplete),
        capture: captureFn(
          baseCapture({
            motionObservations: [{ kind: "complex_slider" }, { kind: "custom_cursor" }],
          })
        ),
        adaptationContract: ADAPTATION_CONTRACT,
      })
    ).rejects.toMatchObject({ code: "ADAPTATION_CONTRACT_REQUIRED" });

    const covered = await newGeneration({ reference: { url: "https://reference.example.com/" }, putScreenshot: null });
    const frozen = await runReferenceIntake(env, {
      ...intakeInput(covered),
      capture: captureFn(baseCapture({ motionObservations: [{ kind: "complex_slider" }] })),
      adaptationContract: ADAPTATION_CONTRACT,
    });
    expect(frozen.suitability).toBe("SUPPORTED_WITH_LIMITATIONS");
    expect(frozen.adaptationContract!.qaExceptions).toContain("slider track count reduced to 3");

    const read = await getFrozenReferenceEvidence(env, covered.siteGenerationId);
    expect(read!.adaptationContract!.acceptedApproximations[0].replaces).toBe("complex_slider");
  });

  it("satisfies the SUPPORTED_WITH_LIMITATIONS contract requirement from the Onboarding Submission reference", async () => {
    // Production seam (2026-09-05 retest): the concrete Adaptation Contract
    // demanded by PRD section 10 rides the immutable Onboarding Submission —
    // no test-only injection needed.
    const context = await newGeneration({
      reference: {
        url: "https://reference.example.com/",
        adaptationContract: {
          version: "1",
          unsupportedFeatures: [{ feature: "heavy_parallax", reason: "scroll-linked parallax choreography" }],
          acceptedApproximations: [
            { replaces: "heavy_parallax", substituteOutcome: "static composition preserved; reduced-motion-safe scroll reveal substitutes parallax" },
          ],
          qaExceptions: [],
        },
      },
      putScreenshot: null,
    });
    const frozen = await runReferenceIntake(env, {
      ...intakeInput(context),
      capture: captureFn(baseCapture({ motionObservations: [{ kind: "heavy_parallax" }] })),
    });

    expect(frozen.suitability).toBe("SUPPORTED_WITH_LIMITATIONS");
    expect(frozen.adaptationContract!.unsupportedFeatures[0].feature).toBe("heavy_parallax");

    const read = await getFrozenReferenceEvidence(env, context.siteGenerationId);
    expect(read!.adaptationContract!.acceptedApproximations[0].replaces).toBe("heavy_parallax");
  });

  it("fails closed on a malformed Adaptation Contract frozen in a legacy submission payload", async () => {
    const context = await newGeneration({ reference: { url: "https://reference.example.com/" }, putScreenshot: null });

    // Submission immutability is trigger-enforced, so the legacy row (frozen
    // before submission-time contract validation existed) is constructed
    // directly. The intake error throws before any package write, so the
    // build/version ids are never persisted.
    const owner = await env.DB.prepare(
      "SELECT business_id, site_id FROM onboarding_submissions WHERE id = (SELECT onboarding_submission_id FROM site_generations WHERE id = ?)"
    )
      .bind(context.siteGenerationId)
      .first<{ business_id: string; site_id: string }>();
    const submissionId = `sub-legacy-${Math.random().toString(36).slice(2)}`;
    const generationId = `gen-legacy-${Math.random().toString(36).slice(2)}`;
    await env.DB.prepare(
      "INSERT INTO onboarding_submissions (id, business_id, site_id, build_mode, schema_version, payload_json, fact_snapshot_json, checksum, submitted_at) VALUES (?, ?, ?, 'REFERENCE_BOUND', 1, ?, '{}', 'legacy', '2026-09-05T00:00:00.000Z')"
    )
      .bind(
        submissionId,
        owner!.business_id,
        owner!.site_id,
        JSON.stringify({
          buildMode: "REFERENCE_BOUND",
          reference: { url: "https://reference.example.com/", adaptationContract: { version: "1" } },
        })
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO site_generations (id, site_id, onboarding_submission_id, build_mode, sequence_number, created_at, updated_at) VALUES (?, ?, ?, 'REFERENCE_BOUND', 2, '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')"
    )
      .bind(generationId, owner!.site_id, submissionId)
      .run();

    await expect(
      runReferenceIntake(env, {
        siteGenerationId: generationId,
        buildId: context.buildId,
        buildVersionId: context.buildVersionId,
        buildVersionNumber: 1,
        capture: captureFn(baseCapture({ motionObservations: [{ kind: "heavy_parallax" }] })),
      })
    ).rejects.toMatchObject({ code: "ADAPTATION_CONTRACT_INVALID" });
  });

  it("freezes UNSUPPORTED classification instead of hiding it as a limitation", async () => {
    const context = await newGeneration({ reference: { url: "https://reference.example.com/" }, putScreenshot: null });
    const frozen = await runReferenceIntake(env, {
      ...intakeInput(context),
      capture: captureFn(baseCapture({ motionObservations: [{ kind: "canvas_webgl_primary", identityDefining: true }] })),
      adaptationContract: ADAPTATION_CONTRACT,
    });
    expect(frozen.suitability).toBe("UNSUPPORTED");
    expect(frozen.suitabilityReasons[0]).toContain("canvas_webgl_primary");
  });

  it("never promotes Reference content into Business Facts", async () => {
    const context = await newGeneration({});
    const submissionBefore = await env.DB.prepare(
      "SELECT payload_json, fact_snapshot_json, checksum FROM onboarding_submissions WHERE id = (SELECT onboarding_submission_id FROM site_generations WHERE id = ?)"
    )
      .bind(context.siteGenerationId)
      .first<{ payload_json: string; fact_snapshot_json: string; checksum: string }>();

    await runReferenceIntake(env, {
      ...intakeInput(context),
      capture: baseCapture({
        measuredElements: [
          {
            selectorHint: "h1",
            role: "typography",
            computed: { fontFamily: "Brand Font", text: "Reference Company Tagline" },
            confidence: "HIGH",
            source: "COMPUTED_STYLE",
          },
        ],
      }),
    });

    const submissionAfter = await env.DB.prepare(
      "SELECT payload_json, fact_snapshot_json, checksum FROM onboarding_submissions WHERE id = (SELECT onboarding_submission_id FROM site_generations WHERE id = ?)"
    )
      .bind(context.siteGenerationId)
      .first<{ payload_json: string; fact_snapshot_json: string; checksum: string }>();
    expect(submissionAfter).toEqual(submissionBefore);

    const factUpdates = await env.DB.prepare("SELECT COUNT(*) AS n FROM fact_updates WHERE site_generation_id = ?")
      .bind(context.siteGenerationId)
      .first<{ n: number }>();
    expect(factUpdates!.n).toBe(0);
  });

  it("freezes evidence immutably: re-runs read the frozen package and rows cannot change", async () => {
    const context = await newGeneration({});
    const first = await runReferenceIntake(env, { ...intakeInput(context), capture: captureFn(baseCapture()) });
    const second = await runReferenceIntake(env, {
      ...intakeInput(context),
      capture: captureFn(baseCapture({ motionObservations: [{ kind: "canvas_webgl_primary" }] })),
    });
    expect(second.alreadyFrozen).toBe(true);
    expect(second.packageId).toBe(first.packageId);
    expect(second.suitability).toBe(first.suitability);

    await expect(
      env.DB.prepare("UPDATE reference_evidence_packages SET suitability = 'UNSUPPORTED' WHERE id = ?")
        .bind(first.packageId)
        .run()
    ).rejects.toThrow("REFERENCE_EVIDENCE_IMMUTABLE");

    // Evidence JSON is written immutably.
    const evidenceBody = await getObject(env, first.evidenceR2Key);
    expect(evidenceBody).not.toBeNull();
  });

  it("rejects missing screenshots and non-REFERENCE_BOUND generations", async () => {
    const missing = await newGeneration({ putScreenshot: null as unknown as string });
    await expect(runReferenceIntake(env, { ...intakeInput(missing) })).rejects.toMatchObject({
      code: "REFERENCE_SCREENSHOT_MISSING",
    });

    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "ORIGINAL_DESIGN",
        facts: { businessName: "No Reference Co", contactEmail: "hi@nr.example" , ...(canonicalStructuredFacts()) },
        creativeDirection: { direction: "Handcrafted warm minimalism" },
      },
    });
    // Intake rejects on mode before touching Build ids, so no Build is
    // created here — an ORIGINAL_DESIGN generation never runs the Reference
    // intake (issue #24: its Reference stages are skipped, never faked).
    await expect(
      runReferenceIntake(env, {
        siteGenerationId: started.siteGenerationId,
        buildId: "b-od-mode-probe",
        buildVersionId: "bv-od-mode-probe",
        buildVersionNumber: 1,
      })
    ).rejects.toMatchObject({ code: "NOT_REFERENCE_BOUND" });
  });

  it("advances the Build through REFERENCE_CHECK to REFERENCE_EVIDENCE", async () => {
    const context = await newGeneration({ reference: { url: "https://reference.example.com/" }, putScreenshot: null });
    await runReferenceIntake(env, { ...intakeInput(context), capture: captureFn(baseCapture()) });
    const events = await env.DB.prepare(
      "SELECT to_state, stage FROM build_workflow_events WHERE build_id = ? ORDER BY created_at"
    )
      .bind(context.buildId)
      .all<{ to_state: string; stage: string }>();
    const states = (events.results ?? []).map((row) => row.to_state);
    expect(states).toEqual(["INTAKE_READY", "REFERENCE_CHECK", "REFERENCE_EVIDENCE"]);
    expect(ReferenceIntakeError.name).toBe("ReferenceIntakeError");
  });
});
