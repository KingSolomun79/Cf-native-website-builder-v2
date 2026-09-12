// V2 single-flight execution coordination for immutable provider-backed
// stages (issue #54).
//
// Workflow attempts may retry/re-enter around failures (resource exhaustion,
// provider timeouts, Durable Object evictions, engine restarts). Production
// evidence (build 91764d47, 2026-09-06) shows two overlapping executions of
// the same immutable stage: both observed "artifact absent", both called the
// model, and only the immutable store rejected the loser afterwards — after
// the expensive duplicate provider call had already been spent. This module is
// deliberately neutral about the precise isolate lifecycle that produced the
// overlap: effects of external/provider calls must be safe under ANY
// interleaving of attempts.
//
// Mechanism: every deterministic stage request carries an execution key
// (slot identity) and a request fingerprint (content identity). A small MUTABLE
// claim row is inserted atomically before the provider call; exactly one
// execution owns the call. Losers never call the provider — they either reuse
// the finished artifact (claim COMPLETED) or fail with a transient domain
// error the Workflow retry policy already understands. Immutable artifacts
// (build_stage_artifacts) stay the source of truth; the claim is operational
// coordination only.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { sha256Hex, type StageArtifactRecord } from "./stage-artifacts";

export type StageExecutionClaimState =
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED_RETRYABLE"
  | "FAILED_TERMINAL";

/** Transient: another attempt owns a fresh lease for this exact stage slot.
 *  Thrown to the Workflow step, whose retry policy re-enters the stage later —
 *  never a busy-loop inside one invocation.
 *
 *  Issue #64: the typed identity and the stable message prefix are a
 *  BEST-EFFORT OPTIMIZATION (lease-aware wake at lease-expiry + margin), not
 *  a safety requirement. The production runtime may rehydrate this error
 *  into a shape that defeats both (canary-proven 2026-09-07: 0/10
 *  recognitions). Correctness never depends on recognition: an unrecognized
 *  yield takes the ordinary transient fallback schedule, and the normative
 *  chain — atomic single-flight claim + immutable artifact reuse + bounded
 *  fallback retries + stale-claim takeover — still completes the stage. */
export class StageExecutionInProgressError extends Error {
  readonly code = "STAGE_EXECUTION_IN_PROGRESS" as const;
  constructor(
    readonly executionKey: string,
    readonly ownerLeaseExpiresAt: string
  ) {
    super(
      `STAGE_EXECUTION_IN_PROGRESS: another execution owns stage '${executionKey}' until ${ownerLeaseExpiresAt}; the provider call is single-flight (issue #54)`
    );
    this.name = "StageExecutionInProgressError";
  }
}

/** Terminal: state/provenance corruption or a collision that provably does not
 *  belong to this deterministic request. Must NOT burn workflow retries — the
 *  workflow boundary maps this to a NonRetryableError (issue #54 §11). */
export class StageExecutionCollisionError extends Error {
  readonly code = "STAGE_EXECUTION_TERMINAL_COLLISION" as const;
  constructor(message: string) {
    super(message);
    this.name = "StageExecutionCollisionError";
  }
}

// Lease sizing (issue #54 §8): the lease must outcover the longest legitimate
// owner path — one runSchemaValidatedAiStage section, which is at most TWO
// provider attempts (the boundary's one targeted structural repair). The Coding
// Plan transport aborts each attempt at SIMPLE_STREAM_MAX_DURATION_MS (default
// 600s) and the vision path is bounded by VISION_REQUEST_TIMEOUT_MS (≤120s), so
// the enclosing workflow step's own timeout bounds the real per-invocation
// floor; headroom keeps a live owner safe. The workflow step's explicit
// per-attempt timeout ("10 minutes") is deliberately SHORTER than the lease,
// so an attempt is always dead before its claim could be stolen while still
// running. A dead owner delays takeover until expiry; the workflow's retry
// schedule makes a stale claim takeover-eligible by retry 7 of 8
// (fallback-only timeline in website-build-workflow.ts, issue #64) — the
// lease-aware wait (stageInProgressRetryAfterMs) would make it exact, but is
// an opportunistic optimization the contract never requires.
export const STAGE_EXECUTION_LEASE_MS = 660_000;

/** Wake margin added to a lease expiry before a waiting contender re-enters:
 *  engine scheduling granularity plus bounded clock skew between the claim
 *  writer and the contender, so the takeover CAS never fires a fraction of a
 *  second before expiry. */
