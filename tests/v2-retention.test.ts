import { canonicalStructuredFacts } from "./helpers/canonical-facts";
import { describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild, createNextBuildVersion, appendBuildWorkflowEvent } from "../src/domain/lifecycle";
import { storeBuildStageArtifact } from "../src/domain/stage-artifacts";
import { buildVersionSourceKey } from "../src/domain/artifact-keys";
import { assignReleaseReady } from "../src/domain/release";
import { approveBuildVersion, publishApprovedBuildVersion, getPublicationState, rollbackPublication, type PublicationDeployer } from "../src/domain/publication";
import { deployPreview, type AssembledCandidate } from "../src/domain/assembly";
import { QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS, type QaAReport, type QaBReport } from "../src/domain/qa-stages";
import {
  cleanupDisposableDeployments,
  markSupersededPreviews,
  pruneDisposableVersionArtifacts,
  pruneDisposableBuildArtifacts,
  getCompactBuildRecord,
  indexDisposableArtifacts,
} from "../src/domain/retention";
import { putObject, getObject } from "../src/lib/assets";
import { generateId } from "../src/lib/crypto";

// Primary-seam tests for the Deployment/artifact retention lifecycle
// (issue #16).

const env = providedEnv as unknown as Env;

const PASS_A: QaAReport = {
  version: "1", visualScore: 94, contentScore: 93, fabrication: false,
  hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })), findings: [],
};
const PASS_B: QaBReport = {
  version: "1", technicalScore: 95,
  gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })), findings: [],
};

async function newSite(): Promise<{ siteGenerationId: string; siteId: string; buildId: string; buildVersionId: string }> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Rift Valley Roasters", contactEmail: "hi@rvr.example" , ...(canonicalStructuredFacts()) },
      reference: { screenshotR2Key: `references/uploads/ret-${Math.random().toString(36).slice(2)}.png` },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { siteGenerationId: started.siteGenerationId, siteId: started.siteId, buildId: created.buildId, buildVersionId: created.buildVersionId };
}

function candidate(hash: string): AssembledCandidate {
  return {
    pages: { home: "<!DOCTYPE html><html><body>x</body></html>" },
    sharedCss: "body{}",
    sharedJs: "",
    files: new Map([["index.html", new TextEncoder().encode("<!DOCTYPE html><html><body>x</body></html>")]]),
    artifactManifestHash: hash,
    manifestR2Key: "builds/test/manifest.json",
    routingNotes: [],
  };
}

async function insertDeployment(input: {
  buildId: string;
  buildVersionId: string;
  role: "preview" | "published" | "rollback";
  workerName: string;
  status?: "active" | "superseded" | "deleted";
  updatedAt?: string;
}): Promise<string> {
  const id = generateId();
  await env.DB.prepare(
    `INSERT INTO build_deployments (id, build_id, build_version_id, role, worker_name, preview_url, artifact_manifest_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'h', ?, ?, ?)`
  )
    .bind(id, input.buildId, input.buildVersionId, input.role, input.workerName, `https://${input.workerName}.example/`, input.status ?? "active", input.updatedAt ?? "2026-09-01T00:00:00Z", input.updatedAt ?? "2026-09-01T00:00:00Z")
    .run();
  return id;
}

function recordingDeleter(): { deleter: (name: string) => Promise<void>; deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    deleter: async (name) => {
      deleted.push(name);
    },
  };
}

const previewDeployer = async (): Promise<{ previewUrl: string }> => ({ previewUrl: "https://preview.example/" });
const publishDeployer: PublicationDeployer = async () => ({ publishedUrl: "https://live.example/" });

async function releaseReadyAndApprove(context: { siteGenerationId: string; buildId: string; buildVersionId: string }, versionNumber: number, hash: string): Promise<void> {
  await storeBuildStageArtifact(env, {
    buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
    kind: "assembled_manifest", schemaVersion: "build-manifest/1",
    value: { artifactManifestHash: hash, files: [{ path: "index.html", sha256: "a", bytes: 1 }] },
  });
  await putObject(env, buildVersionSourceKey(context.buildId, versionNumber, "index.html"), "<!DOCTYPE html><html><body>x</body></html>");
  await assignReleaseReady(env, {
    buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
    qaA: PASS_A, qaB: PASS_B, qaBuildVersionId: context.buildVersionId,
  });
  await approveBuildVersion(env, context);
}

