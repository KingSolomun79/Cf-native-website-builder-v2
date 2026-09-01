import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild, createNextBuildVersion } from "../src/domain/lifecycle";
import { storeBuildStageArtifact } from "../src/domain/stage-artifacts";
import { buildVersionSourceKey } from "../src/domain/artifact-keys";
import { assignReleaseReady } from "../src/domain/release";
import { QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS, type QaAReport, type QaBReport } from "../src/domain/qa-stages";
import {
  approveBuildVersion,
  publishApprovedBuildVersion,
  rollbackPublication,
  getPublicationState,
  type PublicationDeployer,
} from "../src/domain/publication";
import { putObject } from "../src/lib/assets";
import {
  signOperatorCapability,
  verifyOperatorCapability,
  OPERATOR_CAPABILITY_MAX_TTL_MS,
} from "../src/lib/operator-capability";
import { createApproval } from "../src/routes/v2.approval-create";
import { rollbackSitePublication } from "../src/routes/v2.rollback";

// Capability-token gating for the Approval and Rollback operator routes
// (issue #29 / W4): allowed paths, every denial class, fail-closed behavior,
// and authorization-before-mutation ordering.

const env = providedEnv as unknown as Env;

function operatorApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/api/v2/build-versions/:buildVersionId/approval", createApproval);
  app.post("/api/v2/sites/:siteId/rollback", rollbackSitePublication);
  return app;
}

async function post(app: Hono<{ Bindings: Env }>, path: string, token: string | null, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(
    `https://test.example.com${path}`,
    { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) },
    env
  );
}

// ── shared lifecycle fixtures (mirrors tests/v2-publication.test.ts) ────────

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
      files: [{ path: "index.html", sha256: "a", bytes: 10 }],
      routingNotes: [],
    },
  });
  await putObject(env, buildVersionSourceKey(options.buildId, options.buildVersionNumber, "index.html"), "<!DOCTYPE html>");
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
      facts: { businessName: "Capability Roasters", contactEmail: "hi@cap.example" },
      reference: { screenshotR2Key: `references/uploads/cap-${Math.random().toString(36).slice(2)}.png` },
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

const stubDeployer: PublicationDeployer = async () => ({ publishedUrl: "https://live.example/" });

async function approveToken(input: {
  buildId: string;
  buildVersionId: string;
  artifactManifestHash: string;
  exp?: number;
  secret?: string;
}): Promise<string> {
  return signOperatorCapability(
    { ...env, OPERATOR_CAPABILITY_SECRET: input.secret ?? env.OPERATOR_CAPABILITY_SECRET } as Env,
    {
      action: "approve",
      buildId: input.buildId,
      buildVersionId: input.buildVersionId,
      artifactManifestHash: input.artifactManifestHash,
      exp: input.exp ?? Date.now() + 30 * 60_000,
    }
  );
}

async function rollbackToken(input: {
  siteId: string;
  fromBuildVersionId: string;
  exp?: number;
  secret?: string;
}): Promise<string> {
  return signOperatorCapability(
    { ...env, OPERATOR_CAPABILITY_SECRET: input.secret ?? env.OPERATOR_CAPABILITY_SECRET } as Env,
    {
      action: "rollback",
      siteId: input.siteId,
      fromBuildVersionId: input.fromBuildVersionId,
      exp: input.exp ?? Date.now() + 30 * 60_000,
    }
  );
}

async function approvalCount(buildVersionId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_approvals WHERE build_version_id = ?")
    .bind(buildVersionId)
    .first<{ n: number }>();
  return row!.n;
}

async function stateOf(buildId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT state FROM builds WHERE id = ?").bind(buildId).first<{ state: string }>();
  return row?.state ?? null;
}

// ── token library ───────────────────────────────────────────────────────────

