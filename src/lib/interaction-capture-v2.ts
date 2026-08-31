// Phase 16.R3: auditable, exercised interaction evidence.
//
// Replaces the metadata-only Phase 16.3 path. An interaction is `observed` ONLY
// when its trigger was executed and a resulting state/behavior was recorded.
// Static DOM/CSS discovery is `detected`; fallback is `inferred`. Every observed
// interaction has a unique evidence id + selector, before/after state, a real
// trace/screenshot key, viewport + motion mode, and a verified reset outcome.
// Default and prefers-reduced-motion:reduce are captured as a paired experiment
// and compared. Safe-interaction policy forbids submits, external nav,
// destructive/download/auth/payment actions. Legacy interaction-capture.ts is
// left in place; this is the v2 source of truth wired in by the evidence-attempt
// coordinator.

import type { Env } from "../env.d";
import type {
  CaptureEvidenceRef,
  CaptureFailure,
  CaptureStatus,
  EvidenceClassification,
  EvidenceInteraction,
  EvidenceInteractionCapture,
  EvidenceInteractionManifest,
  EvidenceInteractionRow,
  InteractionTrigger,
  MotionMode,
  ReducedMotionComparison,
  ReducedMotionOutcome,
} from "../types";
import type { ScreenshotEvidenceArtifact } from "./blueprint-schema-v2";
import {
  evidenceInteractionsKey,
  evidenceInteractionsManifestKey,
  evidenceInteractionsRawKey,
  evidenceInteractionsTraceKey,
  evidenceInteractionTraceKey,
  getObject,
  putImmutableObject,
} from "./assets";
import { createInteractionEvidence } from "./db";
import { generateId, nowIso } from "./crypto";
import {
  CAPTURE_NAV_TIMEOUT_MS,
  REFERENCE_VIEWPORTS,
  type ReferenceViewport,
} from "./viewports";
import type {
  BrowserAdapter,
  BrowserPage,
  BrowserSession,
  RawCandidate,
  RawInteractionDetection,
} from "./browser-adapter";
import { assertUnique, buildEvidenceId, evidenceIdSelector } from "./selector";
import { withBrowser } from "./browser-lifecycle";

export interface EvidenceInteractionParams {
  jobId: string;
  clientSlug: string;
  siteVersion: number;
  attemptId: string;
  referenceUrl: string;
  adapter: BrowserAdapter;
  fallbackContext?: InteractionFallbackContext;
}

export interface InteractionFallbackContext {
  sectionOrder: string[];
  navigationStyle: string | null;
  buttonStyle: string | null;
  cardStyle: string | null;
  screenshotInteractions: Array<{ element: string; type: string; description: string }>;
  screenshotR2Key?: string;
}

export function buildInteractionFallbackContext(artifact: ScreenshotEvidenceArtifact): InteractionFallbackContext {
  const observations = artifact.observations;
  const byCategory = (category: ScreenshotEvidenceArtifact["observations"][number]["category"]) => observations.filter((item) => item.category === category);
  const firstText = (category: ScreenshotEvidenceArtifact["observations"][number]["category"]) => byCategory(category)[0]?.observation ?? null;
  const sectionOrder = observations
    .filter((item) => item.category === "layout" || item.category === "spacing")
    .map((item) => item.region?.label ?? "")
    .filter((label, index, labels) => label.length > 0 && labels.indexOf(label) === index);
  const surfaces = byCategory("surfaces");
  return {
    sectionOrder,
    navigationStyle: firstText("navigation"),
    buttonStyle: surfaces.find((item) => /button|cta/i.test(item.observation))?.observation ?? null,
    cardStyle: surfaces.find((item) => /card|panel|tile/i.test(item.observation))?.observation ?? null,
    screenshotInteractions: byCategory("interaction").map((item) => ({
      element: item.region?.label || "element",
      type: "screenshot",
      description: item.observation,
    })),
    screenshotR2Key: artifact.screenshotR2Key,
  };
}

export interface EvidenceInteractionResult {
  manifest: EvidenceInteractionManifest;
  captures: EvidenceInteractionCapture[];
  manifestR2Key: string;
}

const SETTLE_MS = 150;
const PER_TRIGGER_LIMIT = 6;

// Explicit prohibition list. Clicks are restricted to known-safe toggles/menus/
// accordions. No form submission, external navigation, destructive buttons,
// downloads, auth, or payment actions.
function isSafeToClick(c: RawCandidate): boolean {
  if (!c.isToggle || c.external || !!c.href || isDestructive(c)) return false;
  return c.tag === "summary" || c.tag === "details" || c.tag === "button" || c.role === "button";
}