export const STAGE_EXECUTION_RETRY_MARGIN_MS = 15_000;

/** Retry-after milliseconds for the transient STAGE_EXECUTION_IN_PROGRESS
 *  yield: wake once past the live owner's lease expiry so stale takeover is
 *  reachable on the next Workflow attempt. Returns null for any other error.
 *
 *  Issue #64: OPPORTUNISTIC ONLY. Production (canary 2026-09-07) rehydrates
 *  thrown errors into shapes that defeat BOTH the instanceof branch and the
 *  message-prefix branch below, so the normative wake schedule is the
 *  repo-owned fallback — this function only shortens the wait when the
 *  runtime happens to preserve error identity. Recognition here must never
 *  be load-bearing for correctness or for any production GO decision. */
export function stageInProgressRetryAfterMs(error: unknown, now: number = Date.now()): number | null {
  let expiresAtMs: number | null = null;
  if (error instanceof StageExecutionInProgressError) {
    expiresAtMs = Date.parse(error.ownerLeaseExpiresAt);
  } else if (error instanceof Error && error.message.startsWith("STAGE_EXECUTION_IN_PROGRESS:")) {
    const match = / until ([^;\s]+)\s*;/.exec(error.message);
    if (match) expiresAtMs = Date.parse(match[1]);
  }
  if (expiresAtMs === null || Number.isNaN(expiresAtMs)) return null;
  // Clamp to the maximum legitimate horizon (a fresh full lease + margin): a
  // hostile or corrupt "until" timestamp can never stretch the wait beyond
  // one normal claim lifetime, and an expired lease never waits negatively.
  const wait = expiresAtMs + STAGE_EXECUTION_RETRY_MARGIN_MS - now;
  return Math.min(Math.max(wait, 0), STAGE_EXECUTION_LEASE_MS + STAGE_EXECUTION_RETRY_MARGIN_MS);
}

export interface StageExecutionFingerprintParts {
  binding: string;
  buildId: string;
  buildVersionId: string;
  kind: string;
  subkey: string;
  schemaVersion: string;
  promptId?: string;
  promptVersion?: string;
  model?: string;
  provider?: string;
  /** sha256 of the exact deterministic user prompt — the content identity of
   *  the request. Never includes timestamps, request ids or attempt numbers. */
  userPromptSha256?: string;
  /** Additional deterministic request material (e.g. a repair directive
   *  fingerprint). Keys are sorted before hashing. */
  extra?: Record<string, string>;
}

// Content identity of a deterministic stage request (issue #54 §2). Sorted
// keys keep the hash stable against object-literal ordering changes.
export async function deriveStageExecutionFingerprint(parts: StageExecutionFingerprintParts): Promise<string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(parts)) {
    if (value === undefined) continue;
    if (key === "extra" && parts.extra) {
      for (const [extraKey, extraValue] of Object.entries(parts.extra)) flat[`extra.${extraKey}`] = extraValue;
      continue;
    }
    flat[key] = String(value);
  }
  const canonical = Object.keys(flat)
    .sort()
    .map((key) => `${key}=${flat[key]}`)
    .join("\n");
  return sha256Hex(canonical);
}

// Slot identity (issue #54 §2): build version + artifact slot. Content does
// NOT belong in the key — the fingerprint rides the claim row for forensics
// and collision adjudication.
export async function deriveStageExecutionKey(
  buildVersionId: string,
  kind: string,
  subkey: string
): Promise<string> {
  return sha256Hex(JSON.stringify({ binding: "stage-execution-key/1", buildVersionId, kind, subkey }));
}

interface ClaimRow {
  execution_key: string;
  request_fingerprint: string;
  state: StageExecutionClaimState;
  owner_token: string;
  lease_expires_at: string;
  artifact_r2_key: string | null;
  artifact_checksum: string | null;
}

export interface SingleFlightExisting<T> extends StageArtifactRecord<T> {}

