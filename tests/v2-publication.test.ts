import { canonicalStructuredFacts } from "./helpers/canonical-facts";
import { describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild, createNextBuildVersion } from "../src/domain/lifecycle";
import { storeBuildStageArtifact } from "../src/domain/stage-artifacts";
import { buildVersionSourceKey } from "../src/domain/artifact-keys";
import { assignReleaseReady } from "../src/domain/release";
import { generateId, nowIso } from "../src/lib/crypto";
import { QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS, type QaAReport, type QaBReport } from "../src/domain/qa-stages";
import {
  approveBuildVersion,
  publishApprovedBuildVersion,
  rollbackPublication,
  getPublicationState,
  PublicationError,
  type PublicationDeployer,
} from "../src/domain/publication";
import { putObject } from "../src/lib/assets";

// Primary-seam tests for Approval / Publication / Rollback (issue #15).

const env = providedEnv as unknown as Env;

const PASS_A: QaAReport = {
  version: "1",
  visualScore: 94,
  contentScore: 93,
  fabrication: false,
  hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [],
};
const PASS_B: QaBReport = {
  version: "1",
  technicalScore: 95,
  gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [],
};

async function releaseReadyVersion(options: {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  hash: string;
}): Promise<void> {
  await storeBuildStageArtifact(env, {
    buildId: options.buildId,
    buildVersionId: options.buildVersionId,
    siteGenerationId: options.siteGenerationId,
    kind: "assembled_manifest",
    schemaVersion: "build-manifest/1",
    value: {
      schemaVersion: "build-manifest/1",
      buildId: options.buildId,
      buildVersionId: options.buildVersionId,
      versionNumber: options.buildVersionNumber,
      artifactManifestHash: options.hash,
      files: [
        { path: "index.html", sha256: "a", bytes: 10 },
        { path: "site.css", sha256: "b", bytes: 5 },
      ],
      routingNotes: [],
    },
  });
  for (const [path, content] of [
    ["index.html", `<!DOCTYPE html><html><body>v${options.buildVersionNumber}</body></html>`],
    ["site.css", "body{}"],
  ] as const) {
    await putObject(env, buildVersionSourceKey(options.buildId, options.buildVersionNumber, path), content);
  }
  await assignReleaseReady(env, {
    buildId: options.buildId,
    buildVersionId: options.buildVersionId,
    siteGenerationId: options.siteGenerationId,
    qaA: PASS_A,
    qaB: PASS_B,
    qaBuildVersionId: options.buildVersionId,
  });
}

async function newSite(): Promise<{
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  buildVersionId: string;
}> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Rift Valley Roasters", contactEmail: "hi@rvr.example" , ...(canonicalStructuredFacts()) },
      reference: { screenshotR2Key: `references/uploads/pub-${Math.random().toString(36).slice(2)}.png` },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return {
    siteGenerationId: started.siteGenerationId,
    siteId: started.siteId,
    buildId: created.buildId,
    buildVersionId: created.buildVersionId,
  };
}

function deployer(explodeFirst = 0): { deployer: PublicationDeployer; calls: number } {
  const state = { calls: 0 };
  return {
    calls: 0,
    deployer: async () => {
      state.calls += 1;
      if (state.calls <= explodeFirst) throw new Error("CF API 502");
      return { publishedUrl: `https://pub-live-${state.calls}.wazibizwebsites.workers.dev/` };
    },
  };
}

async function versionsOf(buildId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?")
    .bind(buildId)
    .first<{ n: number }>();
  return row!.n;
}

describe("Approval", () => {
  it("is granted only to one exact Release Ready version and does not make the Site live", async () => {
    const context = await newSite();
    // Not Release Ready yet.
    await expect(approveBuildVersion(env, context)).rejects.toMatchObject({ code: "NOT_RELEASE_READY" });

    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-alpha" });
    const approval = await approveBuildVersion(env, { ...context, approvedBy: "jo" });
    expect(approval.artifactManifestHash).toBe("hash-alpha");

    // Approval alone: no publication, no live state, build state is APPROVED.
    expect(await getPublicationState(env, context.siteId)).toEqual({ current: null, rollback: null });
    const state = await env.DB.prepare("SELECT state FROM builds WHERE id = ?")
      .bind(context.buildId)
      .first<{ state: string }>();
    expect(state!.state).toBe("APPROVED");

    // Double approval of the same version is rejected.
    await expect(approveBuildVersion(env, context)).rejects.toMatchObject({ code: "ALREADY_APPROVED" });
    await expect(
      env.DB.prepare("UPDATE build_approvals SET artifact_manifest_hash = 'x' WHERE id = ?").bind(approval.approvalId).run()
    ).rejects.toThrow("BUILD_APPROVAL_IMMUTABLE");
  });
});

