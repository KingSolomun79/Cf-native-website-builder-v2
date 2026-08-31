// Typed Browser adapter for reference evidence capture.
//
// Both reference-capture and interaction-capture depend on this contract instead
// of @cloudflare/playwright directly. Production wires it to env.BROWSER; tests
// wire it to a deterministic fixture adapter (see browser-fixtures.ts). There is
// deliberately NO evaluate(string) method — extraction goes through typed
// operations (extractLayout / discoverInteractables / readComputedStyle) so the
// fixture adapter never parses arbitrary script strings.

import type {
  NavDiagnostics,
  RedirectEntry,
  FailedResource,
  BlockedResource,
} from "../types";
import type { ReferenceViewport } from "./viewports";
import { EVIDENCE_ID_ATTR } from "./selector";
import { RENDERABLE_INTERACTION_PAIRS } from "./renderable-interactions";

export interface RawBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawSection {
  order: number;
  tag: string;
  role: string | null;
  heading: string | null;
  text: string | null;
  bounds: RawBounds;
  evidenceId: string | null;
}

export interface RawTypeStyle {
  element: string;
  fontFamily: string | null;
  fontSize: string | null;
  fontWeight: string | null;
  lineHeight: string | null;
  letterSpacing: string | null;
  textTransform: string | null;
  evidenceId: string | null;
}

export interface RawImage {
  src: string;
  alt: string | null;
  naturalWidth: number;
  naturalHeight: number;
  displayedWidth: number;
  inMain: boolean;
  evidenceId: string | null;
}

export interface RawNavItem {
  href: string;
  text: string | null;
  external: boolean;
  evidenceId: string | null;
}

export interface RawSpacing {
  sectionPadding: string | null;
  sectionMargin: string | null;
  rhythm: string | null;
  evidenceId: string | null;
}

export interface RawContrastSample {
  selector: string;
  evidenceId: string | null;
  text: string;
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
}

export interface RawLayout {
  finalUrl: string;
  title: string | null;
  lang: string | null;
  description: string | null;
  viewportMeta: string | null;
  sections: RawSection[];
  typography: RawTypeStyle[];
  colors: { background: string | null; text: string | null; accents: string[] };
  nav: RawNavItem[];
  images: RawImage[];
  spacing: RawSpacing | null;
  contrastSamples: RawContrastSample[];
  consentDetected: boolean;
}

export interface RawCandidate {
  evidenceId: string;
  tag: string;
  role: string | null;
  text: string | null;
  href: string | null;
  external: boolean;
  selector: string;
  capabilitySelectors: string[];
  triggers: string[];
  transitionProperties: string[];
  transitionDuration: string;
  transitionTimingFunction: string;
  transitionDelay: string;
  hasAnimation: boolean;
  isToggle: boolean;
  isSticky: boolean;
  isReveal: boolean;
  isSafeFormControl: boolean;
  resting: Record<string, string>;
  bounds: RawBounds;
}

export interface RawInteractionDetection {
  candidates: RawCandidate[];
  sticky: string[];
  revealCandidates: Array<{ selector: string; evidenceId: string; properties: string[]; duration: string; easing: string; delay: string }>;
}

export interface NewPageOptions {
  viewport: ReferenceViewport;
  reducedMotion: boolean;
}

export interface GotoOptions {
  timeoutMs: number;
  waitUntil: "networkidle" | "load";
}