function isDestructive(c: RawCandidate): boolean {
  const t = (c.text ?? "").toLowerCase();
  return /(delete|remove|submit|sign in|log in|log out|pay|checkout|download|register|unsubscribe|confirm)/i.test(t);
}

function evRef(viewport: string, selector: string, screenshotR2Key: string | null): CaptureEvidenceRef {
  return { viewport, selector, screenshotR2Key };
}

function detectedObservation(c: RawCandidate, viewport: string, motionMode: MotionMode): EvidenceInteraction {
  const hasTransitionMotion = c.transitionProperties.length > 0 && c.transitionDuration !== "0s";
  const evidenceId = c.evidenceId;
  return {
    id: generateId(),
    evidenceId,
    trigger: "hover",
    target: c.tag,
    selector: c.selector,
    viewport,
    motionMode,
    role: c.role,
    classification: "detected",
    changedProperties: hasTransitionMotion ? c.transitionProperties : [],
    before: {},
    after: {},
    duration: hasTransitionMotion ? c.transitionDuration : null,
    easing: hasTransitionMotion ? c.transitionTimingFunction : null,
    delay: hasTransitionMotion ? c.transitionDelay : null,
    motionSafe: true,
    relevance: 1,
    traceR2Key: null,
    screenshotR2Key: null,
    reducedMotionComparison: null,
    resetOutcome: "skipped",
    evidence: evRef(viewport, c.selector, null),
  };
}

function buildDetectedBase(detection: RawInteractionDetection, viewport: string, motionMode: MotionMode): EvidenceInteraction[] {
  const out: EvidenceInteraction[] = [];
  for (const c of detection.candidates) {
    for (const trigger of c.triggers) {
      const base = detectedObservation(c, viewport, motionMode);
      base.trigger = trigger as InteractionTrigger;
      out.push(base);
    }
  }
  return out;
}

async function exerciseOne(
  env: Env,
  page: BrowserPage,
  observation: EvidenceInteraction,
  params: EvidenceInteractionParams,
  viewportName: string,
  motionMode: MotionMode,
  candidate: RawCandidate | undefined
): Promise<EvidenceInteraction> {
  const selector = observation.selector;
  try {
    await assertUnique((s) => page.countMatches(s), selector);
  } catch {
    return { ...observation, classification: "skipped", resetOutcome: "skipped" };
  }

  if (observation.trigger === "toggle" && (!candidate || !isSafeToClick(candidate))) {
    return { ...observation, classification: "skipped", resetOutcome: "skipped" };
  }

  try {
    const beforeState = await page.readInteractionState(selector);
    let actionExecuted = true;
    switch (observation.trigger) {
      case "hover": await page.hover(selector); break;
      case "focus": await page.focus(selector); break;
      case "active": await page.pressPointerDown(selector); break;
      case "toggle": await page.toggleAccordionOrMenu(selector); break;
      case "sticky": await page.scrollTo(selector); break;
      case "scroll-reveal": await page.scrollTo(selector); break;
      case "section-transition": await page.scrollTo(selector); break;
      default: actionExecuted = false;
    }
    if (!actionExecuted) return observation;
    await page.settle(SETTLE_MS);
    const afterState = await page.readInteractionState(selector);
    const changed = changedKeys(beforeState, afterState);

    await page.reset();
    const resetState = await page.readInteractionState(selector);
    const resetVerified = changed.every((key) => resetState[key] === beforeState[key]);

    const traceKey = evidenceInteractionTraceKey(
      params.clientSlug,
      params.siteVersion,
      params.attemptId,
      viewportName,
      motionMode,
      observation.id
    );
    await putImmutableObject(env, traceKey, JSON.stringify({
      actionExecuted,
      trigger: observation.trigger,
      selector,
      before: beforeState,
      after: afterState,
      changed,
      reset: resetState,
      resetVerified,
    }, null, 2), { httpMetadata: { contentType: "application/json" } });

    const classification: EvidenceClassification = !resetVerified
      ? "failed"
      : changed.length > 0
        ? "observed"
        : "detected";

    const updated: EvidenceInteraction = {
      ...observation,
      classification,
      changedProperties: changed,
      before: pick(beforeState, changed),
      after: pick(afterState, changed),
      traceR2Key: traceKey,
      screenshotR2Key: null,
      resetOutcome: resetVerified ? "verified" : "failed",
    };
    return updated;
  } catch {
    await page.reset().catch(() => {});
    return { ...observation, classification: "failed", resetOutcome: "failed" };
  }
}

