import { beforeAll, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { CAPABILITY_ENVELOPE } from "../src/domain/generated/capability-envelope";
import { PROMPT_MANIFEST, composeStagePrompt } from "../src/domain/prompt-contract";
import { BUILD_LIFECYCLE_STATES } from "../src/domain/lifecycle-schema";
import { recordBenchmarkRun, BENCHMARK_CASES, benchmarkCaseById, freezeBenchmarkCases } from "../src/domain/benchmark";
import { runBenchmarkCase } from "../src/domain/benchmark-runner";
import { createGoldenScripts } from "./helpers/benchmark-golden";
import { evaluateProofGate, assertOriginalDesignUnlocked } from "../src/domain/proof-gate";
import { approveBuildVersion, publishApprovedBuildVersion, rollbackPublication, getPublicationState, type PublicationDeployer } from "../src/domain/publication";
import { createNextBuildVersion } from "../src/domain/lifecycle";
import { getBuildStageArtifact, storeBuildStageArtifact } from "../src/domain/stage-artifacts";
import { buildVersionSourceKey } from "../src/domain/artifact-keys";
import { assignReleaseReady } from "../src/domain/release";
import { cleanupDisposableDeployments } from "../src/domain/retention";
import { acceptFormSubmission, upsertSiteConfiguration, DEFAULT_PLATFORM_SENDER_IDENTITY } from "../src/domain/form-service";
import { QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS, type QaAReport, type QaBReport } from "../src/domain/qa-stages";
import { putObject } from "../src/lib/assets";

// Final V2 integration and release verification (issue #26): one coherent
// pass proving the canonical lifecycle end-to-end, the gates, the form
// contracts, prompt-manifest agreement and envelope agreement on the fully
// contracted tree.

const env = providedEnv as unknown as Env;

const PASS_A: QaAReport = {
  version: "1", visualScore: 94, contentScore: 93, fabrication: false,
  hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })), findings: [],
};
const PASS_B: QaBReport = {
  version: "1", technicalScore: 95,
  gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })), findings: [],
};

const publishDeployer: PublicationDeployer = async ({ workerName }) => ({
  publishedUrl: `https://${workerName}.wazibizwebsites.workers.dev/`,
});