describe("Deployment retention", () => {
  it("deletes previews of FAILED builds and is idempotent on repeat", async () => {
    const context = await newSite();
    await insertDeployment({ buildId: context.buildId, buildVersionId: context.buildVersionId, role: "preview", workerName: "fail-preview" });
    await appendBuildWorkflowEvent(env, { buildId: context.buildId, toState: "FAILED", stage: "terminal_outcome", detail: "no usable candidate" });

    const { deleter, deleted } = recordingDeleter();
    const first = await cleanupDisposableDeployments(env, { deleter, buildIds: [context.buildId] });
    expect(deleted).toEqual(["fail-preview"]);
    expect(first.deletedWorkers).toEqual(["fail-preview"]);

    const row = await env.DB.prepare("SELECT status FROM build_deployments WHERE worker_name = 'fail-preview'")
      .first<{ status: string }>();
    expect(row!.status).toBe("deleted");

    // Safe repeated cleanup: nothing left to do.
    const second = await cleanupDisposableDeployments(env, { deleter, buildIds: [context.buildId] });
    expect(second.deletedWorkers).toEqual([]);
    expect(deleted).toEqual(["fail-preview"]);
  });

  it("superseded previews are cleaned while the newest preview survives", async () => {
    const context = await newSite();
    await deployPreview(env, { buildId: context.buildId, buildVersionId: context.buildVersionId, buildVersionNumber: 1, candidate: candidate("h1"), deployer: previewDeployer });
    const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    await deployPreview(env, { buildId: context.buildId, buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber, candidate: candidate("h2"), deployer: previewDeployer });

    // Deploying v2's preview superseded v1's preview.
    const v1Row = await env.DB.prepare(
      "SELECT d.status FROM build_deployments d JOIN build_versions v ON v.id = d.build_version_id WHERE d.build_id = ? AND v.version_number = 1 AND d.role = 'preview'"
    )
      .bind(context.buildId)
      .first<{ status: string }>();
    expect(v1Row!.status).toBe("superseded");

    const { deleter, deleted } = recordingDeleter();
    await cleanupDisposableDeployments(env, { deleter, buildIds: [context.buildId] });
    const v1Worker = `b-${context.buildId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}-v1`;
    const v2Worker = `b-${context.buildId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}-v2`;
    expect(deleted).toEqual([v1Worker]);

    const survivors = await env.DB.prepare(
      "SELECT worker_name FROM build_deployments WHERE build_id = ? AND status != 'deleted'"
    )
      .bind(context.buildId)
      .all<{ worker_name: string }>();
    expect((survivors.results ?? []).map((row) => row.worker_name)).toEqual([v2Worker]);
  });

  it("protects the current Published Version and the retained Rollback Version; expired older published deployments are removed", async () => {
    const context = await newSite();
    await releaseReadyAndApprove(context, 1, "h1");
    await publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: publishDeployer });
    const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    const v2Context = { ...context, buildVersionId: next.buildVersionId };
    await releaseReadyAndApprove(v2Context, next.buildVersionNumber, "h2");
    await publishApprovedBuildVersion(env, { ...context, buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber, deployer: publishDeployer });

    // After publishing v2: v1 published is superseded but holds the
    // rollback role -> protected.
    const { deleter, deleted } = recordingDeleter();
    await cleanupDisposableDeployments(env, { deleter, now: new Date(Date.now() + 60_000), buildIds: [context.buildId] });
    expect(deleted).toEqual([]);
    const v1Deployment = await env.DB.prepare(
      "SELECT status FROM build_deployments WHERE build_version_id = ? AND role = 'published'"
    )
      .bind(context.buildVersionId)
      .first<{ status: string }>();
    expect(v1Deployment!.status).toBe("superseded"); // retained as rollback, worker alive

    // Consume the rollback (restores v1), then publish v2 again: now v1 no
    // longer holds the rollback role. Advance past the window -> removable.
    const { rollbackPublication } = await import("../src/domain/publication");
    await rollbackPublication(env, { siteId: context.siteId });
    await publishApprovedBuildVersion(env, { ...context, buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber, deployer: publishDeployer });

    // v2's first published deployment is now the superseded non-rollback one.
    const afterWindow = await cleanupDisposableDeployments(env, {
      deleter,
      now: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      buildIds: [context.buildId],
    });
    expect(afterWindow.deletedWorkers.length).toBe(1);
    const current = await env.DB.prepare(
      "SELECT status FROM build_deployments WHERE build_version_id = ? AND role = 'published' AND status = 'active'"
    )
      .bind(next.buildVersionId)
      .first<{ status: string }>();
    expect(current).not.toBeNull();
  });

  it("markSupersededPreviews only affects older versions of the same build", async () => {
    const a = await newSite();
    const b = await newSite();
    await insertDeployment({ buildId: a.buildId, buildVersionId: a.buildVersionId, role: "preview", workerName: "a-v1" });
    await insertDeployment({ buildId: b.buildId, buildVersionId: b.buildVersionId, role: "preview", workerName: "b-v1" });
    const next = await createNextBuildVersion(env, { buildId: a.buildId, cause: "automated_repair" });

    const changed = await markSupersededPreviews(env, { buildId: a.buildId, activeBuildVersionId: next.buildVersionId });
    expect(changed).toBe(1);
    const aRow = await env.DB.prepare("SELECT status FROM build_deployments WHERE worker_name = 'a-v1'").first<{ status: string }>();
    const bRow = await env.DB.prepare("SELECT status FROM build_deployments WHERE worker_name = 'b-v1'").first<{ status: string }>();
    expect(aRow!.status).toBe("superseded");
    expect(bRow!.status).toBe("active");
  });
});