function changedKeys(before: Record<string, string>, after: Record<string, string>): string[] {
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((key) => before[key] !== after[key]);
}

function pick(record: Record<string, string>, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (record[k] !== undefined) out[k] = record[k];
  return out;
}

function compareReducedMotion(defaultObs: EvidenceInteraction[], reducedObs: EvidenceInteraction[]): Map<string, ReducedMotionComparison> {
  const comparisons = new Map<string, ReducedMotionComparison>();
  const reducedByKey = new Map<string, EvidenceInteraction>();
  for (const r of reducedObs) reducedByKey.set(`${r.trigger}:${r.evidenceId}`, r);
  for (const d of defaultObs) {
    const r = reducedByKey.get(`${d.trigger}:${d.evidenceId}`);
    if (!r) continue;
    const defaultChanged = d.changedProperties;
    const reducedChanged = r.changedProperties;
    const defaultDurationMs = parseDurationMs(d.duration);
    const reducedDurationMs = parseDurationMs(r.duration);
    let outcome: ReducedMotionOutcome = "n/a";
    let note = "no motion detected in default mode";
    if (defaultChanged.length > 0 || defaultDurationMs > 0) {
      if (reducedChanged.length === 0 || reducedDurationMs === 0) {
        outcome = "removed";
        note = "motion removed under prefers-reduced-motion: reduce";
      } else if (reducedDurationMs < defaultDurationMs) {
        outcome = "shortened";
        note = `motion shortened from ${defaultDurationMs}ms to ${reducedDurationMs}ms under prefers-reduced-motion: reduce`;
      } else {
        outcome = "unchanged";
        note = "motion unchanged under prefers-reduced-motion: reduce";
      }
    }
    comparisons.set(`${d.trigger}:${d.evidenceId}`, {
      defaultChangedProperties: defaultChanged,
      reducedChangedProperties: reducedChanged,
      defaultDurationMs,
      reducedDurationMs,
      outcome,
      note,
    });
  }
  return comparisons;
}

function parseDurationMs(duration: string | null): number {
  if (!duration) return 0;
  const first = duration.split(",")[0]?.trim() ?? "0";
  if (first.endsWith("ms")) return Number.parseFloat(first) || 0;
  if (first.endsWith("s")) return (Number.parseFloat(first) || 0) * 1000;
  return Number.parseFloat(first) || 0;
}

