import type { Env } from "../env.d";
import type { QaIssue } from "../types";
import type { BrowserAdapter, BrowserPage, BrowserSession, RawCandidate, RawLayout } from "./browser-adapter";
import { playwrightAdapter } from "./browser-adapter";
import type { DesignBlueprintV2, InteractionBlueprintV2 } from "./blueprint-schema-v2";
import { putObject, qaAttemptReportKey, qaAttemptScreenshotKey, qaInteractionEvidenceKey } from "./assets";
import { REFERENCE_VIEWPORTS, CAPTURE_NAV_TIMEOUT_MS } from "./viewports";

const PAGE_SLUGS = ["/", "/services", "/about", "/contact"] as const;
const PAGE_NAMES: Record<(typeof PAGE_SLUGS)[number], string> = {
  "/": "home",
  "/services": "services",
  "/about": "about",
  "/contact": "contact",
};

export interface InteractionExerciseEvidence {
  viewport: string;
  trigger: string;
  selector: string;
  executed: boolean;
  changedProperties: string[];
  reset: "verified" | "failed" | "skipped";
}

export interface VisualQualityGateResult {
  score: number;
  threshold: number;
  publishable: boolean;
  issues: QaIssue[];
  screenshots: {
    desktop: Record<string, string>;
    tablet: Record<string, string>;
    mobile: Record<string, string>;
  };
  interactionEvidence: InteractionExerciseEvidence[];
  reportR2Key: string;
  interactionEvidenceR2Key: string;
}

function issue(input: Omit<QaIssue, "recommendedFix"> & { recommendedFix: string }): QaIssue {
  return input;
}

function pageUrl(base: string, slug: string): string {
  return `${base.replace(/\/$/, "")}${slug === "/" ? "" : slug}`;
}