describe("artifact pruning and compact Build Records", () => {
  it("prunes disposable artifacts while compact records keep outcome, QA, root cause, cost and provenance", async () => {
    const context = await newSite();
    // Give the version provenance + cost + a repair root cause (the QA
    // report artifact is stored by assignReleaseReady itself).
    const { runSchemaValidatedAiStage } = await import("../src/domain/ai-boundary");
    const { DesignBlueprintSchema, DESIGN_BLUEPRINT_SCHEMA_VERSION } = await import("../src/simple-design/contracts");
    await runSchemaValidatedAiStage(env, {
      stage: "simple-design-blueprint",
      schema: DesignBlueprintSchema,
      schemaVersion: DESIGN_BLUEPRINT_SCHEMA_VERSION,
      userPrompt: "x",
      buildId: context.buildId,
      siteGenerationId: context.siteGenerationId,
      buildVersionId: context.buildVersionId,
      buildVersionNumber: 1,
      generate: async () => ({ content: "not-json", provider: "test", model: "m" }),
    }).catch(() => undefined); // terminal-invalid run still persists provenance rows
    await env.DB.prepare(
      `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, cost_usd, created_at)
       VALUES (?, ?, ?, 'home-hero', 1, 1, 'succeeded', 0.4, '2026-09-01T00:00:00Z')`
    )
      .bind(generateId(), context.buildId, context.buildVersionId)
      .run();
    await env.DB.prepare(
      `INSERT INTO repair_batches (id, build_id, source_build_version_id, kind, plan_json, created_build_version_id, created_at)
       VALUES (?, ?, ?, 'fix_coordinator', ?, ?, '2026-09-01T00:00:00Z')`
    )
      .bind(generateId(), context.buildId, context.buildVersionId, JSON.stringify({ rootCauses: [{ findingRef: "qa/home-390.png", domain: "visual", rootCause: "hero grid lacks mobile stacking rule" }] }), context.buildVersionId)
      .run();
    await releaseReadyAndApprove(context, 1, "h-final");

    const pruned: string[] = [];
    const prunedKeys = await pruneDisposableVersionArtifacts(
      env,
      { buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId },
      { deleteObject: async (key) => { pruned.push(key); } }
    );
    expect(prunedKeys.length).toBeGreaterThan(0);
    expect(pruned).toEqual(prunedKeys);
    // QA report artifact + manifest are pruned.
    expect(prunedKeys.some((key) => key.includes("/qa_report"))).toBe(true);
    expect(prunedKeys.some((key) => key.includes("/assembled_manifest"))).toBe(true);

    // Compact Build Record survives artifact removal with everything needed
    // to answer "why did this Build fail/succeed".
    const record = await getCompactBuildRecord(env, context.buildId);
    expect(record).not.toBeNull();
    expect(record!.outcome).toBe("APPROVED");
    expect(record!.versions[0].releaseReady).toBe(true);
    expect(record!.versions[0].qa).toEqual({ visual: 94, content: 93, technical: 95 });
    expect(record!.rootCauses[0].rootCause).toContain("mobile stacking");
    expect(record!.imageSpendUsd).toBeCloseTo(0.4, 4);
    expect(record!.provenance.some((entry) => entry.stage === "simple-design-blueprint" && entry.model === "m")).toBe(true);
  });

  it("benchmark sites keep evidence on the longer retention policy", async () => {
    const context = await newSite();
    await storeBuildStageArtifact(env, {
      buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
      kind: "qa_evidence_bundle", schemaVersion: "qa-evidence/1", value: { captures: [] },
    });
    await storeBuildStageArtifact(env, {
      buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
      kind: "generated_page", subkey: "home", schemaVersion: "generated-source/page-home/1", value: { html: "x" },
    });

    const index = await indexDisposableArtifacts(
      env,
      { buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId },
      { benchmarkSiteIds: [context.siteId] }
    );
    expect(index.benchmarkProtectedKeys.some((key) => key.includes("/qa_evidence_bundle"))).toBe(true);
    expect(index.artifactKeys.some((key) => key.includes("/generated_page"))).toBe(true);
    expect(index.artifactKeys.some((key) => key.includes("/qa_evidence_bundle"))).toBe(false);

    const plain = await indexDisposableArtifacts(
      env,
      { buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId }
    );
    expect(plain.artifactKeys.some((key) => key.includes("/qa_evidence_bundle"))).toBe(true);
  });
});