async function captureViewportInteractions(
  env: Env,
  session: BrowserSession,
  viewport: ReferenceViewport,
  params: EvidenceInteractionParams,
  capturedAt: string
): Promise<EvidenceInteractionCapture[]> {
  const results: EvidenceInteractionCapture[] = [];

  for (const motionMode of ["default", "reduced"] as MotionMode[]) {
    let page: BrowserPage | null = null;
    try {
      page = await session.newPage({ viewport, reducedMotion: motionMode === "reduced" });
      const nav = await page.goto(params.referenceUrl, { timeoutMs: CAPTURE_NAV_TIMEOUT_MS, waitUntil: "networkidle" });
      if (nav.timedOut || (nav.httpStatus !== null && nav.httpStatus >= 400)) {
        const failure: CaptureFailure = nav.timedOut
          ? { code: "NAVIGATION_TIMEOUT", message: `Navigation timed out (${viewport.name}/${motionMode}).` }
          : { code: nav.httpStatus! >= 500 ? "HTTP_5XX" : "HTTP_4XX", message: `Reference returned HTTP ${nav.httpStatus}.` };
        results.push(fallbackCapture(viewport, params.referenceUrl, params, capturedAt, motionMode, failure));
        continue;
      }

      await page.assignEvidenceIds();
      const detection = await page.discoverInteractables();

      const rawKey = evidenceInteractionsRawKey(params.clientSlug, params.siteVersion, params.attemptId, viewport.name, motionMode);
      await putImmutableObject(env, rawKey, JSON.stringify(detection, null, 2), { httpMetadata: { contentType: "application/json" } });

      let observations = buildDetectedBase(detection, viewport.name, motionMode);

      // Exercise a bounded sample per trigger (safe only).
      const byTrigger = new Map<InteractionTrigger, EvidenceInteraction[]>();
      for (const obs of observations) {
        if (obs.classification !== "detected") continue;
        const candidate = detection.candidates.find((c) => c.evidenceId === obs.evidenceId);
        if (!candidate || isDestructive(candidate)) {
          obs.classification = "skipped";
          continue;
        }
        const arr = byTrigger.get(obs.trigger) ?? [];
        arr.push(obs);
        byTrigger.set(obs.trigger, arr);
      }
      for (const [trigger, group] of byTrigger) {
        for (const obs of group.slice(0, PER_TRIGGER_LIMIT)) {
          const idx = observations.indexOf(obs);
          if (idx < 0) continue;
          const candidate = detection.candidates.find((c) => c.evidenceId === obs.evidenceId);
          observations[idx] = await exerciseOne(env, page, obs, params, viewport.name, motionMode, candidate);
        }
      }

      observations = dedupeAndRank(observations);
      const status = deriveStatus(observations);

      const interactionsKey = evidenceInteractionsKey(params.clientSlug, params.siteVersion, params.attemptId, viewport.name, motionMode);
      const capture: EvidenceInteractionCapture = {
        attemptId: params.attemptId,
        viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
        motionMode,
        referenceUrl: params.referenceUrl,
        finalUrl: nav.finalUrl,
        status,
        fallbackReason: null,
        observations,
        tracesR2Key: null,
        rawR2Key: rawKey,
        screenshotR2Key: null,
        interactionsR2Key: interactionsKey,
        capturedAt,
      };
      results.push(capture);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push(fallbackCapture(viewport, params.referenceUrl, params, capturedAt, motionMode, { code: classifyFailureCode(err), message }));
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  return results;
}

export function deriveStatus(observations: EvidenceInteraction[]): CaptureStatus {
  const observed = observations.filter((o) => o.classification === "observed").length;
  if (observed === 0) return observations.some((o) => o.classification === "detected") ? "partial" : "failed";
  return "captured";
}

export function dedupeAndRank(observations: EvidenceInteraction[]): EvidenceInteraction[] {
  const seen = new Map<string, EvidenceInteraction>();
  const rank: Record<EvidenceClassification, number> = { observed: 3, detected: 2, inferred: 1, skipped: 0, failed: 0 };
  for (const obs of observations) {
    const key = `${obs.viewport}:${obs.motionMode}:${obs.trigger}:${obs.evidenceId}`;
    const existing = seen.get(key);
    if (!existing || rank[obs.classification] > rank[existing.classification] || (obs.after && Object.keys(obs.after).length > Object.keys(existing.after).length)) {
      seen.set(key, obs);
    }
  }
  return Array.from(seen.values()).sort((a, b) => rank[b.classification] - rank[a.classification]);
}

function fallbackCapture(
  viewport: ReferenceViewport,
  referenceUrl: string,
  params: EvidenceInteractionParams,
  capturedAt: string,
  motionMode: MotionMode,
  failure: CaptureFailure
): EvidenceInteractionCapture {
  return {
    attemptId: params.attemptId,
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    motionMode,
    referenceUrl,
    finalUrl: null,
    status: "partial",
    fallbackReason: failure,
    observations: fallbackProfile(viewport, motionMode, params.fallbackContext),
    tracesR2Key: null,
    rawR2Key: null,
    screenshotR2Key: params.fallbackContext?.screenshotR2Key ?? null,
    interactionsR2Key: evidenceInteractionsKey(params.clientSlug, params.siteVersion, params.attemptId, viewport.name, motionMode),
    capturedAt,
  };
}

// Non-empty, conservative, page-relevant inferred profile. No autoplay/decorative motion.
export function fallbackProfile(
  viewport: ReferenceViewport,
  motionMode: MotionMode,
  context?: InteractionFallbackContext
): EvidenceInteraction[] {
  const observations: EvidenceInteraction[] = [];
  const inferred = (trigger: InteractionTrigger, target: string, kind: string, idx: number): EvidenceInteraction => {
    const evidenceId = buildEvidenceId({ viewport: viewport.name, kind, index: idx });
    const selector = evidenceIdSelector(evidenceId);
    return {
      id: generateId(),
      evidenceId,
      trigger,
      target,
      selector,
      viewport: viewport.name,
      motionMode,
      role: null,
      classification: "inferred",
      changedProperties: trigger === "hover" || trigger === "focus" ? ["color", "background-color", "opacity"] : [],
      before: {},
      after: {},
      duration: motionMode === "reduced" ? "0ms" : trigger === "section-transition" ? "200ms" : "150ms",
      easing: "ease-out",
      delay: "0s",
      motionSafe: true,
      relevance: 2,
      traceR2Key: null,
      screenshotR2Key: context?.screenshotR2Key ?? null,
      reducedMotionComparison: null,
      resetOutcome: "skipped",
      evidence: evRef(viewport.name, selector, context?.screenshotR2Key ?? null),
    };
  };
  observations.push(
    inferred("hover", "button", "button-hover", 0),
    inferred("focus", "button", "button-focus", 0),
    inferred("active", "button", "button-active", 0),
    inferred("scroll-reveal", "section", "section-reveal", 0)
  );
  if (context?.navigationStyle) {
    observations.push(inferred("hover", "a", "nav-link", 0), inferred("focus", "a", "nav-link", 0));
    if (viewport.name === "mobile" && /menu|drawer|hamburger|collapsed/i.test(context.navigationStyle)) {
      observations.push(inferred("toggle", "button", "navigation-toggle", 0));
    }
  }
  if (context?.buttonStyle) {
    observations.push(
      inferred("hover", "button", "button", 0),
      inferred("focus", "button", "button", 0),
      inferred("active", "button", "button", 0)
    );
  }
  if (context?.cardStyle) observations.push(inferred("hover", "article", "card", 0));
  if ((context?.sectionOrder.length ?? 0) > 1) observations.push(inferred("section-transition", "section", "section", 0));

  for (const [index, hint] of (context?.screenshotInteractions ?? []).entries()) {
    const text = `${hint.type} ${hint.description}`.toLowerCase();
    const trigger: InteractionTrigger | null = /toggle|open|expand/.test(text)
      ? "toggle"
      : /focus/.test(text)
        ? "focus"
        : /active|press/.test(text)
          ? "active"
          : /hover/.test(text)
            ? "hover"
            : /scroll|reveal/.test(text)
              ? "scroll-reveal"
              : null;
    if (trigger) observations.push(inferred(trigger, hint.element || "element", hint.element || "element", index + 1));
  }

  return dedupeAndRank(observations);
}

function classifyFailureCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/dns|enotfound|getaddrinfo/i.test(msg)) return "DNS_FAILURE";
  if (/timeout|timed out/i.test(msg)) return "NAVIGATION_TIMEOUT";
  if (/browser|launch|unavailable/i.test(msg)) return "BROWSER_UNAVAILABLE";
  if (/network|econnrefused|econnreset/i.test(msg)) return "NETWORK_ERROR";
  return "UNKNOWN";
}

