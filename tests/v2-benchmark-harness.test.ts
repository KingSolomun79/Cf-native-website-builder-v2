// Frozen five-site REFERENCE_BOUND benchmark harness (issue #17, PRD
// sections 43-45). Primary-seam tests: the harness drives the CANONICAL
// production pipeline entry (startSiteGeneration -> createInitialBuild ->
// runBuildPipeline) with only the provider seams scripted; identity, drift
// protection, PASS calculation, provenance/cost recording and the retention
// classes are proven against real D1/R2 state.

import { canonicalStructuredFacts } from "./helpers/canonical-facts";
import { createSimpleScripts } from "./helpers/simple-scripts";
import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { putObject, getObject } from "../src/lib/assets";
import { appendBuildWorkflowEvent, createInitialBuild, startSiteGeneration } from "../src/domain/lifecycle";
import { storeBuildStageArtifact } from "../src/domain/stage-artifacts";
import {
  BENCHMARK_CASE_DEFINITIONS,
  assertBenchmarkShape,
  type BenchmarkCaseDefinition,
} from "../src/domain/benchmark/definitions";
import { FROZEN_SCREENSHOTS } from "../src/domain/benchmark/generated-frozen-screenshots";
import {
  benchmarkDefinitionHash,
  evaluateBenchmarkPass,
  freezeBenchmarkCases,
  getBenchmarkCaseDefinition,
  startBenchmarkRun,
  verifyBenchmarkCaseInputs,
} from "../src/domain/benchmark/harness";
import {
  indexDisposableArtifacts,
  pruneDisposableBuildArtifacts,
  pruneDisposableVersionArtifacts,
  BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS,
} from "../src/domain/retention";

const env = providedEnv as unknown as Env;

const FROZEN_CASE_IDS = BENCHMARK_CASE_DEFINITIONS.map((c) => c.caseId) as [
  string,
  string,
  string,
  string,
  string,
];

// PRD section 43's exact five archetypes — the frozen set is the set.
const PRD43_ARCHETYPES = [
  "asymmetric/editorial",
  "image-heavy hospitality/travel",
  "restrained corporate/professional",
  "bold trades/local service",
  "difficult but supported responsive/motion Reference",
];

function withDefinition(caseId: string, mutate: (definition: BenchmarkCaseDefinition) => void): BenchmarkCaseDefinition {
  const clone = JSON.parse(JSON.stringify(getBenchmarkCaseDefinition(caseId))) as BenchmarkCaseDefinition;
  mutate(clone);
  return clone;
}