export interface SingleFlightStageInput<T> {
  buildId: string;
  buildVersionId: string;
  kind: string;
  subkey: string;
  /** Deterministic content identity of this exact request (issue #54 §2). */
  requestFingerprint: string;
  /** Load the immutable artifact for this slot, if it exists. */
  loadExisting: () => Promise<SingleFlightExisting<T> | null>;
  /** Adjudicate a stored artifact against the current request. Returning
   *  false means the stored artifact provably does not belong to this
   *  request (strict fingerprint mode — e.g. informed assembly repair). */
  verifyExisting: (existing: SingleFlightExisting<T>) => boolean;
  /** Terminal error for a foreign stored artifact. Defaults to
   *  StageExecutionCollisionError; the informed assembly repair keeps its
   *  issue-#52 StageArtifactError("REPAIR_ARTIFACT_MISMATCH") semantics. */
  existingMismatchError?: (existing: SingleFlightExisting<T>) => Error;
  /** The expensive provider-backed work. Called AT MOST ONCE per execution,
   *  and at most once per deterministic request across all executions. */
  run: () => Promise<{ value: T; provenance?: unknown }>;
  /** Persist the immutable artifact (must enforce immutability itself). */
  store: (result: { value: T; provenance?: unknown }) => Promise<{ artifactR2Key: string; checksum: string }>;
  /** Terminal provider failures (e.g. vision-seam exhaustion): no future
   *  provider call may serve the same impossible request (issue #54 §12). */
  isTerminalProviderError?: (error: unknown) => boolean;
  leaseMs?: number;
}

export interface SingleFlightStageResult<T> {
  value: T;
  artifactR2Key: string;
  checksum: string;
  /** True when an existing immutable artifact was reused (0 provider calls). */
  reused: boolean;
  /** 0 (reuse) or 1 (this execution owned the provider call). */
  providerCalls: 0 | 1;
}

const takeoverEligible = "((state = 'IN_PROGRESS' AND lease_expires_at < ?1) OR state = 'FAILED_RETRYABLE')";