async function persistInteractionRow(env: Env, params: EvidenceInteractionParams, capture: EvidenceInteractionCapture): Promise<void> {
  const observedCount = capture.observations.filter((o) => o.classification === "observed").length;
  const detectedCount = capture.observations.filter((o) => o.classification === "detected").length;
  const inferredCount = capture.observations.filter((o) => o.classification === "inferred").length;
  const row: EvidenceInteractionRow = {
    id: generateId(),
    attempt_id: params.attemptId,
    job_id: params.jobId,
    client_slug: params.clientSlug,
    site_version: params.siteVersion,
    viewport: capture.viewport.name,
    motion_mode: capture.motionMode,
    status: capture.status,
    observed_count: observedCount,
    detected_count: detectedCount,
    inferred_count: inferredCount,
    reduced_motion_comparison: JSON.stringify(
      capture.observations
        .filter((observation) => observation.reducedMotionComparison !== null)
        .map((observation) => ({
          evidenceId: observation.evidenceId,
          trigger: observation.trigger,
          comparison: observation.reducedMotionComparison,
        }))
    ),
    traces_r2_key: capture.tracesR2Key,
    interactions_r2_key: capture.interactionsR2Key,
    raw_r2_key: capture.rawR2Key,
    checksum: await checksumJson(capture),
    captured_at: capture.capturedAt,
    created_at: nowIso(),
  };
  await createInteractionEvidence(env.DB, row);
}

async function checksumJson(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const { computeChecksum } = await import("./reference-input");
  return computeChecksum(encoded.buffer as ArrayBuffer);
}

