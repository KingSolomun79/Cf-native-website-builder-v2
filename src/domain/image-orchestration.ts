// Durable KIE image job lifecycle (issue #58).
//
// The synchronous wave runner (image-pipeline.ts) submits a KIE task and then
// busy-waits for it INSIDE one workflow step — the dominant remaining
// production failure: a slow provider owned the whole step's timeout fate.
// This module re-shapes the SAME domain semantics (waves, priority order,
// bounded attempts, hard USD 3.00 gate, orientation conformance, acceptance
// immutability) as a durable submit → sleep → poll state machine:
//
//   image:{slotId}:a{n}:submit      — #54-claim single-flight KIE submission;
//                                    the attempt row is persisted BEFORE the
//                                    remote call ('pending') and carries the
//                                    remote task id immediately after, so a
//                                    replay resumes polling instead of
//                                    re-submitting.
//   image:{slotId}:a{n}:poll:{k}    — ONE short status probe (+ acceptance
//                                    finalization on success). Provider
//                                    PENDING is normal control flow, never an
//                                    error; transport failures throw into the
//                                    step's bounded retry policy.
//   image:{slotId}:a{n}:wait:{k}    — durable Workflow sleep between polls
//                                    (step.sleep in production; does not
//                                    consume execution concurrency or CPU).
//   image:{slotId}:a{n}:timeout     — bounded wait exhausted: the attempt is
//                                    failed as a DOMAIN outcome, never through
//                                    Workflow engine retry exhaustion.
//
// Known bounded window: if the engine kills the isolate between the remote
// createTask response and the local task-id persist, a replay cannot know the
// orphaned remote task exists and re-submits (KIE has no idempotency key).
// The #54 claim serializes submitters and the hard spend gate bounds the
// worst case; the window is a single HTTP round-trip wide.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { putImmutableObjectTolerant } from "../lib/assets";
import { sniffImageDimensions, orientationConforms } from "../lib/image-dimensions";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { buildVersionAssetKey } from "./artifact-keys";
import { runSchemaValidatedAiStage, type RawAiGenerate } from "./ai-boundary";
import {
  buildImagePromptUserPrompt,
  IMAGE_PROMPT_RECORDS_SCHEMA_VERSION,
  ImagePromptRecordsSchema,
  expandSlotsToTarget,
  waveForSlot,
  orderSlotsByPriority,
  MAX_ATTEMPTS_PER_SLOT,
  KIE_SPEND_LIMIT_USD,
  generationBudgetUsd,
  ImageBudgetExceededError,
  getImageSpendReport,
  type ImageGenerationProvider,
  type ImageGenerationResult,
  type ImagePromptRecord,
  type ImageSpendReport,
  type RunImageGenerationInput,
  type SlotGenerationOutcome,
} from "./image-pipeline";
import type { ImageSlot } from "./site-generator";
import {
  StageExecutionCollisionError,
  StageExecutionInProgressError,
  deriveStageExecutionFingerprint,
  deriveStageExecutionKey,
} from "./stage-execution";
import { sha256Hex } from "./stage-artifacts";

// Provider-friendly cadence (issue #58 §22): z-image tasks typically resolve
// in well under a minute; 30s probes keep remote polling polite while the
// durable sleeps cost nothing. step.sleep does NOT count toward the Workflow
// step limit — only the poll steps do (issue #58 §21).
export const IMAGE_POLL_INTERVAL_MS_DEFAULT = 30_000;
// Per-attempt provider wait bound (issue #58 §13): one Image Attempt may wait
// at most this long for its remote task before it is FAILED as a domain
// outcome and normal attempt-budget semantics apply. 15 minutes covers slow
// queues without letting a stuck task hold a slot forever.
export const IMAGE_ATTEMPT_TIMEOUT_MS_DEFAULT = 900_000;

// Short claim lease for submissions (#58 §7): createTask is one bounded HTTP
// round-trip (the adapter internally retries 429s for ~30s), so a dead
// submitter is taken over after 2 minutes instead of holding the full
// 660s stage lease.
export const KIE_SUBMISSION_LEASE_MS = 120_000;

