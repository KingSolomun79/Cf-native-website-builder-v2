import type { Env } from "../env.d";
import type {
  CaptureEvidenceRef,
  CaptureFailure,
  CaptureStatus,
  InteractionCapture,
  InteractionManifest,
  InteractionObservation,
  InteractionTrigger,
  ReferenceInteractionRow,
} from "../types";
import { putObject } from "./assets";
import { referenceInteractionsKey, referenceInteractionsManifestKey } from "./assets";
import { upsertReferenceInteraction } from "./db";
import { generateId, nowIso } from "./crypto";
import { CAPTURE_NAV_TIMEOUT_MS, REFERENCE_VIEWPORTS, type ReferenceViewport } from "./viewports";
import { classifyCaptureFailure } from "./reference-capture";
import { withBrowser } from "./browser-lifecycle";
import type { Browser, Page } from "@cloudflare/playwright";

const TRACKED_PROPS = [
  "opacity",
  "transform",
  "color",
  "background-color",
  "box-shadow",
  "border-color",
  "text-decoration-color",
  "outline-color",
  "scale",
  "translate",
] as const;

const HOVER_SAMPLE_LIMIT = 5;
const FOCUS_SAMPLE_LIMIT = 3;

interface RawCandidate {
  selector: string;
  tag: string;
  role: string | null;
  text: string | null;
  triggers: InteractionTrigger[];
  transitionProperties: string[];
  transitionDuration: string;
  transitionTimingFunction: string;
  transitionDelay: string;
  hasAnimation: boolean;
  animationName: string;
  resting: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
}

interface RawDetection {
  reducedMotion: boolean;
  candidates: RawCandidate[];
  sticky: string[];
  revealCandidates: Array<{ selector: string; properties: string[]; duration: string; easing: string; delay: string }>;
  finalUrl: string;
}

const DETECT_INTERACTIONS_SCRIPT = `(() => {
  const trim = (s) => (s ? String(s).replace(/\\s+/g, " ").trim().slice(0, 120) : null);
  const hint = (el) => { if (el.id) return "#" + el.id; const tag = el.tagName.toLowerCase(); const role = el.getAttribute("role"); if (role) return tag + "[role=\\"" + role + "\\"]"; const cls = el.className && typeof el.className === "string" ? el.className.trim().split(/\\s+/)[0] : ""; return cls ? tag + "." + cls : tag; };
  const tracked = ["opacity","transform","color","background-color","box-shadow","border-color","text-decoration-color","outline-color","scale","translate"];
  const styleOf = (el) => getComputedStyle(el);
  const transitionOf = (el) => { const s = styleOf(el); return { props: (s.transitionProperty || "none").split(", ").map((p) => p.trim()).filter((p) => p && p !== "all"), dur: s.transitionDuration || "0s", ease: s.transitionTimingFunction || "ease", delay: s.transitionDelay || "0s" }; };
  const restingOf = (el) => { const s = styleOf(el); const out = {}; tracked.forEach((p) => { const camel = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); out[p] = s[camel]; }); return out; };
  const selector = "a[href], button, [role=button], summary, input, select, textarea, [tabindex], details, [aria-expanded], nav a";
  const reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const candidates = [];
  Array.from(document.querySelectorAll(selector)).slice(0, 80).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const triggers = [];
    const cursor = styleOf(el).cursor;
    if (tag === "a" || tag === "button" || role === "button" || cursor === "pointer") triggers.push("hover", "active");
    if (tag === "a" || tag === "button" || tag === "input" || tag === "select" || tag === "textarea" || el.hasAttribute("tabindex")) triggers.push("focus");
    if (tag === "summary" || tag === "details" || el.hasAttribute("aria-expanded")) triggers.push("toggle");
    if (triggers.length === 0) triggers.push("hover");
    const t = transitionOf(el);
    const anim = styleOf(el).animationName;
    candidates.push({ selector: hint(el), tag, role, text: trim(el.textContent), triggers: Array.from(new Set(triggers)), transitionProperties: t.props, transitionDuration: t.dur, transitionTimingFunction: t.ease, transitionDelay: t.delay, hasAnimation: !!anim && anim !== "none", animationName: anim || "", resting: restingOf(el), bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } });
  });
  const sticky = Array.from(document.querySelectorAll("*")).slice(0, 400).filter((el) => getComputedStyle(el).position === "sticky").map(hint);
  const revealSelector = "[data-aos], [class*=reveal i], [class*=animate i], [class*=fade i], [class*=slide i]";
  const revealCandidates = Array.from(document.querySelectorAll(revealSelector)).slice(0, 30).map((el) => { const t = transitionOf(el); return { selector: hint(el), properties: t.props, duration: t.dur, easing: t.ease, delay: t.delay }; });
  return { reducedMotion, candidates, sticky, revealCandidates, finalUrl: location.href };
})()`;