export interface BrowserPage {
  goto(url: string, opts: GotoOptions): Promise<NavDiagnostics>;
  url(): string;
  assignEvidenceIds(): Promise<void>;
  waitForImages(timeoutMs: number): Promise<void>;
  extractLayout(): Promise<RawLayout>;
  discoverInteractables(): Promise<RawInteractionDetection>;
  readComputedStyle(selector: string, props: readonly string[]): Promise<Record<string, string>>;
  readInteractionState(selector: string): Promise<Record<string, string>>;
  countMatches(selector: string): Promise<number>;
  hover(selector: string): Promise<void>;
  focus(selector: string): Promise<void>;
  pressPointerDown(selector: string): Promise<void>;
  click(selector: string): Promise<void>;
  toggleAccordionOrMenu(selector: string): Promise<void>;
  scrollTo(selector: string): Promise<void>;
  settle(ms: number): Promise<void>;
  reset(): Promise<void>;
  showAllRevealElements(): Promise<void>;
  screenshot(opts: { fullPage: boolean }): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface BrowserSession {
  newPage(opts: NewPageOptions): Promise<BrowserPage>;
  close(): Promise<void>;
}

export interface BrowserAdapter {
  launch(env: unknown): Promise<BrowserSession>;
}

// Build a NavDiagnostics from a Playwright response/navigation outcome.
export function buildNavDiagnostics(input: {
  initialUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  redirectChain: RedirectEntry[];
  failedResources: FailedResource[];
  blockedResources: BlockedResource[];
  timedOut: boolean;
  overlayLimitations: string[];
}): NavDiagnostics {
  return {
    initialUrl: input.initialUrl,
    finalUrl: input.finalUrl,
    httpStatus: input.httpStatus,
    redirectChain: input.redirectChain,
    failedResources: input.failedResources,
    blockedResources: input.blockedResources,
    timedOut: input.timedOut,
    overlayLimitations: input.overlayLimitations,
  };
}

export const TRACKED_PROPS = [
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

// ── Production adapter (Playwright via env.BROWSER) ─────────────────────────
// A thin shim mapping the typed contract onto @cloudflare/playwright. Kept
// small and obvious so the spy test can verify the wiring.
export const playwrightAdapter: BrowserAdapter = {
  async launch(env) {
    const { launch } = await import("@cloudflare/playwright");
    const browser = await launch((env as { BROWSER: import("@cloudflare/playwright").BrowserWorker }).BROWSER);
    return {
      async newPage(opts) {
        const page = await browser.newPage({
          viewport: { width: opts.viewport.width, height: opts.viewport.height },
          reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
        });
        return makePlaywrightPage(page);
      },
      async close() {
        await browser.close();
      },
    };
  },
};

const ASSIGN_EVIDENCE_IDS_SCRIPT = `(() => {
  const candidates = "a[href], button, [role=button], summary, input, select, textarea, [tabindex], details, [aria-expanded], img, header, [role=banner], nav, [role=navigation], main, [role=main], section, article, aside, footer, [role=contentinfo], h1, h2, h3, h4, p, label, li, [data-aos], [class*=reveal i], [class*=animate i], [class*=fade i], [class*=slide i]";
  Array.from(document.querySelectorAll(candidates)).filter((el) => !el.matches(".skip-link")).forEach((el, index) => {
    el.setAttribute("${EVIDENCE_ID_ATTR}", "cf-" + index);
  });
})()`;

function makePlaywrightPage(page: import("@cloudflare/playwright").Page): BrowserPage {
  return {
    async goto(url, opts) {
      const redirectChain: RedirectEntry[] = [];
      const failedResources: FailedResource[] = [];
      const blockedResources: BlockedResource[] = [];
      let httpStatus: number | null = null;

      page.on("response", (resp) => {
        const status = resp.status();
        try {
          if (resp.url() === page.url()) httpStatus = status;
        } catch { /* page may have navigated */ }
        if (status >= 400) {
          failedResources.push({ url: resp.url(), type: resp.request().resourceType(), reason: `HTTP ${status}` });
        }
      });
      page.on("requestfailed", (request) => {
        const reason = request.failure()?.errorText ?? "request failed";
        const record = { url: request.url(), reason };
        if (/blocked|aborted|denied/i.test(reason)) blockedResources.push(record);
        else failedResources.push({ ...record, type: request.resourceType() });
      });

      let timedOut = false;
      try {
        const resp = await page.goto(url, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs });
        if (resp) httpStatus = resp.status();
        let redirected = resp?.request().redirectedFrom() ?? null;
        while (redirected) {
          const redirectResponse = await redirected.response();
          redirectChain.unshift({ url: redirected.url(), status: redirectResponse?.status() ?? null });
          redirected = redirected.redirectedFrom();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/timeout|timed out/i.test(msg)) timedOut = true;
        else throw err;
      }

      const finalUrl = page.url();
      return buildNavDiagnostics({
        initialUrl: url,
        finalUrl,
        httpStatus,
        redirectChain,
        failedResources,
        blockedResources,
        timedOut,
        overlayLimitations: [],
      });
    },
    url: () => page.url(),
    async assignEvidenceIds() {
      await page.evaluate(ASSIGN_EVIDENCE_IDS_SCRIPT);
    },
    async waitForImages(timeoutMs) {
      await page.evaluate(`((timeout) => {
        const images = Array.from(document.images);
        images.forEach((image) => { image.loading = "eager"; });
        const readiness = images.map((image) => {
          if (image.complete) return image.decode ? image.decode().catch(() => undefined) : Promise.resolve();
          return new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          }).then(() => image.decode ? image.decode().catch(() => undefined) : undefined);
        });
        return Promise.race([
          Promise.all(readiness),
          new Promise((resolve) => setTimeout(resolve, timeout)),
        ]);
      })(${JSON.stringify(timeoutMs)})`);
    },
    async extractLayout() {
      return page.evaluate(EXTRACT_LAYOUT_SCRIPT);
    },
    async discoverInteractables() {
      return page.evaluate(DISCOVER_INTERACTABLES_SCRIPT);
    },
    async readComputedStyle(selector, props) {
      return page.evaluate(
        `((sel, ps) => { const el = document.querySelector(sel); if (!el) return {}; const s = getComputedStyle(el); const out = {}; ps.forEach((p) => { const camel = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); out[p] = s[camel]; }); return out; })(${JSON.stringify(selector)}, ${JSON.stringify(props)})`
      );
    },
    async readInteractionState(selector) {
      return page.evaluate(
        `((sel) => {
          const el = document.querySelector(sel);
          if (!el) return {};
          const s = getComputedStyle(el);
          const out = {};
          ${JSON.stringify(TRACKED_PROPS)}.forEach((p) => {
            const camel = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            out[p] = s[camel];
          });
          const rect = el.getBoundingClientRect();
          out["aria-expanded"] = el.getAttribute("aria-expanded") || "";
          out.open = el.hasAttribute("open") ? "true" : "false";
          out.checked = "checked" in el ? String(el.checked) : "";
          out["bounding-top"] = String(Math.round(rect.top));
          out["scroll-y"] = String(Math.round(window.scrollY));
          return out;
        })(${JSON.stringify(selector)})`
      );
    },
    async countMatches(selector) {
      return page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    },
    async hover(selector) { await page.hover(selector); },
    async focus(selector) { await page.focus(selector); },
    async pressPointerDown(selector) {
      const box = await page.locator(selector).boundingBox();
      if (!box) throw new Error(`Cannot press invisible element: ${selector}`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
    },
    async click(selector) { await page.click(selector); },
    async toggleAccordionOrMenu(selector) { await page.click(selector); },
    async scrollTo(selector) {
      await page.evaluate(`((sel) => { const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: "center" }); window.scrollBy(0, 200); })(${JSON.stringify(selector)})`);
    },
    async settle(ms) { await page.waitForTimeout(ms); },
    async reset() {
      await page.mouse.up().catch(() => {});
      await page.mouse.move(0, 0).catch(() => {});
      await page.reload({ waitUntil: "load" });
      await page.evaluate(ASSIGN_EVIDENCE_IDS_SCRIPT);
    },
    async showAllRevealElements() {
      await page.evaluate(`document.querySelectorAll("[data-reveal]").forEach((element) => element.classList.add("is-visible"))`);
    },
    async screenshot(opts) { const buf = await page.screenshot({ type: "png", fullPage: opts.fullPage }); return new Uint8Array(buf); },
    async close() { await page.close(); },
  };
}

const EXTRACT_LAYOUT_SCRIPT = `(() => {
  const trim = (s) => (s ? String(s).replace(/\\s+/g, " ").trim().slice(0, 300) : null);
  const round = (n) => Math.round(n);
  const eid = (el) => el.getAttribute("data-cf-evidence-id");
  const boundsOf = (el) => { const r = el.getBoundingClientRect(); return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) }; };
  const styleOf = (el) => { const s = getComputedStyle(el); return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textTransform: s.textTransform }; };
  const landmark = "header, [role=banner], nav, [role=navigation], main, [role=main], section, article, aside, footer, [role=contentinfo]";
  const sections = Array.from(document.querySelectorAll(landmark)).filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0).slice(0, 40).map((el, i) => { const h = el.querySelector("h1, h2, h3, h4"); return { order: i, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), heading: h ? trim(h.textContent) : null, text: trim(el.textContent), bounds: boundsOf(el), evidenceId: eid(el) }; });
  const typeTargets = [["body", "body"], ["h1", "h1"], ["h2", "h2"], ["p", "p"], ["a", "a"]];
  const typography = typeTargets.map(([key, sel]) => { const el = sel === "body" ? document.body : document.querySelector(sel); if (!el) return null; const s = styleOf(el); return { element: key, fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textTransform: s.textTransform, evidenceId: eid(el) }; }).filter(Boolean);
  const bodyStyle = getComputedStyle(document.body);
  const counts = new Map();
  Array.from(document.querySelectorAll("h1, h2, h3, a, button, [role=button]")).slice(0, 60).forEach((el) => { const s = getComputedStyle(el); [s.color, s.backgroundColor].forEach((c) => { if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") counts.set(c, (counts.get(c) || 0) + 1); }); });
  const accents = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);
  const nav = Array.from(document.querySelectorAll("nav a, [role=navigation] a")).slice(0, 40).map((a) => { let external = false; try { external = a.href ? new URL(a.href, location.href).origin !== location.origin : false; } catch (e) {} return { href: a.href || "", text: trim(a.textContent), external, evidenceId: eid(a) }; });
  const images = Array.from(document.querySelectorAll("img")).slice(0, 80).map((img) => { const r = img.getBoundingClientRect(); return { src: img.currentSrc || img.src || "", alt: trim(img.getAttribute("aria-label") || img.alt), naturalWidth: img.naturalWidth || 0, naturalHeight: img.naturalHeight || 0, displayedWidth: round(r.width), inMain: !!img.closest("main"), evidenceId: eid(img) }; });
  const viewportMeta = document.querySelector("meta[name=viewport]") ? document.querySelector("meta[name=viewport]").getAttribute("content") : null;
  const description = document.querySelector("meta[name=description]") ? document.querySelector("meta[name=description]").getAttribute("content") : null;
  const consentSelector = "[id*=cookie i], [class*=cookie i], [id*=consent i], [class*=consent i], [id*=gdpr i], [aria-label*=cookie i]";
  const consentDetected = !!document.querySelector(consentSelector);
  const firstSection = document.querySelector("section");
  let spacing = null;
  if (firstSection) { const s = getComputedStyle(firstSection); spacing = { sectionPadding: s.padding, sectionMargin: s.margin, rhythm: s.rowGap || s.columnGap || null, evidenceId: eid(firstSection) }; }
  const parseColor = (value) => { const m = String(value || "").match(/rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)/i); return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) } : null; };
  const composite = (front, back) => { const a = front.a + back.a * (1 - front.a); if (a <= 0) return { r: 255, g: 255, b: 255, a: 1 }; return { r: (front.r * front.a + back.r * back.a * (1 - front.a)) / a, g: (front.g * front.a + back.g * back.a * (1 - front.a)) / a, b: (front.b * front.a + back.b * back.a * (1 - front.a)) / a, a }; };
  const effectiveBackground = (el) => { const layers = []; let node = el; while (node && node.nodeType === 1) { const parsed = parseColor(getComputedStyle(node).backgroundColor); if (parsed && parsed.a > 0) layers.push(parsed); node = node.parentElement; } let color = { r: 255, g: 255, b: 255, a: 1 }; layers.reverse().forEach((layer) => { color = composite(layer, color); }); return "rgb(" + Math.round(color.r) + ", " + Math.round(color.g) + ", " + Math.round(color.b) + ")"; };
  const contrastTargets = "h1, h2, h3, h4, p, a[href], button, label, li, summary, .stat__value, .stat__label, .footer__copy";
  const contrastSamples = Array.from(document.querySelectorAll(contrastTargets)).filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity || 1) > 0 && trim(el.textContent); }).slice(0, 160).map((el) => { const s = getComputedStyle(el); const id = eid(el); return { selector: id ? "[data-cf-evidence-id=\\\"" + id + "\\\"]" : el.tagName.toLowerCase(), evidenceId: id, text: trim(el.textContent), color: s.color, backgroundColor: effectiveBackground(el), fontSize: s.fontSize, fontWeight: s.fontWeight }; });
  return { finalUrl: location.href, title: trim(document.title), lang: document.documentElement.lang || null, description: trim(description), viewportMeta, sections, typography, colors: { background: bodyStyle.backgroundColor, text: bodyStyle.color, accents }, nav, images, spacing, contrastSamples, consentDetected };
})()`;

const DISCOVER_INTERACTABLES_SCRIPT = `(() => {
  const capabilitySelectors = ${JSON.stringify([...new Set(RENDERABLE_INTERACTION_PAIRS.map((entry) => entry.selector))])};
  const trim = (s) => (s ? String(s).replace(/\\s+/g, " ").trim().slice(0, 120) : null);
  const tracked = ["opacity","transform","color","background-color","box-shadow","border-color","text-decoration-color","outline-color","scale","translate"];
  const styleOf = (el) => getComputedStyle(el);
  const transitionOf = (el) => { const s = styleOf(el); return { props: (s.transitionProperty || "none").split(", ").map((p) => p.trim()).filter((p) => p && p !== "all"), dur: s.transitionDuration || "0s", ease: s.transitionTimingFunction || "ease", delay: s.transitionDelay || "0s" }; };
  const restingOf = (el) => { const s = styleOf(el); const out = {}; tracked.forEach((p) => { const camel = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); out[p] = s[camel]; }); return out; };
  const interactive = "a[href], button, [role=button], summary, input, select, textarea, [tabindex], details, [aria-expanded], nav a";
  const candidates = Array.from(document.querySelectorAll("[data-cf-evidence-id]"))
    .filter((el) => {
      if (el.matches(".skip-link")) return false;
      const cls = el.className && typeof el.className === "string" ? el.className : "";
      const s = getComputedStyle(el);
      return el.matches(interactive) || s.position === "sticky" || /(reveal|animate|fade|slide)/i.test(cls) || el.hasAttribute("data-aos") || el.hasAttribute("data-reveal") || (s.animationName && s.animationName !== "none");
    }).slice(0, 80).map((el) => {
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const triggers = [];
    const cursor = styleOf(el).cursor;
    if (tag === "a" || tag === "button" || role === "button" || cursor === "pointer") triggers.push("hover", "active");
    if (tag === "a" || tag === "button" || tag === "input" || tag === "select" || tag === "textarea" || el.hasAttribute("tabindex")) triggers.push("focus");
    if (tag === "summary" || tag === "details" || el.hasAttribute("aria-expanded")) triggers.push("toggle");
    const t = transitionOf(el);
    const anim = styleOf(el).animationName;
    const evidenceId = el.getAttribute("data-cf-evidence-id") || "";
    const isToggle = tag === "summary" || tag === "details" || el.hasAttribute("aria-expanded");
    const isSticky = styleOf(el).position === "sticky";
    const cls = el.className && typeof el.className === "string" ? el.className : "";
    const isReveal = /(reveal|animate|fade|slide)/i.test(cls) || el.hasAttribute("data-aos") || el.hasAttribute("data-reveal");
    if (isSticky) triggers.push("sticky");
    if (isReveal) triggers.push("scroll-reveal");
    if (anim && anim !== "none") triggers.push("section-transition");
    const inputType = (tag === "input" && el.type) ? el.type.toLowerCase() : "";
    const isSafeFormControl = ["text","email","tel","search","url"].includes(inputType) || tag === "select" || tag === "textarea";
    const href = el.getAttribute("href");
    let external = false;
    try { external = !!href && new URL(href, location.href).origin !== location.origin; } catch (e) {}
    return { evidenceId, tag, role, text: trim(el.textContent), href, external, selector: "[data-cf-evidence-id=\\"" + evidenceId + "\\"]", capabilitySelectors: capabilitySelectors.filter((selector) => el.matches(selector)), triggers: Array.from(new Set(triggers)), transitionProperties: t.props, transitionDuration: t.dur, transitionTimingFunction: t.ease, transitionDelay: t.delay, hasAnimation: !!anim && anim !== "none", isToggle, isSticky, isReveal, isSafeFormControl, resting: restingOf(el), bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
  }).filter((c) => c.bounds.width > 0 && c.bounds.height > 0 && c.evidenceId);
  const sticky = Array.from(document.querySelectorAll("[data-cf-evidence-id]")).filter((el) => getComputedStyle(el).position === "sticky").map((el) => "[data-cf-evidence-id=\\"" + el.getAttribute("data-cf-evidence-id") + "\\"]");
  const revealCandidates = candidates.filter((c) => c.isReveal).map((c) => ({ selector: c.selector, evidenceId: c.evidenceId, properties: c.transitionProperties, duration: c.transitionDuration, easing: c.transitionTimingFunction, delay: c.transitionDelay }));
  return { candidates, sticky, revealCandidates };
})()`;
