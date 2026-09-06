// V2 budgeted two-wave image generation (issue #10, PRD sections 17-18).
//
// Stable Image Slots flow through prioritized KIE generation into Accepted
// Images:
//   - Wave 1: all CRITICAL slots + HIGH homepage slots.
//   - Wave 2: remaining NORMAL/supporting slots.
//   - Hard completed-site spend gate: USD 3.00 (never exceeded).
//   - ~20-25% of the budget is preserved for repair and is not consumed by
//     initial generation.
//   - Crop/object-position, asset routing and slot remap are attempted before
//     regeneration wherever they can solve a defect; retries are bounded and
//     mobile-specific variants are exceptional.
// Accepted Images persist to project-controlled storage; temporary provider
// URLs never survive into release.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { getObject, putImmutableObjectTolerant } from "../lib/assets";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { buildVersionAssetKey } from "./artifact-keys";
import { runSchemaValidatedAiStage, type RawAiGenerate } from "./ai-boundary";
import type { ImageSlot } from "./site-generator";
import { orientationConforms, sniffImageDimensions } from "../lib/image-dimensions";

// PRD section 18.
export const KIE_SPEND_LIMIT_USD = 3.0;
export const REPAIR_RESERVE_RATIO = 0.225; // 20-25% preserved for repair
export const NORMAL_TARGET_ACCEPTED_IMAGES = 12;
export const MAX_ATTEMPTS_PER_SLOT = 2;

export function generationBudgetUsd(limit = KIE_SPEND_LIMIT_USD): number {
  return Number((limit * (1 - REPAIR_RESERVE_RATIO)).toFixed(4));
}

export type ImagePriority = ImageSlot["priority"];

// Wave 1 = CRITICAL slots + HIGH homepage slots; Wave 2 = everything else.
export function waveForSlot(slot: Pick<ImageSlot, "priority" | "page">): 1 | 2 {
  return slot.priority === "CRITICAL" || (slot.priority === "HIGH" && slot.page === "home") ? 1 : 2;
}

export function splitWaves(slots: ImageSlot[]): { wave1: ImageSlot[]; wave2: ImageSlot[] } {
  const wave1 = slots.filter((slot) => waveForSlot(slot) === 1);
  const wave2 = slots.filter((slot) => waveForSlot(slot) === 2);
  return { wave1, wave2 };
}

const PRIORITY_ORDER: Record<ImagePriority, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };

export function orderSlotsByPriority(slots: ImageSlot[]): ImageSlot[] {
  return [...slots].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.id.localeCompare(b.id));
}

// Deterministic top-up toward the normal ~12-Accepted-Image target: adds
// supporting detail slots reusing existing NORMAL blueprint roles. Slot
// identity stays semantic; budget still governs what actually generates.
export function expandSlotsToTarget(slots: ImageSlot[], target = NORMAL_TARGET_ACCEPTED_IMAGES): ImageSlot[] {
  const expanded = [...slots];
  const normalRoles = slots.filter((slot) => slot.priority === "NORMAL");
  const fallback = normalRoles[0] ?? slots[slots.length - 1];
  if (!fallback) return expanded;
  let index = 2;
  const pages: Array<ImageSlot["page"]> = ["home", "about", "services", "contact"];
  while (expanded.length < target) {
    const page = pages[expanded.length % pages.length];
    const role = normalRoles[(expanded.length - slots.length) % Math.max(normalRoles.length, 1)] ?? fallback;
    expanded.push({
      id: `${page}-supporting-${index}`,
      page,
      semanticRole: `${role.semanticRole} (supporting ${index})`,
      blueprintRole: role.blueprintRole,
      priority: "NORMAL",
      orientation: "landscape",
      negativeSpaceForText: false,
    });
    index += 1;
    if (index > target * 2) break; // safety valve
  }
  return expanded;
}

// ── KIE prompt generation stage ─────────────────────────────────────────────

export const IMAGE_PROMPT_RECORDS_SCHEMA_VERSION = "image-prompt-records/1";

export const ImagePromptRecordSchema = Type.Object(
  {
    slotId: Type.String({ minLength: 1 }),
    promptText: Type.String({ minLength: 40, maxLength: 4000 }),
    altText: Type.String({ minLength: 5, maxLength: 500 }),
    shotType: Type.String({ minLength: 2, maxLength: 120 }),
    lighting: Type.String({ minLength: 2, maxLength: 500 }),
    avoidance: Type.String({ minLength: 2, maxLength: 1000 }),
  },
  { additionalProperties: false }
);
export type ImagePromptRecord = Static<typeof ImagePromptRecordSchema>;

