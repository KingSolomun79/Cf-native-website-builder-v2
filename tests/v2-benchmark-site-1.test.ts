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
import { QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS } from "../src/domain/qa-stages";

// Benchmark Site 1 end-to-end validation (issue #18): the frozen
// asymmetric/editorial case runs the autonomous REFERENCE_BOUND pipeline and
// the complete PASS/failure evidence is persisted without manual source edits.

const env = providedEnv as unknown as Env;
const CASE_ID = "bench-asymmetric-editorial";

describe("Benchmark Site 1 — asymmetric/editorial", () => {
  let caseDefinition: ReturnType<typeof benchmarkCaseById>;

  beforeAll(async () => {
    await freezeBenchmarkCases(env);
    caseDefinition = benchmarkCaseById(CASE_ID);
  });

  it("uses the frozen inputs from #17 unchanged", async () => {
    const row = await env.DB.prepare("SELECT * FROM benchmark_cases WHERE id = ?")
      .bind(CASE_ID)
      .first<{ archetype: string; evidence_checksum: string; screenshot_checksum: string; replacement_brief_json: string }>();
    expect(row).not.toBeNull();
    expect(row!.archetype).toBe("asymmetric/editorial");
    expect(row!.evidence_checksum).toBe(await evidenceChecksumOf(caseDefinition.evidence));
    expect(row!.screenshot_checksum).toBe(await screenshotChecksumOf(caseDefinition.evidence));
    const brief = JSON.parse(row!.replacement_brief_json) as { businessName: string };
    expect(brief.businessName).toBe("Rift Valley Roasters");
  });

  it("traverses the autonomous pipeline to Release Ready and records complete PASS evidence", async () => {
    const outcome = await runBenchmarkCase(env, { caseId: CASE_ID, deps: createGoldenScripts(caseDefinition) });

    expect(outcome.releaseReady).toBe(true);
    expect(outcome.pass).toBe(true);
    expect(outcome.reasons).toEqual([]);

    const run = await env.DB.prepare("SELECT * FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{
        status: string; release_ready: number; image_spend_usd: number; manual_source_edits: number;
        root_cause: string | null; qa_summary_json: string; provenance_json: string;
      }>();
    expect(run!.status).toBe("pass");
    expect(run!.release_ready).toBe(1);
    expect(run!.manual_source_edits).toBe(0);
    expect(run!.image_spend_usd).toBeGreaterThan(0);
    expect(run!.image_spend_usd).toBeLessThanOrEqual(3.0);
    expect(run!.root_cause).toBeNull();

    // Scores, hard gates and geometry evidence recorded.
    const qaSummary = JSON.parse(run!.qa_summary_json!) as {
      visualScore: number; contentScore: number; technicalScore: number;
      hardGates: Array<{ id: string; passed: boolean }>; mandatoryGates: Array<{ id: string; passed: boolean }>;
    };
    expect(qaSummary.visualScore).toBeGreaterThanOrEqual(90);
    expect(qaSummary.contentScore).toBeGreaterThanOrEqual(90);
    expect(qaSummary.technicalScore).toBeGreaterThanOrEqual(90);
    expect(qaSummary.hardGates.filter((gate) => !gate.passed)).toEqual([]);
    expect(qaSummary.hardGates.map((gate) => gate.id).sort()).toEqual([...QA_A_HARD_GATE_IDS].sort());
    expect(qaSummary.mandatoryGates.map((gate) => gate.id).sort()).toEqual([...QA_B_MANDATORY_GATE_IDS].sort());

    // Prompt/model/schema provenance recorded for every stage family.
    const provenance = JSON.parse(run!.provenance_json!) as Array<{ stage: string; prompt_id: string; prompt_version: string; model: string; schema_version: string }>;
    const byStage = new Map(provenance.map((entry) => [entry.stage, entry]));
    expect(byStage.get("reference-analyzer")).toMatchObject({ prompt_id: "reference-analyzer", prompt_version: "v3" });
    expect(byStage.get("visual-blueprint-generator")).toMatchObject({ prompt_version: "v3" });
    expect(byStage.get("website-generator")).toMatchObject({ prompt_version: "v4" });
    expect(byStage.get("qa-a-visual-content")).toMatchObject({ prompt_version: "v3" });

    // The exact candidate reached Release Ready: release record exists for
    // the run's Build Version and a preview deployment serves it.
    const release = await env.DB.prepare("SELECT qa_a_visual_score FROM build_release_records WHERE build_version_id = ?")
      .bind(outcome.buildVersionId)
      .first<{ qa_a_visual_score: number }>();
    expect(release).not.toBeNull();
    const preview = await env.DB.prepare(
      "SELECT status FROM build_deployments WHERE build_version_id = ? AND role = 'preview'"
    )
      .bind(outcome.buildVersionId)
      .first<{ status: string }>();
    expect(preview!.status).toBe("active");

    // The asymmetric/editorial silhouette survived into the generated site.
    const homeArtifact = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey = 'home'"
    )
      .bind(outcome.buildVersionId)
      .first<{ artifact_r2_key: string }>();
    expect(homeArtifact).not.toBeNull();
    const stored = await env.SITE_BUCKET.get(homeArtifact!.artifact_r2_key);
    const page = JSON.parse(await new Response(stored!.body).text()) as { html: string };
    for (const region of caseDefinition.evidence.regions) {
      expect(page.html).toContain(`data-region="${region.id}"`);
    }
    expect(page.html).toMatch(/<h1>[^<]*Rift Valley Roasters<\/h1>/);

    const suite = await getBenchmarkSuiteStatus(env);
    expect(suite.perCase.find((entry) => entry.caseId === CASE_ID)?.latestStatus).toBe("pass");
  });

  it("keeps failure evidence actionable without altering the frozen target", async () => {
    const checksumsBefore = await env.DB.prepare(
      "SELECT evidence_checksum, screenshot_checksum FROM benchmark_cases WHERE id = ?"
    )
      .bind(CASE_ID)
      .first<{ evidence_checksum: string; screenshot_checksum: string }>();

    // A QA regression (P1 blocker) must produce a recorded failure with an
    // actionable root cause — no manual edits, no benchmark mutation.
    const scripts = createGoldenScripts(caseDefinition);
    const failingGenerate = async (systemPrompt: string, userPrompt: string, attempt: number) => {
      if (userPrompt.includes("hard composition gate") && attempt === 1) {
        return {
          content: JSON.stringify({
            version: "1",
            visualScore: 91,
            contentScore: 92,
            fabrication: false,
            hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: id !== "MOBILE_PRESERVES_VISUAL_IDENTITY" })),
            findings: [
              { severity: "P1", domain: "visual", description: "mobile loses the asymmetric split", evidenceRef: "qa/home-390.png" },
            ],
          }),
          provider: "benchmark-script",
          model: "benchmark-golden-model",
        };
      }
      return scripts.generate(systemPrompt, userPrompt, attempt);
    };

    const outcome = await runBenchmarkCase(env, { caseId: CASE_ID, deps: { ...scripts, generate: failingGenerate } });
    expect(outcome.pass).toBe(false);
    expect(outcome.releaseReady).toBe(false);

    const run = await env.DB.prepare("SELECT * FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ status: string; root_cause: string; qa_summary_json: string }>();
    expect(run!.status).toBe("fail");
    expect(run!.root_cause).toBe("GENERATOR");
    const qaSummary = JSON.parse(run!.qa_summary_json!) as { reasons: string[] };
    expect(qaSummary.reasons.join(" ")).toContain("MOBILE_PRESERVES_VISUAL_IDENTITY");

    // Frozen target untouched by the failure.
    const checksumsAfter = await env.DB.prepare(
      "SELECT evidence_checksum, screenshot_checksum FROM benchmark_cases WHERE id = ?"
    )
      .bind(CASE_ID)
      .first<{ evidence_checksum: string; screenshot_checksum: string }>();
    expect(checksumsAfter).toEqual(checksumsBefore);
  });
});