describe("Publication", () => {
  it("deploys the exact approved version without regeneration and records traceable identity", async () => {
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-beta" });
    await approveBuildVersion(env, context);

    const deployedFiles: Map<string, Uint8Array> = new Map();
    const stub: PublicationDeployer = async ({ workerName, files }) => {
      expect(workerName).toContain("-v1");
      for (const [path, bytes] of files) deployedFiles.set(path, bytes);
      return { publishedUrl: "https://live.example/" };
    };

    const publication = await publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: stub });
    expect(publication.alreadyPublished).toBe(false);
    expect(publication.artifactManifestHash).toBe("hash-beta");

    // Exact candidate bytes (from immutable storage), not a regeneration.
    expect([...deployedFiles.keys()].sort()).toEqual(["index.html", "site.css"]);
    expect(new TextDecoder().decode(deployedFiles.get("index.html")!)).toContain("<body>v1</body>");

    const view = await getPublicationState(env, context.siteId);
    expect(view.current!.buildVersionId).toBe(context.buildVersionId);
    expect(view.rollback).toBeNull();

    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at")
      .bind(context.buildId)
      .all<{ to_state: string }>();
    expect((events.results ?? []).map((row) => row.to_state)).toEqual([
      "INTAKE_READY", "QA", "RELEASE_READY", "APPROVED", "PUBLISHING", "PUBLISHED",
    ]);

    // Idempotent: publishing the same approved version again is a read.
    const again = await publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: stub });
    expect(again.alreadyPublished).toBe(true);
    expect(again.publicationId).toBe(publication.publicationId);
  });

  it("retries an operational failure under the same Approval, and a retry can never drift to a newer approved candidate", async () => {
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-gamma" });
    await approveBuildVersion(env, context);

    const failing = deployer(1);
    await expect(
      publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: failing.deployer })
    ).rejects.toMatchObject({ code: "PUBLISH_FAILED" });

    const failedRows = await env.DB.prepare(
      "SELECT status, attempt FROM publications WHERE build_version_id = ?"
    )
      .bind(context.buildVersionId)
      .all<{ status: string; attempt: number }>();
    expect((failedRows.results ?? []).map((row) => row.status)).toEqual(["failed"]);
    expect(await getPublicationState(env, context.siteId)).toEqual({ current: null, rollback: null });

    // A newer candidate becomes approved while v1's publication is still
    // unretried — the retry must deploy v1, never implicitly v2.
    const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    await releaseReadyVersion({
      siteGenerationId: context.siteGenerationId, buildId: context.buildId,
      buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber, hash: "hash-delta",
    });
    await approveBuildVersion(env, { buildId: context.buildId, buildVersionId: next.buildVersionId });

    // Retry: SAME approval, unchanged version — attempt 2 succeeds for v1.
    const succeeding = deployer(0);
    const retried = await publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: succeeding.deployer });
    expect(retried.attempt).toBe(2);
    expect(retried.alreadyPublished).toBe(false);
    expect(retried.artifactManifestHash).toBe("hash-gamma");

    // v1 is the live Published Version; v2 has no publications at all.
    expect((await getPublicationState(env, context.siteId)).current!.buildVersionId).toBe(context.buildVersionId);
    const v2Publications = await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE build_version_id = ?")
      .bind(next.buildVersionId)
      .first<{ n: number }>();
    expect(v2Publications!.n).toBe(0);

    const approvals = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_approvals WHERE build_version_id = ?")
      .bind(context.buildVersionId)
      .first<{ n: number }>();
    expect(approvals!.n).toBe(1);
  });

  it("prevents approval drift across versions", async () => {
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-one" });
    await approveBuildVersion(env, context);

    // A different (newer) version cannot inherit the earlier approval.
    const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    await expect(
      publishApprovedBuildVersion(env, {
        siteId: context.siteId, buildId: context.buildId,
        buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber,
        deployer: deployer().deployer,
      })
    ).rejects.toMatchObject({ code: "NOT_APPROVED" });
  });

  it("refuses publication when the approved manifest hash no longer matches the candidate (APPROVAL_HASH_MISMATCH)", async () => {
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-right" });
    // Seed an approval bound to a DIFFERENT manifest hash than the
    // candidate's current (immutable) manifest — the drift state the guard
    // exists for. (INSERT is legal; only UPDATE/DELETE are trigger-blocked,
    // so this is the only way to construct the drifted state.)
    await env.DB.prepare(
      `INSERT INTO build_approvals (id, build_id, build_version_id, artifact_manifest_hash, approved_at)
       VALUES (?, ?, ?, 'hash-approved-earlier', ?)`
    )
      .bind(generateId(), context.buildId, context.buildVersionId, nowIso())
      .run();

    await expect(
      publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: deployer().deployer })
    ).rejects.toMatchObject({ code: "APPROVAL_HASH_MISMATCH" });

    // Nothing deployed, nothing recorded.
    expect(await getPublicationState(env, context.siteId)).toEqual({ current: null, rollback: null });
    const publications = await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE build_version_id = ?")
      .bind(context.buildVersionId)
      .first<{ n: number }>();
    expect(publications!.n).toBe(0);
  });
});