export const ImagePromptRecordsSchema = Type.Object(
  { records: Type.Array(ImagePromptRecordSchema, { minItems: 1 }) },
  { additionalProperties: false }
);
export type ImagePromptRecords = Static<typeof ImagePromptRecordsSchema>;

export function buildImagePromptUserPrompt(slots: ImageSlot[], slotIdsWithPrompts?: string[]): string {
  const scoped = slotIdsWithPrompts ? slots.filter((slot) => slotIdsWithPrompts.includes(slot.id)) : slots;
  // Issue #48: generated imagery must never carry fabricated identity — the
  // frozen RankForge candidate baked a fake client-logo strip into an asset's
  // pixels. The prohibition is binding for every slot prompt record.
  return `Generate KIE image prompts for the Image Slots below. Each record keeps the slot's stable semantic/compositional identity, honors its priority, orientation and text-space requirements, and follows the slot avoidance discipline.

IDENTITY PROHIBITION (binding, issue #48): every prompt must produce abstract or photographic imagery only — NO readable text, lettering, numbers, wordmarks, logos, brand or client names, awards or certifications marks, watermarks, UI chrome, or screenshot-like composition. Reproducing a Reference trust band's visual rhythm never licenses inventing the entities in it; a prompt that would render any name, logo or text must be rewritten to an abstract/photographic equivalent before output.

IMAGE SLOTS:
${JSON.stringify(scoped, null, 2)}`;
}

// ── Provider boundary ───────────────────────────────────────────────────────

export interface ResolvedSlotTask {
  slotId: string;
  promptText: string;
  aspectRatio: string;
}

export type ImageProviderFetchResult =
  | { status: "complete"; bytes: Uint8Array; temporaryUrl: string }
  | { status: "pending" }
  | { status: "failed" };

export interface ImageGenerationProvider {
  createTask(task: ResolvedSlotTask): Promise<{ taskId: string; costUsd: number }>;
  /** Bounded-wait poll: resolves (or times out) after internally waiting for
   *  the remote task. Legacy synchronous shape — the durable driver
   *  (image-orchestration.ts, issue #58) uses checkResult instead. */
  fetchResult(taskId: string): Promise<ImageProviderFetchResult>;
  /** ONE short status probe with no internal waiting (issue #58): transport
   *  failures throw into the poll step's bounded retry policy; provider
   *  PENDING is returned as the normal 'pending' state, never an error. */
  checkResult?(taskId: string): Promise<ImageProviderFetchResult>;
  /** Deterministic pre-submission cost estimate (issue #58 §17): lets the
   *  durable budget gate reject BEFORE any remote task is created. Null when
   *  the provider cannot estimate (the legacy post-createTask gate applies). */
  estimateCost?(): number | null;
}

// ── Defect repair ordering ──────────────────────────────────────────────────

export type ImageDefectKind = "crop_framing" | "asset_routing" | "content_remap" | "generation_quality" | "prompt_mismatch";

export interface ImageDefectRepairPlanStep {
  strategy: "css_crop_object_position" | "asset_routing" | "content_remap" | "image_attempt_regeneration" | "prompt_repair_and_regeneration";
  applies: boolean;
  note: string;
}

// PRD section 18 repair priority: CSS/object-position/container fix, then
// asset-routing fix, then content remap, then Image Attempt regeneration,
// then prompt repair + regeneration. Blueprint review only when the contract
// itself is defective (never reached from here).
export function planImageDefectRepair(defect: { kind: ImageDefectKind; mobileSpecific?: boolean }): ImageDefectRepairPlanStep[] {
  return [
    {
      strategy: "css_crop_object_position",
      applies: defect.kind === "crop_framing",
      note: "adjust object-position/aspect crop in CSS before any regeneration",
    },
    {
      strategy: "asset_routing",
      applies: defect.kind === "asset_routing",
      note: "route an existing Accepted Image that satisfies the slot",
    },
    {
      strategy: "content_remap",
      applies: defect.kind === "content_remap",
      note: "remap slot usage in content before regenerating",
    },
    {
      strategy: "image_attempt_regeneration",
      applies: defect.kind === "generation_quality",
      note: `bounded new Image Attempt (max ${MAX_ATTEMPTS_PER_SLOT} per slot${defect.mobileSpecific ? "; mobile-specific variant is exceptional" : ""})`,
    },
    {
      strategy: "prompt_repair_and_regeneration",
      applies: defect.kind === "prompt_mismatch",
      note: "repair the slot prompt, then regenerate once",
    },
  ];
}

