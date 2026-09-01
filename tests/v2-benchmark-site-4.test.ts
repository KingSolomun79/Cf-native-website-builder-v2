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

// Benchmark Site 4 end-to-end validation (issue #21): the frozen bold
// trades/local-service case runs the autonomous pipeline with its five-region
// silhouette ending in a quote form; complete PASS/failure evidence is
// persisted without manual source edits.

const env = providedEnv as unknown as Env;
const CASE_ID = "bench-trades-local-service";

describe("Benchmark Site 4 — bold trades/local service", () => {
  let caseDefinition: ReturnType<typeof benchmarkCaseById>;

  beforeAll(async () => {
    await freezeBenchmarkCases(env);
    caseDefinition = benchmarkCaseById(CASE_ID);
  });

  it("uses the frozen inputs from #17 unchanged", async () => {
    const row = await env.DB.prepare("SELECT * FROM benchmark_cases WHERE id = ?")
      .bind(CASE_ID)
      .first<{ archetype: string; evidence_checksum: string; screenshot_checksum: string; replacement_brief_json: string }>();
    expect(row!.archetype).toBe("bold trades/local service");
    expect(row!.evidence_checksum).toBe(await evidenceChecksumOf(caseDefinition.evidence));
    expect(row!.screenshot_checksum).toBe(await screenshotChecksumOf(caseDefinition.evidence));
    expect(JSON.parse(row!.replacement_brief_json).businessName).toBe("Ironline Roofing");
    // The bold uppercase display and the quote-form region are frozen identity.
    expect(caseDefinition.evidence.measuredElements[0].computed.textTransform).toBe("uppercase");
    expect(caseDefinition.evidence.regions.map((region) => region.id)).toEqual([
      "banner-hero", "offer-grid", "before-after", "trust-bar", "quote-form",
    ]);
  });

  it("traverses the autonomous pipeline to Release Ready with the platform form contract intact", async () => {
    const outcome = await runBenchmarkCase(env, {
      caseId: CASE_ID,
      deps: createGoldenScripts(caseDefinition),
      imageMassRatio: 0.3,
    });

    expect(outcome.pass).toBe(true);
    expect(outcome.releaseReady).toBe(true);
    expect(outcome.imageSpendUsd).toBeLessThanOrEqual(3.0);

    const run = await env.DB.prepare("SELECT * FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ status: string; manual_source_edits: number; qa_summary_json: string; provenance_json: string }>();
    expect(run!.status).toBe("pass");
    expect(run!.manual_source_edits).toBe(0);

    const qaSummary = JSON.parse(run!.qa_summary_json!) as { technicalScore: number; mandatoryGates: Array<{ id: string; passed: boolean }> };
    expect(qaSummary.technicalScore).toBeGreaterThanOrEqual(90);
    expect(qaSummary.mandatoryGates.find((gate) => gate.id === "FORM_SERVICE_CONTRACT")?.passed).toBe(true);

    const provenance = JSON.parse(run!.provenance_json!) as Array<{ stage: string }>;
    expect(provenance.some((entry) => entry.stage === "qa-b-browser-technical")).toBe(true);

    // The bold five-region silhouette survived, including the quote-form
    // region, and the Contact page carries the platform form contract.
    const homeArtifact = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey = 'home'"
    )
      .bind(outcome.buildVersionId)
      .first<{ artifact_r2_key: string }>();
    const homeStored = await env.SITE_BUCKET.get(homeArtifact!.artifact_r2_key);
    const home = JSON.parse(await new Response(homeStored!.body).text()) as { html: string };
    for (const region of caseDefinition.evidence.regions) {
      expect(home.html).toContain(`data-region="${region.id}"`);
    }

    const contactArtifact = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey = 'contact'"
    )
      .bind(outcome.buildVersionId)
      .first<{ artifact_r2_key: string }>();
    const contactStored = await env.SITE_BUCKET.get(contactArtifact!.artifact_r2_key);
    const contact = JSON.parse(await new Response(contactStored!.body).text()) as { html: string };
    expect(contact.html).toContain('action="https://forms.wazibiz.example/api/v2/forms/submit"');
    expect(contact.html).not.toMatch(/\bname="(recipient|to|from|sender|template)"/i);

    const suite = await getBenchmarkSuiteStatus(env);
    expect(suite.perCase.find((item) => item.caseId === CASE_ID)?.latestStatus).toBe("pass");
  });

  it("records actionable failure evidence when the generated form breaks the platform contract", async () => {
    const checksumsBefore = await env.DB.prepare(
      "SELECT evidence_checksum, screenshot_checksum FROM benchmark_cases WHERE id = ?"
    )
      .bind(CASE_ID)
      .first<{ evidence_checksum: string; screenshot_checksum: string }>();

    // A generation regression (browser-controlled recipient smuggled into the
    // contact form) must be caught by the deterministic cross-file validation
    // at the generation boundary and recorded with an actionable cause — it
    // never reaches preflight or QA.
    const scripts = createGoldenScripts(caseDefinition);
    const failingGenerate = async (systemPrompt: string, userPrompt: string, attempt: number) => {
      const result = await scripts.generate(systemPrompt, userPrompt, attempt);
      if (userPrompt.includes("page id 'contact'")) {
        const parsed = JSON.parse(result.content as string) as { html: string };
        return {
          content: JSON.stringify({
            html: parsed.html.replace(
              '<input type="hidden" name="siteFormId"',
              '<input type="hidden" name="recipient" value="owner@ironline.example"\n  <input type="hidden" name="siteFormId"'
            ),
          }),
          provider: result.provider,
          model: result.model,
        };
      }
      return result;
    };

    const outcome = await runBenchmarkCase(env, {
      caseId: CASE_ID,
      deps: { ...scripts, generate: failingGenerate },
      imageMassRatio: 0.3,
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.rootCause).toBe("GENERATOR");

    const run = await env.DB.prepare("SELECT qa_summary_json FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ qa_summary_json: string }>();
    const failure = JSON.parse(run!.qa_summary_json!) as { failedStage: string; error: string };
    expect(failure.failedStage).toBe("generation");
    expect(failure.error).toContain("FORM_CONTRACT_VIOLATION");

    const checksumsAfter = await env.DB.prepare(
      "SELECT evidence_checksum, screenshot_checksum FROM benchmark_cases WHERE id = ?"
    )
      .bind(CASE_ID)
      .first<{ evidence_checksum: string; screenshot_checksum: string }>();
    expect(checksumsAfter).toEqual(checksumsBefore);
  });
});
