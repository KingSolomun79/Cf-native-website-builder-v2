import { beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  benchmarkCaseById,
  evidenceChecksumOf,
  screenshotChecksumOf,
  freezeBenchmarkCases,
  getBenchmarkSuiteStatus,
} from "../src/domain/benchmark";
import { runBenchmarkCase } from "../src/domain/benchmark-runner";
import { createGoldenScripts } from "./helpers/benchmark-golden";

// Benchmark Site 3 end-to-end validation (issue #20): the frozen restrained
// corporate/professional case runs the autonomous pipeline with its low image
// mass and centered 960px container evidence; complete PASS/failure evidence
// is persisted without manual source edits.

const env = providedEnv as unknown as Env;
const CASE_ID = "bench-corporate-professional";

describe("Benchmark Site 3 — restrained corporate/professional", () => {
  let caseDefinition: ReturnType<typeof benchmarkCaseById>;

  beforeAll(async () => {
    await freezeBenchmarkCases(env);
    caseDefinition = benchmarkCaseById(CASE_ID);
  });

  it("uses the frozen inputs from #17 unchanged", async () => {
    const row = await env.DB.prepare("SELECT * FROM benchmark_cases WHERE id = ?")
      .bind(CASE_ID)
      .first<{ archetype: string; evidence_checksum: string; screenshot_checksum: string; replacement_brief_json: string }>();
    expect(row!.archetype).toBe("restrained corporate/professional");
    expect(row!.evidence_checksum).toBe(await evidenceChecksumOf(caseDefinition.evidence));
    expect(row!.screenshot_checksum).toBe(await screenshotChecksumOf(caseDefinition.evidence));
    expect(JSON.parse(row!.replacement_brief_json).businessName).toBe("Ledger & Vale Partners");
    // The restrained container evidence is part of the frozen identity.
    const mainElement = caseDefinition.evidence.measuredElements.find((element) => element.role === "layout");
    expect(mainElement?.computed.maxWidth).toBe("960px");
    expect(caseDefinition.evidence.regions.map((region) => region.id)).toEqual([
      "centered-hero", "services-matrix", "proof-band", "contact-panel",
    ]);
  });

  it("traverses the autonomous pipeline to Release Ready with restrained image mass", async () => {
    const outcome = await runBenchmarkCase(env, {
      caseId: CASE_ID,
      deps: createGoldenScripts(caseDefinition),
      imageMassRatio: 0.2,
    });

    expect(outcome.pass).toBe(true);
    expect(outcome.releaseReady).toBe(true);
    expect(outcome.imageSpendUsd).toBeGreaterThan(0);
    expect(outcome.imageSpendUsd).toBeLessThanOrEqual(3.0);

    const run = await env.DB.prepare("SELECT * FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ status: string; manual_source_edits: number; qa_summary_json: string; provenance_json: string }>();
    expect(run!.status).toBe("pass");
    expect(run!.manual_source_edits).toBe(0);

    const qaSummary = JSON.parse(run!.qa_summary_json!) as { visualScore: number; contentScore: number; technicalScore: number };
    expect(qaSummary.visualScore).toBeGreaterThanOrEqual(90);
    expect(qaSummary.contentScore).toBeGreaterThanOrEqual(90);
    expect(qaSummary.technicalScore).toBeGreaterThanOrEqual(90);

    // Prompt/model/schema provenance covers analysis -> QA.
    const provenance = JSON.parse(run!.provenance_json!) as Array<{ stage: string; prompt_version: string; schema_version: string }>;
    const analysisEntry = provenance.find((entry) => entry.stage === "reference-analyzer");
    expect(analysisEntry).toMatchObject({ prompt_version: "v3", schema_version: "reference-analysis/1" });

    // The restrained silhouette survived: centered hero + services matrix.
    const homeArtifact = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey = 'home'"
    )
      .bind(outcome.buildVersionId)
      .first<{ artifact_r2_key: string }>();
    const stored = await env.SITE_BUCKET.get(homeArtifact!.artifact_r2_key);
    const page = JSON.parse(await new Response(stored!.body).text()) as { html: string };
    expect(page.html).toContain('data-region="centered-hero"');
    expect(page.html).toContain('data-region="services-matrix"');

    const suite = await getBenchmarkSuiteStatus(env);
    expect(suite.perCase.find((item) => item.caseId === CASE_ID)?.latestStatus).toBe("pass");
  });

  it("records actionable failure evidence when the analysis fabricates observations", async () => {
    const checksumsBefore = await env.DB.prepare(
      "SELECT evidence_checksum, screenshot_checksum FROM benchmark_cases WHERE id = ?"
    )
      .bind(CASE_ID)
      .first<{ evidence_checksum: string; screenshot_checksum: string }>();

    // An analysis-stage regression (trait anchored to invented evidence)
    // must surface as an actionable REFERENCE_ANALYSIS failure.
    const scripts = createGoldenScripts(caseDefinition);
    const failingGenerate = async (systemPrompt: string, userPrompt: string, attempt: number) => {
      if (userPrompt.includes("Interpret the frozen versioned Reference Evidence")) {
        return {
          content: JSON.stringify({
            version: "1",
            visualSystemSummary: "Restrained professional system.",
            hierarchy: [{ level: "display", description: "measured headline", confidence: "HIGH" }],
            signatureTraits: [
              { id: "trait-typography", description: "Measured display type", identityDefining: true, evidenceRefs: ["h1"] },
              { id: "trait-region-flow", description: "Region silhouette", identityDefining: true, evidenceRefs: ["centered-hero"] },
              { id: "trait-fabricated", description: "Invented observation", identityDefining: false, evidenceRefs: ["region-does-not-exist"] },
            ],
            designIntent: [{ hypothesis: "professional restraint", confidence: "MEDIUM" }],
            photographicGrammar: { summary: "sparse professional imagery", imageRoles: ["leadership"] },
            responsiveBehavior: ["centered container holds to mobile"],
            motionBehavior: [],
            identityCarriers: ["trait-typography"],
          }),
          provider: "benchmark-script",
          model: "benchmark-golden-model",
        };
      }
      return scripts.generate(systemPrompt, userPrompt, attempt);
    };

    const outcome = await runBenchmarkCase(env, {
      caseId: CASE_ID,
      deps: { ...scripts, generate: failingGenerate },
      imageMassRatio: 0.2,
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.rootCause).toBe("REFERENCE_ANALYSIS");

    const run = await env.DB.prepare("SELECT qa_summary_json FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ qa_summary_json: string }>();
    const failure = JSON.parse(run!.qa_summary_json!) as { failedStage: string; error: string };
    expect(failure.failedStage).toBe("analysis");
    expect(failure.error).toContain("region-does-not-exist");

    const checksumsAfter = await env.DB.prepare(
      "SELECT evidence_checksum, screenshot_checksum FROM benchmark_cases WHERE id = ?"
    )
      .bind(CASE_ID)
      .first<{ evidence_checksum: string; screenshot_checksum: string }>();
    expect(checksumsAfter).toEqual(checksumsBefore);
  });
});
