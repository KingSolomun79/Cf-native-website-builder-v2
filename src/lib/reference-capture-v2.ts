// Phase 16.R3: auditable responsive-layout evidence capture.
//
// Replaces the metadata-only Phase 16.2 path with structured navigation
// diagnostics (HTTP status, redirects, failed/blocked resources, timeouts,
// overlays), raw + normalized evidence persisted separately + immutably under
// an attempt id, spacing rhythm, and provably-unique selectors. Depends on the
// typed BrowserAdapter, not @cloudflare/playwright directly. Legacy
// reference-capture.ts is left in place; this is the v2 source of truth wired in
// by the evidence-attempt coordinator.

import type { Env } from "../env.d";
import type {
  CaptureDiagnostics,
  CaptureEvidenceRef,
  CaptureFailure,
  CaptureImage,
  CaptureNavItem,
  CaptureSection,
  CaptureSpacing,
  CaptureStatus,
  CaptureTypeStyle,
  EvidenceReferenceCapture,
  EvidenceReferenceCaptureRow,
  RedirectEntry,
  ReferenceCapture,
  ReferenceCaptureManifest,
  ResponsiveDiff,
} from "../types";
import {
  evidenceCaptureJsonKey,
  evidenceCaptureManifestKey,
  evidenceCaptureRawKey,
  evidenceCaptureScreenshotKey,
  getObject,
  putImmutableObject,
} from "./assets";
import { computeChecksum } from "./reference-input";
import { createCaptureEvidence, getCaptureEvidenceForAttempt } from "./db";

async function checksumJson(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  return computeChecksum(encoded.buffer as ArrayBuffer);
}
import { generateId, nowIso } from "./crypto";
import { validateReferenceUrl } from "./reference-input";
import {
  CAPTURE_NAV_TIMEOUT_MS,
  REFERENCE_VIEWPORTS,
  type ReferenceViewport,
} from "./viewports";
import type {
  BrowserAdapter,
  BrowserPage,
  BrowserSession,
  RawLayout,
} from "./browser-adapter";
import { withBrowser } from "./browser-lifecycle";

export interface EvidenceCaptureParams {
  jobId: string;
  clientSlug: string;
  siteVersion: number;
  attemptId: string;
  referenceUrl: string;
  adapter: BrowserAdapter;
}

export interface EvidenceCaptureResult {
  manifest: ReferenceCaptureManifest;
  captures: EvidenceReferenceCapture[];
  manifestR2Key: string;
}

function classifyHttpStatus(status: number | null): CaptureFailure | null {
  if (status === null) return null;
  if (status >= 500) return { code: "HTTP_5XX", message: `Reference returned HTTP ${status}.` };
  if (status >= 400) return { code: "HTTP_4XX", message: `Reference returned HTTP ${status}.` };
  return null;
}

function deriveCaptureStatus(diagnostics: CaptureDiagnostics, failure: CaptureFailure | null): CaptureStatus {
  if (failure) {
    if (failure.code === "HTTP_5XX" || failure.code === "HTTP_4XX") return "failed";
    return "partial";
  }
  if (diagnostics.failedResources.length > 0 || diagnostics.overlayLimitations.length > 0) return "partial";
  return "captured";
}

function evRef(viewport: string, selector: string, screenshotR2Key: string | null): CaptureEvidenceRef {
  return { viewport, selector, screenshotR2Key };
}