export async function runStageSingleFlight<T>(
  env: Env,
  input: SingleFlightStageInput<T>
): Promise<SingleFlightStageResult<T>> {
  const executionKey = await deriveStageExecutionKey(input.buildVersionId, input.kind, input.subkey);

  // 1. Fast path: the immutable artifact already exists. It is the source of
  // truth — reuse before any claim bookkeeping (issue #54 §5/#10). A stale
  // IN_PROGRESS claim whose artifact already landed (crash between artifact
  // store and claim completion) is healed here, exactly once.
  const existing = await input.loadExisting();
  if (existing) {
    if (!input.verifyExisting(existing)) {
      await markClaimTerminal(env, executionKey, input.requestFingerprint);
      throw foreignArtifactError(input, existing);
    }
    await healClaimForStoredArtifact(env, executionKey, existing);
    return {
      value: existing.value,
      artifactR2Key: existing.artifactR2Key,
      checksum: existing.checksum,
      reused: true,
      providerCalls: 0,
    };
  }

  // 2. Atomic claim: exactly one execution becomes owner (issue #54 §4).
  const ownerToken = generateId();
  const now = nowIso();
  const leaseMs = input.leaseMs ?? STAGE_EXECUTION_LEASE_MS;
  const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
  const insert = await env.DB.prepare(
    `INSERT INTO stage_execution_claims (
       execution_key, build_id, build_version_id, stage_kind, subkey,
       request_fingerprint, state, owner_token, lease_expires_at, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'IN_PROGRESS', ?7, ?8, ?9, ?9)
     ON CONFLICT (execution_key) DO NOTHING`
  )
    .bind(
      executionKey,
      input.buildId,
      input.buildVersionId,
      input.kind,
      input.subkey,
      input.requestFingerprint,
      ownerToken,
      leaseExpiresAt,
      now
    )
    .run();

  let owner = insert.meta.changes === 1;
  let lastState: StageExecutionClaimState | null = null;
  let lastLease = "";

  // 3. Loser path: adjudicate the existing claim. Bounded re-reads — never a
  // busy-loop (issue #54 §6); waiting happens through the Workflow retry
  // policy by throwing the transient domain error.
  for (let round = 0; !owner && round < 3; round++) {
    const row = await env.DB.prepare("SELECT * FROM stage_execution_claims WHERE execution_key = ?1")
      .bind(executionKey)
      .first<ClaimRow>();
    if (!row) {
      // Claim vanished between INSERT-conflict and read (external cleanup).
      // One bounded re-claim attempt via the same atomic INSERT.
      const retry = await env.DB.prepare(
        `INSERT INTO stage_execution_claims (
           execution_key, build_id, build_version_id, stage_kind, subkey,
           request_fingerprint, state, owner_token, lease_expires_at, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'IN_PROGRESS', ?7, ?8, ?9, ?9)
         ON CONFLICT (execution_key) DO NOTHING`
      )
        .bind(
          executionKey,
          input.buildId,
          input.buildVersionId,
          input.kind,
          input.subkey,
          input.requestFingerprint,
          ownerToken,
          leaseExpiresAt,
          now
        )
        .run();
      owner = retry.meta.changes === 1;
      continue;
    }
    lastState = row.state;
    lastLease = row.lease_expires_at;

    if (row.state === "COMPLETED") {
      // 4. The owner finished: the immutable artifact is the outcome
      // (issue #54 §5). Zero provider calls on this path.
      const finished = await input.loadExisting();
      if (finished && input.verifyExisting(finished)) {
        return {
          value: finished.value,
          artifactR2Key: finished.artifactR2Key,
          checksum: finished.checksum,
          reused: true,
          providerCalls: 0,
        };
      }
      throw new StageExecutionCollisionError(
        `claim '${executionKey}' is COMPLETED but its artifact '${input.kind}/${input.subkey}' is missing or foreign for Build Version ${input.buildVersionId}; refusing to regenerate over corrupted state (issue #54)`
      );
    }

    if (row.state === "FAILED_TERMINAL") {
      throw new StageExecutionCollisionError(
        `claim '${executionKey}' is FAILED_TERMINAL for Build Version ${input.buildVersionId}; the same impossible request must not re-call the provider (issue #54 §12)`
      );
    }

    if (row.state === "IN_PROGRESS" && row.lease_expires_at >= now) {
      throw new StageExecutionInProgressError(executionKey, row.lease_expires_at);
    }

    // 5. Expired lease or retryable failure: atomic compare-and-swap takeover
    // (issue #54 §7). The conditional UPDATE is the concurrency point — only
    // one contender's UPDATE reports changes = 1.
    const takeover = await env.DB.prepare(
      `UPDATE stage_execution_claims
       SET owner_token = ?2, lease_expires_at = ?3, state = 'IN_PROGRESS',
           request_fingerprint = ?4, updated_at = ?5
       WHERE execution_key = ?1 AND ${takeoverEligible}`
    )
      .bind(executionKey, ownerToken, leaseExpiresAt, input.requestFingerprint, nowIso())
      .run();
    owner = takeover.meta.changes === 1;
    if (!owner) lastState = "IN_PROGRESS";
  }

  if (!owner) {
    if (lastState === "COMPLETED") {
      const finished = await input.loadExisting();
      if (finished && input.verifyExisting(finished)) {
        return {
          value: finished.value,
          artifactR2Key: finished.artifactR2Key,
          checksum: finished.checksum,
          reused: true,
          providerCalls: 0,
        };
      }
    }
    if (lastState === "FAILED_TERMINAL") {
      throw new StageExecutionCollisionError(
        `claim '${executionKey}' is FAILED_TERMINAL for Build Version ${input.buildVersionId} (issue #54 §12)`
      );
    }
    // Still owned: yield to the Workflow retry policy — the next attempt
    // finds either the finished artifact or an expired lease.
    throw new StageExecutionInProgressError(executionKey, lastLease || leaseExpiresAt);
  }

  // 6. Owner path (issue #54 §9): provider call -> parse/validate -> immutable
  // store -> claim COMPLETED. Before calling, honor the crash-between-store-
  // and-completion recovery window (issue #54 §10): a previous owner may have
  // stored the artifact just before dying; re-check, never re-call.
  const recovered = await input.loadExisting();
  if (recovered) {
    if (input.verifyExisting(recovered)) {
      await completeClaim(env, executionKey, ownerToken, recovered);
      return {
        value: recovered.value,
        artifactR2Key: recovered.artifactR2Key,
        checksum: recovered.checksum,
        reused: true,
        providerCalls: 0,
      };
    }
    await markClaimTerminal(env, executionKey, input.requestFingerprint);
    throw foreignArtifactError(input, recovered);
  }

  try {
    const result = await input.run();
    let stored: { artifactR2Key: string; checksum: string };
    try {
      stored = await input.store(result);
    } catch (storeError) {
      // 7. Collision safety net (issue #54 §11): despite ownership, the
      // artifact appeared (e.g. an uncoordinated pre-#54 execution). If it
      // provably IS this request, adopt it; otherwise fail terminally —
      // never overwrite, never pick a new subkey, never regenerate.
      if (isArtifactAlreadyExists(storeError)) {
        const adopted = await input.loadExisting();
        if (adopted && input.verifyExisting(adopted)) {
          await completeClaim(env, executionKey, ownerToken, adopted);
          return {
            value: adopted.value,
            artifactR2Key: adopted.artifactR2Key,
            checksum: adopted.checksum,
            reused: true,
            providerCalls: 1,
          };
        }
        await markClaimTerminal(env, executionKey, input.requestFingerprint);
        throw adopted
          ? foreignArtifactError(input, adopted)
          : new StageExecutionCollisionError(
              `store collision on '${input.kind}/${input.subkey}' for Build Version ${input.buildVersionId} with unreadable existing content; immutable artifact preserved, provider not re-called (issue #54 §11)`
            );
      }
      throw storeError;
    }
    await completeClaim(env, executionKey, ownerToken, {
      artifactR2Key: stored.artifactR2Key,
      checksum: stored.checksum,
    });
    return {
      value: result.value,
      artifactR2Key: stored.artifactR2Key,
      checksum: stored.checksum,
      reused: false,
      providerCalls: 1,
    };
  } catch (error) {
    // 8. Provider failure handling (issue #54 §12): release ownership so a
    // later attempt can claim after the workflow's backoff; terminal provider
    // failures close the claim permanently — no retry churn for an impossible
    // request. The original error always propagates.
    if (error instanceof StageExecutionCollisionError) {
      throw error;
    }
    if (input.isTerminalProviderError?.(error)) {
      await markClaimTerminal(env, executionKey, input.requestFingerprint);
      throw error;
    }
    await releaseClaim(env, executionKey, ownerToken);
    throw error;
  }
}