// Non-regeneration strategies that can resolve a defect without spending
// KIE budget.
export function resolveDefectWithoutRegeneration(defect: { kind: ImageDefectKind }): ImageDefectRepairPlanStep | null {
  return planImageDefectRepair(defect).find((step) => step.applies && step.strategy !== "image_attempt_regeneration" && step.strategy !== "prompt_repair_and_regeneration") ?? null;
}

// ── Ledger ──────────────────────────────────────────────────────────────────

export interface ImageSpendReport {
  spentUsd: number;
  hardLimitUsd: number;
  generationBudgetUsd: number;
  repairReserveUsd: number;
  acceptedCount: number;
  unresolvedSlots: string[];
  targetAcceptedImages: number;
}

export async function getImageSpendReport(env: Env, buildId: string, slots: ImageSlot[]): Promise<ImageSpendReport> {
  const spend = await env.DB.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM image_attempts WHERE build_id = ?"
  )
    .bind(buildId)
    .first<{ spent: number }>();
  const accepted = await env.DB.prepare(
    "SELECT slot_id FROM accepted_images WHERE build_version_id IN (SELECT id FROM build_versions WHERE build_id = ?)"
  )
    .bind(buildId)
    .all<{ slot_id: string }>();
  const acceptedIds = new Set((accepted.results ?? []).map((row) => row.slot_id));
  return {
    spentUsd: Number((spend?.spent ?? 0).toFixed(4)),
    hardLimitUsd: KIE_SPEND_LIMIT_USD,
    generationBudgetUsd: generationBudgetUsd(),
    repairReserveUsd: Number((KIE_SPEND_LIMIT_USD * REPAIR_RESERVE_RATIO).toFixed(4)),
    acceptedCount: acceptedIds.size,
    unresolvedSlots: slots.filter((slot) => !acceptedIds.has(slot.id)).map((slot) => slot.id),
    targetAcceptedImages: NORMAL_TARGET_ACCEPTED_IMAGES,
  };
}

export class ImageBudgetExceededError extends Error {
  constructor(readonly spentUsd: number, readonly nextCostUsd: number, readonly limitUsd: number) {
    super(`Hard KIE spend gate: spent $${spentUsd.toFixed(2)} + next $${nextCostUsd.toFixed(2)} would exceed $${limitUsd.toFixed(2)}`);
    this.name = "ImageBudgetExceededError";
  }
}

// ── Wave runner ─────────────────────────────────────────────────────────────

export interface RunImageWaveInput {
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  wave: 1 | 2;
  slots: ImageSlot[];
  promptRecords: Map<string, ImagePromptRecord>;
  provider: ImageGenerationProvider;
  /** Spend already committed for this completed Site (defaults to ledger). */
  committedSpendUsd?: number;
}

