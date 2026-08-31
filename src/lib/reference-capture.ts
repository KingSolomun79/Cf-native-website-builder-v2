import type { Env } from "../env.d";
import type {
  CaptureEvidenceRef,
  CaptureFailure,
  CaptureImage,
  CaptureNavItem,
  CaptureSection,
  CaptureStatus,
  CaptureTypeStyle,
  ReferenceCapture,
  ReferenceCaptureManifest,
  ReferenceCaptureRow,
  ResponsiveDiff,
} from "../types";
import {
  putObject,
  referenceCaptureJsonKey,
  referenceCaptureManifestKey,
  referenceCaptureScreenshotKey,
} from "./assets";
import { upsertReferenceCapture } from "./db";
import { generateId, nowIso } from "./crypto";
import { validateReferenceUrl } from "./reference-input";
import {
  CAPTURE_MAX_RETRIES,
  CAPTURE_NAV_TIMEOUT_MS,
  REFERENCE_VIEWPORTS,
  type ReferenceViewport,
} from "./viewports";
import { withBrowser } from "./browser-lifecycle";
import type { Browser, Page } from "@cloudflare/playwright";

interface RawBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RawSection {
  order: number;
  tag: string;
  role: string | null;
  heading: string | null;
  text: string | null;
  bounds: RawBounds;
  selector: string;
}

interface RawTypeStyle {
  element: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  selector: string;
}

interface RawColors {
  background: string;
  text: string;
  accents: string[];
}

interface RawExtraction {
  finalUrl: string;
  title: string | null;
  lang: string | null;
  description: string | null;
  viewportMeta: string | null;
  sections: RawSection[];
  typography: RawTypeStyle[];
  colors: RawColors;
  nav: Array<{ href: string; text: string | null; external: boolean }>;
  images: Array<{
    src: string;
    alt: string | null;
    naturalWidth: number;
    naturalHeight: number;
    displayedWidth: number;
  }>;
  consentDetected: boolean;
  redirectCount: number;
}

const EXTRACT_PAGE_SCRIPT = `(() => {
  const trim = (s) => (s ? String(s).replace(/\\s+/g, " ").trim().slice(0, 300) : null);
  const round = (n) => Math.round(n);
  const boundsOf = (el) => { const r = el.getBoundingClientRect(); return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) }; };
  const hint = (el) => { if (el.id) return "#" + el.id; const tag = el.tagName.toLowerCase(); const role = el.getAttribute("role"); return role ? tag + "[role=\\"" + role + "\\"]" : tag; };
  const styleOf = (el) => { const s = getComputedStyle(el); return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textTransform: s.textTransform }; };
  const landmark = "header, [role=banner], nav, [role=navigation], main, [role=main], section, article, aside, footer, [role=contentinfo]";
  const sections = Array.from(document.querySelectorAll(landmark))
    .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
    .slice(0, 40)
    .map((el, i) => { const h = el.querySelector("h1, h2, h3, h4"); return { order: i, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), heading: h ? trim(h.textContent) : null, text: trim(el.textContent), bounds: boundsOf(el), selector: hint(el) }; });
  const typeTargets = [["body", "body"], ["h1", "h1"], ["h2", "h2"], ["p", "p"], ["a", "a"]];
  const typography = typeTargets.map(([key, sel]) => { const el = sel === "body" ? document.body : document.querySelector(sel); if (!el) return null; const s = styleOf(el); s.element = key; s.selector = sel === "body" ? "body" : sel + ":first-of-type"; return s; }).filter(Boolean);
  const bodyStyle = getComputedStyle(document.body);
  const counts = new Map();
  Array.from(document.querySelectorAll("h1, h2, h3, a, button, [role=button]")).slice(0, 60).forEach((el) => { const s = getComputedStyle(el); [s.color, s.backgroundColor].forEach((c) => { if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") counts.set(c, (counts.get(c) || 0) + 1); }); });
  const accents = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);
  const colors = { background: bodyStyle.backgroundColor, text: bodyStyle.color, accents };
  const nav = Array.from(document.querySelectorAll("nav a, [role=navigation] a")).slice(0, 40).map((a) => { let external = false; try { external = a.href ? new URL(a.href, location.href).origin !== location.origin : false; } catch (e) {} return { href: a.href || "", text: trim(a.textContent), external }; });
  const images = Array.from(document.querySelectorAll("img")).slice(0, 40).map((img) => { const r = img.getBoundingClientRect(); return { src: img.currentSrc || img.src || "", alt: trim(img.getAttribute("aria-label") || img.alt), naturalWidth: img.naturalWidth || 0, naturalHeight: img.naturalHeight || 0, displayedWidth: round(r.width) }; });
  const viewportMeta = document.querySelector("meta[name=viewport]") ? document.querySelector("meta[name=viewport]").getAttribute("content") : null;
  const description = document.querySelector("meta[name=description]") ? document.querySelector("meta[name=description]").getAttribute("content") : null;
  const consentSelector = "[id*=cookie i], [class*=cookie i], [id*=consent i], [class*=consent i], [id*=gdpr i], [aria-label*=cookie i]";
  const consentDetected = !!document.querySelector(consentSelector);
  let redirectCount = 0; const navEntry = (performance.getEntriesByType("navigation") || [])[0]; if (navEntry && typeof navEntry.redirectCount === "number") redirectCount = navEntry.redirectCount;
  return { finalUrl: location.href, title: trim(document.title), lang: document.documentElement.lang || null, description: trim(description), viewportMeta: viewportMeta, sections, typography, colors, nav, images, consentDetected, redirectCount };
})()`;