function normalizeLayout(
  raw: RawLayout,
  viewport: ReferenceViewport,
  referenceUrl: string,
  diagnostics: CaptureDiagnostics,
  screenshotR2Key: string | null,
  capturedAt: string,
  attemptId: string
): EvidenceReferenceCapture {
  const failure = classifyHttpStatus(diagnostics.httpStatus);
  const status = deriveCaptureStatus(diagnostics, failure);

  const sections: CaptureSection[] = raw.sections.map((s) => ({
    order: s.order,
    tag: s.tag,
    role: s.role,
    heading: s.heading,
    text: s.text,
    bounds: s.bounds,
    evidence: evRef(viewport.name, s.evidenceId ? `[data-cf-evidence-id="${s.evidenceId}"]` : viewport.name, screenshotR2Key),
  }));

  const typography: CaptureTypeStyle[] = raw.typography.map((t) => ({
    element: t.element,
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    textTransform: t.textTransform,
    evidence: evRef(viewport.name, t.evidenceId ? `[data-cf-evidence-id="${t.evidenceId}"]` : t.element, screenshotR2Key),
  }));

  const colors = {
    background: raw.colors.background,
    text: raw.colors.text,
    accents: raw.colors.accents,
    evidence: evRef(viewport.name, "body", screenshotR2Key),
  };

  const nav: CaptureNavItem[] = raw.nav.map((n) => ({
    href: n.href,
    text: n.text,
    external: n.external,
    evidence: evRef(viewport.name, n.evidenceId ? `[data-cf-evidence-id="${n.evidenceId}"]` : "nav a", screenshotR2Key),
  }));

  const images: CaptureImage[] = raw.images.map((im) => ({
    src: im.src,
    alt: im.alt,
    naturalWidth: im.naturalWidth,
    naturalHeight: im.naturalHeight,
    displayedWidth: im.displayedWidth,
    evidence: evRef(viewport.name, im.evidenceId ? `[data-cf-evidence-id="${im.evidenceId}"]` : "img", screenshotR2Key),
  }));

  const spacing: CaptureSpacing | null = raw.spacing
    ? {
        sectionPadding: raw.spacing.sectionPadding,
        sectionMargin: raw.spacing.sectionMargin,
        rhythm: raw.spacing.rhythm,
        evidence: evRef(viewport.name, raw.spacing.evidenceId ? `[data-cf-evidence-id="${raw.spacing.evidenceId}"]` : "section", screenshotR2Key),
      }
    : null;

  const limitations = [...diagnostics.overlayLimitations];
  if (diagnostics.redirects.length > 0) {
    limitations.push(`${diagnostics.redirects.length} redirect(s) before final URL; chain recorded in diagnostics.redirects`);
  }
  if (diagnostics.failedResources.length > 0) {
    limitations.push(`${diagnostics.failedResources.length} failed resource(s); see diagnostics.failedResources`);
  }
  if (diagnostics.blockedResources.length > 0) {
    limitations.push(`${diagnostics.blockedResources.length} blocked resource(s); see diagnostics.blockedResources`);
  }
  if (diagnostics.timedOut) {
    limitations.push("navigation readiness timed out; capture may be incomplete");
  }

  return {
    attemptId,
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    referenceUrl,
    finalUrl: raw.finalUrl,
    diagnostics,
    status,
    failure,
    screenshotR2Key,
    rawR2Key: null,
    title: raw.title,
    lang: raw.lang,
    description: raw.description,
    viewportMeta: raw.viewportMeta,
    sections,
    typography,
    colors,
    nav,
    images,
    spacing,
    limitations,
    capturedAt,
  };
}

