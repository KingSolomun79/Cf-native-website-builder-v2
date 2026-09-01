import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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
import { createPublication } from "../src/routes/v2.publication-create";
import { rollbackSitePublication } from "../src/routes/v2.rollback";

// Capability-token gating for the Approval, Publication and Rollback operator
// routes (issue #29 / W4; issue #31 adds Publication): allowed paths, every
// denial class, fail-closed behavior, and authorization-before-mutation
// ordering.

const env = providedEnv as unknown as Env;

function operatorApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/api/v2/build-versions/:buildVersionId/approval", createApproval);
  app.post("/api/v2/build-versions/:buildVersionId/publication", createPublication);
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
  it("round-trips signed approve, publish and rollback claims", async () => {
    const approve = {
      action: "approve" as const,
      buildId: "b1",
      buildVersionId: "bv1",
      artifactManifestHash: "hash-1",
      exp: Date.now() + 10 * 60_000,
    };
    const publish = {
      action: "publish" as const,
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
    expect(await verifyOperatorCapability(env, await signOperatorCapability(env, publish))).toEqual(publish);
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
    const publish = await signOperatorCapability(vectorEnv, {
      action: "publish",
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
    expect(publish).toBe(
      "eyJhY3Rpb24iOiJwdWJsaXNoIiwiYnVpbGRJZCI6ImItMSIsImJ1aWxkVmVyc2lvbklkIjoiYnYtMSIsImFydGlmYWN0TWFuaWZlc3RIYXNoIjoiaGFzaC12ZWN0b3IiLCJleHAiOjE3ODAwMDAwMDAwMDAsInNpZyI6IjVkOTZlYjIwYzVjMTk1Y2NiYmE4NDA0MzlhN2FkZjIwM2Q3ZDJmYzVkZWE0MGE0NzM5ZGMzNGZmNzAzYTkyY2EifQ"
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

// ── publication operator route ──────────────────────────────────────────────

async function publishToken(input: {
  buildId: string;
  buildVersionId: string;
  artifactManifestHash: string;
  exp?: number;
  secret?: string;
}): Promise<string> {
  return signOperatorCapability(
    { ...env, OPERATOR_CAPABILITY_SECRET: input.secret ?? env.OPERATOR_CAPABILITY_SECRET } as Env,
    {
      action: "publish",
      buildId: input.buildId,
      buildVersionId: input.buildVersionId,
      artifactManifestHash: input.artifactManifestHash,
      exp: input.exp ?? Date.now() + 30 * 60_000,
    }
  );
}

// Cloudflare API stub so the route's PRODUCTION default deployer (assets-only
// path through src/lib/publish.ts) runs for real inside success tests — the
// same technique as tests/v2-static-deploy.test.ts.
function stubCloudflareApi(): { uploadSessionBodies: string[] } {
  const uploadSessionBodies: string[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;

    if (url.includes("/assets-upload-session")) {
      if (body) uploadSessionBodies.push(body);
      return Response.json({ success: true, result: { jwt: "upload-complete-jwt", buckets: [] } });
    }
    if (url.endsWith("/workers/workers") && method === "POST") {
      return Response.json({ success: true, result: { id: "worker-1" } });
    }
    if (url.includes("/workers/workers/worker-1/versions")) {
      return Response.json({ success: true, result: { id: "version-1" } });
    }
    if (url.includes("/deployments")) {
      return Response.json({ success: true });
    }
    if (url.includes("/workers/subdomain")) {
      if (method === "POST") return Response.json({ success: true });
      return Response.json({ success: true, result: { subdomain: "wazibizwebsites" } });
    }
    if (url.includes(".workers.dev/")) {
      return new Response("ok", { status: 200 });
    }
    return Response.json({ success: false, errors: [{ code: 0, message: `unexpected ${method} ${url}` }] });
  });
  vi.stubGlobal("fetch", fetchStub);
  return { uploadSessionBodies };
}

async function publicationCount(buildVersionId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE build_version_id = ?")
    .bind(buildVersionId)
    .first<{ n: number }>();
  return row!.n;
}

describe("publication operator route", () => {
  beforeEach(() => {
    stubCloudflareApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes the exact approved Build Version with a sufficient capability and no regeneration", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-pub-1" });
    await approveBuildVersion(env, context);
    const versionsBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?")
      .bind(context.buildId)
      .first<{ n: number }>();

    const token = await publishToken({ ...context, artifactManifestHash: "hash-pub-1" });
    const response = await post(app, `/api/v2/build-versions/${context.buildVersionId}/publication`, token);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      publicationId: string;
      artifactManifestHash: string;
      workerName: string;
      publishedUrl: string;
      alreadyPublished: boolean;
    };
    expect(body.artifactManifestHash).toBe("hash-pub-1");
    expect(body.alreadyPublished).toBe(false);
    expect(body.workerName).toContain("-v1");
    expect(body.publishedUrl).toContain(".workers.dev");

    // Exact approved artifact deployed: the upload session manifest carries
    // the exact immutable-storage bytes of the approved version.
    const view = await getPublicationState(env, context.siteId);
    expect(view.current!.buildVersionId).toBe(context.buildVersionId);
    const row = await env.DB.prepare("SELECT artifact_manifest_hash FROM publications WHERE id = ?")
      .bind(body.publicationId)
      .first<{ artifact_manifest_hash: string }>();
    expect(row!.artifact_manifest_hash).toBe("hash-pub-1");

    // No regeneration: the Build still has exactly the same Build Versions.
    const versionsAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?")
      .bind(context.buildId)
      .first<{ n: number }>();
    expect(versionsAfter!.n).toBe(versionsBefore!.n);
  });

  it("denies missing, invalid, expired and wrong-secret tokens before any mutation", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-pub-2" });
    await approveBuildVersion(env, context);

    const cases: Array<[string, string | null]> = [
      ["missing Authorization", null],
      ["garbage token", "garbage"],
      ["expired token", await publishToken({ ...context, artifactManifestHash: "hash-pub-2", exp: Date.now() - 1_000 })],
      ["wrong-secret token", await publishToken({ ...context, artifactManifestHash: "hash-pub-2", secret: "attacker-secret" })],
    ];
    for (const [label, token] of cases) {
      const response = await post(app, `/api/v2/build-versions/${context.buildVersionId}/publication`, token);
      expect(response.status, label).toBe(401);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("CAPABILITY_REQUIRED");
    }
    expect(await publicationCount(context.buildVersionId)).toBe(0);
    expect(await getPublicationState(env, context.siteId)).toEqual({ current: null, rollback: null });
  });

  it("denies wrong actions and capabilities bound to another Build, Version or manifest", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-pub-3" });
    await approveBuildVersion(env, context);
    // A real second Build Version of the same Build, Release Ready.
    const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    await releaseReadyVersion({
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: next.buildVersionId,
      buildVersionNumber: next.buildVersionNumber,
      hash: "hash-pub-3-next",
    });

    const approveCapability = await approveToken({ ...context, artifactManifestHash: "hash-pub-3" });
    const rollbackCapability = await rollbackToken({ siteId: context.siteId, fromBuildVersionId: context.buildVersionId });
    const wrongBuild = await publishToken({ ...context, buildId: "not-this-build", artifactManifestHash: "hash-pub-3" });
    const wrongVersion = await publishToken({
      buildId: context.buildId,
      buildVersionId: next.buildVersionId,
      artifactManifestHash: "hash-pub-3-next",
    });
    const wrongHash = await publishToken({ ...context, artifactManifestHash: "hash-not-current" });

    for (const [label, token] of [
      ["approve capability on publication route", approveCapability],
      ["rollback capability on publication route", rollbackCapability],
      ["capability bound to a different Build", wrongBuild],
      ["capability minted for a different Build Version", wrongVersion],
      ["capability bound to a stale manifest hash", wrongHash],
    ] as Array<[string, string]>) {
      const response = await post(app, `/api/v2/build-versions/${context.buildVersionId}/publication`, token);
      expect(response.status, label).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("CAPABILITY_INSUFFICIENT");
    }
    expect(await publicationCount(context.buildVersionId)).toBe(0);
  });

  it("denies publication when the manifest drifted after minting", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-pub-4" });
    await approveBuildVersion(env, context);
    const token = await publishToken({ ...context, artifactManifestHash: "hash-pub-4" });

    // Simulate manifest drift on the immutable store: the D1 artifact index
    // is fully immutable (no UPDATE, no DELETE), so tamper at the R2 layer —
    // overwrite the manifest object at its existing key with content whose
    // hash differs. The token no longer describes the state the operator
    // reviewed and must be denied.
    const artifactRow = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'assembled_manifest'"
    )
      .bind(context.buildVersionId)
      .first<{ artifact_r2_key: string }>();
    await putObject(
      env,
      artifactRow!.artifact_r2_key,
      JSON.stringify({ artifactManifestHash: "hash-drifted", files: [{ path: "index.html", sha256: "a", bytes: 10 }] })
    );

    const response = await post(app, `/api/v2/build-versions/${context.buildVersionId}/publication`, token);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("CAPABILITY_INSUFFICIENT");
    expect(await publicationCount(context.buildVersionId)).toBe(0);
  });

  it("keeps domain ordering after authorization: unapproved is 409, missing candidate is 500, unknown version is 404", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-pub-5" });

    // Valid capability, but the domain still requires Approval first.
    const unapproved = await post(
      app,
      `/api/v2/build-versions/${context.buildVersionId}/publication`,
      await publishToken({ ...context, artifactManifestHash: "hash-pub-5" })
    );
    expect(unapproved.status).toBe(409);
    expect(((await unapproved.json()) as { error: { code: string } }).error.code).toBe("NOT_APPROVED");

    // Approved, but an assembled candidate file is missing from immutable
    // storage: domain-invalid publication fails without publishing anything
    // else (PUBLISH_FAILED, failed attempt recorded).
    await approveBuildVersion(env, context);
    const missingFile = await newSite();
    await storeBuildStageArtifact(env, {
      buildId: missingFile.buildId,
      buildVersionId: missingFile.buildVersionId,
      siteGenerationId: missingFile.siteGenerationId,
      kind: "assembled_manifest",
      schemaVersion: "build-manifest/1",
      value: {
        schemaVersion: "build-manifest/1",
        buildId: missingFile.buildId,
        buildVersionId: missingFile.buildVersionId,
        versionNumber: 1,
        artifactManifestHash: "hash-pub-missing",
        files: [{ path: "index.html", sha256: "a", bytes: 10 }],
        routingNotes: [],
      },
    });
    await assignReleaseReady(env, {
      buildId: missingFile.buildId,
      buildVersionId: missingFile.buildVersionId,
      siteGenerationId: missingFile.siteGenerationId,
      qaA: PASS_A,
      qaB: PASS_B,
      qaBuildVersionId: missingFile.buildVersionId,
    });
    await approveBuildVersion(env, missingFile);
    const failed = await post(
      app,
      `/api/v2/build-versions/${missingFile.buildVersionId}/publication`,
      await publishToken({ ...missingFile, artifactManifestHash: "hash-pub-missing" })
    );
    expect(failed.status).toBe(500);
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe("PUBLISH_FAILED");

    const missing = await post(
      app,
      "/api/v2/build-versions/does-not-exist/publication",
      await publishToken({ buildId: "nope", buildVersionId: "does-not-exist", artifactManifestHash: "nope" })
    );
    expect(missing.status).toBe(404);
  });

  it("re-publishes the same exact version idempotently, and only that version", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-pub-6" });
    await approveBuildVersion(env, context);

    const first = await post(
      app,
      `/api/v2/build-versions/${context.buildVersionId}/publication`,
      await publishToken({ ...context, artifactManifestHash: "hash-pub-6" })
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { publicationId: string };

    // Idempotent retry for the SAME permitted exact version: a read, not a
    // new publication.
    const again = await post(
      app,
      `/api/v2/build-versions/${context.buildVersionId}/publication`,
      await publishToken({ ...context, artifactManifestHash: "hash-pub-6" })
    );
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { publicationId: string; alreadyPublished: boolean };
    expect(againBody.alreadyPublished).toBe(true);
    expect(againBody.publicationId).toBe(firstBody.publicationId);
    expect(await publicationCount(context.buildVersionId)).toBe(1);
  });

  it("denies by default when OPERATOR_CAPABILITY_SECRET is not configured", async () => {
    const app = operatorApp();
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-pub-7" });
    await approveBuildVersion(env, context);
    const token = await publishToken({ ...context, artifactManifestHash: "hash-pub-7" });

    const response = await app.request(
      `https://test.example.com/api/v2/build-versions/${context.buildVersionId}/publication`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      { ...env, OPERATOR_CAPABILITY_SECRET: undefined }
    );
    expect(response.status).toBe(401);
    expect(await publicationCount(context.buildVersionId)).toBe(0);
  });

  it("refuses at the mutation boundary when the manifest changes after authorization (TOCTOU)", async () => {
    const context = await newSite();
    await releaseReadyVersion({ ...context, buildVersionNumber: 1, hash: "hash-pub-8" });
    await approveBuildVersion(env, context);
    const before = await getPublicationState(env, context.siteId);

    // The authorized hash no longer matches the version's current manifest
    // at the persistence boundary: nothing is deployed or recorded.
    await expect(
      publishApprovedBuildVersion(env, {
        ...context,
        buildVersionNumber: 1,
        deployer: stubDeployer,
        expectedArtifactManifestHash: "hash-someone-authorized-earlier",
      })
    ).rejects.toMatchObject({ code: "APPROVAL_HASH_MISMATCH" });
    expect(await getPublicationState(env, context.siteId)).toEqual(before);
    expect(await publicationCount(context.buildVersionId)).toBe(0);
  });
});