export interface CaptureParams {
  jobId: string;
  clientSlug: string;
  siteVersion: number;
  referenceUrl: string;
}

export async function captureReferenceEvidence(
  env: Env,
  params: CaptureParams
): Promise<ReferenceCaptureManifest> {
  const { jobId, clientSlug, siteVersion, referenceUrl } = params;
  const capturedAt = nowIso();
  const captures: ReferenceCapture[] = [];

  let browser: Browser | null = null;
  try {
    browser = await launchBrowser(env);
  } catch (err) {
    const failure = classifyCaptureFailure(err, { phase: "launch" });
    for (const vp of REFERENCE_VIEWPORTS) {
      captures.push(failedCapture(vp, referenceUrl, failure, capturedAt));
      await persistCaptureRow(env, jobId, clientSlug, siteVersion, captures[captures.length - 1]);
    }
    return finalizeManifest(env, jobId, referenceUrl, captures, capturedAt, clientSlug, siteVersion);
  }

  return withBrowser(browser, async (activeBrowser) => {
    for (const viewport of REFERENCE_VIEWPORTS) {
      const capture = await captureViewport(env, activeBrowser, viewport, referenceUrl, clientSlug, siteVersion, jobId, capturedAt);
      captures.push(capture);
      await persistCaptureRow(env, jobId, clientSlug, siteVersion, capture);
      await persistCaptureJson(env, clientSlug, siteVersion, capture);
    }

    return finalizeManifest(env, jobId, referenceUrl, captures, capturedAt, clientSlug, siteVersion);
  });
}

async function launchBrowser(env: Env): Promise<Browser> {
  const { launch } = await import("@cloudflare/playwright");
  return await launch(env.BROWSER);
}