export interface InteractionParams {
  jobId: string;
  clientSlug: string;
  siteVersion: number;
  referenceUrl: string;
}

export async function captureInteractions(env: Env, params: InteractionParams): Promise<InteractionManifest> {
  const { jobId, clientSlug, siteVersion, referenceUrl } = params;
  const capturedAt = nowIso();
  const captures: InteractionCapture[] = [];

  let browser: Browser | null = null;
  try {
    browser = await launchInteractionBrowser(env);
  } catch (err) {
    const failure = classifyCaptureFailure(err, { phase: "launch" });
    for (const vp of REFERENCE_VIEWPORTS) {
      captures.push(buildFallbackCapture(vp, referenceUrl, clientSlug, siteVersion, failure, capturedAt));
      await persistInteractionRow(env, jobId, clientSlug, siteVersion, captures[captures.length - 1]);
    }
    return finalizeInteractionManifest(env, jobId, referenceUrl, captures, capturedAt, clientSlug, siteVersion);
  }

  return withBrowser(browser, async (activeBrowser) => {
    for (const viewport of REFERENCE_VIEWPORTS) {
      const capture = await captureViewportInteractions(env, activeBrowser, viewport, referenceUrl, clientSlug, siteVersion, jobId, capturedAt);
      captures.push(capture);
      await persistInteractionRow(env, jobId, clientSlug, siteVersion, capture);
      await persistInteractionJson(env, clientSlug, siteVersion, capture);
    }

    return finalizeInteractionManifest(env, jobId, referenceUrl, captures, capturedAt, clientSlug, siteVersion);
  });
}

async function launchInteractionBrowser(env: Env): Promise<Browser> {
  const { launch } = await import("@cloudflare/playwright");
  return await launch(env.BROWSER);
}