describe("operator capability tokens", () => {
  it("round-trips signed approve and rollback claims", async () => {
    const approve = {
      action: "approve" as const,
      buildId: "b1",
      buildVersionId: "bv1",
      artifactManifestHash: "hash-1",
      exp: Date.now() + 10 * 60_000,
    };
    const rollback = {
      action: "rollback" as const,
      siteId: "s1",
      fromBuildVersionId: "bv2",
      exp: Date.now() + 10 * 60_000,
    };
    expect(await verifyOperatorCapability(env, await signOperatorCapability(env, approve))).toEqual(approve);
    expect(await verifyOperatorCapability(env, await signOperatorCapability(env, rollback))).toEqual(rollback);
  });

  it("matches the pinned known-answer vectors (agreement with the offline mint script)", async () => {
    const vectorEnv = { ...env, OPERATOR_CAPABILITY_SECRET: "vector-secret" } as Env;
    const approve = await signOperatorCapability(vectorEnv, {
      action: "approve",
      buildId: "b-1",
      buildVersionId: "bv-1",
      artifactManifestHash: "hash-vector",
      exp: 1780000000000,
    });
    const rollback = await signOperatorCapability(vectorEnv, {
      action: "rollback",
      siteId: "site-1",
      fromBuildVersionId: "bv-9",
      exp: 1780000060000,
    });
    // Precomputed with node:crypto in scripts/mint-operator-capability.mjs's
    // canonical form; pins byte-level agreement between the two signers.
    expect(approve).toBe(
      "eyJhY3Rpb24iOiJhcHByb3ZlIiwiYnVpbGRJZCI6ImItMSIsImJ1aWxkVmVyc2lvbklkIjoiYnYtMSIsImFydGlmYWN0TWFuaWZlc3RIYXNoIjoiaGFzaC12ZWN0b3IiLCJleHAiOjE3ODAwMDAwMDAwMDAsInNpZyI6IjYxOGExY2JkYzM5YmE4OWQxZmJkY2I4ZDZiYjA1MzY0MWE3Y2NkNmE5OWM5MTBmMjk0MzFkYmU3MWI3NzlmZTEifQ"
    );
    expect(rollback).toBe(
      "eyJhY3Rpb24iOiJyb2xsYmFjayIsInNpdGVJZCI6InNpdGUtMSIsImZyb21CdWlsZFZlcnNpb25JZCI6ImJ2LTkiLCJleHAiOjE3ODAwMDAwNjAwMDAsInNpZyI6Ijc5ODA0YmFhNzNmZDZmZTRlNTZhNzkwZDM5M2RiOTVlZWViZmYwMWMzZDYyMWM0NzQ4ZWRjYmEzMjgwNWZhNWUifQ"
    );
  });

  it("rejects wrong-secret signatures, tampered claims and malformed input", async () => {
    const claims = {
      action: "approve" as const,
      buildId: "b1",
      buildVersionId: "bv1",
      artifactManifestHash: "hash-1",
      exp: Date.now() + 10 * 60_000,
    };
    const signedByOtherSecret = await signOperatorCapability(
      { ...env, OPERATOR_CAPABILITY_SECRET: "attacker-secret" } as Env,
      claims
    );
    expect(await verifyOperatorCapability(env, signedByOtherSecret)).toBeNull();

    // Tamper: re-encode the payload with a swapped binding but the original sig.
    const tampered = JSON.parse(atob(signedByOtherSecret.replace(/-/g, "+").replace(/_/g, "/")));
    const token = btoa(JSON.stringify({ ...tampered, buildVersionId: "bv2" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyOperatorCapability({ ...env, OPERATOR_CAPABILITY_SECRET: "attacker-secret" } as Env, token)).toBeNull();

    expect(await verifyOperatorCapability(env, "not-a-token")).toBeNull();
    expect(await verifyOperatorCapability(env, "")).toBeNull();
    expect(await verifyOperatorCapability(env, null)).toBeNull();
    expect(await verifyOperatorCapability(env, btoa("[]"))).toBeNull();
  });

  it("rejects expired and beyond-ceiling expiry", async () => {
    const base = { action: "approve" as const, buildId: "b1", buildVersionId: "bv1", artifactManifestHash: "hash-1" };
    const now = Date.now();
    const expired = await signOperatorCapability(env, { ...base, exp: now - 1_000 });
    expect(await verifyOperatorCapability(env, expired, now)).toBeNull();

    const tooFar = await signOperatorCapability(env, { ...base, exp: now + OPERATOR_CAPABILITY_MAX_TTL_MS + 1 });
    expect(await verifyOperatorCapability(env, tooFar, now)).toBeNull();

    const atCeiling = await signOperatorCapability(env, { ...base, exp: now + OPERATOR_CAPABILITY_MAX_TTL_MS });
    expect(await verifyOperatorCapability(env, atCeiling, now)).not.toBeNull();
  });

  it("rejects bound values that could smuggle the canonical delimiter, and fails closed without a secret", async () => {
    const injection = await signOperatorCapability(env, {
      action: "approve",
      buildId: "b1:x",
      buildVersionId: "bv1",
      artifactManifestHash: "hash-1",
      exp: Date.now() + 60_000,
    });
    expect(await verifyOperatorCapability(env, injection)).toBeNull();

    const noSecretEnv = { ...env, OPERATOR_CAPABILITY_SECRET: undefined } as Env;
    const valid = await signOperatorCapability(env, {
      action: "approve",
      buildId: "b1",
      buildVersionId: "bv1",
      artifactManifestHash: "hash-1",
      exp: Date.now() + 60_000,
    });
    expect(await verifyOperatorCapability(noSecretEnv, valid)).toBeNull();
    await expect(
      signOperatorCapability(noSecretEnv, {
        action: "approve",
        buildId: "b1",
        buildVersionId: "bv1",
        artifactManifestHash: "hash-1",
        exp: Date.now() + 60_000,
      })
    ).rejects.toThrow("OPERATOR_CAPABILITY_SECRET");
  });
});

// ── approval operator route ─────────────────────────────────────────────────

describe("approval operator route", () => {
  it("approves the exact bound Build Version with a sufficient capability", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-cap-1" });

    const token = await approveToken({ ...context, artifactManifestHash: "hash-cap-1" });
    const response = await post(app, `/api/v2/build-versions/${context.buildVersionId}/approval`, token, {
      approvedBy: "jo",
      approvalNote: "looks right",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { approvalId: string; buildVersionId: string; artifactManifestHash: string };
    expect(body.buildVersionId).toBe(context.buildVersionId);
    expect(body.artifactManifestHash).toBe("hash-cap-1");
    expect(await approvalCount(context.buildVersionId)).toBe(1);
    expect(await stateOf(context.buildId)).toBe("APPROVED");
  });

  it("denies missing, invalid, expired and wrong-secret tokens before any mutation", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-cap-2" });

    const cases: Array<[string, string | null]> = [
      ["missing Authorization", null],
      ["garbage token", "garbage"],
      ["expired token", await approveToken({ ...context, artifactManifestHash: "hash-cap-2", exp: Date.now() - 1_000 })],
      ["wrong-secret token", await approveToken({ ...context, artifactManifestHash: "hash-cap-2", secret: "attacker-secret" })],
    ];
    for (const [label, token] of cases) {
      const response = await post(app, `/api/v2/build-versions/${context.buildVersionId}/approval`, token);
      expect(response.status, label).toBe(401);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("CAPABILITY_REQUIRED");
    }
    expect(await approvalCount(context.buildVersionId)).toBe(0);
    expect(await stateOf(context.buildId)).not.toBe("APPROVED");
  });

  it("denies a wrong action and capabilities bound to another version or manifest", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-cap-3" });
    const other = await newSite();
    await releaseReadyVersion({ ...other, buildVersionNumber: 1, hash: "hash-cap-other" });

    const wrongAction = await rollbackToken({ siteId: context.siteId, fromBuildVersionId: context.buildVersionId });
    const otherVersion = await approveToken({ ...other, artifactManifestHash: "hash-cap-other" });
    const wrongHash = await approveToken({ ...context, artifactManifestHash: "hash-not-current" });

    for (const [label, token] of [
      ["rollback capability on approval route", wrongAction],
      ["capability minted for a different Build Version", otherVersion],
      ["capability bound to a stale manifest hash", wrongHash],
    ] as Array<[string, string]>) {
      const response = await post(app, `/api/v2/build-versions/${context.buildVersionId}/approval`, token);
      expect(response.status, label).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("CAPABILITY_INSUFFICIENT");
    }
    expect(await approvalCount(context.buildVersionId)).toBe(0);
  });

  it("keeps domain ordering after authorization: not Release Ready is 409, unknown version is 404", async () => {
    const app = operatorApp();
    const context = await newSite();
    // No release-ready record yet; a capability cannot bind a real hash yet,
    // so authorize via a token bound to the (absent) manifest -> 403 remains
    // the default until Release Ready exists.
    const unauthorized = await post(
      app,
      `/api/v2/build-versions/${context.buildVersionId}/approval`,
      await approveToken({ ...context, artifactManifestHash: "no-manifest" })
    );
    expect(unauthorized.status).toBe(403);

    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-cap-4" });
    await approveBuildVersion(env, context); // domain seam: make it already approved
    const again = await post(
      app,
      `/api/v2/build-versions/${context.buildVersionId}/approval`,
      await approveToken({ ...context, artifactManifestHash: "hash-cap-4" })
    );
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("ALREADY_APPROVED");
    expect(await approvalCount(context.buildVersionId)).toBe(1);

    const missing = await post(
      app,
      "/api/v2/build-versions/does-not-exist/approval",
      await approveToken({ buildId: "nope", buildVersionId: "does-not-exist", artifactManifestHash: "nope" })
    );
    expect(missing.status).toBe(404);
  });

  it("denies by default when OPERATOR_CAPABILITY_SECRET is not configured", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-cap-5" });
    const token = await approveToken({ ...context, artifactManifestHash: "hash-cap-5" });

    const response = await app.request(
      `https://test.example.com/api/v2/build-versions/${context.buildVersionId}/approval`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      { ...env, OPERATOR_CAPABILITY_SECRET: undefined }
    );
    expect(response.status).toBe(401);
    expect(await approvalCount(context.buildVersionId)).toBe(0);
  });
});

