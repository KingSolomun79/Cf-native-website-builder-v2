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
import { sha256Hex } from "./crypto";
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
// generation regardless of Blueprint wording. Proof elements (stats, charts,
// UI) must be real HTML/CSS overlays, never baked into generated photography.
//
// FINAL SIMPLE ITERATION (operator GO, 2026-09-09): the negative-prompt policy
// alone is proven insufficient — z-image follows the SCENE semantics and
// fabricates pseudo-text/UI whenever the brief implies screens, whatever the
// prohibition says. The effective provider prompt therefore (1) leads with a
// positive SCENE REWRITE of every screen-bearing clause (deterministic, no
// extra LLM stage, no slot-id hardcoding), and (2) ends with the binding
// SCREEN-FREE photography clause before the negative list.
export const TEXT_SAFE_PHOTO_NEGATIVE =
  "Avoid: text, pseudo-text, gibberish, letters, numbers, logo, signage, dashboard, browser, UI, website screenshot, visible screen, presentation slide, chart, watermark.";

export const SCREEN_FREE_PHOTO_REQUIREMENT =
  "STRICT RULE, overriding any conflicting instruction. SCREEN-FREE PHOTOGRAPHY REQUIREMENT: no readable or pseudo-readable text anywhere; no visible computer, phone, tablet, television or presentation display — any device shows only its back, edge or closed lid, away from camera, off, defocused or cropped out; no browser windows, no dashboards, no charts, no slides, no documents facing the camera, no signage, no labels, no posters, no logos, no UI elements. Natural documentary style, never composed around a blank screen; never invent interface content.";

// Deterministic screen-safe scene adaptation: rewrites the screen-bearing
// clauses of a Blueprint image brief so the SEMANTIC PURPOSE survives (team
// collaboration, analysis, celebration, consulting, presentation) while the
// text-bearing object no longer faces the camera. Pure prompt transform —
// not a model stage. Ordered; specific staging rules first, generic leftovers
// last. Wildcard tails never cross commas (a greedy [a-z ,'-] class once ate
// whole clauses), and "facing" staging rules guard against the rewrites'
// own "rear-facing" outputs. Generalizes over semantic terms, never slot ids.
const SCREEN_SCENE_REWRITES: Array<[RegExp, string]> = [
  // collaboration around open laptops → lids/backs toward the camera
  [/\baround (?:their |the )?laptops?\b/gi, "around laptops turned away from the camera (only lids and backs visible)"],
  // reviewing/analyzing content ON a computer → device closed or rear-facing
  [/\b(?:reviewing|studying|checking|analyzing|reading) (?:[a-z]{3,20} ){0,3}on (?:a |the |their |her |his )?(laptop|notebook|computer|pc)\b/gi,
    "working thoughtfully at the desk, a closed or rear-facing $1 to one side"],
  [/\b(?:reviewing|studying|checking|reading|browsing) (?:[a-z]{3,20} ){0,3}on (?:a |the |their |her |his )?(tablet|ipad|phone|smartphone)\b/gi,
    "reviewing notes in a paper notebook, no $1 display visible"],
  // celebrating/facing a screen (with on-screen content) → no screen in frame
  [/\b(?:in front of|(?<!rear-)facing) (?:a |the |their )?(?:laptop|monitor|screen|display|television)(?: showing [a-z -]{0,24})?/gi,
    "together, no monitor, dashboard or visible screen in frame"],
  // presenting content on a screen → plain-wall staging
  [/\b(?:presenting|explaining) [a-z ]{3,60}? (?:on|via) (?:a )?(?:large |big |giant )?(?:presentation )?(?:screen|monitor|display|television|projector)\b/gi,
    "leading the session, plain wall behind, no presentation screen or signage,"],
  [/\bgesturing toward [a-z -]{0,20}?(?:charts|graphs|slides|dashboard)[a-z -]{0,20}/gi,
    "gesturing expressively as the group follows along"],
  // screen-lit faces → ambient light (a lit face implies a visible screen)
  [/\bscreen glow (?:lighting|illuminating) (?:their|his|her) face,? ?/gi, "soft ambient lighting, "],
  [/\bscreen glow\b/gi, "ambient glow"],
  [/\bglow from screens\b/gi, "glow"],
  // any remaining on-screen content clause
  [/\b(?:showing|displaying|featuring) (?:an |the )?(?:analytics )?(?:dashboard|website|web page|charts?|graphs?|slides?)(?: with [a-z -]{3,40})?/gi, ""],
  // generic leftover device usage → closed/rear-facing device beside them
  [/\b(?:on|at|using|with|over) (?:a |the |their |her |his )?(laptop|notebook|computer|monitor|display|screen|tablet|phone)\b/gi,
    "beside a closed or rear-facing $1"],
  [/\bwith laptops\b/gi, "with closed laptops"],
];

