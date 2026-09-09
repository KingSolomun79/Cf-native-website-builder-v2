// V2 KIE image-generation provider adapter (issue #10 production wiring).
//
// Bridges the V2 ImageGenerationProvider boundary (src/domain/image-pipeline.ts)
// onto the retained KIE.ai jobs API. Image generation is NOT an LLM call — the
// KIE_MODEL var selects the image model and is untouched by the canonical
// glm-5.3-flash LLM routing decision.
//
// Budget accounting: the USD 3.00 hard completed-site spend gate debits each
// task at the configured KIE_TASK_COST_USD estimate (default $0.05/task,
// ~$0.70 for a normal 12-14 slot plan — the gate still bounds total attempts
// if a provider misbehaves). KIE's own `charge` field is read when present and
// logged for reconciliation; the attempt ledger keeps the estimate.

import type { Env } from "../env.d";
import type {
  ImageGenerationProvider,
  ImageProviderFetchResult,
  ResolvedSlotTask,
} from "../domain/image-pipeline";

export const KIE_TASK_COST_USD_DEFAULT = 0.05;
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS_DEFAULT = 150_000;
// KIE z-image documents a 1000-character prompt maximum; exceeding it fails
// with code 500 "The text length cannot exceed the maximum limit" (live
// evidence, issue #30). Cap the assembled prompt at the documented limit.
export const KIE_MAX_PROMPT_CHARS = 1000;
const MAX_PROMPT_CHARS = KIE_MAX_PROMPT_CHARS;
const CREATE_MAX_ATTEMPTS = 3;

// Text-safe photography policy (benchmark hardening, Phase 3 finding: KIE
// photographs baked in fake dashboards/analytics UI/pseudo-text). Applied
// deterministically at the KIE image-request boundary to EVERY photographic
// generation regardless of Blueprint wording; it overrides any conflicting
// instruction inside the slot brief, which is truncated to fit AFTER the
// policy. Proof elements (stats, charts, UI) must be real HTML/CSS overlays,
// never baked into generated photography.
export const TEXT_SAFE_PHOTO_POLICY =
  "STRICT RULE, overriding any conflicting instruction: the photograph must contain NO visible or pseudo-visible writing — no text, no letters, no numbers, no logos or brand marks, no signage, no posters, no labels, no documents, no website pages, no dashboards, no analytics interfaces, no presentation slides, no charts with labels or axes. If the scene includes a laptop, monitor, tablet or phone, its screen faces away from the camera, is switched off, strongly defocused, cropped out, or reads only as a plain glow. Never invent interface content.";
export const TEXT_SAFE_PHOTO_NEGATIVE =
  "Avoid: text, pseudo-text, gibberish letters, numbers, logos, signage, website screenshot, user interface, dashboard, browser window, analytics UI, readable monitor, presentation slide, poster, watermark, label.";