export function imagePollIntervalMs(env: Env): number {
  const parsed = Number.parseInt(env.KIE_POLL_INTERVAL_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : IMAGE_POLL_INTERVAL_MS_DEFAULT;
}

export function imageAttemptTimeoutMs(env: Env): number {
  const parsed = Number.parseInt(env.KIE_ATTEMPT_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : IMAGE_ATTEMPT_TIMEOUT_MS_DEFAULT;
}

/** Worst-case durable poll steps per attempt: the attempt timeout expressed
 *  as a poll count (issue #58 §13 "maximum poll count" form). */
export function imageMaxPollsPerAttempt(env: Env): number {
  return Math.max(1, Math.ceil(imageAttemptTimeoutMs(env) / imagePollIntervalMs(env)));
}

/** Durable execution seams. `stepDo` maps to the Workflow's step.do (the same
 *  per-stage retry policy as every pipeline stage); `sleep` maps to
 *  step.sleep. Tests inject a replay-cache engine and an instant sleep. */
export interface ImageOrchestrationSeams {
  stepDo: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  sleep?: (name: string, ms: number) => Promise<void>;
}

interface AttemptContext {
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  siteGenerationId: string;
  wave: 1 | 2;
  slot: ImageSlot;
  record: ImagePromptRecord;
  attemptNumber: number;
  provider: ImageGenerationProvider;
}

export async function runImageGenerationDurable(
  env: Env,
  input: RunImageGenerationInput,
  seams: ImageOrchestrationSeams
): Promise<ImageGenerationResult> {
  const slots = input.expandToTarget === false ? input.slots : expandSlotsToTarget(input.slots);

  // The LLM prompt-records stage is its own short durable step. Serializable
  // array result — step outputs must survive engine serialization.
  const records = await seams.stepDo(`pipeline: image prompts (v${input.buildVersionNumber})`, async () => {
    const promptRun = await runSchemaValidatedAiStage<ImagePromptRecordsShape>(env, {
      stage: "kie-image-prompt-generator",
      schema: ImagePromptRecordsSchema,
      schemaVersion: IMAGE_PROMPT_RECORDS_SCHEMA_VERSION,
      userPrompt: buildImagePromptUserPrompt(slots),
      buildId: input.buildId,
      siteGenerationId: input.siteGenerationId,
      buildVersionId: input.buildVersionId,
      buildVersionNumber: input.buildVersionNumber,
      temperature: 0.4,
      generate: input.generate,
    });
    return promptRun.value.records;
  });
  const promptRecords = new Map(records.map((record) => [record.slotId, record]));

  const wave1 = await runDurableWave(env, input, seams, promptRecords, slots, 1);
  const wave2 = await runDurableWave(env, input, seams, promptRecords, slots, 2);

  const report = await getImageSpendReport(env, input.buildId, slots);
  return { outcomes: [...wave1, ...wave2], report };
}

interface ImagePromptRecordsShape {
  records: ImagePromptRecord[];
}

async function runDurableWave(
  env: Env,
  input: RunImageGenerationInput,
  seams: ImageOrchestrationSeams,
  promptRecords: Map<string, ImagePromptRecord>,
  slots: ImageSlot[],
  wave: 1 | 2
): Promise<SlotGenerationOutcome[]> {
  const waveSlots = orderSlotsByPriority(slots.filter((slot) => waveForSlot(slot) === wave));
  const outcomes: SlotGenerationOutcome[] = [];
  const providerErrorNotes: string[] = [];
  const orientationRejections: string[] = [];

  for (const slot of waveSlots) {
    const record = promptRecords.get(slot.id);
    if (!record) {
      outcomes.push({ slotId: slot.id, status: "failed", costUsd: 0 });
      continue;
    }
    const outcome = await runDurableSlot(env, input, seams, wave, slot, record, orientationRejections, providerErrorNotes);
    outcomes.push(outcome);
  }

  // Wrapped in a step so an engine replay reads the cached event instead of
  // appending a duplicate.
  await seams.stepDo(`pipeline: image wave ${wave} event (v${input.buildVersionNumber})`, async () => {
    const accepted = outcomes.filter((outcome) => outcome.status === "accepted").length;
    await appendBuildWorkflowEvent(env, {
      buildId: input.buildId,
      buildVersionId: input.buildVersionId,
      fromState: wave === 1 ? "SITE_VALIDATION" : "IMAGE_WAVE_1",
      toState: wave === 1 ? "IMAGE_WAVE_1" : "IMAGE_WAVE_2",
      stage: wave === 1 ? "image_wave_1" : "image_wave_2",
      detail: `Wave ${wave}: ${accepted}/${waveSlots.length} slots accepted${providerErrorNotes.length ? `; provider errors: ${providerErrorNotes.join("; ").slice(0, 240)}` : ""}${orientationRejections.length ? `; orientation rejections: ${orientationRejections.join("; ").slice(0, 240)}` : ""}`,
    });
    return null;
  });

  return outcomes;
}

// ── Per-slot attempt loop ───────────────────────────────────────────────────

async function runDurableSlot(
  env: Env,
  input: RunImageGenerationInput,
  seams: ImageOrchestrationSeams,
  wave: 1 | 2,
  slot: ImageSlot,
  record: ImagePromptRecord,
  orientationRejections: string[],
  providerErrorNotes: string[]
): Promise<SlotGenerationOutcome> {
  // Re-entry position derives from PERSISTED state (issue #58 §12): an
  // in-flight ('pending') attempt is RESUMED, never duplicated; a settled
  // attempt starts the next bounded one.
  const rows = await env.DB.prepare(
    "SELECT attempt_number, status FROM image_attempts WHERE build_version_id = ? AND slot_id = ? ORDER BY attempt_number"
  )
    .bind(input.buildVersionId, slot.id)
    .all<{ attempt_number: number; status: string }>();
  const persisted = rows.results ?? [];
  const latest = persisted.length > 0 ? persisted[persisted.length - 1] : null;

  if (latest?.status === "rejected_budget") {
    // Deterministic budget stop for this slot: re-entry must not re-plan it.
    return { slotId: slot.id, status: "rejected_budget", costUsd: 0 };
  }

  const firstAttemptNumber =
    latest?.status === "pending" ? latest.attempt_number : persisted.length + 1;
  if (firstAttemptNumber > MAX_ATTEMPTS_PER_SLOT) {
    return { slotId: slot.id, status: "failed", costUsd: 0 };
  }

  let lastOutcome: SlotGenerationOutcome = { slotId: slot.id, status: "failed", costUsd: 0 };
  for (let attemptNumber = firstAttemptNumber; attemptNumber <= MAX_ATTEMPTS_PER_SLOT; attemptNumber++) {
    lastOutcome = await runDurableAttempt(env, input, seams, wave, slot, record, attemptNumber, orientationRejections, providerErrorNotes);
    if (lastOutcome.status === "accepted" || lastOutcome.status === "rejected_budget") break;
  }
  return lastOutcome;
}

async function runDurableAttempt(
  env: Env,
  input: RunImageGenerationInput,
  seams: ImageOrchestrationSeams,
  wave: 1 | 2,
  slot: ImageSlot,
  record: ImagePromptRecord,
  attemptNumber: number,
  orientationRejections: string[],
  providerErrorNotes: string[]
): Promise<SlotGenerationOutcome> {
  const ctx: AttemptContext = {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    siteGenerationId: input.siteGenerationId,
    wave,
    slot,
    record,
    attemptNumber,
    provider: input.provider,
  };

  // 1. Durable single-flight submission: the attempt row is persisted with
  //    the remote task id BEFORE any polling starts (issue #58 §5–§8).
  const submitted = await seams.stepDo(`image:${slot.id}:a${attemptNumber}:submit`, () =>
    submitImageAttemptSingleFlight(env, ctx)
  );
  if (submitted.kind === "rejected_budget") {
    return { slotId: slot.id, status: "rejected_budget", costUsd: 0 };
  }
  if (submitted.kind === "failed") {
    if (submitted.reason) providerErrorNotes.push(`${slot.id}: ${submitted.reason.slice(0, 100)}`);
    return { slotId: slot.id, status: "failed", costUsd: 0 };
  }

  // 2. Bounded durable poll loop. Provider PENDING/QUEUED/PROCESSING is
  //    control flow, never an error (issue #58 §14): poll, persist, sleep,
  //    poll again — each probe its own short step.
  const intervalMs = imagePollIntervalMs(env);
  const maxPolls = imageMaxPollsPerAttempt(env);
  let outcome: SlotGenerationOutcome | null = null;
  for (let poll = 1; poll <= maxPolls; poll++) {
    const probe = await seams.stepDo(`image:${slot.id}:a${attemptNumber}:poll:${poll}`, () =>
      pollImageAttempt(env, ctx)
    );
    if (probe.status === "pending") {
      await (seams.sleep ?? instantSleep)(`image:${slot.id}:a${attemptNumber}:wait:${poll}`, intervalMs);
      continue;
    }
    if (probe.orientationNote) orientationRejections.push(probe.orientationNote);
    outcome = probe.outcome;
    break;
  }

  // 3. Bound exhausted: attempt-level timeout as an explicit DOMAIN failure
  //    (issue #58 §13) — Workflow engine retry exhaustion is never the image
  //    timeout mechanism.
  if (!outcome) {
    outcome = await seams.stepDo(`image:${slot.id}:a${attemptNumber}:timeout`, async () => {
      await env.DB.prepare(
        "UPDATE image_attempts SET status = 'failed' WHERE build_version_id = ?1 AND slot_id = ?2 AND attempt_number = ?3 AND status = 'pending'"
      )
        .bind(ctx.buildVersionId, ctx.slot.id, ctx.attemptNumber)
        .run();
      await appendBuildWorkflowEvent(env, {
        buildId: ctx.buildId,
        buildVersionId: ctx.buildVersionId,
        fromState: ctx.wave === 1 ? "SITE_VALIDATION" : "IMAGE_WAVE_1",
        toState: ctx.wave === 1 ? "IMAGE_WAVE_1" : "IMAGE_WAVE_2",
        stage: "image_attempt_timeout",
        detail: `Image attempt ${ctx.attemptNumber} for slot ${ctx.slot.id} exceeded the ${(imageAttemptTimeoutMs(env) / 60_000).toFixed(0)}-minute provider wait bound; marked failed under normal attempt-budget semantics`,
      });
      return { slotId: ctx.slot.id, status: "failed" as const, costUsd: submitted.costUsd };
    });
  }
  return outcome;
}

async function instantSleep(): Promise<void> {}

// ── Submission (#54-claim single-flight) ────────────────────────────────────

type SubmissionOutcome =
  | { kind: "submitted" | "resumed"; taskId: string; costUsd: number }
  | { kind: "failed"; reason?: string }
  | { kind: "rejected_budget" };

interface AttemptRowRef {
  id: string;
  provider_task_id: string | null;
  cost_usd: number;
  status: string;
}

function aspectRatioFor(slot: ImageSlot): string {
  return slot.orientation === "portrait" ? "9:16" : slot.orientation === "square" ? "1:1" : "16:9";
}

async function buildSpentUsd(env: Env, buildId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM image_attempts WHERE build_id = ?")
    .bind(buildId)
    .first<{ spent: number }>();
  return Number(row?.spent ?? 0);
}

async function loadAttemptRow(env: Env, ctx: AttemptContext): Promise<AttemptRowRef | null> {
  return await env.DB.prepare(
    "SELECT id, provider_task_id, cost_usd, status FROM image_attempts WHERE build_version_id = ?1 AND slot_id = ?2 AND attempt_number = ?3"
  )
    .bind(ctx.buildVersionId, ctx.slot.id, ctx.attemptNumber)
    .first<AttemptRowRef>();
}

/** Runs INSIDE the submit step. Submission identity is deterministic
 *  (build version + slot + attempt + prompt hash + generation parameters,
 *  issue #58 §7) and coordinated through the #54 execution-claim mechanics:
 *  overlapping executions never double-submit, and a replay with the remote
 *  task id already persisted never submits at all. */
async function submitImageAttemptSingleFlight(env: Env, ctx: AttemptContext): Promise<SubmissionOutcome> {
  // Fast path: the remote task id is already durable (issue #58 §8) — this
  // exact attempt owns a KIE task; resume polling it.
  const existing = await loadAttemptRow(env, ctx);
  if (existing?.provider_task_id) {
    return { kind: "resumed", taskId: existing.provider_task_id, costUsd: Number(existing.cost_usd ?? 0) };
  }

  const executionKey = await deriveStageExecutionKey(
    ctx.buildVersionId,
    "kie_image_submission",
    `${ctx.slot.id}:a${ctx.attemptNumber}`
  );
  const fingerprint = await deriveStageExecutionFingerprint({
    binding: "kie-image-submission/1",
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    kind: "kie_image_submission",
    subkey: `${ctx.slot.id}:a${ctx.attemptNumber}`,
    schemaVersion: "1",
    model: env.KIE_MODEL ?? "",
    userPromptSha256: await sha256Hex(ctx.record.promptText),
    extra: {
      aspectRatio: aspectRatioFor(ctx.slot),
      wave: String(ctx.wave),
      slotOrientation: ctx.slot.orientation,
    },
  });

  // Atomic claim: exactly one execution submits (issue #58 §7).
  const ownerToken = generateId();
  const now = nowIso();
  const leaseExpiresAt = new Date(Date.now() + KIE_SUBMISSION_LEASE_MS).toISOString();
  const insert = await env.DB.prepare(
    `INSERT INTO stage_execution_claims (
       execution_key, build_id, build_version_id, stage_kind, subkey,
       request_fingerprint, state, owner_token, lease_expires_at, created_at, updated_at
     ) VALUES (?1, ?2, ?3, 'kie_image_submission', ?4, ?5, 'IN_PROGRESS', ?6, ?7, ?8, ?8)
     ON CONFLICT (execution_key) DO NOTHING`
  )
    .bind(
      executionKey,
      ctx.buildId,
      ctx.buildVersionId,
      `${ctx.slot.id}:a${ctx.attemptNumber}`,
      fingerprint,
      ownerToken,
      leaseExpiresAt,
      now
    )
    .run();

  let owner = insert.meta.changes === 1;
  if (!owner) {
    const claim = await env.DB.prepare("SELECT * FROM stage_execution_claims WHERE execution_key = ?1")
      .bind(executionKey)
      .first<{ state: string; owner_token: string; lease_expires_at: string; request_fingerprint: string }>();
    if (!claim) throw new Error(`submission claim '${executionKey}' vanished between conflict and read`);
    if (claim.request_fingerprint !== fingerprint) {
      throw new StageExecutionCollisionError(
        `submission claim '${executionKey}' belongs to a different deterministic request (fingerprint ${claim.request_fingerprint.slice(0, 12)}…); refusing to submit a foreign slot request (issue #58 §7)`
      );
    }
    if (claim.state === "COMPLETED") {
      const settled = await loadAttemptRow(env, ctx);
      if (settled?.provider_task_id) {
        return { kind: "resumed", taskId: settled.provider_task_id, costUsd: Number(settled.cost_usd ?? 0) };
      }
      if (settled?.status === "rejected_budget") return { kind: "rejected_budget" };
      throw new StageExecutionCollisionError(
        `submission claim '${executionKey}' is COMPLETED but attempt ${ctx.attemptNumber} of slot ${ctx.slot.id} has no remote task id; refusing to re-submit over corrupted state (issue #58 §8)`
      );
    }
    if (claim.state === "FAILED_TERMINAL") {
      throw new StageExecutionCollisionError(
        `submission claim '${executionKey}' is FAILED_TERMINAL; the same impossible submission must not re-call the provider (issue #54 §12)`
      );
    }
    if (claim.state === "IN_PROGRESS" && claim.lease_expires_at >= now) {
      // A live submitter owns this attempt: yield into the step's bounded
      // retry policy, which waits out exactly the remaining lease.
      throw new StageExecutionInProgressError(executionKey, claim.lease_expires_at);
    }
    // Expired lease or retryable failure: atomic compare-and-swap takeover.
    const takeover = await env.DB.prepare(
      `UPDATE stage_execution_claims
       SET owner_token = ?2, lease_expires_at = ?3, state = 'IN_PROGRESS', updated_at = ?4
       WHERE execution_key = ?1 AND ((state = 'IN_PROGRESS' AND lease_expires_at < ?5) OR state = 'FAILED_RETRYABLE')`
    )
      .bind(executionKey, ownerToken, leaseExpiresAt, nowIso(), now)
      .run();
    owner = takeover.meta.changes === 1;
    if (!owner) throw new StageExecutionInProgressError(executionKey, claim.lease_expires_at);
    // The previous owner died before finishing: its attempt row (if any) is
    // re-owned below and reset to the submitting state.
    if (existing) {
      await env.DB.prepare("UPDATE image_attempts SET status = 'pending' WHERE id = ?1 AND status = 'failed'").bind(existing.id).run();
    }
  }

  // Owner path. Budget gate BEFORE the external side effect when the provider
  // estimates deterministically (issue #58 §17): a rejection then creates no
  // remote task at all.
  const settleClaim = () =>
    env.DB.prepare(
      "UPDATE stage_execution_claims SET state = 'COMPLETED', updated_at = ?2 WHERE execution_key = ?1 AND owner_token = ?3 AND state = 'IN_PROGRESS'"
    )
      .bind(executionKey, nowIso(), ownerToken)
      .run();

  try {
    const estimate = ctx.provider.estimateCost?.() ?? null;
    if (estimate !== null) {
      const spent = await buildSpentUsd(env, ctx.buildId);
      const hardBreach = spent + estimate > KIE_SPEND_LIMIT_USD + 1e-9;
      const generationCeiling = ctx.wave === 2 ? KIE_SPEND_LIMIT_USD : generationBudgetUsd();
      const ceilingBreach = spent + estimate > generationCeiling + 1e-9;
      if (hardBreach || ceilingBreach) {
        await upsertAttemptRow(env, ctx, existing, "rejected_budget", null, 0);
        await settleClaim();
        if (hardBreach) throw new ImageBudgetExceededError(spent, estimate, KIE_SPEND_LIMIT_USD);
        return { kind: "rejected_budget" };
      }
    }

    // PLANNED/SUBMITTING: the attempt row exists BEFORE the remote call
    // (issue #58 §6) — operators see planned work immediately and a replay
    // can resume it.
    const attemptId = await upsertAttemptRow(env, ctx, existing, "pending", null, 0);

    let task: { taskId: string; costUsd: number };
    try {
      task = await ctx.provider.createTask({
        slotId: ctx.slot.id,
        promptText: ctx.record.promptText,
        aspectRatio: aspectRatioFor(ctx.slot),
      });
    } catch (error) {
      // Bounded failed attempt (submit-time failure never polls): normal
      // attempt-budget semantics apply, claim released for a later attempt.
      await env.DB.prepare("UPDATE image_attempts SET status = 'failed' WHERE id = ?1 AND status = 'pending'")
        .bind(attemptId)
        .run();
      await env.DB.prepare(
        "UPDATE stage_execution_claims SET state = 'FAILED_RETRYABLE', updated_at = ?2 WHERE execution_key = ?1 AND owner_token = ?3 AND state = 'IN_PROGRESS'"
      )
        .bind(executionKey, nowIso(), ownerToken)
        .run();
      return { kind: "failed", reason: (error as Error)?.message };
    }

    if (estimate === null) {
      // Providers without a deterministic estimate keep the legacy gate
      // position: the createTask probe IS the cost source.
      const spent = await buildSpentUsd(env, ctx.buildId);
      const generationCeiling = ctx.wave === 2 ? KIE_SPEND_LIMIT_USD : generationBudgetUsd();
      if (spent + task.costUsd > KIE_SPEND_LIMIT_USD + 1e-9) {
        await env.DB.prepare("UPDATE image_attempts SET status = 'rejected_budget' WHERE id = ?1 AND status = 'pending'")
          .bind(attemptId)
          .run();
        await settleClaim();
        throw new ImageBudgetExceededError(spent, task.costUsd, KIE_SPEND_LIMIT_USD);
      }
      if (spent + task.costUsd > generationCeiling + 1e-9) {
        await env.DB.prepare("UPDATE image_attempts SET status = 'rejected_budget' WHERE id = ?1 AND status = 'pending'")
          .bind(attemptId)
          .run();
        await settleClaim();
        return { kind: "rejected_budget" };
      }
    }

    // SUBMITTED: the remote task id is durable BEFORE polling begins
    // (issue #58 §8). Replay from here resumes this exact task.
    await env.DB.prepare("UPDATE image_attempts SET provider_task_id = ?2, cost_usd = ?3 WHERE id = ?1")
      .bind(attemptId, task.taskId, task.costUsd)
      .run();
    await settleClaim();
    return { kind: "submitted", taskId: task.taskId, costUsd: task.costUsd };
  } catch (error) {
    if (error instanceof ImageBudgetExceededError) throw error;
    if (error instanceof StageExecutionCollisionError) throw error;
    await env.DB.prepare(
      "UPDATE stage_execution_claims SET state = 'FAILED_RETRYABLE', updated_at = ?2 WHERE execution_key = ?1 AND owner_token = ?3 AND state = 'IN_PROGRESS'"
    )
      .bind(executionKey, nowIso(), ownerToken)
      .run();
    throw error;
  }
}

/** Insert-or-adopt the attempt row for this deterministic slot/attempt
 *  (UNIQUE (build_version_id, slot_id, attempt_number)) and set its status.
 *  Returns the row id used by acceptance bookkeeping. */
async function upsertAttemptRow(
  env: Env,
  ctx: AttemptContext,
  existing: AttemptRowRef | null,
  status: "pending" | "rejected_budget",
  providerTaskId: string | null,
  costUsd: number
): Promise<string> {
  if (!existing) {
    const id = generateId();
    await env.DB.prepare(
      `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, provider_task_id, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (build_version_id, slot_id, attempt_number) DO NOTHING`
    )
      .bind(id, ctx.buildId, ctx.buildVersionId, ctx.slot.id, ctx.wave, ctx.attemptNumber, status, providerTaskId, costUsd, nowIso())
      .run();
    const row = await loadAttemptRow(env, ctx);
    if (!row) throw new Error(`image attempt row for slot ${ctx.slot.id} attempt ${ctx.attemptNumber} missing after insert`);
    return row.id;
  }
  await env.DB.prepare("UPDATE image_attempts SET status = ?2, provider_task_id = ?3, cost_usd = ?4 WHERE id = ?1")
    .bind(existing.id, status, providerTaskId, costUsd)
    .run();
  return existing.id;
}

// ── Poll + acceptance ───────────────────────────────────────────────────────

type PollProbe =
  | { status: "pending" }
  | { status: "final"; outcome: SlotGenerationOutcome; orientationNote?: string };

/** Runs INSIDE a poll step: one short status probe against the PERSISTED
 *  remote task id (issue #58 §10/§12), plus acceptance finalization on
 *  success. Idempotent under step retry: every write is guarded by the
 *  attempt's 'pending' status or an ON CONFLICT DO NOTHING. */
async function pollImageAttempt(env: Env, ctx: AttemptContext): Promise<PollProbe> {
  const row = await env.DB.prepare(
    "SELECT id, provider_task_id, cost_usd FROM image_attempts WHERE build_version_id = ?1 AND slot_id = ?2 AND attempt_number = ?3"
  )
    .bind(ctx.buildVersionId, ctx.slot.id, ctx.attemptNumber)
    .first<AttemptRowRef>();
  if (!row?.provider_task_id) {
    throw new Error(
      `image poll found no persisted provider task for slot ${ctx.slot.id} attempt ${ctx.attemptNumber}; submission evidence is missing`
    );
  }
  const taskId = row.provider_task_id;
  const check = ctx.provider.checkResult
    ? await ctx.provider.checkResult(taskId)
    : await ctx.provider.fetchResult(taskId);

  if (check.status === "pending") return { status: "pending" };

  if (check.status === "failed") {
    await env.DB.prepare("UPDATE image_attempts SET status = 'failed' WHERE id = ?1 AND status = 'pending'")
      .bind(row.id)
      .run();
    return { status: "final", outcome: { slotId: ctx.slot.id, status: "failed", costUsd: Number(row.cost_usd ?? 0) } };
  }

  // Issue #47 orientation conformance BEFORE acceptance — identical to the
  // synchronous wave runner's gate.
  const dimensions = sniffImageDimensions(check.bytes);
  if (dimensions && !orientationConforms(ctx.slot.orientation, dimensions)) {
    const r2Key = buildVersionAssetKey(ctx.buildId, ctx.buildVersionNumber, `images/${ctx.slot.id}-a${ctx.attemptNumber}.webp`);
    await putImmutableObjectTolerant(env, r2Key, check.bytes, { httpMetadata: { contentType: "image/webp" } });
    await env.DB.prepare(
      "UPDATE image_attempts SET status = 'failed', provider_url = ?2, r2_key = ?3 WHERE id = ?1 AND status = 'pending'"
    )
      .bind(row.id, check.temporaryUrl, r2Key)
      .run();
    return {
      status: "final",
      outcome: { slotId: ctx.slot.id, status: "failed", costUsd: Number(row.cost_usd ?? 0) },
      orientationNote: `${ctx.slot.id}: ${ctx.slot.orientation} required, measured ${dimensions.width}x${dimensions.height}`,
    };
  }

  // Persist to project-controlled storage; the temporary provider URL is
  // audit-only. Tolerant re-freeze keeps a retried poll idempotent.
  const r2Key = buildVersionAssetKey(ctx.buildId, ctx.buildVersionNumber, `images/${ctx.slot.id}-a${ctx.attemptNumber}.webp`);
  await putImmutableObjectTolerant(env, r2Key, check.bytes, { httpMetadata: { contentType: "image/webp" } });
  const checksum = await sha256HexBytes(check.bytes);
  await env.DB.prepare(
    "UPDATE image_attempts SET status = 'succeeded', provider_url = ?2, r2_key = ?3, checksum = ?4 WHERE id = ?1 AND status = 'pending'"
  )
    .bind(row.id, check.temporaryUrl, r2Key, checksum)
    .run();
  await env.DB.prepare(
    `INSERT INTO accepted_images (build_version_id, slot_id, attempt_id, r2_key, accepted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (build_version_id, slot_id) DO NOTHING`
  )
    .bind(ctx.buildVersionId, ctx.slot.id, row.id, r2Key, nowIso())
    .run();
  return {
    status: "final",
    outcome: { slotId: ctx.slot.id, status: "accepted", attemptId: row.id, r2Key, costUsd: Number(row.cost_usd ?? 0) },
  };
}

async function sha256HexBytes(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Re-exported for operators/tests: the spend report shape is shared with the
// synchronous runner so downstream accounting is identical.
export type { ImageSpendReport };