describe("canonical lifecycle end-to-end (fresh Onboarding Submission through Rollback)", () => {
  beforeAll(async () => {
    await freezeBenchmarkCases(env);
    // The e2e build is REFERENCE_BOUND; the proof gate state is exercised in
    // its own describe below.
  });

  it("runs REFERENCE_BOUND from intake to Release Ready, Approval, Publication, Form Service and Rollback", async () => {
    // 1-13: the benchmark runner drives intake -> evidence -> analysis ->
    // blueprint -> contract -> generation -> images -> assembly+preflight ->
    // preview -> QA evidence -> QA-A/QA-B -> Release Ready and records the
    // benchmark run verdict.
    const caseDefinition = benchmarkCaseById("bench-asymmetric-editorial");
    const outcome = await runBenchmarkCase(env, { caseId: caseDefinition.id, deps: createGoldenScripts(caseDefinition) });
    expect(outcome.pass).toBe(true);
    expect(outcome.releaseReady).toBe(true);

    // The build's recorded workflow states are exactly canonical states.
    const events = await env.DB.prepare(
      "SELECT to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at"
    )
      .bind(outcome.buildId)
      .all<{ to_state: string }>();
    const allowed = new Set<string>(BUILD_LIFECYCLE_STATES);
    for (const event of events.results ?? []) {
      expect(allowed.has(event.to_state)).toBe(true);
    }
    expect((events.results ?? []).map((event) => event.to_state)).toContain("RELEASE_READY");

    // 14: explicit human Approval of the exact Release Ready version.
    const approval = await approveBuildVersion(env, { buildId: outcome.buildId, buildVersionId: outcome.buildVersionId, approvedBy: "final-verification" });
    expect(approval.buildVersionId).toBe(outcome.buildVersionId);

    // Site Configuration is mutable runtime state with no Build.
    const buildsBeforeConfig = await env.DB.prepare("SELECT COUNT(*) AS n FROM builds WHERE site_generation_id = ?")
      .bind(outcome.siteGenerationId)
      .first<{ n: number }>();
    const siteId = (await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?")
      .bind(outcome.siteGenerationId)
      .first<{ site_id: string }>())!.site_id;
    await upsertSiteConfiguration(env, {
      siteId,
      formDestination: "owner@riftvalleyroasters.example",
      allowedOrigins: ["https://riftvalleyroasters.example"],
    });
    const buildsAfterConfig = await env.DB.prepare("SELECT COUNT(*) AS n FROM builds WHERE site_generation_id = ?")
      .bind(outcome.siteGenerationId)
      .first<{ n: number }>();
    expect(buildsAfterConfig!.n).toBe(buildsBeforeConfig!.n);

    // 15: separate Publication of the exact approved version.
    const published = await publishApprovedBuildVersion(env, {
      siteId, buildId: outcome.buildId, buildVersionId: outcome.buildVersionId,
      buildVersionNumber: 1, deployer: publishDeployer,
    });
    expect(published.alreadyPublished).toBe(false);
    expect((await getPublicationState(env, siteId)).current!.buildVersionId).toBe(outcome.buildVersionId);

    // Central Form Service against the published Site's public form
    // identity: Accepted Submission + Email Delivery with the wired
    // transport; visitor email is Reply-To only.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const wiredEnv = { ...env, WAZIBIZ_EMAIL_TRANSPORT_URL: "https://mail-router.example/send" } as Env;
    const accepted = await acceptFormSubmission(wiredEnv, {
      origin: "https://riftvalleyroasters.example",
      remoteAddress: "203.0.113.240",
      payload: { siteFormId: `site:${siteId}`, name: "Final Check", email: "final@visitor.example", message: "End-to-end verification." },
    });
    const delivery = await env.DB.prepare("SELECT status, destination, sender_identity, reply_to FROM email_deliveries WHERE form_submission_id = ?")
      .bind(accepted.submissionId)
      .first<{ status: string; destination: string; sender_identity: string; reply_to: string }>();
    expect(delivery!.status).toBe("delivered");
    expect(delivery!.sender_identity).toBe(DEFAULT_PLATFORM_SENDER_IDENTITY);
    expect(delivery!.reply_to).toBe("final@visitor.example");
    vi.unstubAllGlobals();

    // A second version is published, retaining the first as Rollback Version…
    const next = await createNextBuildVersion(env, { buildId: outcome.buildId, cause: "automated_repair" });
    await storeBuildStageArtifact(env, {
      buildId: outcome.buildId, buildVersionId: next.buildVersionId, siteGenerationId: outcome.siteGenerationId,
      kind: "assembled_manifest", schemaVersion: "build-manifest/1",
      value: { artifactManifestHash: "hash-final-v2", files: [{ path: "index.html", sha256: "a", bytes: 1 }] },
    });
    await putObject(env, buildVersionSourceKey(outcome.buildId, next.buildVersionNumber, "index.html"), "<!DOCTYPE html><html><body>v2</body></html>");
    await assignReleaseReady(env, {
      buildId: outcome.buildId, buildVersionId: next.buildVersionId, siteGenerationId: outcome.siteGenerationId,
      qaA: PASS_A, qaB: PASS_B, qaBuildVersionId: next.buildVersionId,
    });
    await approveBuildVersion(env, { buildId: outcome.buildId, buildVersionId: next.buildVersionId });
    await publishApprovedBuildVersion(env, {
      siteId, buildId: outcome.buildId, buildVersionId: next.buildVersionId,
      buildVersionNumber: next.buildVersionNumber, deployer: publishDeployer,
    });
    const afterV2 = await getPublicationState(env, siteId);
    expect(afterV2.current!.buildVersionId).toBe(next.buildVersionId);
    expect(afterV2.rollback!.buildVersionId).toBe(outcome.buildVersionId);

    // …and Rollback restores the exact prior version without new lifecycle
    // objects while Site Configuration survives.
    const rollback = await rollbackPublication(env, { siteId });
    expect(rollback.restoredBuildVersionId).toBe(outcome.buildVersionId);
    expect((await getPublicationState(env, siteId)).current!.buildVersionId).toBe(outcome.buildVersionId);
    const config = await env.DB.prepare("SELECT form_destination FROM site_configurations WHERE site_id = ?")
      .bind(siteId)
      .first<{ form_destination: string }>();
    expect(config!.form_destination).toBe("owner@riftvalleyroasters.example");

    // Retention keeps the current publication and consumed rollback slot
    // safe; nothing in scope here was disposable.
    const cleanup = await cleanupDisposableDeployments(env, { now: new Date(Date.now() + 60_000), buildIds: [outcome.buildId] });
    expect(cleanup.deletedWorkers).toEqual([]);
    const currentStillActive = await env.DB.prepare(
      "SELECT status FROM build_deployments WHERE build_version_id = ? AND role = 'published' AND status = 'active'"
    )
      .bind(outcome.buildVersionId)
      .first<{ status: string }>();
    expect(currentStillActive!.status).toBe("active");
  });
});