async function captureViewportInteractions(
  env: Env,
  browser: Browser,
  viewport: ReferenceViewport,
  referenceUrl: string,
  clientSlug: string,
  siteVersion: number,
  jobId: string,
  capturedAt: string
): Promise<InteractionCapture> {
  let page: Page | null = null;
  try {
    page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    let navigated = false;
    try {
      await page.goto(referenceUrl, { waitUntil: "networkidle", timeout: CAPTURE_NAV_TIMEOUT_MS });
      navigated = true;
    } catch {
      navigated = false;
    }
    if (!navigated) {
      const failure = classifyCaptureFailure(new Error("navigation failed before interaction capture"), { phase: "navigate", viewport });
      return buildFallbackCapture(viewport, referenceUrl, clientSlug, siteVersion, failure, capturedAt);
    }

    const raw = await page.evaluate<RawDetection>(DETECT_INTERACTIONS_SCRIPT);
    const observations = normalizeInteractions(raw, viewport);

    const hoverSample = raw.candidates.filter((c) => c.triggers.includes("hover")).slice(0, HOVER_SAMPLE_LIMIT);
    for (const candidate of hoverSample) {
      try {
        const after = await exerciseStateChange(page, candidate.selector, "hover");
        if (after) applyObservedStateChange(observations, candidate.selector, "hover", candidate.resting, after);
      } catch {
        // exercising this candidate failed; motion metadata still recorded as observed
      }
    }

    const focusSample = raw.candidates.filter((c) => c.triggers.includes("focus")).slice(0, FOCUS_SAMPLE_LIMIT);
    for (const candidate of focusSample) {
      try {
        const after = await exerciseStateChange(page, candidate.selector, "focus");
        if (after) applyObservedStateChange(observations, candidate.selector, "focus", candidate.resting, after);
      } catch {
        // focus exercising failed; motion metadata still recorded
      }
    }

    const ranked = dedupeAndRank(observations);
    const screenshotKey = null;

    return {
      viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
      referenceUrl,
      status: deriveInteractionStatus(ranked, raw.reducedMotion),
      reducedMotionDetected: raw.reducedMotion,
      fallbackReason: null,
      observations: ranked,
      screenshotR2Key: screenshotKey,
      interactionsR2Key: referenceInteractionsKey(clientSlug, siteVersion, viewport.name),
      capturedAt,
    };
  } catch (err) {
    const failure = classifyCaptureFailure(err, { phase: "evaluate", viewport });
    return buildFallbackCapture(viewport, referenceUrl, clientSlug, siteVersion, failure, capturedAt);
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function exerciseStateChange(
  page: Page,
  selector: string,
  kind: "hover" | "focus"
): Promise<Record<string, string> | null> {
  if (kind === "hover") {
    await page.hover(selector);
  } else {
    await page.focus(selector);
  }
  return page.evaluate<Record<string, string> | null>(
    `((sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); const out = {}; ["opacity","transform","color","background-color","box-shadow","border-color","text-decoration-color","outline-color","scale","translate"].forEach((p) => { const camel = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); out[p] = s[camel]; }); return out; })(${JSON.stringify(selector)})`
  );
}

function applyObservedStateChange(
  observations: InteractionObservation[],
  selector: string,
  trigger: InteractionTrigger,
  before: Record<string, string>,
  after: Record<string, string>
): void {
  const changed = TRACKED_PROPS.filter((p) => before[p] !== after[p]);
  if (changed.length === 0) return;
  const obs = observations.find((o) => o.selector === selector && o.trigger === trigger);
  if (obs) {
    obs.before = pick(before, changed);
    obs.after = pick(after, changed);
    obs.changedProperties = changed;
  }
}

function pick(record: Record<string, string>, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = record[k];
  return out;
}

export function normalizeInteractions(raw: RawDetection, viewport: ReferenceViewport): InteractionObservation[] {
  const observations: InteractionObservation[] = [];
  const evRef = (selector: string): CaptureEvidenceRef => ({ viewport: viewport.name, selector, screenshotR2Key: null });

  for (const c of raw.candidates) {
    const hasTransitionMotion = c.transitionProperties.length > 0 && c.transitionDuration !== "0s";
    for (const trigger of c.triggers) {
      observations.push({
        id: generateId(),
        trigger,
        target: c.tag,
        selector: c.selector,
        viewport: viewport.name,
        role: c.role,
        observed: true,
        changedProperties: hasTransitionMotion ? c.transitionProperties : [],
        before: {},
        after: {},
        duration: hasTransitionMotion ? c.transitionDuration : null,
        easing: hasTransitionMotion ? c.transitionTimingFunction : null,
        delay: hasTransitionMotion ? c.transitionDelay : null,
        motionSafe: isMotionSafe(trigger, c.transitionDuration, c.hasAnimation),
        relevance: scoreRelevance(trigger, c.transitionProperties, c.transitionDuration, c.hasAnimation),
        evidence: evRef(c.selector),
      });
    }
    if (c.hasAnimation) {
      observations.push({
        id: generateId(),
        trigger: "section-transition",
        target: c.tag,
        selector: c.selector,
        viewport: viewport.name,
        role: c.role,
        observed: true,
        changedProperties: [],
        before: {},
        after: {},
        duration: null,
        easing: null,
        delay: null,
        motionSafe: isMotionSafe("section-transition", "0s", true),
        relevance: 2,
        evidence: evRef(c.selector),
      });
    }
  }

  for (const stickySelector of raw.sticky) {
    observations.push({
      id: generateId(),
      trigger: "sticky",
      target: "element",
      selector: stickySelector,
      viewport: viewport.name,
      role: null,
      observed: true,
      changedProperties: [],
      before: {},
      after: {},
      duration: null,
      easing: null,
      delay: null,
      motionSafe: true,
      relevance: 3,
      evidence: evRef(stickySelector),
    });
  }

  for (const reveal of raw.revealCandidates) {
    observations.push({
      id: generateId(),
      trigger: "scroll-reveal",
      target: "element",
      selector: reveal.selector,
      viewport: viewport.name,
      role: null,
      observed: true,
      changedProperties: reveal.properties,
      before: {},
      after: {},
      duration: reveal.duration,
      easing: reveal.easing,
      delay: reveal.delay,
      motionSafe: isMotionSafe("scroll-reveal", reveal.duration, false),
      relevance: 3,
      evidence: evRef(reveal.selector),
    });
  }

  return observations;
}

export function buildFallbackCapture(
  viewport: ReferenceViewport,
  referenceUrl: string,
  clientSlug: string,
  siteVersion: number,
  failure: CaptureFailure,
  capturedAt: string
): InteractionCapture {
  const observations = fallbackProfile(viewport);
  return {
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    referenceUrl,
    status: "partial",
    reducedMotionDetected: false,
    fallbackReason: failure,
    observations,
    screenshotR2Key: null,
    interactionsR2Key: referenceInteractionsKey(clientSlug, siteVersion, viewport.name),
    capturedAt,
  };
}

export function fallbackProfile(viewport: ReferenceViewport): InteractionObservation[] {
  const evRef = (selector: string): CaptureEvidenceRef => ({ viewport: viewport.name, selector, screenshotR2Key: null });
  const inferred = (
    trigger: InteractionTrigger,
    target: string,
    selector: string,
    duration: string,
    easing: string,
    relevance: number
  ): InteractionObservation => ({
    id: generateId(),
    trigger,
    target,
    selector,
    viewport: viewport.name,
    role: null,
    observed: false,
    changedProperties: trigger === "hover" || trigger === "focus" ? ["color", "background-color", "opacity"] : [],
    before: {},
    after: {},
    duration,
    easing,
    delay: "0s",
    motionSafe: true,
    relevance,
    evidence: evRef(selector),
  });

  return [
    inferred("hover", "a", "nav a", "150ms", "ease-out", 4),
    inferred("focus", "a", "nav a", "150ms", "ease-out", 4),
    inferred("hover", "button", "button", "150ms", "ease-out", 4),
    inferred("focus", "button", "button", "150ms", "ease-out", 4),
    inferred("active", "a", "a", "0ms", "ease", 2),
    inferred("scroll-reveal", "section", "[data-reveal]", "500ms", "ease-out", 3),
    inferred("section-transition", "section", "section", "200ms", "ease-out", 2),
  ];
}

export function dedupeAndRank(observations: InteractionObservation[]): InteractionObservation[] {
  const seen = new Map<string, InteractionObservation>();
  for (const obs of observations) {
    const key = `${obs.viewport}:${obs.trigger}:${obs.selector}`;
    const existing = seen.get(key);
    if (!existing || obs.relevance > existing.relevance || (obs.relevance === existing.relevance && obs.after && Object.keys(obs.after).length > Object.keys(existing.after).length)) {
      seen.set(key, obs);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.relevance - a.relevance);
}

export function isMotionSafe(trigger: InteractionTrigger, transitionDuration: string, hasAnimation: boolean): boolean {
  const ms = parseDurationMs(transitionDuration);
  if (trigger === "scroll-reveal" && ms > 800) return false;
  if (trigger === "section-transition" && hasAnimation && ms > 1000) return false;
  return true;
}

export function classifyMotionSafety(captures: InteractionCapture[]): string[] {
  const notes: string[] = [];
  for (const capture of captures) {
    const unsafe = capture.observations.filter((o) => !o.motionSafe);
    for (const o of unsafe) {
      notes.push(`${capture.viewport.name}: ${o.trigger} on ${o.selector} exceeds reduced-motion budget (${o.duration}); disable or simplify under prefers-reduced-motion.`);
    }
    if (capture.reducedMotionDetected) {
      notes.push(`${capture.viewport.name}: reference signals prefers-reduced-motion: reduce; all non-essential motion must be suppressed downstream.`);
    }
  }
  return notes;
}

export function deriveInteractionStatus(observations: InteractionObservation[], reducedMotionDetected: boolean): CaptureStatus {
  const observed = observations.filter((o) => o.observed).length;
  if (observed === 0) return "failed";
  if (reducedMotionDetected || observations.some((o) => !o.motionSafe)) return "partial";
  return "captured";
}

function parseDurationMs(duration: string | null): number {
  if (!duration) return 0;
  const trimmed = duration.trim();
  if (trimmed.endsWith("ms")) return parseFloat(trimmed) || 0;
  if (trimmed.endsWith("s")) return (parseFloat(trimmed) || 0) * 1000;
  return parseFloat(trimmed) || 0;
}

function scoreRelevance(trigger: InteractionTrigger, properties: string[], duration: string, hasAnimation: boolean): number {
  let score = 1;
  if (trigger === "hover" || trigger === "focus") score += 2;
  if (trigger === "toggle") score += 1;
  if (properties.some((p) => ["transform", "opacity", "box-shadow", "background-color", "color"].includes(p))) score += 1;
  const ms = parseDurationMs(duration);
  if (ms > 0 && ms <= 400) score += 1;
  if (hasAnimation) score += 1;
  return score;
}

async function persistInteractionRow(
  env: Env,
  jobId: string,
  clientSlug: string,
  siteVersion: number,
  capture: InteractionCapture
): Promise<void> {
  const observedCount = capture.observations.filter((o) => o.observed).length;
  const inferredCount = capture.observations.filter((o) => !o.observed).length;
  const row: ReferenceInteractionRow = {
    id: generateId(),
    job_id: jobId,
    client_slug: clientSlug,
    site_version: siteVersion,
    viewport: capture.viewport.name,
    status: capture.status,
    observed_count: observedCount,
    inferred_count: inferredCount,
    reduced_motion_detected: capture.reducedMotionDetected ? 1 : 0,
    fallback_reason: capture.fallbackReason ? JSON.stringify(capture.fallbackReason) : null,
    interactions_r2_key: capture.interactionsR2Key,
    manifest_r2_key: referenceInteractionsManifestKey(clientSlug, siteVersion),
    captured_at: capture.capturedAt,
    created_at: nowIso(),
  };
  await upsertReferenceInteraction(env.DB, row);
}

async function persistInteractionJson(
  env: Env,
  clientSlug: string,
  siteVersion: number,
  capture: InteractionCapture
): Promise<void> {
  await putObject(env, capture.interactionsR2Key, JSON.stringify(capture, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function finalizeInteractionManifest(
  env: Env,
  jobId: string,
  referenceUrl: string,
  captures: InteractionCapture[],
  capturedAt: string,
  clientSlug: string,
  siteVersion: number
): Promise<InteractionManifest> {
  const manifest: InteractionManifest = {
    jobId,
    referenceUrl,
    overallStatus: captures.every((c) => c.status === "captured")
      ? "captured"
      : captures.every((c) => c.status === "failed")
        ? "failed"
        : "partial",
    viewports: captures,
    motionSafetyNotes: classifyMotionSafety(captures),
    manifestR2Key: referenceInteractionsManifestKey(clientSlug, siteVersion),
    capturedAt,
  };
  await putObject(env, manifest.manifestR2Key, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return manifest;
}