function isArtifactAlreadyExists(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "ARTIFACT_ALREADY_EXISTS"
  );
}

function foreignArtifactError<T>(
  input: SingleFlightStageInput<T>,
  existing: SingleFlightExisting<T>
): Error {
  if (input.existingMismatchError) return input.existingMismatchError(existing);
  return new StageExecutionCollisionError(
    `existing artifact '${input.kind}/${input.subkey}' for Build Version ${input.buildVersionId} does not match the current deterministic request (fingerprint ${input.requestFingerprint.slice(0, 12)}…); refusing to reuse a foreign artifact or overwrite the immutable slot (issue #54)`
  );
}

// Mark COMPLETED only from the owner token (issue #54 §9): a claim can never
// be completed by a stale loser. Fingerprint-agnostic by design — ownership
// already serializes the request.
async function completeClaim(
  env: Env,
  executionKey: string,
  ownerToken: string,
  artifact: { artifactR2Key?: string; checksum?: string }
): Promise<void> {
  await env.DB.prepare(
    `UPDATE stage_execution_claims
     SET state = 'COMPLETED', artifact_r2_key = ?3, artifact_checksum = ?4, updated_at = ?2
     WHERE execution_key = ?1 AND owner_token = ?5 AND state = 'IN_PROGRESS'`
  )
    .bind(executionKey, nowIso(), artifact.artifactR2Key ?? null, artifact.checksum ?? null, ownerToken)
    .run();
}

async function releaseClaim(env: Env, executionKey: string, ownerToken: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE stage_execution_claims
     SET state = 'FAILED_RETRYABLE', updated_at = ?2
     WHERE execution_key = ?1 AND owner_token = ?3 AND state = 'IN_PROGRESS'`
  )
    .bind(executionKey, nowIso(), ownerToken)
    .run();
}

async function markClaimTerminal(env: Env, executionKey: string, fingerprint: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE stage_execution_claims
     SET state = 'FAILED_TERMINAL', updated_at = ?2
     WHERE execution_key = ?1 AND state != 'COMPLETED' AND request_fingerprint = ?3`
  )
    .bind(executionKey, nowIso(), fingerprint)
    .run();
}

// Crash-between-store-and-completion recovery (issue #54 §10): the artifact
// exists and is verified for this request, so the claim's only remaining job
// is bookkeeping. Any execution may finish it; the update is idempotent.
async function healClaimForStoredArtifact<T>(
  env: Env,
  executionKey: string,
  existing: StageArtifactRecord<T>
): Promise<void> {
  await env.DB.prepare(
    `UPDATE stage_execution_claims
     SET state = 'COMPLETED', artifact_r2_key = ?2, artifact_checksum = ?3, updated_at = ?4
     WHERE execution_key = ?1 AND state = 'IN_PROGRESS'`
  )
    .bind(executionKey, existing.artifactR2Key, existing.checksum, nowIso())
    .run();
}