export interface SlotGenerationOutcome {
  slotId: string;
  status: "accepted" | "failed" | "rejected_budget";
  attemptId?: string;
  r2Key?: string;
  costUsd: number;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function runImageWave(env: Env, input: RunImageWaveInput): Promise<SlotGenerationOutcome[]> {
  const waveSlots = orderSlotsByPriority(input.slots.filter((slot) => waveForSlot(slot) === input.wave));
  const outcomes: SlotGenerationOutcome[] = [];
  let lastProviderError: string | null = null;
  // Issue #47 orientation conformance: measured pixel-dimension mismatches are
  // recorded here for the wave event — a rejected asset burns its attempt's
  // real cost, so the ledger must show where the spend went.
  const orientationRejections: string[] = [];

  for (const slot of waveSlots) {
    const record = input.promptRecords.get(slot.id);
    if (!record) {
      outcomes.push({ slotId: slot.id, status: "failed", costUsd: 0 });
      continue;
    }

    // Workflow-retry safety: attempt numbering resumes from the persisted
    // attempt rows. Restarting at 1 on every re-entry would collide with the
    // UNIQUE (build_version_id, slot_id, attempt_number) index and crash-loop
    // the step for a slot that already has attempts. A slot that already
    // burned its bounded attempts in an earlier pass is skipped as failed —
    // the wave completes and assembly's asset-routing/preflight decides.
    const priorRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM image_attempts WHERE build_version_id = ? AND slot_id = ?"
    )
      .bind(input.buildVersionId, slot.id)
      .first<{ n: number }>();
    const firstAttemptNumber = Number(priorRow?.n ?? 0) + 1;
    if (firstAttemptNumber > MAX_ATTEMPTS_PER_SLOT) {
      outcomes.push({ slotId: slot.id, status: "failed", costUsd: 0 });
      continue;
    }

    const spentRow = await env.DB.prepare(
      "SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM image_attempts WHERE build_id = ?"
    )
      .bind(input.buildId)
      .first<{ spent: number }>();
    const spent = input.committedSpendUsd ?? Number(spentRow?.spent ?? 0);

    let succeeded = false;
    let lastOutcome: SlotGenerationOutcome = { slotId: slot.id, status: "failed", costUsd: 0 };

    for (let attemptNumber = firstAttemptNumber; attemptNumber <= MAX_ATTEMPTS_PER_SLOT && !succeeded; attemptNumber++) {      const attemptId = generateId();
      const createdAt = nowIso();

      // Probe cost without committing.
      let task: { taskId: string; costUsd: number };
      try {
        task = await input.provider.createTask({
          slotId: slot.id,
          promptText: record.promptText,
          aspectRatio: slot.orientation === "portrait" ? "9:16" : slot.orientation === "square" ? "1:1" : "16:9",
        });
      } catch (error) {
        lastProviderError = (error as Error).message;
        await env.DB.prepare(
          `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, cost_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'failed', 0, ?)`
        )
          .bind(attemptId, input.buildId, input.buildVersionId, slot.id, input.wave, attemptNumber, createdAt)
          .run();
        lastOutcome = { slotId: slot.id, status: "failed", costUsd: 0 };
        continue;
      }

      // Hard gate: never exceed the completed-site spend limit.
      if (spent + task.costUsd > KIE_SPEND_LIMIT_USD + 1e-9) {
        await env.DB.prepare(
          `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, cost_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'rejected_budget', 0, ?)`
        )
          .bind(attemptId, input.buildId, input.buildVersionId, slot.id, input.wave, attemptNumber, createdAt)
          .run();
        throw new ImageBudgetExceededError(spent, task.costUsd, KIE_SPEND_LIMIT_USD);
      }

      // Generation-phase budget: preserve the repair reserve; stop starting
      // new work beyond it without failing the Build.
      const generationCeiling = input.wave === 2 ? KIE_SPEND_LIMIT_USD : generationBudgetUsd();
      if (spent + task.costUsd > generationCeiling + 1e-9) {
        await env.DB.prepare(
          `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, cost_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'rejected_budget', 0, ?)`
        )
          .bind(attemptId, input.buildId, input.buildVersionId, slot.id, input.wave, attemptNumber, createdAt)
          .run();
        lastOutcome = { slotId: slot.id, status: "rejected_budget", costUsd: 0 };
        break;
      }

      const result = await input.provider.fetchResult(task.taskId);
      if (result.status !== "complete") {
        await env.DB.prepare(
          `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, provider_task_id, cost_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?)`
        )
          .bind(attemptId, input.buildId, input.buildVersionId, slot.id, input.wave, attemptNumber, task.taskId, task.costUsd, createdAt)
          .run();
        lastOutcome = { slotId: slot.id, status: "failed", costUsd: task.costUsd };
        continue;
      }

      // Issue #47: deterministic orientation conformance BEFORE acceptance —
      // a decodable asset whose measured pixel orientation contradicts the
      // slot's compositional requirement is a failed attempt, never an
      // Accepted Image (the frozen v3 build shipped a 16:9 collage for a 2:3
      // portrait role). Undecodable bytes stay a QA judgment, not a rejection.
      const dimensions = sniffImageDimensions(result.bytes);
      if (dimensions && !orientationConforms(slot.orientation, dimensions)) {
        const r2Key = buildVersionAssetKey(input.buildId, input.buildVersionNumber, `images/${slot.id}-a${attemptNumber}.webp`);
        await putImmutableObjectTolerant(env, r2Key, result.bytes, { httpMetadata: { contentType: "image/webp" } });
        await env.DB.prepare(
          `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, provider_task_id, provider_url, r2_key, cost_usd, checksum, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, ?, ?, ?)`
        )
          .bind(attemptId, input.buildId, input.buildVersionId, slot.id, input.wave, attemptNumber, task.taskId, result.temporaryUrl, r2Key, task.costUsd, await sha256Hex(result.bytes), createdAt)
          .run();
        orientationRejections.push(`${slot.id}: ${slot.orientation} required, measured ${dimensions.width}x${dimensions.height}`);
        lastOutcome = { slotId: slot.id, status: "failed", costUsd: task.costUsd };
        continue;
      }

      // Persist to project-controlled storage; the temporary provider URL is
      // audit-only and never referenced by the Site.
      const r2Key = buildVersionAssetKey(
        input.buildId,
        input.buildVersionNumber,
        `images/${slot.id}-a${attemptNumber}.webp`
      );
      // Tolerant re-freeze: a retried wave re-attempts unaccepted slots under
      // the same deterministic attempt key.
      await putImmutableObjectTolerant(env, r2Key, result.bytes, { httpMetadata: { contentType: "image/webp" } });
      const checksum = await sha256Hex(result.bytes);

      await env.DB.prepare(
        `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, provider_task_id, provider_url, r2_key, cost_usd, checksum, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, ?, ?)`
      )
        .bind(attemptId, input.buildId, input.buildVersionId, slot.id, input.wave, attemptNumber, task.taskId, result.temporaryUrl, r2Key, task.costUsd, checksum, createdAt)
        .run();

      // Acceptance: the attempt satisfies the slot's semantic/compositional
      // requirements for this exact Build Version.
      await env.DB.prepare(
        `INSERT INTO accepted_images (build_version_id, slot_id, attempt_id, r2_key, accepted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (build_version_id, slot_id) DO NOTHING`
      )
        .bind(input.buildVersionId, slot.id, attemptId, r2Key, createdAt)
        .run();

      lastOutcome = { slotId: slot.id, status: "accepted", attemptId, r2Key, costUsd: task.costUsd };
      succeeded = true;
    }

    outcomes.push(lastOutcome);
  }

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: input.wave === 1 ? "SITE_VALIDATION" : "IMAGE_WAVE_1",
    toState: input.wave === 1 ? "IMAGE_WAVE_1" : "IMAGE_WAVE_2",
    stage: input.wave === 1 ? "image_wave_1" : "image_wave_2",
    detail: `Wave ${input.wave}: ${outcomes.filter((outcome) => outcome.status === "accepted").length}/${waveSlots.length} slots accepted${lastProviderError ? `; last provider error: ${lastProviderError.replace(/\s+/g, " ").slice(0, 240)}` : ""}${orientationRejections.length ? `; orientation rejections: ${orientationRejections.join("; ").slice(0, 240)}` : ""}`,
  });

  return outcomes;
}