function embeddedBytes(caseId: string): Uint8Array {
  const binary = atob(FROZEN_SCREENSHOTS[caseId].base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function freezeAll(): Promise<Awaited<ReturnType<typeof freezeBenchmarkCases>>> {
  // Test-environment hygiene: the suite's storage persists across runs, so
  // restore the canonical bytes before freezing (freeze itself never
  // overwrites — that strictness is production behavior, asserted below).
  for (const caseId of FROZEN_CASE_IDS) {
    await putObject(env, `benchmarks/${caseId}/reference/screenshot.png`, embeddedBytes(caseId));
  }
  return freezeBenchmarkCases(env, [...FROZEN_CASE_IDS]);
}

async function runRow(runId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare("SELECT * FROM benchmark_runs WHERE id = ?").bind(runId).first<Record<string, unknown>>();
  expect(row).not.toBeNull();
  return row!;
}

describe("frozen five-case benchmark definitions", () => {
  it("defines exactly five materially different cases with unique identities", () => {
    expect(() => assertBenchmarkShape()).not.toThrow();
    expect(BENCHMARK_CASE_DEFINITIONS.length).toBe(5);
    const ids = new Set(BENCHMARK_CASE_DEFINITIONS.map((c) => c.caseId));
    const slots = new Set(BENCHMARK_CASE_DEFINITIONS.map((c) => c.slot));
    expect(ids.size).toBe(5);
    expect([...slots].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(BENCHMARK_CASE_DEFINITIONS.map((c) => c.archetype)).toEqual(PRD43_ARCHETYPES);
    for (const definition of BENCHMARK_CASE_DEFINITIONS) {
      expect(definition.facts.businessName).toBe(definition.name);
      expect(definition.reference.screenshotChecksum).toMatch(/^[0-9a-f]{64}$/);
      expect(definition.reference.screenshotR2Key).toBe(`benchmarks/${definition.caseId}/reference/screenshot.png`);
      // Canonical facts shape: services + business hours always present.
      expect(definition.facts.services.length).toBeGreaterThanOrEqual(3);
      expect(definition.facts.businessHours.monday.status).toBe("OPEN");
    }
  });

  it("computes stable, distinct definition hashes", async () => {
    const first = await Promise.all(BENCHMARK_CASE_DEFINITIONS.map((c) => benchmarkDefinitionHash(c)));
    const second = await Promise.all(BENCHMARK_CASE_DEFINITIONS.map((c) => benchmarkDefinitionHash(c)));
    expect(first).toEqual(second);
    for (const hash of first) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(first).size).toBe(5);
  });

  it("a mutated Reference identity changes the hash and cannot masquerade as the frozen case", async () => {
    const original = await benchmarkDefinitionHash(getBenchmarkCaseDefinition(FROZEN_CASE_IDS[0]));
    const mutated = await benchmarkDefinitionHash(
      withDefinition(FROZEN_CASE_IDS[0], (d) => {
        d.reference.screenshotChecksum = "0".repeat(64);
      })
    );
    expect(mutated).not.toBe(original);

    // A different case cannot masquerade under another case's identity:
    // each case's hash covers its own caseId + reference identity.
    const case2 = await benchmarkDefinitionHash(getBenchmarkCaseDefinition(FROZEN_CASE_IDS[1]));
    expect(case2).not.toBe(original);
  });

  it("mutated Business Facts change the hash", async () => {
    const original = await benchmarkDefinitionHash(getBenchmarkCaseDefinition(FROZEN_CASE_IDS[2]));
    const mutated = await benchmarkDefinitionHash(
      withDefinition(FROZEN_CASE_IDS[2], (d) => {
        d.facts.businessDescription = "Mutated brief — not the frozen replacement Business.";
      })
    );
    expect(mutated).not.toBe(original);
  });

  it("frozen cases cannot be silently replaced", async () => {
    await freezeAll();
    // A repeat freeze verifies and never mutates.
    const reports = await freezeAll();
    expect(reports.every((r) => r.status === "verified")).toBe(true);

    // The frozen row carries exactly the frozen identity: a mutated
    // definition's identity does not match what is stored.
    const drifted = withDefinition(FROZEN_CASE_IDS[0], (d) => {
      d.reference.screenshotChecksum = "1".repeat(64);
    });
    const row = await env.DB.prepare("SELECT screenshot_checksum, archetype FROM benchmark_cases WHERE id = ?")
      .bind(FROZEN_CASE_IDS[0])
      .first<{ screenshot_checksum: string; archetype: string }>();
    expect(row!.screenshot_checksum).toBe(getBenchmarkCaseDefinition(FROZEN_CASE_IDS[0]).reference.screenshotChecksum);
    expect(row!.screenshot_checksum).not.toBe(drifted.reference.screenshotChecksum);

    // The frozen row is immutable at the database level: no update, no delete.
    await expect(
      env.DB.prepare("UPDATE benchmark_cases SET archetype = 'easy' WHERE id = ?").bind(FROZEN_CASE_IDS[0]).run()
    ).rejects.toThrow();
    await expect(env.DB.prepare("DELETE FROM benchmark_cases WHERE id = ?").bind(FROZEN_CASE_IDS[0]).run()).rejects.toThrow();
  });
});

describe("benchmark run machinery (canonical pipeline seam)", () => {
  it("a scripted first-pass RELEASE_READY run records Benchmark PASS with full identity", async () => {
    await freezeAll();
    const run = await startBenchmarkRun(env, {
      caseId: FROZEN_CASE_IDS[0],
      deps: createSimpleScripts(),
      codeRevision: "test-main-head",
    });
    expect(run.terminal).toBe("RELEASE_READY");
    expect(run.pass).toBe(true);

    const row = await runRow(run.runId);
    expect(row.status).toBe("pass");
    expect(row.release_ready).toBe(1);
    expect(row.definition_hash).toBe(run.definitionHash);
    expect(row.definition_version).toBe("1");
    expect(row.code_revision).toBe("test-main-head");
    expect(row.repair_consumed).toBe(0);
    expect(row.manual_source_edits).toBe(0);
    expect(Number(row.image_spend_usd)).toBeGreaterThan(0);
    expect(Number(row.image_spend_usd)).toBeLessThanOrEqual(3);
    expect(row.benchmark_case_id).toBe(FROZEN_CASE_IDS[0]);
    expect(row.site_generation_id).toBe(run.siteGenerationId);
    expect(row.build_id).toBe(run.buildId);
    expect(row.build_version_id).toBe(run.finalBuildVersionId);
    // Canonical facts are not leaking real contact data: example-only email.
    expect(FROZEN_CASE_IDS && BENCHMARK_CASE_DEFINITIONS.every((c) => c.facts.contactEmail.endsWith(".example"))).toBe(true);
  });

  it("Approval and Publication are not required for Benchmark PASS", async () => {
    await freezeAll();
    const run = await startBenchmarkRun(env, {
      caseId: FROZEN_CASE_IDS[3],
      deps: createSimpleScripts(),
    });
    expect(run.pass).toBe(true);
    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM build_approvals WHERE build_id = ?) AS approvals,
         (SELECT COUNT(*) FROM publications WHERE build_id = ?) AS publications,
         (SELECT COUNT(*) FROM site_published_state WHERE site_id = ?) AS published_state`
    )
      .bind(run.buildId, run.buildId, run.siteId)
      .first<{ approvals: number; publications: number; published_state: number }>();
    expect(counts!.approvals).toBe(0);
    expect(counts!.publications).toBe(0);
    expect(counts!.published_state).toBe(0);
  });

  it("records prompt/model/schema provenance and per-run cost", async () => {
    await freezeAll();
    const run = await startBenchmarkRun(env, {
      caseId: FROZEN_CASE_IDS[2],
      deps: createSimpleScripts(),
    });
    const row = await runRow(run.runId);
    const provenance = JSON.parse(row.provenance_json as string) as { pipelineVersion: string; prompts: Array<{ stage: string; prompt_version: string; model: string }> };
    expect(provenance.pipelineVersion).toBe("simple_blueprint_v1");
    expect(provenance.prompts.length).toBeGreaterThan(0);
    expect(provenance.prompts.some((p) => p.prompt_id.includes("blueprint") && p.prompt_version === "v5")).toBe(true);

    const spend = await env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM image_attempts WHERE build_id = ?")
      .bind(run.buildId)
      .first<{ total: number }>();
    expect(Number(row.image_spend_usd)).toBeCloseTo(spend!.total, 2);
    expect(Number(row.accepted_images)).toBeGreaterThan(0);

    const stageRuns = await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_stage_runs WHERE build_id = ?")
      .bind(run.buildId)
      .first<{ n: number }>();
    expect(stageRuns!.n).toBeGreaterThan(0);
  });

  it("HUMAN_REVIEW_REQUIRED and FAILED terminals record Benchmark FAIL with root cause", async () => {
    await freezeAll();
    const humanReview = await startBenchmarkRun(env, {
      caseId: FROZEN_CASE_IDS[1],
      deps: createSimpleScripts({ allVisualQaFails: true }),
    });
    expect(humanReview.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(humanReview.pass).toBe(false);
    const failRow = await runRow(humanReview.runId);
    expect(failRow.status).toBe("fail");
    expect(failRow.release_ready).toBe(0);
    expect(failRow.root_cause).not.toBeNull();

    const failed = await startBenchmarkRun(env, {
      caseId: FROZEN_CASE_IDS[4],
      deps: createSimpleScripts({ builderInventsCssSelectors: true }),
    });
    expect(failed.terminal).toBe("FAILED");
    expect(failed.pass).toBe(false);
    const failedRow = await runRow(failed.runId);
    expect(failedRow.status).toBe("fail");
    expect(String(failedRow.root_cause).length).toBeGreaterThan(0);
  });

  it("rejects unknown case identities — no run can invent a sixth case", async () => {
    await expect(startBenchmarkRun(env, { caseId: "bench-99-easy-street" })).rejects.toThrow(/frozen set is exactly/);
  });
});

describe("PASS calculator", () => {
  it("PASS = automated RELEASE_READY + zero manual edits + spend within the USD 3 gate", () => {
    expect(evaluateBenchmarkPass({ terminal: "RELEASE_READY", imageSpendUsd: 1.05, manualSourceEdits: 0 }).pass).toBe(true);
    expect(evaluateBenchmarkPass({ terminal: "RELEASE_READY", imageSpendUsd: 3.0, manualSourceEdits: 0 }).pass).toBe(true);
  });

  it("over-budget spend FAILs", () => {
    const verdict = evaluateBenchmarkPass({ terminal: "RELEASE_READY", imageSpendUsd: 3.01, manualSourceEdits: 0 });
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain("hard gate");
  });

  it("a manual-source-edit marker FAILs", () => {
    const verdict = evaluateBenchmarkPass({ terminal: "RELEASE_READY", imageSpendUsd: 0.9, manualSourceEdits: 1 });
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain("manual source edits");
  });

  it("HUMAN_REVIEW_REQUIRED, FAILED and DEGRADED FAIL — no partial pass exists", () => {
    for (const terminal of ["HUMAN_REVIEW_REQUIRED", "FAILED", "DEGRADED"] as const) {
      const verdict = evaluateBenchmarkPass({ terminal, imageSpendUsd: 0, manualSourceEdits: 0 });
      expect(verdict.pass).toBe(false);
      expect(verdict.reason).toContain("FAIL");
    }
  });
});

describe("benchmark retention classes (FDR 130)", () => {
  it("frozen definitions survive Build cleanup; compact run records survive bulky evidence pruning", async () => {
    await freezeAll();
    const run = await startBenchmarkRun(env, {
      caseId: FROZEN_CASE_IDS[0],
      deps: createSimpleScripts(),
    });
    const frozenScreenshot = await getObject(env, `benchmarks/${FROZEN_CASE_IDS[0]}/reference/screenshot.png`);
    expect(frozenScreenshot).not.toBeNull();

    // Terminalize the Build as FAILED so its version becomes cleanup-eligible,
    // then run the #16 prune driver scoped to this Build.
    await appendBuildWorkflowEvent(env, { buildId: run.buildId, toState: "FAILED", stage: "terminal_outcome", detail: "retention-class test" });
    const pruned: string[] = [];
    const report = await pruneDisposableBuildArtifacts(env, {
      buildIds: [run.buildId],
      benchmarkSiteIds: [run.siteId],
      deleteObject: async (key) => {
        pruned.push(key);
      },
    });
    // Whatever the driver prunes, the frozen definition keys are never among
    // them; benchmark evidence keys stay protected on the fresh-run class.
    expect(report.failedVersions).toEqual([]);
    expect(pruned.every((key) => !key.startsWith("benchmarks/"))).toBe(true);
    expect(pruned.every((key) => !report.benchmarkProtectedKeys.includes(key))).toBe(true);

    // Bulky evidence of the run's final version is removable; the frozen
    // screenshot and the compact run row are not.
    if (run.finalBuildVersionId) {
      await pruneDisposableVersionArtifacts(
        env,
        { buildId: run.buildId, buildVersionId: run.finalBuildVersionId, siteGenerationId: run.siteGenerationId },
        { benchmarkSiteIds: [run.siteId], deleteObject: async () => {} }
      );
    }
    const afterPrune = await getObject(env, `benchmarks/${FROZEN_CASE_IDS[0]}/reference/screenshot.png`);
    expect(afterPrune).not.toBeNull();
    await expect(verifyBenchmarkCaseInputs(env, FROZEN_CASE_IDS[0])).resolves.toHaveProperty("definitionHash");

    const survivor = await runRow(run.runId);
    expect(survivor.definition_hash).toBe(run.definitionHash);
    expect(survivor.status).toBe("pass");
    expect(survivor.site_generation_id).toBe(run.siteGenerationId);
  });

  it("per-run bulky evidence follows the 180-day benchmark retention class", async () => {
    await freezeAll();
    const run = await startBenchmarkRun(env, {
      caseId: FROZEN_CASE_IDS[1],
      deps: createSimpleScripts({ allVisualQaFails: true }),
    });
    // The run's recorded FINAL Build Version (the released version on a pass,
    // else the last version the pipeline produced).
    const recorded = await runRow(run.runId);
    const input = {
      buildId: run.buildId,
      buildVersionId: recorded.build_version_id as string,
      siteGenerationId: run.siteGenerationId,
    };
    expect(input.buildVersionId).toBeTruthy();
    const options = { benchmarkSiteIds: [run.siteId] };

    // Fresh run: evidence/AI/QA payloads protected by the benchmark class.
    const fresh = await indexDisposableArtifacts(env, input, options);
    expect(fresh.benchmarkProtectedKeys.length).toBeGreaterThan(0);
    expect(fresh.artifactKeys.some((key) => fresh.benchmarkProtectedKeys.includes(key))).toBe(false);

    // After the retention window the same keys are cleanup-eligible.
    await env.DB.prepare("UPDATE benchmark_runs SET started_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - (BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS + 1) * 24 * 60 * 60_000).toISOString(), run.runId)
      .run();
    const expired = await indexDisposableArtifacts(env, input, { ...options, now: new Date() });
    expect(expired.benchmarkProtectedKeys).toEqual([]);
    expect(expired.artifactKeys.length).toBe(fresh.artifactKeys.length + fresh.benchmarkProtectedKeys.length);
  });

  it("a benchmark-classified site with no run row keeps conservative evidence protection", async () => {
    // Any site WITHOUT a benchmark_runs row: evidence keys stay protected
    // regardless of age (protects more, deletes less).
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: {
          businessName: "No-Run Cafe",
          contactEmail: "hello@norun.example",
          businessType: "cafe",
          businessDescription: "A cafe without a benchmark run row.",
          ...(canonicalStructuredFacts()),
        },
        reference: { screenshotR2Key: "references/uploads/no-run.png" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    await storeBuildStageArtifact(env, {
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      siteGenerationId: started.siteGenerationId,
      kind: "qa_evidence_bundle",
      schemaVersion: "qa-evidence/1",
      value: { captures: [] },
    });
    const index = await indexDisposableArtifacts(
      env,
      { buildId: created.buildId, buildVersionId: created.buildVersionId, siteGenerationId: started.siteGenerationId },
      { benchmarkSiteIds: [started.siteId], now: new Date(Date.now() + 10 * 365 * 24 * 60 * 60_000) }
    );
    expect(index.benchmarkProtectedKeys.length).toBeGreaterThan(0);
  });

  it("input drift after freezing is detected before any run", async () => {
    await freezeAll();
    try {
      // Tamper with the canonical screenshot in R2 (plain put overwrites).
      await putObject(env, `benchmarks/${FROZEN_CASE_IDS[2]}/reference/screenshot.png`, "tampered bytes");
      await expect(verifyBenchmarkCaseInputs(env, FROZEN_CASE_IDS[2])).rejects.toThrow(/pinned checksum/);
      await expect(startBenchmarkRun(env, { caseId: FROZEN_CASE_IDS[2], deps: createSimpleScripts() })).rejects.toThrow(/pinned checksum/);
    } finally {
      // Always restore the frozen bytes so persisted suite storage heals.
      await putObject(env, `benchmarks/${FROZEN_CASE_IDS[2]}/reference/screenshot.png`, embeddedBytes(FROZEN_CASE_IDS[2]));
    }
    await expect(verifyBenchmarkCaseInputs(env, FROZEN_CASE_IDS[2])).resolves.toHaveProperty("definitionHash");
  });
});