// ── #16 enforcement: protection gates, race safety, failure isolation ──────

function publishedWorkerName(buildId: string, versionNumber: number): string {
  return `pub-${buildId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}-v${versionNumber}`;
}

async function publishTwoVersions(): Promise<{ v1: Awaited<ReturnType<typeof newSite>>; v2VersionId: string }> {
  const v1 = await newSite();
  await releaseReadyAndApprove(v1, 1, "h1");
  await publishApprovedBuildVersion(env, { ...v1, buildVersionNumber: 1, deployer: publishDeployer });
  const next = await createNextBuildVersion(env, { buildId: v1.buildId, cause: "automated_repair" });
  await releaseReadyAndApprove({ ...v1, buildVersionId: next.buildVersionId }, next.buildVersionNumber, "h2");
  await publishApprovedBuildVersion(env, { ...v1, buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber, deployer: publishDeployer });
  return { v1, v2VersionId: next.buildVersionId };
}

async function storeGeneratedPage(context: { buildId: string; buildVersionId: string; siteGenerationId: string }): Promise<void> {
  await storeBuildStageArtifact(env, {
    buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
    kind: "generated_page", subkey: "home", schemaVersion: "generated-source/page-home/1", value: { html: "x" },
  });
}

async function failBuild(buildId: string): Promise<void> {
  await appendBuildWorkflowEvent(env, { buildId, toState: "FAILED", stage: "terminal_outcome", detail: "retention test" });
}