export interface BrowserPreviewReadinessOptions {
  attempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export class BrowserPreviewReadinessError extends Error {
  readonly statuses: Record<string, number | null>;

  constructor(statuses: Record<string, number | null>) {
    super(`Browser Run could not reach every preview route: ${Object.entries(statuses).map(([path, status]) => `${path}=${status ?? "network-error"}`).join(", ")}`);
    this.name = "BrowserPreviewReadinessError";
    this.statuses = statuses;
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForBrowserPreviewReadiness(
  session: BrowserSession,
  previewUrl: string,
  options: BrowserPreviewReadinessOptions = {}
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 30);
  const delayMs = Math.max(0, options.delayMs ?? 2_000);
  const sleep = options.sleep ?? wait;
  let statuses: Record<string, number | null> = {};

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const results = await Promise.all(PAGE_SLUGS.map(async (slug) => {
      const page = await session.newPage({ viewport: REFERENCE_VIEWPORTS[0], reducedMotion: false });
      try {
        const nav = await page.goto(pageUrl(previewUrl, slug), { timeoutMs: CAPTURE_NAV_TIMEOUT_MS, waitUntil: "networkidle" });
        return [slug, nav.timedOut ? null : nav.httpStatus] as const;
      } catch {
        return [slug, null] as const;
      } finally {
        await page.close().catch(() => undefined);
      }
    }));
    statuses = Object.fromEntries(results);
    if (Object.values(statuses).every((status) => status !== null && status >= 200 && status < 400)) return;
    if (attempt < attempts) await sleep(delayMs);
  }

  throw new BrowserPreviewReadinessError(statuses);
}

function durationMs(value: string): number {
  const first = value.split(",")[0]?.trim() ?? "0";
  if (first.endsWith("ms")) return Number.parseFloat(first) || 0;
  if (first.endsWith("s")) return (Number.parseFloat(first) || 0) * 1000;
  return Number.parseFloat(first) || 0;
}

function lengthPx(value: string | null): number | null {
  if (!value) return null;
  const first = value.trim().split(/\s+/)[0] ?? "";
  const parsed = Number.parseFloat(first);
  if (!Number.isFinite(parsed)) return null;
  if (first.endsWith("rem") || first.endsWith("em")) return parsed * 16;
  if (first.endsWith("px") || /^-?\d+(\.\d+)?$/.test(first)) return parsed;
  return null;
}

function materiallyDifferentLength(expected: string, actual: string | null): boolean {
  const expectedPx = lengthPx(expected);
  const actualPx = lengthPx(actual);
  if (expectedPx === null || actualPx === null) return false;
  return Math.abs(expectedPx - actualPx) > Math.max(4, expectedPx * 0.2);
}

function normalizeFont(value: string | null): string {
  return (value ?? "").split(",")[0]?.replace(/["']/g, "").trim().toLowerCase() ?? "";
}

function normalizeColor(value: string | null): string | null {
  if (!value) return null;
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const expanded = hex[1].length === 3 ? [...hex[1]].map((part) => part + part).join("") : hex[1];
    return `rgb(${Number.parseInt(expanded.slice(0, 2), 16)}, ${Number.parseInt(expanded.slice(2, 4), 16)}, ${Number.parseInt(expanded.slice(4, 6), 16)})`;
  }
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return rgb ? `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})` : value.trim().toLowerCase();
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseRgbColor(value: string): RgbaColor | null {
  const match = value.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function compositeColor(front: RgbaColor, back: RgbaColor): RgbaColor {
  const alpha = front.a + back.a * (1 - front.a);
  if (alpha <= 0) return { r: 255, g: 255, b: 255, a: 1 };
  return {
    r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
    g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
    b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
    a: alpha,
  };
}

function colorLuminance(color: RgbaColor): number {
  const channel = (value: number) => {
    const normalized = Math.max(0, Math.min(255, value)) / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function calculateContrastRatio(foreground: string, background: string): number | null {
  const backgroundColor = parseRgbColor(background);
  const foregroundColor = parseRgbColor(foreground);
  if (!backgroundColor || !foregroundColor) return null;
  const opaqueBackground = compositeColor(backgroundColor, { r: 255, g: 255, b: 255, a: 1 });
  const opaqueForeground = compositeColor(foregroundColor, opaqueBackground);
  const lighter = Math.max(colorLuminance(opaqueForeground), colorLuminance(opaqueBackground));
  const darker = Math.min(colorLuminance(opaqueForeground), colorLuminance(opaqueBackground));
  return (lighter + 0.05) / (darker + 0.05);
}

function contrastThreshold(fontSize: string, fontWeight: string): number {
  const size = Number.parseFloat(fontSize) || 0;
  const weight = Number.parseInt(fontWeight, 10) || (/bold/i.test(fontWeight) ? 700 : 400);
  return size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
}

export function scoreQualityGate(issues: readonly QaIssue[]): number {
  const penalty = issues.reduce((total, finding) => {
    if (finding.severity === "critical") return total + 35;
    if (finding.severity === "major") return total + 12;
    return total + 3;
  }, 0);
  return Math.max(0, 100 - penalty);
}

export function canPublishQualityGate(score: number, threshold: number, issues: readonly QaIssue[]): boolean {
  return score >= threshold && !issues.some((finding) => finding.severity === "critical");
}

export function inspectIconMarkup(html: string, page: string): QaIssue[] {
  const findings: QaIssue[] = [];
  const iconSvgs = [...html.matchAll(/<svg\b[^>]*class="[^"]*\bicon\b[^"]*"[^>]*>/gi)].map((match) => match[0]);
  if (iconSvgs.length > 6) {
    findings.push(issue({
      severity: "major",
      category: "icons",
      page,
      selector: "svg.icon",
      issue: "Lucide icons are overused on this page.",
      expected: "No more than 6 relevant icons per page.",
      actual: `${iconSvgs.length} icons rendered.`,
      evidence: page,
      recommendedFix: "Keep icons only on cards or key actions where they clarify meaning.",
    }));
  }
  if (iconSvgs.some((svg) => !/aria-hidden="true"|role="img"/i.test(svg))) {
    findings.push(issue({
      severity: "critical",
      category: "icons",
      page,
      selector: "svg.icon",
      issue: "An icon has no accessible decorative or meaningful-image semantics.",
      expected: "Decorative icons use aria-hidden; meaningful icons use role=img and a label.",
      actual: "At least one icon exposes neither semantic pattern.",
      evidence: page,
      recommendedFix: "Render the icon through the approved Lucide wrapper.",
    }));
  }
  if (/unpkg\.com\/lucide|cdn\.jsdelivr\.net\/.*lucide|lucide\.createIcons/i.test(html)) {
    findings.push(issue({
      severity: "critical",
      category: "icons",
      page,
      selector: "script[src], link[href]",
      issue: "A client-side Lucide runtime or CDN dependency is present.",
      expected: "Build-time inline SVG icons only.",
      actual: "Runtime icon dependency detected.",
      evidence: page,
      recommendedFix: "Use the build-time icon registry and remove the external runtime.",
    }));
  }
  return findings;
}

export function compareLayoutToBlueprint(
  layout: RawLayout,
  design: DesignBlueprintV2,
  viewport: { name: string; width: number },
  page: string
): QaIssue[] {
  const findings: QaIssue[] = [];
  const sections = layout.sections.filter((section) => section.tag === "section");
  const expectedSections = page === "/" ? Math.max(3, design.layout.sections.length) : page === "/contact" ? 2 : 3;
  if (sections.length < expectedSections) {
    findings.push(issue({
      severity: "major",
      category: "visual",
      page,
      selector: "main > section",
      issue: "Rendered section hierarchy is thinner than the accepted blueprint.",
      expected: `At least ${expectedSections} visible sections at ${viewport.name}.`,
      actual: `${sections.length} visible sections.`,
      evidence: `${viewport.name}:main`,
      recommendedFix: "Restore the missing semantic sections or adjust the blueprint before rendering.",
    }));
  }
  const h1 = layout.typography.find((entry) => entry.element === "h1");
  const body = layout.typography.find((entry) => entry.element === "body");
  if (!h1 || !h1.fontSize) {
    findings.push(issue({
      severity: "critical",
      category: "visual",
      page,
      selector: "h1",
      issue: "The primary heading is not visually measurable.",
      expected: "A visible h1 with computed typography.",
      actual: "No visible computed h1 style.",
      evidence: `${viewport.name}:h1`,
      recommendedFix: "Render one visible h1 and preserve the blueprint heading hierarchy.",
    }));
  } else if (body?.fontSize && h1.fontSize === body.fontSize) {
    findings.push(issue({
      severity: "major",
      category: "visual",
      page,
      selector: "h1",
      issue: "The h1 does not establish sufficient typographic hierarchy.",
      expected: `Heading scale aligned with ${design.typography.scale}.`,
      actual: `h1 and body both compute to ${h1.fontSize}.`,
      evidence: `${viewport.name}:h1`,
      recommendedFix: "Increase the heading scale while keeping the accepted font relationships.",
    }));
  }
  if (page === "/") {
    const expectedH1 = design.typography.headings.find((entry) => entry.element.toLowerCase() === "h1") ?? design.typography.headings[0];
    const typographyMismatches: string[] = [];
    if (body && normalizeFont(body.fontFamily) !== normalizeFont(design.typography.body.fontFamily)) typographyMismatches.push(`body font ${body.fontFamily}`);
    if (body && materiallyDifferentLength(design.typography.body.fontSize, body.fontSize)) typographyMismatches.push(`body size ${body.fontSize}`);
    if (expectedH1 && h1 && normalizeFont(h1.fontFamily) !== normalizeFont(expectedH1.fontFamily)) typographyMismatches.push(`h1 font ${h1.fontFamily}`);
    if (expectedH1 && h1 && materiallyDifferentLength(expectedH1.fontSize, h1.fontSize)) typographyMismatches.push(`h1 size ${h1.fontSize}`);
    if (typographyMismatches.length > 0) {
      findings.push(issue({
        severity: "major", category: "visual", page, selector: "body, h1",
        issue: "Rendered typography materially diverges from the accepted blueprint.",
        expected: `${design.typography.body.fontFamily} ${design.typography.body.fontSize}; ${expectedH1?.fontFamily ?? "heading font"} ${expectedH1?.fontSize ?? "heading size"}.`,
        actual: typographyMismatches.join("; "),
        evidence: `${viewport.name}:typography`,
        recommendedFix: "Apply the accepted body and heading typography tokens in the deterministic renderer.",
      }));
    }

    const expectedColors = design.colors.roles
      .filter((entry) => entry.role === "background" || entry.role === "text" || entry.role === "primary")
      .map((entry) => ({ role: entry.role, value: normalizeColor(entry.value) }));
    const renderedColors = new Set([normalizeColor(layout.colors.background), normalizeColor(layout.colors.text), ...layout.colors.accents.map(normalizeColor)].filter((entry): entry is string => entry !== null));
    const missingColors = expectedColors.filter((entry) => entry.value && !renderedColors.has(entry.value));
    if (missingColors.length > 0) {
      findings.push(issue({
        severity: "major", category: "visual", page, selector: "body, a, button",
        issue: "Rendered semantic colors diverge from the accepted blueprint.",
        expected: expectedColors.map((entry) => `${entry.role}=${entry.value}`).join(", "),
        actual: Array.from(renderedColors).join(", "),
        evidence: `${viewport.name}:colors`,
        recommendedFix: "Map the accepted background, text, and primary roles into rendered surfaces and actions.",
      }));
    }

    if (layout.spacing && materiallyDifferentLength(design.spacing.sectionPadding, layout.spacing.sectionPadding)) {
      findings.push(issue({
        severity: "major", category: "visual", page, selector: "main > section",
        issue: "Rendered section spacing materially diverges from the accepted blueprint.",
        expected: `Section padding ${design.spacing.sectionPadding}.`,
        actual: `Section padding ${layout.spacing.sectionPadding}.`,
        evidence: `${viewport.name}:${layout.spacing.evidenceId ?? "spacing"}`,
        recommendedFix: "Use the accepted section-padding token while preserving responsive containment.",
      }));
    }
  }
  const overflowing = sections.find((section) => section.bounds.x < -2 || section.bounds.x + section.bounds.width > viewport.width + 2);
  if (overflowing) {
    findings.push(issue({
      severity: "critical",
      category: "visual",
      page,
      selector: overflowing.evidenceId ? `[data-cf-evidence-id="${overflowing.evidenceId}"]` : "section",
      issue: "A section overflows the target viewport.",
      expected: `Content contained within ${viewport.width}px.`,
      actual: `Bounds x=${overflowing.bounds.x}, width=${overflowing.bounds.width}.`,
      evidence: `${viewport.name}:${overflowing.evidenceId ?? overflowing.order}`,
      recommendedFix: "Correct responsive widths, padding, and long-content wrapping.",
    }));
  }
  const imageMinimums: Record<string, number> = { "/": 3, "/services": 3, "/about": 1, "/contact": 1 };
  const mainImages = layout.images.filter((image) => image.inMain);
  const loadedImages = mainImages.filter((image) => image.naturalWidth > 0 && image.naturalHeight > 0 && image.displayedWidth > 0);
  const expectedImages = imageMinimums[page] ?? 1;
  if (loadedImages.length < expectedImages) {
    findings.push(issue({
      severity: "critical",
      category: "visual",
      page,
      selector: "main img",
      issue: "Required page imagery is missing or did not load.",
      expected: `At least ${expectedImages} loaded, visible content image(s).`,
      actual: `${loadedImages.length} loaded image(s) from ${mainImages.length} rendered image element(s).`,
      evidence: `${viewport.name}:main`,
      recommendedFix: "Generate, bundle, and render every required page-aware image before QA.",
    }));
  }
  for (const image of mainImages.filter((entry) => entry.naturalWidth <= 0 || entry.naturalHeight <= 0)) {
    findings.push(issue({
      severity: "critical",
      category: "images",
      page,
      selector: image.evidenceId ? `[data-cf-evidence-id="${image.evidenceId}"]` : "main img",
      issue: "A rendered image asset failed to load.",
      expected: "A decoded image with non-zero natural dimensions.",
      actual: `naturalWidth=${image.naturalWidth}; naturalHeight=${image.naturalHeight}; src=${image.src}.`,
      evidence: `${viewport.name}:${image.evidenceId ?? image.src}`,
      recommendedFix: "Repair the generated asset, content type, or bundle path and rerun QA.",
    }));
  }
  if (layout.colors.accents.length < 2) {
    findings.push(issue({
      severity: "minor",
      category: "visual",
      page,
      selector: "body",
      issue: "The rendered color hierarchy is unusually flat.",
      expected: "Distinct background, text, and accent relationships from the blueprint.",
      actual: `${layout.colors.accents.length} recurrent computed color(s).`,
      evidence: `${viewport.name}:colors`,
      recommendedFix: "Apply the accepted semantic color roles to headings, surfaces, and actions.",
    }));
  }
  for (const sample of layout.contrastSamples.slice(0, 160)) {
    const ratio = calculateContrastRatio(sample.color, sample.backgroundColor);
    const threshold = contrastThreshold(sample.fontSize, sample.fontWeight);
    if (ratio !== null && ratio + 0.01 < threshold) {
      findings.push(issue({
        severity: "critical",
        category: "accessibility",
        page,
        selector: sample.selector,
        issue: "Text does not have sufficient contrast against its rendered background.",
        expected: `Contrast ratio of at least ${threshold.toFixed(1)}:1.`,
        actual: `${ratio.toFixed(2)}:1 for ${sample.color} on ${sample.backgroundColor}.`,
        evidence: `${viewport.name}:${sample.evidenceId ?? sample.selector}`,
        recommendedFix: "Adjust the semantic foreground or background token while preserving the accepted palette relationship.",
      }));
    }
  }
  return findings;
}

function safeCandidate(candidate: RawCandidate): boolean {
  if (candidate.external) return false;
  if (candidate.tag === "input" || candidate.tag === "textarea" || candidate.tag === "select") return false;
  return !/delete|remove|purchase|checkout|submit|send|pay/i.test(candidate.text ?? "");
}

async function exercise(page: BrowserPage, candidate: RawCandidate, trigger: string, viewport: string): Promise<InteractionExerciseEvidence> {
  const before = await page.readInteractionState(candidate.selector);
  let executed = true;
  if (trigger === "hover") await page.hover(candidate.selector);
  else if (trigger === "focus") await page.focus(candidate.selector);
  else if (trigger === "active") await page.pressPointerDown(candidate.selector);
  else if (trigger === "toggle") await page.toggleAccordionOrMenu(candidate.selector);
  else if (trigger === "sticky" || trigger === "scroll-reveal" || trigger === "section-transition") await page.scrollTo(candidate.selector);
  else executed = false;
  if (!executed) return { viewport, trigger, selector: candidate.selector, executed: false, changedProperties: [], reset: "skipped" };
  await page.settle(180);
  const after = await page.readInteractionState(candidate.selector);
  const changedProperties = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((key) => before[key] !== after[key]);
  await page.reset();
  const reset = await page.readInteractionState(candidate.selector);
  const resetVerified = changedProperties.every((key) => reset[key] === before[key]);
  return { viewport, trigger, selector: candidate.selector, executed: true, changedProperties, reset: resetVerified ? "verified" : "failed" };
}

function expectedInteractions(interaction: InteractionBlueprintV2): InteractionBlueprintV2["interactions"] {
  const byTrigger = new Map<string, InteractionBlueprintV2["interactions"][number]>();
  for (const entry of interaction.interactions) {
    if (!byTrigger.has(entry.trigger)) byTrigger.set(entry.trigger, entry);
  }
  return Array.from(byTrigger.values());
}

export function selectCandidateForInteraction(
  candidates: RawCandidate[],
  expected: InteractionBlueprintV2["interactions"][number]
): RawCandidate | undefined {
  return candidates.find((candidate) =>
    candidate.triggers.includes(expected.trigger)
    && candidate.capabilitySelectors.includes(expected.selector)
    && safeCandidate(candidate)
  );
}

export async function runVisualQualityGate(
  env: Env,
  params: {
    previewUrl: string;
    clientSlug: string;
    version: number;
    attempt: number;
    design: DesignBlueprintV2;
    interaction: InteractionBlueprintV2;
    threshold?: number;
    adapter?: BrowserAdapter;
    browserReadiness?: BrowserPreviewReadinessOptions;
  }
): Promise<VisualQualityGateResult> {
  const configuredThreshold = Number.parseInt(env.VISUAL_QA_MIN_SCORE ?? "80", 10) || 80;
  const threshold = Math.max(0, Math.min(100, params.threshold ?? configuredThreshold));
  const findings: QaIssue[] = [];
  const screenshots = { desktop: {}, tablet: {}, mobile: {} } as VisualQualityGateResult["screenshots"];
  const interactionEvidence: InteractionExerciseEvidence[] = [];
  const adapter = params.adapter ?? playwrightAdapter;
  let session;
  try {
    session = await adapter.launch(env);
  } catch (error) {
    findings.push(issue({
      severity: "critical", category: "visual", page: "/", selector: "",
      issue: "Browser-based visual validation could not start.",
      expected: "A Browser Run session for the deployed preview.",
      actual: error instanceof Error ? error.message : String(error),
      evidence: "browser-launch",
      recommendedFix: "Restore the Browser binding and rerun the quality gate before publication.",
    }));
  }

  if (session) {
    try {
      let browserReady = true;
      try {
        await waitForBrowserPreviewReadiness(session, params.previewUrl, params.browserReadiness);
      } catch (error) {
        browserReady = false;
        const statuses = error instanceof BrowserPreviewReadinessError ? error.statuses : {};
        for (const slug of PAGE_SLUGS) {
          const status = statuses[slug] ?? null;
          findings.push(issue({
            severity: "critical", category: "visual", page: slug, selector: "",
            issue: "Browser Run could not reach the deployed preview before QA.",
            expected: "Successful Browser Run navigation before visual validation starts.",
            actual: status === null ? "Network error or navigation timeout." : `HTTP ${status}.`,
            evidence: `browser-readiness:${pageUrl(params.previewUrl, slug)}`,
            recommendedFix: "Wait for preview propagation or repair routing before Browser Run QA.",
          }));
        }
      }

      if (browserReady) for (const viewport of REFERENCE_VIEWPORTS) {
        for (const slug of PAGE_SLUGS) {
          let page: BrowserPage | null = null;
          try {
            page = await session.newPage({ viewport, reducedMotion: false });
            const nav = await page.goto(pageUrl(params.previewUrl, slug), { timeoutMs: CAPTURE_NAV_TIMEOUT_MS, waitUntil: "networkidle" });
            if (nav.timedOut || (nav.httpStatus !== null && nav.httpStatus >= 400)) {
              findings.push(issue({
                severity: "critical", category: "visual", page: slug, selector: "",
                issue: "The deployed preview could not be captured.",
                expected: "Successful preview navigation.",
                actual: nav.timedOut ? "Navigation timed out." : `HTTP ${nav.httpStatus}.`,
                evidence: `${viewport.name}:${nav.finalUrl}`,
                recommendedFix: "Repair preview routing or deployment and rerun the gate.",
              }));
              continue;
            }
            await page.assignEvidenceIds();
            await page.waitForImages(10_000);
            const layout = await page.extractLayout();
            findings.push(...compareLayoutToBlueprint(layout, params.design, viewport, slug));

            if (slug === "/") {
              const detection = await page.discoverInteractables();
              for (const expected of expectedInteractions(params.interaction)) {
                const trigger = expected.trigger;
                const candidate = selectCandidateForInteraction(detection.candidates, expected);
                if (!candidate) {
                  findings.push(issue({
                    severity: trigger === "focus" ? "critical" : "major",
                    category: "interaction", page: slug, selector: expected.selector,
                    issue: `The required ${trigger} interaction is not available at ${viewport.name}.`,
                    expected: `An exercisable ${trigger} state from the InteractionBlueprint.`,
                    actual: "No safe matching target was discovered.",
                    evidence: `${viewport.name}:interaction-discovery`,
                    recommendedFix: "Render an accessible semantic target and implement its blueprint state.",
                  }));
                  continue;
                }
                const result = await exercise(page, candidate, trigger, viewport.name);
                interactionEvidence.push(result);
                if (!result.executed || result.reset === "failed") {
                  findings.push(issue({
                    severity: "critical", category: "interaction", page: slug, selector: candidate.selector,
                    issue: `The ${trigger} interaction could not be exercised and reset safely.`,
                    expected: "Before/after evidence plus a verified reset.",
                    actual: `executed=${result.executed}; reset=${result.reset}.`,
                    evidence: `${viewport.name}:${candidate.evidenceId}`,
                    recommendedFix: "Make the interaction deterministic, reversible, and safe for automated QA.",
                  }));
                } else if (result.changedProperties.length === 0) {
                  findings.push(issue({
                    severity: "minor", category: "interaction", page: slug, selector: candidate.selector,
                    issue: `The ${trigger} target produced no observable state change.`,
                    expected: "A visible or semantic state change.",
                    actual: "Before and after states were identical.",
                    evidence: `${viewport.name}:${candidate.evidenceId}`,
                    recommendedFix: "Add a restrained state change consistent with the InteractionBlueprint.",
                  }));
                }
              }
            }
            if (slug === "/") await page.waitForImages(10_000);
            await page.showAllRevealElements();
            const screenshotKey = qaAttemptScreenshotKey(params.clientSlug, params.version, params.attempt, viewport.name, PAGE_NAMES[slug]);
            const screenshot = await page.screenshot({ fullPage: true });
            await putObject(env, screenshotKey, new Uint8Array(screenshot).buffer, { httpMetadata: { contentType: "image/png" } });
            screenshots[viewport.name][PAGE_NAMES[slug]] = screenshotKey;
          } catch (error) {
            findings.push(issue({
              severity: "critical", category: "visual", page: slug, selector: "",
              issue: "Preview evidence capture failed.",
              expected: "Complete layout, screenshot, and interaction evidence.",
              actual: error instanceof Error ? error.message : String(error),
              evidence: `${viewport.name}:${slug}`,
              recommendedFix: "Fix the preview or browser action and rerun the gate.",
            }));
          } finally {
            if (page) await page.close().catch(() => undefined);
          }
        }

        let reducedPage: BrowserPage | null = null;
        try {
          reducedPage = await session.newPage({ viewport, reducedMotion: true });
          const nav = await reducedPage.goto(pageUrl(params.previewUrl, "/"), { timeoutMs: CAPTURE_NAV_TIMEOUT_MS, waitUntil: "networkidle" });
          if (!nav.timedOut && (nav.httpStatus === null || nav.httpStatus < 400)) {
            await reducedPage.assignEvidenceIds();
            const detection = await reducedPage.discoverInteractables();
            const unsafeMotion = detection.candidates.find((candidate) => durationMs(candidate.transitionDuration) > 100 || candidate.hasAnimation);
            if (unsafeMotion) {
              findings.push(issue({
                severity: "major", category: "interaction", page: "/", selector: unsafeMotion.selector,
                issue: "Motion remains active when reduced motion is requested.",
                expected: "Transitions removed or reduced to 100ms or less.",
                actual: `${unsafeMotion.transitionDuration}${unsafeMotion.hasAnimation ? "; animation active" : ""}.`,
                evidence: `${viewport.name}:reduced-motion`,
                recommendedFix: "Apply the InteractionBlueprint reduced-motion strategy to every animated target.",
              }));
            }
          }
        } catch (error) {
          findings.push(issue({
            severity: "critical", category: "interaction", page: "/", selector: "",
            issue: "Reduced-motion validation could not be completed.",
            expected: "A reachable preview with motion disabled through prefers-reduced-motion.",
            actual: error instanceof Error ? error.message : String(error),
            evidence: `${viewport.name}:reduced-motion`,
            recommendedFix: "Restore preview reachability and rerun reduced-motion validation before publication.",
          }));
        } finally {
          if (reducedPage) await reducedPage.close().catch(() => undefined);
        }
      }
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  const interactionEvidenceR2Key = qaInteractionEvidenceKey(params.clientSlug, params.version, params.attempt);
  await putObject(env, interactionEvidenceR2Key, JSON.stringify(interactionEvidence, null, 2), { httpMetadata: { contentType: "application/json" } });
  const score = scoreQualityGate(findings);
  const publishable = canPublishQualityGate(score, threshold, findings);
  const reportR2Key = qaAttemptReportKey(params.clientSlug, params.version, params.attempt);
  await putObject(env, reportR2Key, JSON.stringify({ score, threshold, publishable, issues: findings, screenshots, interactionEvidenceR2Key }, null, 2), { httpMetadata: { contentType: "application/json" } });
  return { score, threshold, publishable, issues: findings, screenshots, interactionEvidence, reportR2Key, interactionEvidenceR2Key };
}