async function captureViewport(
  env: Env,
  session: BrowserSession,
  viewport: ReferenceViewport,
  params: EvidenceCaptureParams,
  capturedAt: string
): Promise<EvidenceReferenceCapture> {
  let page: BrowserPage | null = null;
  const failedBase = (failure: CaptureFailure): EvidenceReferenceCapture => ({
    attemptId: params.attemptId,
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    referenceUrl: params.referenceUrl,
    finalUrl: null,
    diagnostics: { httpStatus: null, redirects: [], failedResources: [], blockedResources: [], timedOut: false, overlayLimitations: [] },
    status: "failed",
    failure,
    screenshotR2Key: null,
    rawR2Key: null,
    title: null,
    lang: null,
    description: null,
    viewportMeta: null,
    sections: [],
    typography: [],
    colors: { background: null, text: null, accents: [], evidence: evRef(viewport.name, "body", null) },
    nav: [],
    images: [],
    spacing: null,
    limitations: [failure.message],
    capturedAt,
  });

  try {
    page = await session.newPage({ viewport, reducedMotion: false });
    const nav = await page.goto(params.referenceUrl, { timeoutMs: CAPTURE_NAV_TIMEOUT_MS, waitUntil: "networkidle" });

    if (nav.timedOut) {
      return failedBase({ code: "NAVIGATION_TIMEOUT", message: `Navigation to ${params.referenceUrl} timed out.` });
    }

    // DNS-rebinding mitigation: re-check the final redirected URL.
    if (nav.finalUrl && validateReferenceUrl(nav.finalUrl) === null) {
      return failedBase({ code: "DISALLOWED_REDIRECT", message: `Reference navigation resolved to a disallowed final URL: ${nav.finalUrl}` });
    }

    const httpFailure = classifyHttpStatus(nav.httpStatus);
    await page.assignEvidenceIds();
    const raw = await page.extractLayout();

    const screenshotKey = evidenceCaptureScreenshotKey(params.clientSlug, params.siteVersion, params.attemptId, viewport.name);
    const rawKey = evidenceCaptureRawKey(params.clientSlug, params.siteVersion, params.attemptId, viewport.name);
    const captureKey = evidenceCaptureJsonKey(params.clientSlug, params.siteVersion, params.attemptId, viewport.name);

    const diagnostics: CaptureDiagnostics = {
      httpStatus: nav.httpStatus,
      redirects: nav.redirectChain,
      failedResources: nav.failedResources,
      blockedResources: nav.blockedResources,
      timedOut: nav.timedOut,
      overlayLimitations: raw.consentDetected ? ["consent or cookie overlay detected; captured content may be incomplete"] : [],
    };

    const normalized = normalizeLayout(
      raw,
      viewport,
      params.referenceUrl,
      diagnostics,
      httpFailure === null ? screenshotKey : null,
      capturedAt,
      params.attemptId
    );
    normalized.rawR2Key = rawKey;

    await putImmutableObject(env, rawKey, JSON.stringify(raw, null, 2), { httpMetadata: { contentType: "application/json" } });
    if (httpFailure === null && normalized.status !== "failed") {
      const screenshot = await page.screenshot({ fullPage: true });
      await putImmutableObject(env, screenshotKey, screenshot, { httpMetadata: { contentType: "image/png" } });
    }
    await putImmutableObject(env, captureKey, JSON.stringify(normalized, null, 2), { httpMetadata: { contentType: "application/json" } });

    return normalized;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failedBase({ code: classifyFailureCode(err), message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

function classifyFailureCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/dns|enotfound|getaddrinfo/i.test(msg)) return "DNS_FAILURE";
  if (/timeout|timed out/i.test(msg)) return "NAVIGATION_TIMEOUT";
  if (/browser|launch|unavailable/i.test(msg)) return "BROWSER_UNAVAILABLE";
  if (/network|econnrefused|econnreset/i.test(msg)) return "NETWORK_ERROR";
  return "UNKNOWN";
}

export async function captureResponsiveEvidence(env: Env, params: EvidenceCaptureParams): Promise<EvidenceCaptureResult> {
  const capturedAt = nowIso();
  const captures: EvidenceReferenceCapture[] = [];

  let session: BrowserSession | null = null;
  try {
    session = await params.adapter.launch(env);
  } catch (err) {
    const code = classifyFailureCode(err);
    const message = err instanceof Error ? err.message : String(err);
    for (const vp of REFERENCE_VIEWPORTS) {
      captures.push({
        attemptId: params.attemptId,
        viewport: { name: vp.name, width: vp.width, height: vp.height },
        referenceUrl: params.referenceUrl,
        finalUrl: null,
        diagnostics: { httpStatus: null, redirects: [], failedResources: [], blockedResources: [], timedOut: false, overlayLimitations: [] },
        status: "failed",
        failure: { code, message },
        screenshotR2Key: null,
        rawR2Key: null,
        title: null, lang: null, description: null, viewportMeta: null,
        sections: [], typography: [], colors: { background: null, text: null, accents: [], evidence: evRef(vp.name, "body", null) },
        nav: [], images: [], spacing: null, limitations: [message], capturedAt,
      });
      await persistCaptureRow(env, params, captures[captures.length - 1]);
    }
  }

  if (session) {
    await withBrowser(session, async (active) => {
      for (const viewport of REFERENCE_VIEWPORTS) {
        const capture = await captureViewport(env, active, viewport, params, capturedAt);
        captures.push(capture);
        await persistCaptureRow(env, params, capture);
      }
    });
  }

  const manifest = finalizeManifest(params, captures, capturedAt);
  await putImmutableObject(env, manifest.manifestR2Key, JSON.stringify(manifest.manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return { manifest: manifest.manifest, captures, manifestR2Key: manifest.manifestR2Key };
}

async function persistCaptureRow(env: Env, params: EvidenceCaptureParams, capture: EvidenceReferenceCapture): Promise<void> {
  const row: EvidenceReferenceCaptureRow = {
    id: generateId(),
    attempt_id: params.attemptId,
    job_id: params.jobId,
    client_slug: params.clientSlug,
    site_version: params.siteVersion,
    viewport: capture.viewport.name,
    http_status: capture.diagnostics.httpStatus,
    status: capture.status,
    diagnostics: JSON.stringify(capture.diagnostics),
    raw_r2_key: capture.rawR2Key,
    screenshot_r2_key: capture.screenshotR2Key,
    capture_json_r2_key: capture.rawR2Key
      ? evidenceCaptureJsonKey(params.clientSlug, params.siteVersion, params.attemptId, capture.viewport.name)
      : null,
    checksum: await checksumJson(capture),
    captured_at: capture.capturedAt,
    created_at: nowIso(),
  };
  await createCaptureEvidence(env.DB, row);
}

function finalizeManifest(params: EvidenceCaptureParams, captures: EvidenceReferenceCapture[], capturedAt: string): { manifest: ReferenceCaptureManifest; manifestR2Key: string } {
  const manifestR2Key = evidenceCaptureManifestKey(params.clientSlug, params.siteVersion, params.attemptId);
  const overallStatus: CaptureStatus = captures.every((c) => c.status === "captured")
    ? "captured"
    : captures.every((c) => c.status === "failed")
      ? "failed"
      : "partial";

  const viewports: ReferenceCapture[] = captures.map((c) => ({
    viewport: c.viewport,
    referenceUrl: c.referenceUrl,
    finalUrl: c.finalUrl,
    status: c.status,
    failure: c.failure,
    screenshotR2Key: c.screenshotR2Key,
    title: c.title,
    lang: c.lang,
    description: c.description,
    viewportMeta: c.viewportMeta,
    sections: c.sections,
    typography: c.typography,
    colors: c.colors,
    nav: c.nav,
    images: c.images,
    redirects: c.diagnostics.redirects.map((r: RedirectEntry) => r.url),
    limitations: c.limitations,
    capturedAt: c.capturedAt,
  }));

  const manifest: ReferenceCaptureManifest = {
    jobId: params.jobId,
    referenceUrl: params.referenceUrl,
    finalUrl: captures.find((capture) => capture.finalUrl)?.finalUrl ?? null,
    overallStatus,
    viewports,
    responsiveDiffs: diffResponsive(captures),
    manifestR2Key,
    capturedAt,
  };

  return { manifest, manifestR2Key };
}

export function diffResponsive(captures: EvidenceReferenceCapture[]): ResponsiveDiff[] {
  const diffs: ResponsiveDiff[] = [];
  const desktop = captures.find((c) => c.viewport.name === "desktop");
  const mobile = captures.find((c) => c.viewport.name === "mobile");
  if (!desktop || !mobile) return diffs;

  if (desktop.nav.length !== mobile.nav.length) {
    diffs.push({
      kind: "nav",
      description: `Navigation item count differs: desktop ${desktop.nav.length} vs mobile ${mobile.nav.length} (mobile menu likely present).`,
      fromViewport: "desktop",
      toViewport: "mobile",
      evidence: evRef("mobile", "nav", mobile.screenshotR2Key),
    });
  }
  const desktopSectionIds = new Set(desktop.sections.map((s) => s.tag));
  const mobileHidden = desktop.sections.filter((s) => !mobile.sections.some((m) => m.tag === s.tag));
  for (const hidden of mobileHidden.slice(0, 3)) {
    if (!desktopSectionIds.has(hidden.tag)) continue;
    diffs.push({
      kind: "hidden",
      description: `Section "${hidden.heading ?? hidden.tag}" present on desktop but not visible on mobile.`,
      fromViewport: "desktop",
      toViewport: "mobile",
      evidence: evRef("desktop", hidden.evidence.selector, desktop.screenshotR2Key),
    });
  }
  const dBody = desktop.typography.find((t) => t.element === "body");
  const mBody = mobile.typography.find((t) => t.element === "body");
  if (dBody && mBody && dBody.fontSize !== mBody.fontSize) {
    diffs.push({
      kind: "typography",
      description: `Body font size differs: desktop ${dBody.fontSize} vs mobile ${mBody.fontSize}.`,
      fromViewport: "desktop",
      toViewport: "mobile",
      evidence: evRef("mobile", "body", mobile.screenshotR2Key),
    });
  }
  return diffs;
}

// Load the capture manifest for the current promoted attempt (used by blueprint gen).
export async function loadCurrentCaptureManifest(env: Env, jobId: string, siteVersion: number): Promise<ReferenceCaptureManifest | null> {
  const { getCurrentEvidenceAttempt } = await import("./db");
  const attempt = await getCurrentEvidenceAttempt(env.DB, jobId, siteVersion);
  if (!attempt || attempt.status !== "complete") return null;
  const manifestKey = evidenceCaptureManifestKey(attempt.clientSlug, siteVersion, attempt.attemptId);
  const body = await getObject(env, manifestKey);
  if (!body) return null;
  return new Response(body).json() as Promise<ReferenceCaptureManifest>;
}

export async function loadCurrentCaptureRows(env: Env, jobId: string, siteVersion: number): Promise<EvidenceReferenceCaptureRow[]> {
  const { getCurrentEvidenceAttempt } = await import("./db");
  const attempt = await getCurrentEvidenceAttempt(env.DB, jobId, siteVersion);
  if (!attempt) return [];
  return getCaptureEvidenceForAttempt(env.DB, attempt.attemptId);
}
