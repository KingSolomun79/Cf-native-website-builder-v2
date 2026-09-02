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
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS_DEFAULT = 150_000;

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

  async createTask(task: ResolvedSlotTask): Promise<{ taskId: string; costUsd: number }> {
    const assembledPrompt = [
      "Create one natural editorial photograph intended to be placed inside a website, grounded in the supplied slot brief and accepted design blueprint.",
      `Slot: ${task.slotId}.`,
      `Aspect ratio: ${task.aspectRatio}.`,
      task.promptText,
      "Output only the photographic scene: no website, browser, application interface, screen, device frame, UI layout, wireframe, poster, infographic, collage, or mockup.",
      "Do not add text, letters, logos, navigation, buttons, badges, statistics, testimonials, awards, or unsupported factual claims.",
    ].join(" ");

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

    const result = (await response.json()) as { code: number; msg?: string; data?: { taskId?: string } };
    if (result.code !== 200 || !result.data?.taskId) {
      throw new Error(`KIE task creation failed: ${JSON.stringify(result).slice(0, 300)}`);
    }
    return { taskId: result.data.taskId, costUsd: this.costUsd };
  }

  private async recordInfo(taskId: string): Promise<KieTaskRecord> {
    const response = await fetch(`${this.env.KIE_API_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${this.env.KIE_API_KEY}` },
    });
    return (await response.json()) as KieTaskRecord;
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