describe("gates, prompts and envelope agreement", () => {
  it("proof gate and ORIGINAL_DESIGN gate behave exactly as specified", async () => {
    // Deterministically shut, then open, the gate with recorded runs.
    for (const definition of BENCHMARK_CASES) {
      const started = await (await import("../src/domain/lifecycle")).startSiteGeneration(env, {
        payload: {
          buildMode: "REFERENCE_BOUND",
          facts: { businessName: "Gate Final Co", contactEmail: "gate-final@example.com" },
          reference: { screenshotR2Key: `references/uploads/gf-${Math.random().toString(36).slice(2)}.png` },
        },
      });
      const created = await (await import("../src/domain/lifecycle")).createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
      await recordBenchmarkRun(env, {
        benchmarkCaseId: definition.id,
        siteGenerationId: started.siteGenerationId,
        buildId: created.buildId,
        buildVersionId: created.buildVersionId,
        releaseReady: false, imageSpendUsd: 1, manualSourceEdits: 0, rootCause: "GENERATOR",
      });
    }
    await expect(assertOriginalDesignUnlocked(env)).rejects.toThrow(/locked: 0\/5/);

    for (const definition of BENCHMARK_CASES) {
      const started = await (await import("../src/domain/lifecycle")).startSiteGeneration(env, {
        payload: {
          buildMode: "REFERENCE_BOUND",
          facts: { businessName: "Gate Open Co", contactEmail: "gate-open@example.com" },
          reference: { screenshotR2Key: `references/uploads/go-${Math.random().toString(36).slice(2)}.png` },
        },
      });
      const created = await (await import("../src/domain/lifecycle")).createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
      await recordBenchmarkRun(env, {
        benchmarkCaseId: definition.id,
        siteGenerationId: started.siteGenerationId,
        buildId: created.buildId,
        buildVersionId: created.buildVersionId,
        releaseReady: true, imageSpendUsd: 1.5, manualSourceEdits: 0,
      });
    }
    const open = await assertOriginalDesignUnlocked(env);
    expect(open.gateOpen).toBe(true);
    expect(open.requiredPasses).toBe(3);
  });

  it("runtime prompt identity and composition match the canonical manifest and domain contract", async () => {
    for (const [stage, entry] of Object.entries(PROMPT_MANIFEST)) {
      const composed = composeStagePrompt(entry.promptId as keyof typeof PROMPT_MANIFEST);
      expect(composed.promptId).toBe(stage);
      expect(composed.promptVersion).toBe(entry.promptVersion);
      expect(composed.systemPrompt).toContain("Prompt Domain Contract");
    }
    // Every prompt id ever recorded at runtime belongs to the manifest.
    const rows = await env.DB.prepare("SELECT DISTINCT prompt_id, prompt_version FROM ai_stage_runs").all<{ prompt_id: string; prompt_version: string }>();
    for (const row of rows.results ?? []) {
      const entry = Object.values(PROMPT_MANIFEST).find((candidate) => candidate.promptId === row.prompt_id);
      expect(entry, `unknown runtime prompt ${row.prompt_id}`).toBeDefined();
      expect(entry!.promptVersion).toBe(row.prompt_version);
    }
  });

  it("machine- and human-readable capability envelopes agree with actual behavior", async () => {
    // Envelope: exactly the four pages, static/framework-light, no client
    // accounts, suitability outcomes and proof-gated mode ordering.
    expect([...CAPABILITY_ENVELOPE.site_output.pages]).toEqual(["home", "about", "services", "contact"]);
    expect(CAPABILITY_ENVELOPE.domain_model.client_accounts).toBe(false);
    expect(CAPABILITY_ENVELOPE.domain_model.client_users).toBe(false);
    expect(CAPABILITY_ENVELOPE.modes.implementation_order).toEqual(["REFERENCE_BOUND", "ORIGINAL_DESIGN"]);
    expect(CAPABILITY_ENVELOPE.modes.reference_proof_required_before_original_design).toBe(true);
    expect([...CAPABILITY_ENVELOPE.reference.suitability_outcomes]).toEqual([
      "SUPPORTED", "SUPPORTED_WITH_LIMITATIONS", "UNSUPPORTED",
    ]);
    expect(CAPABILITY_ENVELOPE.site_output.default_shared_files).toEqual(["site.css", "site.js"]);
    expect(CAPABILITY_ENVELOPE.site_output.large_frameworks_default_allowed).toBe(false);

    // Runtime behavior agrees: the most recent generated contract realizes
    // exactly the four pages with site.css/site.js and no dependencies.
    const contracts = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE kind = 'implementation_contract' ORDER BY created_at DESC LIMIT 1"
    ).all<{ artifact_r2_key: string }>();
    const key = contracts.results?.[0]?.artifact_r2_key;
    expect(key).toBeTruthy();
    const body = await env.SITE_BUCKET.get(key!);
    const contract = JSON.parse(await new Response(body!.body).text()) as {
      pages: Array<{ id: string }>;
      files: { sharedCss: string; sharedJs: string };
      approvedDependencies: string[];
    };
    expect(contract.pages.map((page) => page.id)).toEqual([...CAPABILITY_ENVELOPE.site_output.pages]);
    expect(contract.files.sharedCss).toBe("site.css");
    expect(contract.files.sharedJs).toBe("site.js");
    expect(contract.approvedDependencies).toEqual([]);
  });
});