export async function captureInteractionEvidence(env: Env, params: EvidenceInteractionParams): Promise<EvidenceInteractionResult> {
  const capturedAt = nowIso();
  const captures: EvidenceInteractionCapture[] = [];

  let session: BrowserSession | null = null;
  try {
    session = await params.adapter.launch(env);
  } catch (err) {
    const code = classifyFailureCode(err);
    const message = err instanceof Error ? err.message : String(err);
    for (const vp of REFERENCE_VIEWPORTS) {
      for (const motionMode of ["default", "reduced"] as MotionMode[]) {
        captures.push(fallbackCapture(vp, params.referenceUrl, params, capturedAt, motionMode, { code, message }));
      }
    }
  }

  if (session) {
    await withBrowser(session, async (active) => {
      for (const viewport of REFERENCE_VIEWPORTS) {
        const vpCaptures = await captureViewportInteractions(env, active, viewport, params, capturedAt);
        captures.push(...vpCaptures);
      }
    });
  }

  // Attach paired reduced-motion comparisons to default-mode observations.
  attachReducedMotionComparisons(captures);

  for (const capture of captures) {
    const traceKeys = capture.observations
      .map((observation) => observation.traceR2Key)
      .filter((key): key is string => key !== null);
    if (traceKeys.length > 0) {
      capture.tracesR2Key = evidenceInteractionsTraceKey(
        params.clientSlug,
        params.siteVersion,
        params.attemptId,
        capture.viewport.name,
        capture.motionMode
      );
      await putImmutableObject(env, capture.tracesR2Key, JSON.stringify({ traceKeys }, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
    }
    await putImmutableObject(env, capture.interactionsR2Key, JSON.stringify(capture, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });
    await persistInteractionRow(env, params, capture);
  }

  const manifestR2Key = evidenceInteractionsManifestKey(params.clientSlug, params.siteVersion, params.attemptId);
  const overallStatus: CaptureStatus = captures.every((c) => c.status === "captured")
    ? "captured"
    : captures.every((c) => c.status === "failed")
      ? "failed"
      : "partial";
  const manifest: EvidenceInteractionManifest = {
    jobId: params.jobId,
    referenceUrl: params.referenceUrl,
    overallStatus,
    viewports: captures,
    motionSafetyNotes: classifyMotionSafety(captures),
    manifestR2Key,
    capturedAt,
  };
  await putImmutableObject(env, manifestR2Key, JSON.stringify(manifest, null, 2), { httpMetadata: { contentType: "application/json" } });
  return { manifest, captures, manifestR2Key };
}

function attachReducedMotionComparisons(captures: EvidenceInteractionCapture[]): void {
  const byViewport = new Map<string, { defaultObs: EvidenceInteraction[]; reducedObs: EvidenceInteraction[] }>();
  for (const c of captures) {
    const entry = byViewport.get(c.viewport.name) ?? { defaultObs: [], reducedObs: [] };
    if (c.motionMode === "default") entry.defaultObs = c.observations;
    else entry.reducedObs = c.observations;
    byViewport.set(c.viewport.name, entry);
  }
  for (const { defaultObs, reducedObs } of byViewport.values()) {
    const comparisons = compareReducedMotion(defaultObs, reducedObs);
    for (const d of defaultObs) {
      const cmp = comparisons.get(`${d.trigger}:${d.evidenceId}`);
      if (cmp) d.reducedMotionComparison = cmp;
    }
  }
}

export function classifyMotionSafety(captures: EvidenceInteractionCapture[]): string[] {
  const notes: string[] = [];
  for (const capture of captures) {
    for (const o of capture.observations) {
      if (o.reducedMotionComparison && o.reducedMotionComparison.outcome === "unchanged") {
        notes.push(`${capture.viewport.name}: ${o.trigger} on ${o.selector} motion unchanged under prefers-reduced-motion; should be suppressed.`);
      }
    }
  }
  return notes;
}

// Load the interaction manifest for the current promoted attempt (blueprint gen).
export async function loadCurrentInteractionManifest(env: Env, jobId: string, siteVersion: number): Promise<EvidenceInteractionManifest | null> {
  const { getCurrentEvidenceAttempt } = await import("./db");
  const attempt = await getCurrentEvidenceAttempt(env.DB, jobId, siteVersion);
  if (!attempt || attempt.status !== "complete") return null;
  const manifestKey = evidenceInteractionsManifestKey(attempt.clientSlug, siteVersion, attempt.attemptId);
  const body = await getObject(env, manifestKey);
  if (!body) return null;
  return new Response(body).json() as Promise<EvidenceInteractionManifest>;
}