describe("protection gates for live release candidates", () => {
  it("never touches the current Published Version's deployment", async () => {
    const context = await newSite();
    await releaseReadyAndApprove(context, 1, "h1");
    await publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: publishDeployer });

    const { deleter, deleted } = recordingDeleter();
    const report = await cleanupDisposableDeployments(env, { deleter, buildIds: [context.buildId] });
    expect(deleted).toEqual([]);
    expect(report.deletedWorkers).toEqual([]);
    const row = await env.DB.prepare(
      "SELECT status FROM build_deployments WHERE build_version_id = ? AND role = 'published'"
    )
      .bind(context.buildVersionId)
      .first<{ status: string }>();
    expect(row!.status).toBe("active");
  });

  it("keeps a HUMAN_REVIEW_REQUIRED candidate's preview inspectable", async () => {
    const context = await newSite();
    await deployPreview(env, { buildId: context.buildId, buildVersionId: context.buildVersionId, buildVersionNumber: 1, candidate: candidate("h1"), deployer: previewDeployer });
    await appendBuildWorkflowEvent(env, { buildId: context.buildId, toState: "HUMAN_REVIEW_REQUIRED", stage: "terminal_outcome", detail: "blueprint-root defect" });

    const { deleter, deleted } = recordingDeleter();
    const report = await cleanupDisposableDeployments(env, { deleter, buildIds: [context.buildId] });
    expect(deleted).toEqual([]);
    expect(report.deletedWorkers).toEqual([]);
    const row = await env.DB.prepare(
      "SELECT status FROM build_deployments WHERE build_version_id = ? AND role = 'preview'"
    )
      .bind(context.buildVersionId)
      .first<{ status: string }>();
    expect(row!.status).toBe("active");
  });

  it("keeps a RELEASE_READY candidate awaiting Approval", async () => {
    const context = await newSite();
    await deployPreview(env, { buildId: context.buildId, buildVersionId: context.buildVersionId, buildVersionNumber: 1, candidate: candidate("h1"), deployer: previewDeployer });
    // Release Ready WITHOUT Approval: storeBuildStageArtifact + assignReleaseReady only.
    await storeBuildStageArtifact(env, {
      buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
      kind: "assembled_manifest", schemaVersion: "build-manifest/1",
      value: { artifactManifestHash: "h1", files: [{ path: "index.html", sha256: "a", bytes: 1 }] },
    });
    await putObject(env, buildVersionSourceKey(context.buildId, 1, "index.html"), "<!DOCTYPE html><html><body>x</body></html>");
    await assignReleaseReady(env, {
      buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
      qaA: PASS_A, qaB: PASS_B, qaBuildVersionId: context.buildVersionId,
    });
    const approvals = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_approvals WHERE build_version_id = ?")
      .bind(context.buildVersionId)
      .first<{ n: number }>();
    expect(approvals!.n).toBe(0); // the state under test: awaiting Approval

    const { deleter, deleted } = recordingDeleter();
    const report = await cleanupDisposableDeployments(env, { deleter, buildIds: [context.buildId] });
    expect(report.deletedWorkers).toEqual([]);
    const row = await env.DB.prepare(
      "SELECT status FROM build_deployments WHERE build_version_id = ? AND role = 'preview'"
    )
      .bind(context.buildVersionId)
      .first<{ status: string }>();
    expect(row!.status).toBe("active");
  });

  it("keeps an approved version awaiting/retrying publication protected — preview AND artifacts", async () => {
    const context = await newSite();
    await releaseReadyAndApprove(context, 1, "h1"); // approved, never published: open publication right
    await storeGeneratedPage(context);
    await deployPreview(env, { buildId: context.buildId, buildVersionId: context.buildVersionId, buildVersionNumber: 1, candidate: candidate("h1"), deployer: previewDeployer });
    const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    await deployPreview(env, { buildId: context.buildId, buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber, candidate: candidate("h2"), deployer: previewDeployer });

    // The newer preview superseded v1's preview row, but v1's publication
    // right is still open: the approved candidate must stay inspectable.
    const { deleter, deleted } = recordingDeleter();
    const report = await cleanupDisposableDeployments(env, { deleter, buildIds: [context.buildId] });
    expect(deleted).toEqual([]);
    expect(report.protectedWorkers.length).toBe(1);

    // Its artifacts stay publishable too.
    const prune = await pruneDisposableBuildArtifacts(env, { buildIds: [context.buildId], deleteObject: async () => {} });
    expect(prune.prunedVersions).toEqual([]);
    expect(prune.protectedVersions).toEqual([context.buildVersionId]);
  });

  it("rollback restores the exact prior deployment and cleanup cannot delete the restored current publication", async () => {
    const { v1 } = await publishTwoVersions();
    await rollbackPublication(env, { siteId: v1.siteId });

    const { deleter, deleted } = recordingDeleter();
    const report = await cleanupDisposableDeployments(env, { deleter, now: new Date(Date.now() + 60_000), buildIds: [v1.buildId] });
    expect(deleted).toEqual([]);
    expect(report.deletedWorkers).toEqual([]);

    const restored = await env.DB.prepare(
      "SELECT status, worker_name FROM build_deployments WHERE build_version_id = ? AND role = 'published'"
    )
      .bind(v1.buildVersionId)
      .first<{ status: string; worker_name: string }>();
    expect(restored!.status).toBe("active");
    expect(restored!.worker_name).toBe(publishedWorkerName(v1.buildId, 1));
    const state = await getPublicationState(env, v1.siteId);
    expect(state.current?.buildVersionId).toBe(v1.buildVersionId);
  });
});