// ── rollback operator route ─────────────────────────────────────────────────

async function publishedTwice(): Promise<{
  siteId: string;
  v1: { buildId: string; buildVersionId: string };
  v2: { buildId: string; buildVersionId: string };
}> {
  const context = await newSite();
  await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-rb-1" });
  await approveBuildVersion(env, context);
  await publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: stubDeployer });

  const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
  await releaseReadyVersion({
    siteGenerationId: context.siteGenerationId,
    buildId: context.buildId,
    buildVersionId: next.buildVersionId,
    buildVersionNumber: next.buildVersionNumber,
    hash: "hash-rb-2",
  });
  await approveBuildVersion(env, { buildId: context.buildId, buildVersionId: next.buildVersionId });
  await publishApprovedBuildVersion(env, {
    siteId: context.siteId,
    buildId: context.buildId,
    buildVersionId: next.buildVersionId,
    buildVersionNumber: next.buildVersionNumber,
    deployer: stubDeployer,
  });
  return {
    siteId: context.siteId,
    v1: { buildId: context.buildId, buildVersionId: context.buildVersionId },
    v2: { buildId: context.buildId, buildVersionId: next.buildVersionId },
  };
}

describe("rollback operator route", () => {
  it("rolls back to the retained version with a capability bound to the current published state", async () => {
    const app = operatorApp();
    const site = await publishedTwice();

    const token = await rollbackToken({ siteId: site.siteId, fromBuildVersionId: site.v2.buildVersionId });
    const response = await post(app, `/api/v2/sites/${site.siteId}/rollback`, token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { restoredBuildVersionId: string };
    expect(body.restoredBuildVersionId).toBe(site.v1.buildVersionId);

    const view = await getPublicationState(env, site.siteId);
    expect(view.current!.buildVersionId).toBe(site.v1.buildVersionId);
    expect(view.rollback).toBeNull();
  });

  it("denies missing and invalid tokens without touching published state", async () => {
    const app = operatorApp();
    const site = await publishedTwice();
    const before = await getPublicationState(env, site.siteId);

    const cases: Array<[string, string | null]> = [
      ["missing Authorization", null],
      ["garbage token", "garbage"],
      ["expired token", await rollbackToken({ siteId: site.siteId, fromBuildVersionId: site.v2.buildVersionId, exp: Date.now() - 1_000 })],
      ["wrong-secret token", await rollbackToken({ siteId: site.siteId, fromBuildVersionId: site.v2.buildVersionId, secret: "attacker-secret" })],
    ];
    for (const [label, token] of cases) {
      const response = await post(app, `/api/v2/sites/${site.siteId}/rollback`, token);
      expect(response.status, label).toBe(401);
    }
    expect(await getPublicationState(env, site.siteId)).toEqual(before);
  });

  it("denies stale, misbound and wrong-action capabilities without touching published state", async () => {
    const app = operatorApp();
    const site = await publishedTwice();
    const before = await getPublicationState(env, site.siteId);

    const stale = await rollbackToken({ siteId: site.siteId, fromBuildVersionId: site.v1.buildVersionId });
    const wrongSite = await rollbackToken({ siteId: "00000000-0000-0000-0000-000000000000", fromBuildVersionId: site.v2.buildVersionId });
    const wrongAction = await approveToken({
      buildId: site.v2.buildId,
      buildVersionId: site.v2.buildVersionId,
      artifactManifestHash: "hash-rb-2",
    });

    for (const [label, token] of [
      ["stale capability bound to the pre-publication current version", stale],
      ["capability bound to a different Site", wrongSite],
      ["approve capability on rollback route", wrongAction],
    ] as Array<[string, string]>) {
      const response = await post(app, `/api/v2/sites/${site.siteId}/rollback`, token);
      expect(response.status, label).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("CAPABILITY_INSUFFICIENT");
    }
    expect(await getPublicationState(env, site.siteId)).toEqual(before);
  });

  it("keeps domain ordering after authorization: expired window is 409 and state is untouched", async () => {
    const app = operatorApp();
    const site = await publishedTwice();
    await env.DB.prepare("UPDATE site_published_state SET rollback_expires_at = ? WHERE site_id = ?")
      .bind(new Date(Date.now() - 60_000).toISOString(), site.siteId)
      .run();

    const token = await rollbackToken({ siteId: site.siteId, fromBuildVersionId: site.v2.buildVersionId });
    const response = await post(app, `/api/v2/sites/${site.siteId}/rollback`, token);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("ROLLBACK_WINDOW_EXPIRED");

    const view = await getPublicationState(env, site.siteId);
    expect(view.current!.buildVersionId).toBe(site.v2.buildVersionId);
    expect(view.rollback!.buildVersionId).toBe(site.v1.buildVersionId);
  });

  it("denies by default when OPERATOR_CAPABILITY_SECRET is not configured", async () => {
    const app = operatorApp();
    const site = await publishedTwice();
    const before = await getPublicationState(env, site.siteId);
    const token = await rollbackToken({ siteId: site.siteId, fromBuildVersionId: site.v2.buildVersionId });

    const response = await app.request(
      `https://test.example.com/api/v2/sites/${site.siteId}/rollback`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      { ...env, OPERATOR_CAPABILITY_SECRET: undefined }
    );
    expect(response.status).toBe(401);
    expect(await getPublicationState(env, site.siteId)).toEqual(before);
  });

  it("refuses the state flip when published state changes between authorization and mutation", async () => {
    const site = await publishedTwice();
    const before = await getPublicationState(env, site.siteId);

    // A publish landing after authorization: current is no longer the
    // version the capability was bound to, so the conditional update
    // matches zero rows and rollback is refused without side effects.
    await expect(
      rollbackPublication(env, { siteId: site.siteId, expectedCurrentBuildVersionId: "not-current-anymore" })
    ).rejects.toMatchObject({ code: "NO_ROLLBACK_VERSION" });
    expect(await getPublicationState(env, site.siteId)).toEqual(before);
  });
});