async function captureViewport(
  env: Env,
  browser: Browser,
  viewport: ReferenceViewport,
  referenceUrl: string,
  clientSlug: string,
  siteVersion: number,
  jobId: string,
  capturedAt: string
): Promise<ReferenceCapture> {
  let page: Page | null = null;
  try {
    page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });

    let lastErr: unknown = null;
    let navigated = false;
    for (let attempt = 0; attempt <= CAPTURE_MAX_RETRIES; attempt++) {
      try {
        await page.goto(referenceUrl, { waitUntil: "networkidle", timeout: CAPTURE_NAV_TIMEOUT_MS });
        navigated = true;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!navigated) {
      const failure = classifyCaptureFailure(lastErr, { phase: "navigate", viewport });
      return failedCapture(viewport, referenceUrl, failure, capturedAt);
    }

    // DNS-rebinding mitigation: re-check the final post-redirect URL. Intake
    // validation already rejects literal private/local hosts, but a public host
    // could redirect to an internal address. validateReferenceUrl rejects
    // credentials and literal private/local/loopback hosts. This does NOT fully
    // prevent DNS rebinding (a host could resolve public at validation time and
    // private at fetch time); full prevention requires Browser Run network policy.
    const finalUrl = page.url();
    if (finalUrl && validateReferenceUrl(finalUrl) === null) {
      const failure = classifyCaptureFailure(
        new Error(`Reference navigation resolved to a disallowed final URL: ${finalUrl}`),
        { phase: "navigate", viewport }
      );
      return failedCapture(viewport, referenceUrl, failure, capturedAt);
    }

    const raw = await page.evaluate<RawExtraction>(EXTRACT_PAGE_SCRIPT);
    const screenshot = await page.screenshot({ type: "png", fullPage: true });
    const screenshotR2Key = referenceCaptureScreenshotKey(clientSlug, siteVersion, viewport.name);
    await putObject(env, screenshotR2Key, Uint8Array.from(screenshot).buffer, {
      httpMetadata: { contentType: "image/png" },
    });

    return normalizeCapture(raw, viewport, referenceUrl, screenshotR2Key, capturedAt);
  } catch (err) {
    const failure = classifyCaptureFailure(err, { phase: "evaluate", viewport });
    return failedCapture(viewport, referenceUrl, failure, capturedAt);
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export function normalizeCapture(
  raw: RawExtraction,
  viewport: ReferenceViewport,
  referenceUrl: string,
  screenshotR2Key: string,
  capturedAt: string
): ReferenceCapture {
  const evRef = (selector: string): CaptureEvidenceRef => ({
    viewport: viewport.name,
    selector,
    screenshotR2Key,
  });

  const sections: CaptureSection[] = raw.sections.map((s) => ({
    order: s.order,
    tag: s.tag,
    role: s.role,
    heading: s.heading,
    text: s.text,
    bounds: s.bounds,
    evidence: evRef(s.selector),
  }));

  const typography: CaptureTypeStyle[] = raw.typography.map((t) => ({
    element: t.element,
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    textTransform: t.textTransform,
    evidence: evRef(t.selector),
  }));

  const colors = {
    background: raw.colors.background,
    text: raw.colors.text,
    accents: raw.colors.accents,
    evidence: evRef("body"),
  };

  const nav: CaptureNavItem[] = raw.nav.map((n) => ({
    href: n.href,
    text: n.text,
    external: n.external,
    evidence: evRef("nav a"),
  }));

  const images: CaptureImage[] = raw.images.map((im) => ({
    src: im.src,
    alt: im.alt,
    naturalWidth: im.naturalWidth,
    naturalHeight: im.naturalHeight,
    displayedWidth: im.displayedWidth,
    evidence: evRef("img"),
  }));

  const limitations: string[] = [];
  if (raw.consentDetected) {
    limitations.push("consent or cookie overlay detected; captured content may be incomplete");
  }
  if (raw.redirectCount > 0) {
    limitations.push(`${raw.redirectCount} redirect(s) before final URL; intermediate URLs not recorded`);
  }
  if (sections.length === 0) {
    limitations.push("no visible landmark sections detected");
  }

  const status: CaptureStatus = limitations.length > 0 ? "partial" : "captured";

  const redirects = raw.redirectCount > 0 ? [`${referenceUrl} -> ${raw.finalUrl}`] : [];

  return {
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    referenceUrl,
    finalUrl: raw.finalUrl,
    status,
    failure: null,
    screenshotR2Key,
    title: raw.title,
    lang: raw.lang,
    description: raw.description,
    viewportMeta: raw.viewportMeta,
    sections,
    typography,
    colors,
    nav,
    images,
    redirects,
    limitations,
    capturedAt,
  };
}

export function failedCapture(
  viewport: ReferenceViewport,
  referenceUrl: string,
  failure: CaptureFailure,
  capturedAt: string
): ReferenceCapture {
  return {
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    referenceUrl,
    finalUrl: null,
    status: "failed",
    failure,
    screenshotR2Key: null,
    title: null,
    lang: null,
    description: null,
    viewportMeta: null,
    sections: [],
    typography: [],
    colors: { background: null, text: null, accents: [], evidence: { viewport: viewport.name, selector: "", screenshotR2Key: null } },
    nav: [],
    images: [],
    redirects: [],
    limitations: [`capture failed: ${failure.message}`],
    capturedAt,
  };
}

export function classifyCaptureFailure(err: unknown, context: { phase: string; viewport?: ReferenceViewport }): CaptureFailure {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (context.phase === "launch" || lower.includes("browser") || lower.includes("playwright")) {
    return { code: "BROWSER_UNAVAILABLE", message: `Browser rendering unavailable: ${message}` };
  }
  if (/timeout|timed[\s_]out/.test(lower)) {
    return { code: "NAVIGATION_TIMEOUT", message: `Navigation timed out within ${CAPTURE_NAV_TIMEOUT_MS}ms: ${message}` };
  }
  if (lower.includes("enetunreach") || lower.includes("dns") || lower.includes("getaddrinfo") || lower.includes("enotfound")) {
    return { code: "DNS_FAILURE", message: `Could not resolve reference host: ${message}` };
  }
  const httpMatch = message.match(/\b(4\d{2}|5\d{2})\b/);
  if (httpMatch) {
    const code = httpMatch[1].startsWith("4") ? "HTTP_4XX" : "HTTP_5XX";
    return { code, message: `Reference URL returned HTTP ${httpMatch[1]}: ${message}` };
  }
  if (lower.includes("net::err") || lower.includes("connection") || lower.includes("socket")) {
    return { code: "NETWORK_ERROR", message: `Network error reaching reference URL: ${message}` };
  }
  return { code: "UNKNOWN", message: `Capture failed during ${context.phase}: ${message}` };
}

export function diffResponsiveCaptures(captures: ReferenceCapture[]): ResponsiveDiff[] {
  const diffs: ResponsiveDiff[] = [];
  const byName = new Map(captures.filter((c) => c.status !== "failed").map((c) => [c.viewport.name, c]));
  const pairs: Array<[string, string]> = [["desktop", "tablet"], ["tablet", "mobile"]];

  for (const [from, to] of pairs) {
    const a = byName.get(from);
    const b = byName.get(to);
    if (!a || !b) continue;

    const ev = (selector: string): CaptureEvidenceRef => ({ viewport: to, selector, screenshotR2Key: b.screenshotR2Key });

    if (a.sections.length !== b.sections.length) {
      diffs.push({
        kind: "layout",
        description: `Section count changed from ${a.sections.length} (${from}) to ${b.sections.length} (${to}).`,
        fromViewport: from,
        toViewport: to,
        evidence: ev("main"),
      });
    } else {
      const shifted = a.sections.filter((sa, i) => {
        const sb = b.sections[i];
        return sb && Math.abs(sa.bounds.width - sb.bounds.width) > 40;
      });
      if (shifted.length > 0) {
        diffs.push({
          kind: "layout",
          description: `${shifted.length} section(s) changed width by more than 40px between ${from} and ${to}.`,
          fromViewport: from,
          toViewport: to,
          evidence: ev(shifted[0].evidence.selector),
        });
      }
    }

    if (a.nav.length !== b.nav.length) {
      diffs.push({
        kind: "nav",
        description: `Visible navigation items changed from ${a.nav.length} (${from}) to ${b.nav.length} (${to}); likely a responsive menu collapse.`,
        fromViewport: from,
        toViewport: to,
        evidence: ev("nav a"),
      });
    }

    const aBody = a.typography.find((t) => t.element === "body");
    const bBody = b.typography.find((t) => t.element === "body");
    if (aBody && bBody && aBody.fontSize !== bBody.fontSize) {
      diffs.push({
        kind: "typography",
        description: `Body font-size changed from ${aBody.fontSize} (${from}) to ${bBody.fontSize} (${to}).`,
        fromViewport: from,
        toViewport: to,
        evidence: ev("body"),
      });
    }

    const fromNames = new Set(a.sections.map((s) => `${s.tag}:${s.heading ?? ""}`));
    const removed = b.sections.filter((sb) => !fromNames.has(`${sb.tag}:${sb.heading ?? ""}`));
    if (removed.length > 0 && a.sections.length > b.sections.length) {
      diffs.push({
        kind: "hidden",
        description: `${removed.length} section(s) visible at ${from} are not present at ${to}.`,
        fromViewport: from,
        toViewport: to,
        evidence: ev(removed[0].evidence.selector),
      });
    }
  }

  return diffs;
}

export function deriveOverallStatus(captures: ReferenceCapture[]): CaptureStatus {
  if (captures.length === 0) return "failed";
  if (captures.every((c) => c.status === "captured")) return "captured";
  if (captures.every((c) => c.status === "failed")) return "failed";
  return "partial";
}

async function persistCaptureRow(
  env: Env,
  jobId: string,
  clientSlug: string,
  siteVersion: number,
  capture: ReferenceCapture
): Promise<void> {
  const row: ReferenceCaptureRow = {
    id: generateId(),
    job_id: jobId,
    client_slug: clientSlug,
    site_version: siteVersion,
    viewport: capture.viewport.name,
    width: capture.viewport.width,
    height: capture.viewport.height,
    final_url: capture.finalUrl,
    status: capture.status,
    failure_code: capture.failure?.code ?? null,
    failure_message: capture.failure?.message ?? null,
    screenshot_r2_key: capture.screenshotR2Key,
    capture_json_r2_key: referenceCaptureJsonKey(clientSlug, siteVersion, capture.viewport.name),
    redirects: JSON.stringify(capture.redirects),
    limitations: JSON.stringify(capture.limitations),
    captured_at: capture.capturedAt,
    created_at: nowIso(),
  };
  await upsertReferenceCapture(env.DB, row);
}

async function persistCaptureJson(
  env: Env,
  clientSlug: string,
  siteVersion: number,
  capture: ReferenceCapture
): Promise<void> {
  if (capture.status === "failed") return;
  const key = referenceCaptureJsonKey(clientSlug, siteVersion, capture.viewport.name);
  await putObject(env, key, JSON.stringify(capture, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function finalizeManifest(
  env: Env,
  jobId: string,
  referenceUrl: string,
  captures: ReferenceCapture[],
  capturedAt: string,
  clientSlug: string,
  siteVersion: number
): Promise<ReferenceCaptureManifest> {
  const finalUrl = captures.find((c) => c.finalUrl)?.finalUrl ?? null;
  const manifest: ReferenceCaptureManifest = {
    jobId,
    referenceUrl,
    finalUrl,
    overallStatus: deriveOverallStatus(captures),
    viewports: captures,
    responsiveDiffs: diffResponsiveCaptures(captures),
    manifestR2Key: referenceCaptureManifestKey(clientSlug, siteVersion),
    capturedAt,
  };
  await putObject(env, manifest.manifestR2Key, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return manifest;
}