// Pure prompt assembly so tests can prove the policy survives any brief
// (including briefs that ask for screens/analytics) within the 1000-char cap.
export function assembleTextSafePhotoPrompt(brief: string, aspectRatio: string): string {
  const head = `Create one natural editorial photograph intended to be placed inside a website. ${TEXT_SAFE_PHOTO_POLICY} Aspect ratio: ${aspectRatio}.`;
  const tail = ` ${TEXT_SAFE_PHOTO_NEGATIVE}.`;
  const budget = MAX_PROMPT_CHARS - head.length - tail.length - 1;
  const fitted = brief.length > budget ? `${brief.slice(0, Math.max(0, budget - 3))}...` : brief;
  return `${head} ${fitted}${tail}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface KieTaskRecord {
  code: number;
  msg?: string;
  data?: {
    state?: string;
    resultJson?: string;
    failMsg?: string;
    charge?: number;
  };
}

export class KieV2ImageProvider implements ImageGenerationProvider {
  constructor(private env: Env) {}

  private get costUsd(): number {
    const parsed = Number.parseFloat(this.env.KIE_TASK_COST_USD ?? "");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : KIE_TASK_COST_USD_DEFAULT;
  }

  private get pollTimeoutMs(): number {
    const parsed = Number.parseInt(this.env.KIE_POLL_TIMEOUT_MS ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : POLL_TIMEOUT_MS_DEFAULT;
  }

  // Deterministic pre-submission cost estimate (issue #58 §17): the same
  // configured estimate createTask reports, available BEFORE any remote task
  // exists so the durable budget gate can reject without spending.
  estimateCost(): number {
    return this.costUsd;
  }

  async createTask(task: ResolvedSlotTask): Promise<{ taskId: string; costUsd: number }> {
    // The text-safe policy leads the prompt and can never be truncated away
    // by a long slot brief (the brief fills whatever budget remains).
    const assembledPrompt = assembleTextSafePhotoPrompt(task.promptText, task.aspectRatio);

    // KIE rate-limits bursts (live evidence, issue #30: 429 "call frequency
    // too high"); back off and retry the same creation.
    let lastError = "unknown";
    for (let attempt = 1; attempt <= CREATE_MAX_ATTEMPTS; attempt++) {
      let result: { code: number; msg?: string; data?: { taskId?: string } };
      try {
        const response = await fetch(`${this.env.KIE_API_URL}/api/v1/jobs/createTask`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.env.KIE_API_KEY}`,
          },
          body: JSON.stringify({
            model: this.env.KIE_MODEL,
            callBackUrl: `${this.env.PUBLIC_APP_URL}/api/internal/kie-callback`,
            input: {
              prompt: assembledPrompt,
              aspect_ratio: task.aspectRatio,
              nsfw_checker: true,
            },
          }),
        });
        result = (await response.json()) as { code: number; msg?: string; data?: { taskId?: string } };
      } catch (error) {
        lastError = (error as Error).message;
        result = { code: 0 };
      }
      if (result.code === 200 && result.data?.taskId) {
        return { taskId: result.data.taskId, costUsd: this.costUsd };
      }
      lastError = JSON.stringify(result).slice(0, 300);
      if (result.code === 429 && attempt < CREATE_MAX_ATTEMPTS) {
        await sleep(8000 * attempt);
        continue;
      }
      break;
    }
    throw new Error(`KIE task creation failed: ${lastError}`);
  }

  private async recordInfo(taskId: string): Promise<KieTaskRecord> {
    const response = await fetch(`${this.env.KIE_API_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${this.env.KIE_API_KEY}` },
    });
    return (await response.json()) as KieTaskRecord;
  }

  // ONE short status probe with no internal waiting (issue #58). Transport
  // failures THROW so the durable poll step's bounded retry policy handles
  // them; a provider job still running is the normal 'pending' state, never
  // an error (Workflow retries are for failures — provider waiting is
  // Workflow control flow).
  async checkResult(taskId: string): Promise<ImageProviderFetchResult> {
    let record: KieTaskRecord;
    try {
      record = await this.recordInfo(taskId);
    } catch (error) {
      throw new Error(`KIE status probe failed for task ${taskId}: ${(error as Error).message}`);
    }

    const state = record.data?.state;
    if (state === "success") {
      try {
        const parsed = JSON.parse(record.data?.resultJson ?? "{}") as { resultUrls?: string[] };
        const temporaryUrl = parsed.resultUrls?.[0];
        if (!temporaryUrl) return { status: "failed" };
        if (typeof record.data?.charge === "number" && record.data.charge > 0) {
          console.info("kie_task_charge", { taskId, charge: record.data.charge });
        }
        const bytes = await this.download(temporaryUrl);
        return bytes ? { status: "complete", bytes, temporaryUrl } : { status: "failed" };
      } catch {
        return { status: "failed" };
      }
    }
    if (state === "fail") {
      console.error(`KIE task ${taskId} failed: ${record.data?.failMsg ?? "unknown"}`);
      return { status: "failed" };
    }
    return { status: "pending" };
  }

  // Called once immediately after createTask; polls the bounded window so the
  // wave runner sees a completed image rather than a spurious "pending".
  async fetchResult(taskId: string): Promise<ImageProviderFetchResult> {
    const deadline = Date.now() + this.pollTimeoutMs;
    let last: KieTaskRecord | null = null;

    while (Date.now() < deadline) {
      let record: KieTaskRecord;
      try {
        record = await this.recordInfo(taskId);
      } catch {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      last = record;

      const state = record.data?.state;
      if (state === "success") {
        try {
          const parsed = JSON.parse(record.data?.resultJson ?? "{}") as { resultUrls?: string[] };
          const temporaryUrl = parsed.resultUrls?.[0];
          if (!temporaryUrl) return { status: "failed" };
          if (typeof record.data?.charge === "number" && record.data.charge > 0) {
            console.info("kie_task_charge", { taskId, charge: record.data.charge });
          }
          const bytes = await this.download(temporaryUrl);
          return bytes ? { status: "complete", bytes, temporaryUrl } : { status: "failed" };
        } catch {
          return { status: "failed" };
        }
      }
      if (state === "fail") {
        console.error(`KIE task ${taskId} failed: ${record.data?.failMsg ?? "unknown"}`);
        return { status: "failed" };
      }
      await sleep(POLL_INTERVAL_MS);
    }

    console.warn(`KIE task ${taskId} still pending after ${this.pollTimeoutMs}ms (last: ${JSON.stringify(last)?.slice(0, 200)})`);
    return { status: "pending" };
  }

  private async download(temporaryUrl: string): Promise<Uint8Array | null> {
    const response = await fetch(temporaryUrl);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  }
}