// ── Full pipeline ───────────────────────────────────────────────────────────
// NOTE (issue #58): the production pipeline now drives images through the
// durable submit → sleep → poll state machine in image-orchestration.ts.
// runImageGeneration/runImageWave remain the synchronous implementation for
// the benchmark harness and focused ledger-semantics tests; the budget,
// attempt and acceptance rules below are the authoritative semantics both
// paths share.

export interface RunImageGenerationInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  slots: ImageSlot[];
  provider: ImageGenerationProvider;
  generate?: RawAiGenerate;
  expandToTarget?: boolean;
}

export interface ImageGenerationResult {
  outcomes: SlotGenerationOutcome[];
  report: ImageSpendReport;
}

export async function runImageGeneration(
  env: Env,
  input: RunImageGenerationInput
): Promise<ImageGenerationResult> {
  const slots = input.expandToTarget === false ? input.slots : expandSlotsToTarget(input.slots);

  const promptRun = await runSchemaValidatedAiStage<ImagePromptRecords>(env, {
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
  const promptRecords = new Map(promptRun.value.records.map((record) => [record.slotId, record]));

  const wave1 = await runImageWave(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    wave: 1,
    slots,
    promptRecords,
    provider: input.provider,
  });
  const wave2 = await runImageWave(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    wave: 2,
    slots,
    promptRecords,
    provider: input.provider,
  });

  const report = await getImageSpendReport(env, input.buildId, slots);
  return { outcomes: [...wave1, ...wave2], report };
}

// Reader: resolved image manifest for assembly (slot -> accepted R2 key).
export async function getAcceptedImageMap(
  env: Env,
  buildVersionId: string
): Promise<Map<string, { r2Key: string; attemptId: string }>> {
  const rows = await env.DB.prepare(
    "SELECT slot_id, attempt_id, r2_key FROM accepted_images WHERE build_version_id = ?"
  )
    .bind(buildVersionId)
    .all<{ slot_id: string; attempt_id: string; r2_key: string }>();
  return new Map((rows.results ?? []).map((row) => [row.slot_id, { r2Key: row.r2_key, attemptId: row.attempt_id }]));
}

export async function loadAcceptedImageBytes(env: Env, r2Key: string): Promise<Uint8Array | null> {
  const body = await getObject(env, r2Key);
  if (!body) return null;
  return new Uint8Array(await new Response(body).arrayBuffer());
}