describe("Rollback", () => {
  it("retains the previous Published Version, restores it exactly, and preserves history + Site Configuration", async () => {
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-v1" });
    await approveBuildVersion(env, context);
    await publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: deployer().deployer });

    // A newer version on the same Build.
    const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    await releaseReadyVersion({
      siteGenerationId: context.siteGenerationId, buildId: context.buildId,
      buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber, hash: "hash-v2",
    });
    await approveBuildVersion(env, { buildId: context.buildId, buildVersionId: next.buildVersionId });
    await publishApprovedBuildVersion(env, {
      siteId: context.siteId, buildId: context.buildId,
      buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber,
      deployer: deployer().deployer,
    });

    const afterV2 = await getPublicationState(env, context.siteId);
    expect(afterV2.current!.buildVersionId).toBe(next.buildVersionId);
    expect(afterV2.rollback!.buildVersionId).toBe(context.buildVersionId);
    expect(afterV2.rollback!.expiresAt).toBeTruthy();

    // Site Configuration must not roll back implicitly: configure, then
    // rollback, then verify the configuration is untouched.
    await env.DB.prepare(
      `INSERT INTO site_configurations (site_id, form_enabled, form_allowed_origins_json, form_destination, sender_identity, turnstile_required, updated_at)
       VALUES (?, 1, '[]', 'owner@example.com', 'hello@mail.riftvalleyroasters.example', 0, '2026-09-01T00:00:00Z')`
    )
      .bind(context.siteId)
      .run();
    const configBefore = await env.DB.prepare("SELECT * FROM site_configurations WHERE site_id = ?")
      .bind(context.siteId)
      .first();

    const buildsBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM builds WHERE site_generation_id = ?")
      .bind(context.siteGenerationId)
      .first<{ n: number }>();
    const versionsBefore = await versionsOf(context.buildId);
    const approvalsBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_approvals WHERE build_id = ?")
      .bind(context.buildId)
      .first<{ n: number }>();

    const rollback = await rollbackPublication(env, { siteId: context.siteId });
    expect(rollback.restoredBuildVersionId).toBe(context.buildVersionId);

    // No new Build, no new Build Version, no new Approval, no regeneration.
    const buildsAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM builds WHERE site_generation_id = ?")
      .bind(context.siteGenerationId)
      .first<{ n: number }>();
    expect(buildsAfter!.n).toBe(buildsBefore!.n);
    expect(await versionsOf(context.buildId)).toBe(versionsBefore);
    const approvalsAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_approvals WHERE build_id = ?")
      .bind(context.buildId)
      .first<{ n: number }>();
    expect(approvalsAfter!.n).toBe(approvalsBefore!.n);

    // Publication history preserved: both publication rows still exist.
    const history = await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE site_id = ?")
      .bind(context.siteId)
      .first<{ n: number }>();
    expect(history!.n).toBe(2);

    const view = await getPublicationState(env, context.siteId);
    expect(view.current!.buildVersionId).toBe(context.buildVersionId);
    expect(view.rollback).toBeNull();

    // Site Configuration untouched.
    const configAfter = await env.DB.prepare("SELECT * FROM site_configurations WHERE site_id = ?")
      .bind(context.siteId)
      .first();
    expect(configAfter).toEqual(configBefore);

    // Rollback is single-shot: the retained version was consumed.
    await expect(rollbackPublication(env, { siteId: context.siteId })).rejects.toMatchObject({ code: "NO_ROLLBACK_VERSION" });

    const rollbackEvent = await env.DB.prepare(
      "SELECT detail FROM build_workflow_events WHERE stage = 'rollback' AND build_version_id = ?"
    )
      .bind(context.buildVersionId)
      .first<{ detail: string }>();
    expect(rollbackEvent!.detail).toContain("without a new Build");
  });

  it("publishing a third version replaces the single retained Rollback candidate with the immediately previous Published Version", async () => {
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-c1" });
    await approveBuildVersion(env, context);
    await publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: deployer().deployer });

    const v2 = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    await releaseReadyVersion({
      siteGenerationId: context.siteGenerationId, buildId: context.buildId,
      buildVersionId: v2.buildVersionId, buildVersionNumber: v2.buildVersionNumber, hash: "hash-c2",
    });
    await approveBuildVersion(env, { buildId: context.buildId, buildVersionId: v2.buildVersionId });
    await publishApprovedBuildVersion(env, {
      siteId: context.siteId, buildId: context.buildId,
      buildVersionId: v2.buildVersionId, buildVersionNumber: v2.buildVersionNumber,
      deployer: deployer().deployer,
    });

    // After V2: current = V2, retained rollback = V1.
    const afterV2 = await getPublicationState(env, context.siteId);
    expect(afterV2.current!.buildVersionId).toBe(v2.buildVersionId);
    expect(afterV2.rollback!.buildVersionId).toBe(context.buildVersionId);

    // V3: the one retained rollback candidate must MOVE to the immediately
    // previous (V2) — never an unbounded chain, never V1.
    const v3 = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    await releaseReadyVersion({
      siteGenerationId: context.siteGenerationId, buildId: context.buildId,
      buildVersionId: v3.buildVersionId, buildVersionNumber: v3.buildVersionNumber, hash: "hash-c3",
    });
    await approveBuildVersion(env, { buildId: context.buildId, buildVersionId: v3.buildVersionId });
    await publishApprovedBuildVersion(env, {
      siteId: context.siteId, buildId: context.buildId,
      buildVersionId: v3.buildVersionId, buildVersionNumber: v3.buildVersionNumber,
      deployer: deployer().deployer,
    });

    const afterV3 = await getPublicationState(env, context.siteId);
    expect(afterV3.current!.buildVersionId).toBe(v3.buildVersionId);
    expect(afterV3.rollback!.buildVersionId).toBe(v2.buildVersionId);

    // Exactly ONE retained rollback slot exists (V2) — the older V1 is no
    // longer referenced by published state at all, and only the current
    // version's deployment holds an active published role.
    expect(await getPublicationState(env, context.siteId)).toEqual({
      current: { publicationId: afterV3.current!.publicationId, buildVersionId: v3.buildVersionId, url: afterV3.current!.url },
      rollback: { publicationId: afterV3.rollback!.publicationId, buildVersionId: v2.buildVersionId, expiresAt: afterV3.rollback!.expiresAt },
    });
    const activePublished = await env.DB.prepare(
      "SELECT build_version_id FROM build_deployments WHERE build_id = ? AND role = 'published' AND status = 'active'"
    )
      .bind(context.buildId)
      .all<{ build_version_id: string }>();
    expect((activePublished.results ?? []).map((row) => row.build_version_id)).toEqual([v3.buildVersionId]);

    // V1 remains in publication history only — three published rows total.
    const history = await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE site_id = ?")
      .bind(context.siteId)
      .first<{ n: number }>();
    expect(history!.n).toBe(3);

    // And rollback restores exactly the immediately previous version (V2).
    const rollback = await rollbackPublication(env, { siteId: context.siteId });
    expect(rollback.restoredBuildVersionId).toBe(v2.buildVersionId);
    expect((await getPublicationState(env, context.siteId)).current!.buildVersionId).toBe(v2.buildVersionId);
  });

  it("honors the configured rollback window", async () => {
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-w1" });
    await approveBuildVersion(env, context);
    await publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: deployer().deployer });
    const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    await releaseReadyVersion({
      siteGenerationId: context.siteGenerationId, buildId: context.buildId,
      buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber, hash: "hash-w2",
    });
    await approveBuildVersion(env, { buildId: context.buildId, buildVersionId: next.buildVersionId });
    await publishApprovedBuildVersion(env, {
      siteId: context.siteId, buildId: context.buildId,
      buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber,
      deployer: deployer().deployer,
    });

    // Inside the window: rollback succeeds.
    const inWindow = await rollbackPublication(env, { siteId: context.siteId, now: new Date(Date.now() + 60_000) });
    expect(inWindow.restoredBuildVersionId).toBe(context.buildVersionId);

    // Republish v2 to retain v1 again, then expire the window.
    const retry = await publishApprovedBuildVersion(env, {
      siteId: context.siteId, buildId: context.buildId,
      buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber,
      deployer: deployer().deployer,
    });
    expect(retry.alreadyPublished).toBe(false); // fresh publication after rollback consumed the current slot
    await expect(
      rollbackPublication(env, { siteId: context.siteId, now: new Date(Date.now() + 8 * 24 * 60 * 60_000) })
    ).rejects.toMatchObject({ code: "ROLLBACK_WINDOW_EXPIRED" });
  });
});