describe("retention sweep robustness", () => {
  it("skips deletion when protection state changed between selection and delete (race safety)", async () => {
    const a = await newSite();
    await releaseReadyAndApprove(a, 1, "h1");
    await publishApprovedBuildVersion(env, { ...a, buildVersionNumber: 1, deployer: publishDeployer });
    const aNext = await createNextBuildVersion(env, { buildId: a.buildId, cause: "automated_repair" });
    await releaseReadyAndApprove({ ...a, buildVersionId: aNext.buildVersionId }, aNext.buildVersionNumber, "h2");
    await publishApprovedBuildVersion(env, { ...a, buildVersionId: aNext.buildVersionId, buildVersionNumber: aNext.buildVersionNumber, deployer: publishDeployer });

    const b = await newSite();
    await releaseReadyAndApprove(b, 1, "h1");
    await publishApprovedBuildVersion(env, { ...b, buildVersionNumber: 1, deployer: publishDeployer });
    const bNext = await createNextBuildVersion(env, { buildId: b.buildId, cause: "automated_repair" });
    await releaseReadyAndApprove({ ...b, buildVersionId: bNext.buildVersionId }, bNext.buildVersionNumber, "h2");
    await publishApprovedBuildVersion(env, { ...b, buildVersionId: bNext.buildVersionId, buildVersionNumber: bNext.buildVersionNumber, deployer: publishDeployer });

    const workerA1 = publishedWorkerName(a.buildId, 1);
    const workerB1 = publishedWorkerName(b.buildId, 1);
    const deleter = async (name: string) => {
      if (name === workerA1) {
        // While the sweep runs, site B's expired former rollback version is
        // re-published under its still-open approval: it becomes the CURRENT
        // Published Version again, after the sweep snapshot was taken.
        await publishApprovedBuildVersion(env, { ...b, buildVersionNumber: 1, deployer: publishDeployer });
      }
    };

    const report = await cleanupDisposableDeployments(env, { deleter, now: new Date(Date.now() + 30 * 24 * 60 * 60_000) });
    expect(report.deletedWorkers).toContain(workerA1);
    expect(report.deletedWorkers).not.toContain(workerB1);
    expect(report.protectedWorkers).toContain(workerB1);

    const bRow = await env.DB.prepare("SELECT status FROM build_deployments WHERE worker_name = ?")
      .bind(workerB1)
      .first<{ status: string }>();
    expect(bRow!.status).toBe("active");
    const state = await getPublicationState(env, b.siteId);
    expect(state.current?.buildVersionId).toBe(b.buildVersionId);
  });

  it("isolates cleanup failures: row kept for retry, lifecycle untouched, later sweep succeeds", async () => {
    const a = await newSite();
    await insertDeployment({ buildId: a.buildId, buildVersionId: a.buildVersionId, role: "preview", workerName: "iso-fail" });
    await failBuild(a.buildId);
    const b = await newSite();
    await insertDeployment({ buildId: b.buildId, buildVersionId: b.buildVersionId, role: "preview", workerName: "iso-ok" });
    await failBuild(b.buildId);

    const deleted: string[] = [];
    const deleter = async (name: string) => {
      if (name === "iso-fail") throw new Error("connection reset by peer");
      deleted.push(name);
    };
    const report = await cleanupDisposableDeployments(env, { deleter, buildIds: [a.buildId, b.buildId] });
    expect(report.failedWorkers).toEqual([{ workerName: "iso-fail", error: "connection reset by peer" }]);
    expect(report.deletedWorkers).toEqual(["iso-ok"]);

    // The failed row is intact for a later sweep...
    const failedRow = await env.DB.prepare("SELECT status FROM build_deployments WHERE worker_name = 'iso-fail'")
      .first<{ status: string }>();
    expect(failedRow!.status).toBe("active");
    // ...and no publication/build lifecycle state was mutated by cleanup.
    const lifecycle = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM publications WHERE build_version_id IN (?, ?)) AS pubs, (SELECT COUNT(*) FROM site_published_state WHERE site_id IN (?, ?)) AS states, (SELECT state FROM builds WHERE id = ?) AS build_state"
    )
      .bind(a.buildVersionId, b.buildVersionId, a.siteId, b.siteId, a.buildId)
      .first<{ pubs: number; states: number; build_state: string }>();
    expect(lifecycle!.pubs).toBe(0);
    expect(lifecycle!.states).toBe(0);
    expect(lifecycle!.build_state).toBe("FAILED");

    // The later sweep retries and succeeds.
    const retry = await cleanupDisposableDeployments(env, { deleter: recordingDeleter().deleter, buildIds: [a.buildId] });
    expect(retry.deletedWorkers).toEqual(["iso-fail"]);
    expect(retry.failedWorkers).toEqual([]);
  });

  it("treats an already-vanished Worker (404) as successful idempotent cleanup", async () => {
    const context = await newSite();
    await insertDeployment({ buildId: context.buildId, buildVersionId: context.buildVersionId, role: "preview", workerName: "already-gone" });
    await failBuild(context.buildId);

    const report = await cleanupDisposableDeployments(env, {
      deleter: async () => {
        throw new Error("Worker deletion failed: 404");
      },
      buildIds: [context.buildId],
    });
    expect(report.deletedWorkers).toEqual(["already-gone"]);
    expect(report.failedWorkers).toEqual([]);
    const row = await env.DB.prepare("SELECT status FROM build_deployments WHERE worker_name = 'already-gone'")
      .first<{ status: string }>();
    expect(row!.status).toBe("deleted");
  });

  it("caps destructive work per run and resumes on the next sweep", async () => {
    const builds = [await newSite(), await newSite(), await newSite()];
    for (const [index, context] of builds.entries()) {
      await insertDeployment({ buildId: context.buildId, buildVersionId: context.buildVersionId, role: "preview", workerName: `cap-${index}` });
      await failBuild(context.buildId);
    }
    const scope = builds.map((context) => context.buildId);
    const { deleter, deleted } = recordingDeleter();

    const first = await cleanupDisposableDeployments(env, { deleter, maxDeletions: 2, buildIds: scope });
    expect(first.deletedWorkers.length).toBe(2);
    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM build_deployments WHERE build_id IN (?, ?, ?) AND status != 'deleted'"
    )
      .bind(...scope)
      .first<{ n: number }>();
    expect(remaining!.n).toBe(1);

    const second = await cleanupDisposableDeployments(env, { deleter, buildIds: scope });
    expect(second.deletedWorkers.length).toBe(1);
    expect(deleted.length).toBe(3);
  });
});