// The brief's own tail policy is superseded by the boundary clause and only
// wastes the 1000-character provider budget. Stripped BEFORE the rewrites so
// their "on screen" tails cannot re-trigger device rules.
const SUPERSEDED_SELF_POLICY: RegExp[] = [
  /,?\s*no readable text(?: or logos)?(?: on screens?)?(?: anywhere)?/gi,
  /,?\s*no text or logos(?: on screens?)?/gi,
];

// Screen-bearing vocabulary whose presence in a brief triggers adaptation
// reporting (matched terms are provenance, not the rewrite itself).
const SCREEN_TERM_PATTERN =
  /\b(laptops?|notebooks?|computers?|monitors?|screens?|displays?|tablets?|phones?|smartphones?|ipad|iphone|dashboards?|analytics|charts?|graphs?|website|web ?pages?|browser|presentations?|slides?|projector?|documents?|paperwork|signage|posters?|billboard|kiosk|television|tv)\b/gi;

export interface ScreenSafeSceneAdaptation {
  effectiveBrief: string;
  adapted: boolean;
  matchedTerms: string[];
}

export function adaptImageSceneToScreenFree(brief: string): ScreenSafeSceneAdaptation {
  const matchedTerms = [...new Set([...brief.matchAll(SCREEN_TERM_PATTERN)].map((m) => m[1].toLowerCase()))];
  let effective = brief;
  for (const pattern of SUPERSEDED_SELF_POLICY) {
    pattern.lastIndex = 0;
    effective = effective.replace(pattern, "");
  }
  let rewrote = false;
  for (const [pattern, replacement] of SCREEN_SCENE_REWRITES) {
    pattern.lastIndex = 0;
    if (pattern.test(effective)) {
      pattern.lastIndex = 0;
      effective = effective.replace(pattern, replacement);
      rewrote = true;
    }
  }
  return { effectiveBrief: effective.replace(/\s{2,}/g, " ").trim(), adapted: matchedTerms.length > 0 || rewrote, matchedTerms };
}

export interface ScreenSafePhotoPrompt {
  prompt: string;
  blueprintPrompt: string;
  screenSafeAdaptationApplied: boolean;
  matchedScreenTerms: string[];
}

// Pure prompt assembly so tests can prove the screen-free adaptation and the
// binding clause survive any brief (including briefs that demand screens)
// within the 1000-char cap.
export function buildScreenSafePhotoPrompt(brief: string, aspectRatio: string): ScreenSafePhotoPrompt {
  const adaptation = adaptImageSceneToScreenFree(brief);
  const head = `Create one natural editorial photograph for a website. ${SCREEN_FREE_PHOTO_REQUIREMENT} Aspect ratio: ${aspectRatio}.`;
  const tail = ` ${TEXT_SAFE_PHOTO_NEGATIVE}.`;
  const budget = MAX_PROMPT_CHARS - head.length - tail.length - 1;
  const fitted =
    adaptation.effectiveBrief.length > budget
      ? `${adaptation.effectiveBrief.slice(0, Math.max(0, budget - 3))}...`
      : adaptation.effectiveBrief;
  return {
    prompt: `${head} ${fitted}${tail}`,
    blueprintPrompt: brief,
    screenSafeAdaptationApplied: adaptation.adapted,
    matchedScreenTerms: adaptation.matchedTerms,
  };
}

// Back-compat string form (existing callers/consumers).
export function assembleTextSafePhotoPrompt(brief: string, aspectRatio: string): string {
  return buildScreenSafePhotoPrompt(brief, aspectRatio).prompt;
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
    // The SCREEN-FREE clause leads the prompt and can never be truncated away
    // by a long slot brief (the brief fills whatever budget remains). Prompt
    // provenance (blueprint vs effective) is logged per attempt for the
    // benchmark evidence trail — hashes only, never secrets.
    const adapted = buildScreenSafePhotoPrompt(task.promptText, task.aspectRatio);
    const blueprintPromptHash = await sha256Hex(adapted.blueprintPrompt);
    const effectivePromptHash = await sha256Hex(adapted.prompt);
    console.info("kie_screen_safe_provenance", {
      slotId: task.slotId,
      screenSafeAdaptationApplied: adapted.screenSafeAdaptationApplied,
      matchedScreenTerms: adapted.matchedScreenTerms,
      blueprintPromptHash,
      effectivePromptHash,
    });
    const assembledPrompt = adapted.prompt;

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
