import { describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  runStageSingleFlight,
  deriveStageExecutionFingerprint,
  deriveStageExecutionKey,
  StageExecutionInProgressError,
  StageExecutionCollisionError,
  STAGE_EXECUTION_LEASE_MS,
} from "../src/domain/stage-execution";
import { StageArtifactError } from "../src/domain/stage-artifacts";
import { toWorkflowStepError } from "../src/workflows/website-build-workflow";
import { NonRetryableError } from "cloudflare:workflows";

// Issue #54: single-flight execution claims for immutable provider-backed
// stages. Production (build 91764d47, 2026-09-06) showed two overlapping
// workflow attempts both calling the model for the same immutable slot and
// only colliding on the immutable store afterwards — after the duplicate
// provider spend had already happened. These tests prove the ownership claim
// prevents the second provider call under every interleaving the workflow
// engine can produce, and that terminal collisions never churn retries.

const env = providedEnv as unknown as Env;

type SlotArtifact = {
  value: { html: string };
  checksum: string;
  provenance?: { repairRequestFingerprint?: string } | null;
};

// One isolated claim slot per test: the execution key is derived from the
// build version, so a fresh version id per test isolates D1 claim rows.
let versionCounter = 0;

function makeSlot() {
  versionCounter += 1;
  const buildVersionId = `33333333-3334-4333-8333-${String(versionCounter).padStart(12, "0")}`;
  const slot = new Map<string, SlotArtifact>();
  const key = () => deriveStageExecutionKey(buildVersionId, "generated_page", "home");
  return { buildVersionId, slot, key };
}

