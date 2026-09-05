import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runReferenceIntake, getFrozenReferenceEvidence, type ReferenceCaptureFn, type ReferenceCaptureOutput } from "../src/domain/reference-intake";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { createPipelineScripts } from "./helpers/pipeline-scripts";
import { buildPng } from "./helpers/png";
import {
  evaluateReferenceEvidenceSufficiency,
  evidenceMissingFeature,
  REFERENCE_SUFFICIENCY_VERSION,
} from "../src/domain/reference-sufficiency";
import type { ReferenceEvidence } from "../src/domain/reference-evidence-schema";
import { putObject } from "../src/lib/assets";

// Evidence-sufficiency guard (issue #39): information-free Reference Evidence
// must fail closed — no blueprint generation from defaults, no silent mode
// switch. Regression anchor: the frozen RankForge initial evidence state
// (dimensions only, regions [], no measured elements beyond the synthetic
// screenshot anchor) can never again reach Release Ready.

const env = providedEnv as unknown as Env;

// The frozen RankForge evidence shape: dimensions only.
function dimensionsOnlyEvidence(): ReferenceEvidence {
  return {
    version: "1",
    screenshotId: "builds/b/v1/evidence/reference/screenshot.png",
    screenshotMetadata: { pixelWidth: 1440, pixelHeight: 3752, likelyCssViewportWidth: 1440 },
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

function measuredEvidence(): ReferenceEvidence {
  return {
    ...dimensionsOnlyEvidence(),
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
    ],
  };
}

describe("deterministic evidence sufficiency evaluation", () => {
  it("classifies dimensions-only evidence as INSUFFICIENT (frozen RankForge shape)", () => {
    const verdict = evaluateReferenceEvidenceSufficiency(dimensionsOnlyEvidence());
    expect(verdict.sufficiency).toBe("INSUFFICIENT");
    expect(verdict.version).toBe(REFERENCE_SUFFICIENCY_VERSION);
    expect(verdict.missingBlocking).toEqual(["region_structure", "measured_elements"]);
    expect(verdict.reasons.join(" ")).toContain("INSUFFICIENT_REFERENCE_EVIDENCE");
  });

  it("does not let the synthetic screenshot anchor satisfy a blocking dimension", () => {
    // Regions exist, but the only measured element is the dimensions anchor.
    const verdict = evaluateReferenceEvidenceSufficiency({
      ...dimensionsOnlyEvidence(),
      regions: [{ id: "region-1", height: 900, viewportHeightRatio: 1 }],
    });
    expect(verdict.sufficiency).toBe("INSUFFICIENT");
    expect(verdict.missingBlocking).toEqual(["measured_elements"]);
  });

  it("classifies measured evidence as SUFFICIENT", () => {
    const verdict = evaluateReferenceEvidenceSufficiency(measuredEvidence());
    expect(verdict.sufficiency).toBe("SUFFICIENT");
    expect(verdict.missingBlocking).toEqual([]);
  });

  it("downgrades to PARTIAL only when the Adaptation Contract declares every missing dimension", () => {
    const contract = {
      version: "1",
      unsupportedFeatures: [
        { feature: evidenceMissingFeature("measured_elements"), reason: "capture could not measure DOM structure" },
      ],
      acceptedApproximations: [
        { replaces: evidenceMissingFeature("measured_elements"), substituteOutcome: "structure derived from regions only" },
      ],
      qaExceptions: [],
    };
    const partial = evaluateReferenceEvidenceSufficiency(
      { ...dimensionsOnlyEvidence(), regions: [{ id: "region-1", height: 900 }] },
      { adaptationContract: contract }
    );
    expect(partial.sufficiency).toBe("PARTIAL");
    expect(partial.declaredMissing).toEqual(["measured_elements"]);

    // One of two missing dimensions declared is still INSUFFICIENT.
    const insufficient = evaluateReferenceEvidenceSufficiency(dimensionsOnlyEvidence(), { adaptationContract: contract });
    expect(insufficient.sufficiency).toBe("INSUFFICIENT");
  });
});

// ── Intake integration ───────────────────────────────────────────────────────

function screenshotBytes(seed: string): Uint8Array {
  return new Uint8Array(buildPng({ width: 1200, height: 3000, idatBytes: 40 + seed.length }));
}

function measuredCapture(): ReferenceCaptureOutput {
  return {
    canonicalScreenshot: {
      content: screenshotBytes("canonical-live"),
      mimeType: "image/png",
      pixelWidth: 1440,
      pixelHeight: 5200,
      likelyCssViewportWidth: 1440,
    },
    captures: [{ viewportWidth: 1440, viewportHeight: 900, content: screenshotBytes("live-1440"), mimeType: "image/png" }],
    regions: [
      { id: "region-1", startY: 0, endY: 760, height: 760, viewportHeightRatio: 0.844 },
    ],
    measuredElements: [
      {
        selectorHint: "h1",
        role: "typography",
        computed: { fontFamily: "'Editorial Serif'", fontSize: "72px" },
        confidence: "MEDIUM",
        source: "COMPUTED_STYLE",
      },
    ],
    responsiveObservations: [{ kind: "viewport_matrix", viewports: ["desktop"] }],
    motionObservations: [],
    discrepancies: [],
  };
}

async function newGeneration(reference: Record<string, unknown>): Promise<{
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
}> {
  const screenshotKey = `references/uploads/suff-${Math.random().toString(36).slice(2)}.png`;
  if (reference.screenshotR2Key !== undefined) {
    await putObject(env, reference.screenshotR2Key as string, screenshotBytes("submitted"));
  }
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Sufficiency Probe Co", contactEmail: "probe@suff.example" },
      reference,
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { siteGenerationId: started.siteGenerationId, buildId: created.buildId, buildVersionId: created.buildVersionId };
}

function intakeInput(context: { siteGenerationId: string; buildId: string; buildVersionId: string }) {
  return { ...context, buildVersionNumber: 1 };
}

const noopCapture: ReferenceCaptureFn = async () => {
  throw new Error("capture must not run for screenshot-only input");
};

describe("evidence sufficiency at intake and in the pipeline", () => {
  it("freezes INSUFFICIENT for screenshot-only dimensions-only evidence and the build fails closed", async () => {
    const context = await newGeneration({ screenshotR2Key: `references/uploads/suff-${Math.random().toString(36).slice(2)}.png` });

    const frozen = await runReferenceIntake(env, { ...intakeInput(context), capture: noopCapture });
    expect(frozen.evidenceSufficiency.sufficiency).toBe("INSUFFICIENT");
    expect(frozen.evidenceSufficiency.missingBlocking).toEqual(["region_structure", "measured_elements"]);

    // Idempotent re-entry reads the frozen verdict.
    const refrozen = await runReferenceIntake(env, { ...intakeInput(context), capture: noopCapture });
    expect(refrozen.alreadyFrozen).toBe(true);
    expect(refrozen.evidenceSufficiency!.sufficiency).toBe("INSUFFICIENT");

    // The pipeline terminal is fail-closed, and NO design generation ran.
    let generateCalled = false;
    const outcome = await runBuildPipeline(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      deps: {
        ...createPipelineScripts(),
        generate: async () => {
          generateCalled = true;
          throw new Error("no AI stage may run on insufficient evidence");
        },
      },
    });
    expect(generateCalled).toBe(false);
    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.reasons.join(" ")).toContain("INSUFFICIENT_REFERENCE_EVIDENCE");
    expect(outcome.reasons.join(" ")).toContain("EVIDENCE_EXTRACTION");

    const event = await env.DB.prepare(
      "SELECT stage, to_state, detail FROM build_workflow_events WHERE build_id = ? AND stage = 'reference_evidence_sufficiency'"
    )
      .bind(context.buildId)
      .first<{ stage: string; to_state: string; detail: string }>();
    expect(event!.to_state).toBe("HUMAN_REVIEW_REQUIRED");
    expect(event!.detail).toContain("INSUFFICIENT_REFERENCE_EVIDENCE");

    // No Blueprint was generated for the Build Version.
    const artifacts = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'visual_blueprint'"
    )
      .bind(context.buildVersionId)
      .first<{ n: number }>();
    expect(artifacts!.n).toBe(0);
  });

  it("freezes SUFFICIENT for measured URL capture evidence and persists the verdict", async () => {
    const context = await newGeneration({ url: "https://reference.example.com/" });
    const frozen = await runReferenceIntake(env, { ...intakeInput(context), capture: measuredCapture });
    expect(frozen.evidenceSufficiency.sufficiency).toBe("SUFFICIENT");

    const read = await getFrozenReferenceEvidence(env, context.siteGenerationId);
    expect(read!.evidenceSufficiency.sufficiency).toBe("SUFFICIENT");

    const row = await env.DB.prepare(
      "SELECT evidence_sufficiency FROM reference_evidence_packages WHERE site_generation_id = ?"
    )
      .bind(context.siteGenerationId)
      .first<{ evidence_sufficiency: string }>();
    expect(row!.evidence_sufficiency).toBe("SUFFICIENT");
  });

  it("downgrades screenshot-only evidence to PARTIAL when the Adaptation Contract declares the absence", async () => {
    const context = await newGeneration({ screenshotR2Key: `references/uploads/suff-${Math.random().toString(36).slice(2)}.png` });
    const frozen = await runReferenceIntake(env, {
      ...intakeInput(context),
      capture: noopCapture,
      adaptationContract: {
        version: "1",
        unsupportedFeatures: [
          { feature: evidenceMissingFeature("region_structure"), reason: "static screenshot without extractable structure" },
          { feature: evidenceMissingFeature("measured_elements"), reason: "static screenshot without extractable structure" },
        ],
        acceptedApproximations: [
          { replaces: evidenceMissingFeature("region_structure"), substituteOutcome: "structure deferred to the coverage contract" },
          { replaces: evidenceMissingFeature("measured_elements"), substituteOutcome: "structure deferred to the coverage contract" },
        ],
        qaExceptions: [],
      },
    });
    expect(frozen.evidenceSufficiency.sufficiency).toBe("PARTIAL");
    expect(frozen.evidenceSufficiency.declaredMissing).toEqual(["region_structure", "measured_elements"]);
  });

  it("legacy-shaped rows evaluate to INSUFFICIENT on read via the versioned rules", async () => {
    const context = await newGeneration({ screenshotR2Key: `references/uploads/suff-${Math.random().toString(36).slice(2)}.png` });
    const evidence = dimensionsOnlyEvidence();
    const evidenceR2Key = `builds/legacy-39/v1/evidence/reference/evidence.json`;
    await putObject(env, evidenceR2Key, new TextEncoder().encode(JSON.stringify(evidence)));
    await env.DB.prepare(
      `INSERT INTO reference_evidence_packages (
         id, site_generation_id, build_id, build_version_id, suitability, suitability_reasons_json,
         adaptation_contract_json, input_mode, evidence_r2_key, canonical_screenshot_r2_key, checksum, frozen_at
       ) VALUES ('legacy-39-pkg', ?, ?, ?, 'SUPPORTED', '[]', NULL, 'SCREENSHOT_ONLY', ?, 'legacy-screenshot', 'legacy', '2026-08-01T00:00:00Z')`
    )
      .bind(context.siteGenerationId, context.buildId, context.buildVersionId, evidenceR2Key)
      .run();

    const read = await getFrozenReferenceEvidence(env, context.siteGenerationId);
    expect(read!.evidenceSufficiency.sufficiency).toBe("INSUFFICIENT");
    expect(read!.evidenceSufficiency.version).toBe(REFERENCE_SUFFICIENCY_VERSION);

    // The frozen evidence bytes are untouched by the lazy evaluation.
    const stored = await env.SITE_BUCKET.get(evidenceR2Key);
    const storedEvidence = JSON.parse(await new Response(stored!.body).text()) as ReferenceEvidence;
    expect(storedEvidence).toEqual(evidence);
  });
});
