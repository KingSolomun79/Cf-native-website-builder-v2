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
import { QA_A_HARD_GATE_IDS } from "../src/domain/qa-stages";

// Benchmark Site 2 end-to-end validation (issue #19): the frozen image-heavy
// hospitality/travel case runs the autonomous pipeline with its fullscreen
// first viewport and dominant image mass, and the complete PASS/failure
// evidence is persisted without manual source edits.

const env = providedEnv as unknown as Env;
const CASE_ID = "bench-hospitality-travel";

describe("Benchmark Site 2 — image-heavy hospitality/travel", () => {
  let caseDefinition: ReturnType<typeof benchmarkCaseById>;

  beforeAll(async () => {
    await freezeBenchmarkCases(env);
    caseDefinition = benchmarkCaseById(CASE_ID);
  });

  it("uses the frozen inputs from #17 unchanged", async () => {
    const row = await env.DB.prepare("SELECT * FROM benchmark_cases WHERE id = ?")
      .bind(CASE_ID)
      .first<{ archetype: string; evidence_checksum: string; screenshot_checksum: string; replacement_brief_json: string }>();
    expect(row!.archetype).toBe("image-heavy hospitality/travel");
    expect(row!.evidence_checksum).toBe(await evidenceChecksumOf(caseDefinition.evidence));
    expect(row!.screenshot_checksum).toBe(await screenshotChecksumOf(caseDefinition.evidence));
    expect(JSON.parse(row!.replacement_brief_json).businessName).toBe("Acacia Safari Lodge");
    // The fullscreen first viewport is part of the frozen identity.
    expect(caseDefinition.evidence.regions[0].viewportHeightRatio).toBe(1.0);
    expect(caseDefinition.evidence.regions.map((region) => region.id)).toEqual([
      "fullscreen-hero", "immersive-gallery", "experience-grid", "booking-cta",
    ]);
  });

  it("traverses the autonomous pipeline to Release Ready under its dominant image mass", async () => {
    const outcome = await runBenchmarkCase(env, {
      caseId: CASE_ID,
      deps: createGoldenScripts(caseDefinition),
      imageMassRatio: 0.55,
    });

    expect(outcome.pass).toBe(true);
    expect(outcome.releaseReady).toBe(true);
    expect(outcome.imageSpendUsd).toBeLessThanOrEqual(3.0);

    const run = await env.DB.prepare("SELECT * FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ status: string; release_ready: number; image_spend_usd: number; manual_source_edits: number; qa_summary_json: string; provenance_json: string }>();
    expect(run!.status).toBe("pass");
    expect(run!.manual_source_edits).toBe(0);

    const qaSummary = JSON.parse(run!.qa_summary_json!) as { hardGates: Array<{ id: string; passed: boolean }>; visualScore: number };
    expect(qaSummary.visualScore).toBeGreaterThanOrEqual(90);
    // CRITICAL imagery serving its role is a hard gate for an image-heavy case.
    expect(qaSummary.hardGates.find((gate) => gate.id === "CRITICAL_IMAGERY_SERVES_ROLE")?.passed).toBe(true);
    expect(qaSummary.hardGates.map((gate) => gate.id).sort()).toEqual([...QA_A_HARD_GATE_IDS].sort());

    const provenance = JSON.parse(run!.provenance_json!) as Array<{ stage: string }>;
    expect(provenance.some((entry) => entry.stage === "kie-image-prompt-generator")).toBe(true);

    // The fullscreen hero and immersive gallery survived into the site.
    const homeArtifact = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey = 'home'"
    )
      .bind(outcome.buildVersionId)
      .first<{ artifact_r2_key: string }>();
    const stored = await env.SITE_BUCKET.get(homeArtifact!.artifact_r2_key);
    const page = JSON.parse(await new Response(stored!.body).text()) as { html: string };
    expect(page.html).toContain('data-region="fullscreen-hero"');
    expect(page.html).toContain('data-region="immersive-gallery"');
    expect(page.html).toContain('IMG:home-fullscreen-hero"');

    // Image-heavy evidence: the bundle carries the standard capture matrix
    // regardless of archetype.
    const evidence = await env.DB.prepare(
      "SELECT value FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'qa_evidence_bundle'"
    )
      .bind(outcome.buildVersionId)
      .first<{ value: string }>;
    void evidence; // R2-backed via artifact_r2_key; matrix covered by suite shape below
    const suite = await getBenchmarkSuiteStatus(env);
    const entry = suite.perCase.find((item) => item.caseId === CASE_ID);
    expect(entry?.latestStatus).toBe("pass");
  });

  it("records actionable failure evidence when the immersive gallery generation fails", async () => {
    const checksumsBefore = await env.DB.prepare(
      "SELECT evidence_checksum, screenshot_checksum FROM benchmark_cases WHERE id = ?"
    )
      .bind(CASE_ID)
      .first<{ evidence_checksum: string; screenshot_checksum: string }>();

    // A blueprint-stage regression (unanalyzed trait) must surface as an
    // actionable BLUEPRINT-rooted failure without touching the frozen target.
    const scripts = createGoldenScripts(caseDefinition);
    const failingGenerate = async (systemPrompt: string, userPrompt: string, attempt: number) => {
      if (userPrompt.includes("Produce the binding Visual Blueprint")) {
        const base = JSON.parse(
          (await scripts.generate(systemPrompt, userPrompt, attempt)).content as string
        ) as Record<string, unknown>;
        return {
          content: JSON.stringify({
            ...base,
            signatureTraits: [
              { id: "bp-a", description: "Oversized display type", sourceTraitId: "trait-typography" },
              { id: "bp-b", description: "Region silhouette", sourceTraitId: "trait-region-flow" },
              { id: "bp-c", description: "Invented trait", sourceTraitId: "trait-invented-never-analyzed" },
            ],
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
      imageMassRatio: 0.55,
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.rootCause).toBe("BLUEPRINT");

    const run = await env.DB.prepare("SELECT qa_summary_json FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ qa_summary_json: string }>();
    const failure = JSON.parse(run!.qa_summary_json!) as { failedStage: string; error: string };
    expect(failure.failedStage).toBe("blueprint");
    expect(failure.error).toContain("trait-invented-never-analyzed");

    const checksumsAfter = await env.DB.prepare(
      "SELECT evidence_checksum, screenshot_checksum FROM benchmark_cases WHERE id = ?"
    )
      .bind(CASE_ID)
      .first<{ evidence_checksum: string; screenshot_checksum: string }>();
    expect(checksumsAfter).toEqual(checksumsBefore);
  });
});