async function sha256Of(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Deterministic fake of the immutable artifact slot: the callbacks mirror
// exactly what site-generator.ts wires (getBuildStageArtifact /
// storeBuildStageArtifact), minus build-row bookkeeping, so claim
// coordination runs against real D1 while artifact state stays observable.
function fakeStage(
  context: ReturnType<typeof makeSlot>,
  options: {
    run: () => Promise<{ html: string }>;
    store?: (html: string) => Promise<void>;
    verifyExisting?: (existing: SlotArtifact) => boolean;
    existingMismatchError?: () => Error;
    isTerminalProviderError?: (error: unknown) => boolean;
    leaseMs?: number;
  }
) {
  const state = { providerCalls: 0 };
  const invocation = () =>
    runStageSingleFlight<{ html: string }>(env, {
      buildId: "11111111-1111-4111-8111-111111111111",
      buildVersionId: context.buildVersionId,
      kind: "generated_page",
      subkey: "home",
      requestFingerprint: "f".repeat(64),
      loadExisting: async () => {
        const row = context.slot.get("home");
        if (!row) return null;
        return {
          artifactId: "artifact",
          kind: "generated_page",
          subkey: "home",
          schemaVersion: "test/1",
          artifactR2Key: `test/${row.checksum}`,
          checksum: row.checksum,
          provenance: (row.provenance ?? null) as never,
          createdAt: "2026-09-06T00:00:00.000Z",
          value: row.value,
        };
      },
      verifyExisting: (existing) => options.verifyExisting?.(existing as never) ?? true,
      existingMismatchError: options.existingMismatchError,
      run: async () => {
        state.providerCalls += 1;
        return { value: await options.run(), provenance: null };
      },
      store: async (produced) => {
        const checksum = await sha256Of(produced.value.html);
        await options.store?.(produced.value.html);
        context.slot.set("home", { value: { html: produced.value.html }, checksum });
        return { artifactR2Key: `test/${checksum}`, checksum };
      },
      isTerminalProviderError: options.isTerminalProviderError,
      leaseMs: options.leaseMs,
    });
  return { invocation, state };
}

async function claimRow(key: Promise<string>) {
  return env.DB.prepare("SELECT * FROM stage_execution_claims WHERE execution_key = ?1")
    .bind(await key)
    .first<{ state: string; owner_token: string; lease_expires_at: string; artifact_checksum: string | null }>();
}

async function insertExpiredClaim(key: Promise<string>, state: string) {
  await env.DB.prepare(
    `INSERT INTO stage_execution_claims (
       execution_key, build_id, build_version_id, stage_kind, subkey,
       request_fingerprint, state, owner_token, lease_expires_at, created_at, updated_at
     ) VALUES (?1, 'test-build', 'test-version', 'generated_page', 'home', ?2, ?3, 'dead-owner', ?4, ?5, ?5)
     ON CONFLICT (execution_key) DO NOTHING`
  )
    .bind(await key, "f".repeat(64), state, new Date(Date.now() - 120_000).toISOString(), new Date().toISOString())
    .run();
}

describe("single-flight stage execution claims (issue #54)", () => {
  it("two concurrent executions of one deterministic request produce exactly ONE provider call", async () => {
    const context = makeSlot();
    let releaseOwner!: () => void;
    const ownerGate = new Promise<void>((resolve) => { releaseOwner = resolve; });
    let ownerEnteredProvider = false;
    const stage = fakeStage(context, {
      run: async () => {
        ownerEnteredProvider = true;
        await ownerGate;
        return { html: "<html>owner</html>" };
      },
    });

    const owner = stage.invocation();
    await vi.waitUntil(() => ownerEnteredProvider);

    // A second execution entering while the owner is mid-provider-call must
    // observe the fresh claim and NEVER enter the provider.
    const loser = await stage.invocation().then(() => null, (error) => error);
    expect(loser).toBeInstanceOf(StageExecutionInProgressError);
    expect((loser as StageExecutionInProgressError).ownerLeaseExpiresAt).toMatch(/Z$/);
    expect(stage.state.providerCalls).toBe(1);

    releaseOwner();
    const owned = await owner;
    expect(owned.reused).toBe(false);
    expect(owned.providerCalls).toBe(1);

    // The loser's retry after the engine backoff resolves from the frozen
    // artifact with zero additional provider calls.
    const retry = await stage.invocation();
    expect(retry.reused).toBe(true);
    expect(retry.providerCalls).toBe(0);
    expect(retry.value.html).toBe(owned.value.html);
    expect(stage.state.providerCalls).toBe(1);

    const claim = await claimRow(context.key());
    expect(claim?.state).toBe("COMPLETED");
    expect(claim?.artifact_checksum).toBe(owned.checksum);
  });

  it("a COMPLETED claim serves the frozen artifact with zero provider calls", async () => {
    const context = makeSlot();
    const checksum = await sha256Of("<html>frozen</html>");
    context.slot.set("home", { value: { html: "<html>frozen</html>" }, checksum });
    await insertExpiredClaim(context.key(), "COMPLETED");

    const stage = fakeStage(context, { run: async () => { throw new Error("provider must not be called"); } });
    const result = await stage.invocation();
    expect(result.reused).toBe(true);
    expect(result.providerCalls).toBe(0);
    expect(result.value.html).toBe("<html>frozen</html>");
    expect(stage.state.providerCalls).toBe(0);
  });

  it("crash between artifact store and claim completion recovers the artifact with ZERO provider calls (issue #54 §10)", async () => {
    const context = makeSlot();
    const checksum = await sha256Of("<html>stored-then-crashed</html>");
    context.slot.set("home", { value: { html: "<html>stored-then-crashed</html>" }, checksum });
    // The dead owner's claim is still IN_PROGRESS with an expired lease.
    await insertExpiredClaim(context.key(), "IN_PROGRESS");

    const stage = fakeStage(context, { run: async () => { throw new Error("provider must not be called"); } });
    const result = await stage.invocation();
    expect(result.reused).toBe(true);
    expect(result.providerCalls).toBe(0);
    const claim = await claimRow(context.key());
    expect(claim?.state).toBe("COMPLETED");
  });

  it("an expired lease is taken over atomically by exactly one replacement owner (issue #54 §7)", async () => {
    const context = makeSlot();
    await insertExpiredClaim(context.key(), "IN_PROGRESS");

    const stage = fakeStage(context, { run: async () => ({ html: "<html>replacement</html>" }) });
    const result = await stage.invocation();
    expect(result.reused).toBe(false);
    expect(result.providerCalls).toBe(1);
    expect(stage.state.providerCalls).toBe(1);
    const claim = await claimRow(context.key());
    expect(claim?.state).toBe("COMPLETED");
    expect(claim?.owner_token).not.toBe("dead-owner");
  });

  it("two contenders for one expired claim yield ONE provider owner", async () => {
    const context = makeSlot();
    await insertExpiredClaim(context.key(), "IN_PROGRESS");

    let releaseOwner!: () => void;
    const ownerGate = new Promise<void>((resolve) => { releaseOwner = resolve; });
    let ownerEnteredProvider = false;
    const stage = fakeStage(context, {
      run: async () => {
        ownerEnteredProvider = true;
        await ownerGate;
        return { html: "<html>cascade-owner</html>" };
      },
    });

    // A takes over the expired claim (atomic CAS) and enters the provider;
    // B, adjudicating against A's fresh lease, must yield without calling.
    const a = stage.invocation();
    await vi.waitUntil(() => ownerEnteredProvider);
    const b = await stage.invocation().then(() => null, (error) => error);
    expect(b).toBeInstanceOf(StageExecutionInProgressError);
    expect(stage.state.providerCalls).toBe(1);

    releaseOwner();
    const owned = await a;
    expect(owned.providerCalls).toBe(1);
    expect(stage.state.providerCalls).toBe(1);
    expect((await claimRow(context.key()))?.state).toBe("COMPLETED");
  });

  it("a matching store collision adopts the existing artifact — provider called once, claim COMPLETED (issue #54 §11)", async () => {
    const context = makeSlot();
    const twinChecksum = await sha256Of("<html>uncoordinated-twin</html>");
    const stage = fakeStage(context, {
      run: async () => ({ html: "<html>uncoordinated-twin</html>" }),
      store: async () => {
        // An uncoordinated execution stored the artifact between this
        // owner's lookup and its store: the immutable boundary rejects the
        // double-write, and the identical request adopts what landed.
        context.slot.set("home", { value: { html: "<html>uncoordinated-twin</html>" }, checksum: twinChecksum });
        throw Object.assign(new Error("Artifact 'generated_page/home' already exists"), { code: "ARTIFACT_ALREADY_EXISTS" });
      },
    });

    const result = await stage.invocation();
    expect(result.reused).toBe(true);
    expect(result.providerCalls).toBe(1);
    expect(result.value.html).toBe("<html>uncoordinated-twin</html>");
    expect(stage.state.providerCalls).toBe(1);
    expect((await claimRow(context.key()))?.state).toBe("COMPLETED");
  });

  it("a mismatched store collision fails TERMINALLY and never re-calls the provider (issue #54 §11)", async () => {
    const context = makeSlot();
    const stage = fakeStage(context, {
      run: async () => ({ html: "<html>foreign-content</html>" }),
      store: async () => {
        context.slot.set("home", {
          value: { html: "<html>someone-elses-page</html>" },
          checksum: await sha256Of("<html>someone-elses-page</html>"),
        });
        throw Object.assign(new Error("Artifact 'generated_page/home' already exists"), { code: "ARTIFACT_ALREADY_EXISTS" });
      },
      verifyExisting: () => false,
    });

    const error = await stage.invocation().then(() => null, (e) => e);
    expect(error).toBeInstanceOf(StageExecutionCollisionError);
    expect(stage.state.providerCalls).toBe(1);
    expect((await claimRow(context.key()))?.state).toBe("FAILED_TERMINAL");

    // Retrying the same impossible request must not churn the provider.
    const second = await stage.invocation().then(() => null, (e) => e);
    expect(second).toBeInstanceOf(StageExecutionCollisionError);
    expect(stage.state.providerCalls).toBe(1);
  });

  it("a retryable provider failure releases ownership so a later attempt can claim (issue #54 §12)", async () => {
    const context = makeSlot();
    let attempts = 0;
    const stage = fakeStage(context, {
      run: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("simulated transient provider failure");
        return { html: "<html>second-attempt</html>" };
      },
    });

    await expect(stage.invocation()).rejects.toThrow("simulated transient provider failure");
    expect((await claimRow(context.key()))?.state).toBe("FAILED_RETRYABLE");

    const recovered = await stage.invocation();
    expect(recovered.reused).toBe(false);
    expect(recovered.providerCalls).toBe(1);
    expect(attempts).toBe(2);
    expect((await claimRow(context.key()))?.state).toBe("COMPLETED");
  });

  it("a terminal provider failure closes the claim — no retry churn for an impossible request (issue #54 §12)", async () => {
    const context = makeSlot();
    let attempts = 0;
    const stage = fakeStage(context, {
      run: async () => {
        attempts += 1;
        throw new Error("all configured vision providers exhausted");
      },
      isTerminalProviderError: (error) => (error as Error).message.includes("vision providers exhausted"),
    });

    await expect(stage.invocation()).rejects.toThrow("vision providers exhausted");
    expect((await claimRow(context.key()))?.state).toBe("FAILED_TERMINAL");

    const second = await stage.invocation().then(() => null, (e) => e);
    expect(second).toBeInstanceOf(StageExecutionCollisionError);
    expect(attempts).toBe(1);
  });

  it("a foreign repair artifact keeps its issue-#52 terminal mismatch semantics", async () => {
    const context = makeSlot();
    const checksum = await sha256Of("<html>foreign-repair</html>");
    context.slot.set("home", {
      value: { html: "<html>foreign-repair</html>" },
      checksum,
      provenance: { repairRequestFingerprint: "not-the-current-request" },
    });
    const stage = fakeStage(context, {
      run: async () => { throw new Error("provider must not be called"); },
      verifyExisting: (existing) => existing.provenance?.repairRequestFingerprint === "f".repeat(64),
      existingMismatchError: () =>
        new StageArtifactError(
          "REPAIR_ARTIFACT_MISMATCH",
          "REPAIR_ARTIFACT_MISMATCH: informed assembly repair artifact 'home' exists but its provenance does not match (issue #52)"
        ),
    });

    const error = await stage.invocation().then(() => null, (e) => e);
    expect(error).toBeInstanceOf(StageArtifactError);
    expect((error as StageArtifactError).code).toBe("REPAIR_ARTIFACT_MISMATCH");
    expect(stage.state.providerCalls).toBe(0);
  });

  it("terminal collisions map to NonRetryableError at the workflow boundary; transient yields stay retryable", () => {
    const collision = toWorkflowStepError(new StageExecutionCollisionError("mismatched content identity"));
    expect(collision).toBeInstanceOf(NonRetryableError);

    const mismatch = toWorkflowStepError(
      new StageArtifactError("REPAIR_ARTIFACT_MISMATCH", "provenance does not match (issue #52)")
    );
    expect(mismatch).toBeInstanceOf(NonRetryableError);

    // Transient single-flight yields and ordinary failures keep the step's
    // bounded retry policy.
    const inProgress = toWorkflowStepError(new StageExecutionInProgressError("key", "2026-01-01T00:00:00.000Z"));
    expect(inProgress).toBeInstanceOf(StageExecutionInProgressError);
    expect(inProgress).not.toBeInstanceOf(NonRetryableError);
    const ordinary = toWorkflowStepError(new Error("transient provider failure"));
    expect(ordinary).not.toBeInstanceOf(NonRetryableError);
  });

  it("derives stable, content-bound fingerprints and slot keys with no runtime noise", async () => {
    const base = {
      binding: "website-generator-run/1",
      buildId: "b",
      buildVersionId: "v",
      kind: "generated_page",
      subkey: "home",
      schemaVersion: "generated-source/page-home/1",
      userPromptSha256: "abc",
    };
    const first = await deriveStageExecutionFingerprint(base);
    expect(first).toBe(await deriveStageExecutionFingerprint(base));
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    const otherContent = await deriveStageExecutionFingerprint({ ...base, userPromptSha256: "xyz" });
    expect(otherContent).not.toBe(first);

    // Extra material participates; insertion order does not.
    const withExtraA = await deriveStageExecutionFingerprint({ ...base, extra: { repairFingerprint: "r1", note: "x" } });
    const withExtraB = await deriveStageExecutionFingerprint({ ...base, extra: { note: "x", repairFingerprint: "r1" } });
    expect(withExtraA).toBe(withExtraB);

    const context = makeSlot();
    expect(await context.key()).toBe(await context.key());
    const other = deriveStageExecutionKey("other-version", "generated_page", "home");
    expect(await other).not.toBe(await context.key());

    // Lease covers the longest legitimate owner path: two full provider
    // attempts at the gateway's 300s per-attempt bound, plus bounded
    // parse/validate/store overhead.
    expect(STAGE_EXECUTION_LEASE_MS).toBeGreaterThanOrEqual(2 * 300_000);
  });
});