describe("bounded artifact-prune sweep driver", () => {
  it("prunes failed-build version artifacts and leaves active candidates untouched", async () => {
    const failed = await newSite();
    await storeGeneratedPage(failed);
    await failBuild(failed.buildId);
    const active = await newSite();
    await storeGeneratedPage(active);
    await deployPreview(env, { buildId: active.buildId, buildVersionId: active.buildVersionId, buildVersionNumber: 1, candidate: candidate("h1"), deployer: previewDeployer });

    const pruned: string[] = [];
    const report = await pruneDisposableBuildArtifacts(env, {
      buildIds: [failed.buildId, active.buildId],
      deleteObject: async (key) => { pruned.push(key); },
    });
    expect(report.prunedVersions).toEqual([failed.buildVersionId]);
    expect(report.prunedArtifactKeys.some((key) => key.includes("/generated_page"))).toBe(true);
    expect(pruned).toEqual(report.prunedArtifactKeys);
    expect(report.failedVersions).toEqual([]);
  });

  it("prunes a superseded version's artifacts once a newer sibling owns the preview role", async () => {
    const context = await newSite();
    await storeGeneratedPage(context);
    await deployPreview(env, { buildId: context.buildId, buildVersionId: context.buildVersionId, buildVersionNumber: 1, candidate: candidate("h1"), deployer: previewDeployer });
    const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    await deployPreview(env, { buildId: context.buildId, buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber, candidate: candidate("h2"), deployer: previewDeployer });

    const report = await pruneDisposableBuildArtifacts(env, { buildIds: [context.buildId], deleteObject: async () => {} });
    expect(report.prunedVersions).toEqual([context.buildVersionId]);
  });

  it("derives benchmark protection from benchmark_runs without caller injection", async () => {
    const context = await newSite();
    await storeBuildStageArtifact(env, {
      buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
      kind: "qa_evidence_bundle", schemaVersion: "qa-evidence/1", value: { captures: [] },
    });
    await storeGeneratedPage(context);
    await failBuild(context.buildId);

    const caseId = generateId();
    await env.DB.prepare(
      `INSERT INTO benchmark_cases (id, slot, archetype, evidence_checksum, screenshot_checksum, replacement_brief_json, prompt_model_schema_json, frozen_at)
       VALUES (?, 5, 'retention-test', 'e', 's', '{}', '{}', '2026-09-01T00:00:00Z')`
    )
      .bind(caseId)
      .run();
    await env.DB.prepare(
      `INSERT INTO benchmark_runs (id, benchmark_case_id, site_generation_id, build_id, build_version_id, status, release_ready, image_spend_usd, manual_source_edits, started_at)
       VALUES (?, ?, ?, ?, ?, 'pass', 1, 0, 0, '2026-09-01T00:00:00Z')`
    )
      .bind(generateId(), caseId, context.siteGenerationId, context.buildId, context.buildVersionId)
      .run();

    const report = await pruneDisposableBuildArtifacts(env, { buildIds: [context.buildId], deleteObject: async () => {} });
    // Diagnosis evidence stays on the longer benchmark policy; generated
    // source is disposable as usual.
    expect(report.benchmarkProtectedKeys.some((key) => key.includes("/qa_evidence_bundle"))).toBe(true);
    expect(report.prunedArtifactKeys.some((key) => key.includes("/qa_evidence_bundle"))).toBe(false);
    expect(report.prunedArtifactKeys.some((key) => key.includes("/generated_page"))).toBe(true);
  });
});

describe("cron wiring", () => {
  it("scheduled() runs the retention sweep: 404-tolerant worker cleanup and real R2 prune", async () => {
    const context = await newSite();
    await storeGeneratedPage(context);
    const stored = await env.DB.prepare("SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ?")
      .bind(context.buildVersionId)
      .first<{ artifact_r2_key: string }>();
    expect(await getObject(env, stored!.artifact_r2_key)).not.toBeNull();
    await deployPreview(env, { buildId: context.buildId, buildVersionId: context.buildVersionId, buildVersionNumber: 1, candidate: candidate("h1"), deployer: previewDeployer });
    await failBuild(context.buildId);

    // Drain disposable work from EARLIER tests (scoped away from this Build)
    // so this newest Build Version sits within the bounded per-run cron caps;
    // resumability across runs is proven by the cap test above. Chunked: D1
    // caps bound SQL variables, and the shared suite DB has many Builds.
    const otherBuilds = ((await env.DB.prepare("SELECT id FROM builds WHERE id != ?")
      .bind(context.buildId)
      .all<{ id: string }>()).results ?? []).map((row) => row.id);
    for (let index = 0; index < otherBuilds.length; index += 80) {
      const chunk = otherBuilds.slice(index, index + 80);
      await cleanupDisposableDeployments(env, { deleter: async () => {}, buildIds: chunk });
      await pruneDisposableBuildArtifacts(env, { buildIds: chunk, deleteObject: async () => {} });
    }

    // The Cloudflare API is an external provider: stub it as "already
    // vanished" (404) — exactly what the default deleter must tolerate.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("script not found", { status: 404 })));
    try {
      const { scheduled } = await import("../src/index");
      await scheduled({ cron: "*/10 * * * *" } as unknown as Parameters<typeof scheduled>[0], env);
    } finally {
      vi.unstubAllGlobals();
    }

    // Bulky artifact really pruned through the cron path's R2 binding...
    expect(await getObject(env, stored!.artifact_r2_key)).toBeNull();
    // ...and the preview deployment was disposed idempotently despite the 404.
    const row = await env.DB.prepare("SELECT status FROM build_deployments WHERE build_version_id = ? AND role = 'preview'")
      .bind(context.buildVersionId)
      .first<{ status: string }>();
    expect(row!.status).toBe("deleted");
  });
});
