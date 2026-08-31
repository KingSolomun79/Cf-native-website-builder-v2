// Deterministic fixture BrowserAdapter for reference-evidence tests.
//
// Implements the typed BrowserPage/BrowserSession/BrowserAdapter contract from
// browser-adapter.ts against an in-memory fixture model + action ledger. This
// proves orchestration behavior (which selector was exercised, before/after
// state, screenshots/traces requested, reset performed, pages/sessions closed)
// WITHOUT a real browser or network. There is no evaluate(string) parsing —
// every operation is a typed method on the fixture page.

import type { NavDiagnostics } from "../../src/types";
import type {
  BrowserAdapter,
  BrowserPage,
  BrowserSession,
  GotoOptions,
  NewPageOptions,
  RawCandidate,
  RawInteractionDetection,
  RawLayout,
} from "../../src/lib/browser-adapter";
import { TRACKED_PROPS } from "../../src/lib/browser-adapter";

export interface FixtureScenario {
  name: string;
  httpStatus: number;
  httpStatusSequence?: number[];
  finalUrl?: string;
  redirectChain?: Array<{ url: string; status: number }>;
  timedOut?: boolean;
  consentOverlay?: boolean;
  failedResources?: Array<{ url: string; type: string | null; reason: string }>;
  duplicateButtons?: number;
  hasAccordion?: boolean;
  hasMobileMenu?: boolean;
  hasStickyHeader?: boolean;
  hasReveal?: boolean;
  hasSectionTransition?: boolean;
  hasExternalToggle?: boolean;
  hoverChangesColor?: boolean;
  reducedMotionRemovesMotion?: boolean;
  navItemCount?: { desktop: number; mobile: number };
  contrastSamples?: RawLayout["contrastSamples"];
  // When true, goto throws a network error (inaccessible URL).
  inaccessible?: boolean;
}

export interface LedgerEntry {
  kind: "goto" | "assignEvidenceIds" | "waitForImages" | "extractLayout" | "discoverInteractables" | "readComputedStyle" | "readInteractionState" | "countMatches" | "hover" | "focus" | "pressPointerDown" | "click" | "toggleAccordionOrMenu" | "scrollTo" | "settle" | "reset" | "showAllRevealElements" | "screenshot" | "close" | "newPage";
  selector?: string;
  detail?: unknown;
}

export interface FixtureAdapter extends BrowserAdapter {
  ledger: LedgerEntry[];
  pagesOpened: number;
  pagesClosed: number;
  sessionsClosed: number;
  // Inject a failure into the next persist call from the SUT (for cleanup tests).
  failOnNextPersist?: boolean;
}

interface FixtureElement {
  evidenceId: string;
  tag: string;
  role: string | null;
  text: string | null;
  href: string | null;
  external: boolean;
  triggers: string[];
  resting: Record<string, string>;
  hovered: Record<string, string>;
  focused: Record<string, string>;
  active: Record<string, string>;
  isToggle: boolean;
  toggleState: "open" | "closed";
  isSticky: boolean;
  isReveal: boolean;
  hasAnimation: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  transitionProperties: string[];
  transitionDuration: string;
  transitionTimingFunction: string;
  transitionDelay: string;
}

function buildElements(scenario: FixtureScenario): FixtureElement[] {
  const els: FixtureElement[] = [];
  let i = 0;
  const make = (over: Partial<FixtureElement>): FixtureElement => {
    const evidenceId = `cf-${i++}`;
    const resting: Record<string, string> = {
      "opacity": "1",
      "transform": "none",
      "color": "rgb(0,0,0)",
      "background-color": "rgb(255,255,255)",
      "box-shadow": "none",
      "border-color": "rgb(0,0,0)",
      "text-decoration-color": "rgb(0,0,0)",
      "outline-color": "rgb(0,0,0)",
      "scale": "1",
      "translate": "0px",
    };
    return {
      evidenceId,
      tag: "button",
      role: null,
      text: `Button ${i}`,
      href: null,
      external: false,
      triggers: ["hover", "focus", "active"],
      resting,
      hovered: scenario.hoverChangesColor ? { ...resting, "background-color": "rgb(0,123,255)", "color": "rgb(255,255,255)" } : { ...resting },
      focused: { ...resting, "outline-color": "rgb(0,123,255)" },
      active: { ...resting, "transform": "scale(0.98)" },
      isToggle: false,
      toggleState: "closed",
      isSticky: false,
      isReveal: false,
      hasAnimation: false,
      bounds: { x: 10, y: 100 + i * 50, width: 200, height: 40 },
      transitionProperties: scenario.hoverChangesColor ? ["background-color", "color", "transform"] : [],
      transitionDuration: "150ms",
      transitionTimingFunction: "ease-out",
      transitionDelay: "0s",
      ...over,
      // @ts-expect-error evidenceId set above then overridden only if provided
    } as FixtureElement;
  };

  const dupCount = scenario.duplicateButtons ?? 2;
  for (let d = 0; d < dupCount; d++) {
    els.push(make({ tag: "button", text: "Duplicate button" }));
  }
  if (scenario.hasAccordion) {
    els.push(make({ tag: "summary", text: "Accordion", triggers: ["hover", "focus", "toggle"], isToggle: true, toggleState: "closed" }));
  }
  if (scenario.hasMobileMenu) {
    els.push(make({ tag: "button", role: "button", text: "Menu toggle", triggers: ["hover", "focus", "toggle"], isToggle: true, toggleState: "closed" }));
  }
  if (scenario.hasStickyHeader) {
    els.push(make({ tag: "header", text: "Sticky header", triggers: [], isSticky: true, bounds: { x: 0, y: 0, width: 1440, height: 60 } }));
  }
  if (scenario.hasReveal) {
    els.push(make({ tag: "div", text: "Reveal section", triggers: [], isReveal: true, resting: { ...make({}).resting, opacity: "0" }, bounds: { x: 0, y: 2000, width: 1440, height: 200 } }));
  }
  if (scenario.hasSectionTransition) {
    els.push(make({ tag: "section", text: "Animated section", triggers: [], hasAnimation: true, bounds: { x: 0, y: 2400, width: 1440, height: 300 } }));
  }
  if (scenario.hasExternalToggle) {
    els.push(make({
      tag: "a",
      role: "button",
      text: "External menu",
      href: "https://external.test/menu",
      external: true,
      triggers: ["toggle"],
      isToggle: true,
    }));
  }
  return els;
}

class FixturePage implements BrowserPage {
  private scenario: FixtureScenario;
  private viewportName: string;
  private reducedMotion: boolean;
  private ledger: LedgerEntry[];
  private elements: FixtureElement[];
  private nav: NavDiagnostics;
  private closed = false;
  private scrollY = 0;
  private parent: FixtureSession;

  constructor(scenario: FixtureScenario, opts: NewPageOptions, ledger: LedgerEntry[], parent: FixtureSession) {
    this.scenario = scenario;
    this.viewportName = opts.viewport.name;
    this.reducedMotion = opts.reducedMotion;
    this.ledger = ledger;
    this.parent = parent;
    this.elements = buildElements(scenario);
    this.nav = {
      initialUrl: `https://fixture.test/${scenario.name}`,
      finalUrl: scenario.finalUrl ?? `https://fixture.test/${scenario.name}`,
      httpStatus: scenario.httpStatus,
      redirectChain: scenario.redirectChain ?? [],
      failedResources: scenario.failedResources ?? [],
      blockedResources: [],
      timedOut: scenario.timedOut ?? false,
      overlayLimitations: scenario.consentOverlay ? ["consent or cookie overlay detected; captured content may be incomplete"] : [],
    };
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("page closed");
  }

  async goto(url: string, _opts: GotoOptions): Promise<NavDiagnostics> {
    this.ensureOpen();
    this.ledger.push({ kind: "goto", detail: url });
    if (this.scenario.inaccessible) {
      throw new Error("dns ENOTFOUND fixture.test");
    }
    return { ...this.nav, httpStatus: this.parent.nextHttpStatus() };
  }

  url(): string {
    return this.nav.finalUrl;
  }

  async assignEvidenceIds(): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "assignEvidenceIds" });
  }

  async waitForImages(timeoutMs: number): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "waitForImages", detail: timeoutMs });
  }

  async extractLayout(): Promise<RawLayout> {
    this.ensureOpen();
    this.ledger.push({ kind: "extractLayout" });
    return {
      finalUrl: this.nav.finalUrl,
      title: this.scenario.name,
      lang: "en",
      description: "fixture",
      viewportMeta: "width=device-width",
      sections: [{ order: 0, tag: "header", role: "banner", heading: "Fixture", text: "Fixture", bounds: { x: 0, y: 0, width: 1440, height: 200 }, evidenceId: "cf-section-0" }],
      typography: [{ element: "body", fontFamily: "Arial", fontSize: "16px", fontWeight: "400", lineHeight: "1.5", letterSpacing: "normal", textTransform: "none", evidenceId: "cf-body" }],
      colors: { background: "rgb(255,255,255)", text: "rgb(17,17,17)", accents: ["rgb(0,123,255)"] },
      nav: Array.from({ length: this.scenario.navItemCount?.[this.viewportName as "desktop" | "mobile"] ?? 4 }, (_, i) => ({ href: `/p${i}`, text: `P${i}`, external: false, evidenceId: `cf-nav-${i}` })),
      images: Array.from({ length: 3 }, (_, index) => ({ src: `https://fixture.test/img-${index}.png`, alt: `fixture ${index}`, naturalWidth: 1440, naturalHeight: 900, displayedWidth: 1440, inMain: true, evidenceId: `cf-img-${index}` })),
      spacing: { sectionPadding: "64px 0", sectionMargin: "0", rhythm: "32px", evidenceId: "cf-section-0" },
      contrastSamples: this.scenario.contrastSamples ?? [{ selector: "body", evidenceId: "cf-body", text: "Fixture", color: "rgb(17, 17, 17)", backgroundColor: "rgb(255, 255, 255)", fontSize: "16px", fontWeight: "400" }],
      consentDetected: !!this.scenario.consentOverlay,
    };
  }

  async discoverInteractables(): Promise<RawInteractionDetection> {
    this.ensureOpen();
    this.ledger.push({ kind: "discoverInteractables" });
    const candidates: RawCandidate[] = this.elements.map((e) => ({
      evidenceId: e.evidenceId,
      tag: e.tag,
      role: e.role,
      text: e.text,
      href: e.href,
      external: e.external,
      selector: `[data-cf-evidence-id="${e.evidenceId}"]`,
      capabilitySelectors: [
        ...(e.tag === "button" ? [".btn"] : []),
        ...(e.tag === "a" ? ["a"] : []),
        ...(e.isReveal ? ["[data-reveal]"] : []),
      ],
      triggers: [
        ...e.triggers,
        ...(e.isSticky ? ["sticky"] : []),
        ...(e.isReveal ? ["scroll-reveal"] : []),
        ...(e.hasAnimation ? ["section-transition"] : []),
      ],
      transitionProperties: e.transitionProperties,
      transitionDuration: this.reducedMotion && this.scenario.reducedMotionRemovesMotion ? "0ms" : e.transitionDuration,
      transitionTimingFunction: e.transitionTimingFunction,
      transitionDelay: e.transitionDelay,
      hasAnimation: e.hasAnimation,
      isToggle: e.isToggle,
      isSticky: e.isSticky,
      isReveal: e.isReveal,
      isSafeFormControl: false,
      resting: this.activeResting(e),
      bounds: e.bounds,
    }));
    const sticky = this.elements.filter((e) => e.isSticky).map((e) => `[data-cf-evidence-id="${e.evidenceId}"]`);
    const revealCandidates = candidates.filter((c) => c.isReveal).map((c) => ({ selector: c.selector, evidenceId: c.evidenceId, properties: c.transitionProperties, duration: c.transitionDuration, easing: c.transitionTimingFunction, delay: c.transitionDelay }));
    return { candidates, sticky, revealCandidates };
  }

  private activeResting(e: FixtureElement): Record<string, string> {
    if (this.reducedMotion && this.scenario.reducedMotionRemovesMotion) {
      return { ...e.resting, opacity: "1", transform: "none" };
    }
    if (e.isReveal && !this.scenario.hasReveal) return e.resting;
    return e.isReveal ? { ...e.resting, opacity: "0" } : e.resting;
  }

  async readComputedStyle(selector: string, props: readonly string[]): Promise<Record<string, string>> {
    this.ensureOpen();
    this.ledger.push({ kind: "readComputedStyle", selector });
    const el = this.findElement(selector);
    if (!el) return {};
    const marker = el as FixtureElement & { activeKind?: "hovered" | "focused" | "active" };
    let source: Record<string, string> = el.resting;
    if (marker.activeKind === "hovered") source = this.reducedMotion && this.scenario.reducedMotionRemovesMotion ? el.resting : el.hovered;
    else if (marker.activeKind === "focused") source = el.focused;
    else if (marker.activeKind === "active") source = this.reducedMotion && this.scenario.reducedMotionRemovesMotion ? el.resting : el.active;
    if (el.isReveal) {
      const revealed = (el as FixtureElement & { revealed?: boolean }).revealed;
      source = revealed ? { ...source, opacity: "1", transform: "none" } : { ...source, opacity: "0" };
    }
    const out: Record<string, string> = {};
    for (const p of props) out[p] = source[p] ?? el.resting[p] ?? "";
    return out;
  }

  async readInteractionState(selector: string): Promise<Record<string, string>> {
    this.ensureOpen();
    this.ledger.push({ kind: "readInteractionState", selector });
    const el = this.findElement(selector);
    if (!el) return {};
    const computed = await this.readComputedStyle(selector, TRACKED_PROPS);
    return {
      ...computed,
      "aria-expanded": el.isToggle ? String(el.toggleState === "open") : "",
      open: el.tag === "details" || el.tag === "summary" ? String(el.toggleState === "open") : "false",
      checked: "",
      "bounding-top": String(el.isSticky ? 0 : el.bounds.y - this.scrollY),
      "scroll-y": String(this.scrollY),
    };
  }

  private findElement(selector: string): FixtureElement | undefined {
    const id = selector.match(/data-cf-evidence-id="([^"]+)"/)?.[1];
    return this.elements.find((e) => e.evidenceId === id);
  }

  async countMatches(selector: string): Promise<number> {
    this.ensureOpen();
    this.ledger.push({ kind: "countMatches", selector });
    const id = selector.match(/data-cf-evidence-id="([^"]+)"/)?.[1];
    if (!id) return 0;
    return this.elements.filter((e) => e.evidenceId === id).length;
  }

  async hover(selector: string): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "hover", selector });
    this.applyActive(selector, "hovered");
  }
  async focus(selector: string): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "focus", selector });
    this.applyActive(selector, "focused");
  }
  async pressPointerDown(selector: string): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "pressPointerDown", selector });
    this.applyActive(selector, "active");
  }
  async click(selector: string): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "click", selector });
  }
  async toggleAccordionOrMenu(selector: string): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "toggleAccordionOrMenu", selector });
    const el = this.findElement(selector);
    if (el?.isToggle) el.toggleState = el.toggleState === "closed" ? "open" : "closed";
  }
  async scrollTo(selector: string): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "scrollTo", selector });
    const el = this.findElement(selector);
    this.scrollY = 500;
    if (el?.isReveal) {
      // scrolling reveals it; reflect in resting readback via a marker on the element
      (el as FixtureElement & { revealed?: boolean }).revealed = true;
    }
  }
  async settle(_ms: number): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "settle" });
  }
  async reset(): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "reset" });
    this.scrollY = 0;
    for (const el of this.elements) {
      delete (el as FixtureElement & { activeKind?: string }).activeKind;
      delete (el as FixtureElement & { revealed?: boolean }).revealed;
      el.toggleState = "closed";
    }
  }
  async showAllRevealElements(): Promise<void> {
    this.ensureOpen();
    this.ledger.push({ kind: "showAllRevealElements" });
    for (const el of this.elements) {
      if (el.isReveal) (el as FixtureElement & { revealed?: boolean }).revealed = true;
    }
  }
  async screenshot(opts: { fullPage: boolean }): Promise<Uint8Array> {
    this.ensureOpen();
    this.ledger.push({ kind: "screenshot", detail: opts.fullPage });
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  }
  async close(): Promise<void> {
    this.closed = true;
    this.ledger.push({ kind: "close" });
    this.parent.onPageClosed();
  }

  // For tests: peek at element toggle state.
  toggleState(selector: string): "open" | "closed" | undefined {
    return this.findElement(selector)?.toggleState;
  }

  private applyActive(selector: string, kind: "hovered" | "focused" | "active"): void {
    const el = this.findElement(selector);
    if (!el) return;
    // mark so readComputedStyle can return the changed state for this kind
    (el as FixtureElement & { activeKind?: string }).activeKind = kind;
  }
}

class FixtureSession implements BrowserSession {
  private scenario: FixtureScenario;
  ledger: LedgerEntry[];
  pagesOpened = 0;
  pagesClosed = 0;
  closed = false;
  openPages: FixturePage[] = [];
  private gotoCount = 0;

  constructor(scenario: FixtureScenario, ledger: LedgerEntry[]) {
    this.scenario = scenario;
    this.ledger = ledger;
  }

  onPageClosed(): void {
    this.pagesClosed++;
  }

  nextHttpStatus(): number {
    const sequence = this.scenario.httpStatusSequence;
    if (!sequence?.length) return this.scenario.httpStatus;
    const status = sequence[Math.min(this.gotoCount, sequence.length - 1)]!;
    this.gotoCount++;
    return status;
  }

  async newPage(opts: NewPageOptions): Promise<BrowserPage> {
    if (this.closed) throw new Error("session closed");
    this.pagesOpened++;
    this.ledger.push({ kind: "newPage", detail: { viewport: opts.viewport.name, reducedMotion: opts.reducedMotion } });
    const page = new FixturePage(this.scenario, opts, this.ledger, this);
    this.openPages.push(page);
    return page;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ledger.push({ kind: "close", detail: "session" });
  }
}

export function createFixtureAdapter(scenario: FixtureScenario): FixtureAdapter {
  const ledger: LedgerEntry[] = [];
  const sessionHolder: { current: FixtureSession | null } = { current: null };
  const adapter: FixtureAdapter = {
    ledger,
    get pagesOpened() { return sessionHolder.current?.pagesOpened ?? 0; },
    get pagesClosed() { return sessionHolder.current?.pagesClosed ?? 0; },
    get sessionsClosed() { return sessionHolder.current?.closed ? 1 : 0; },
    async launch(_env) {
      const session = new FixtureSession(scenario, ledger);
      sessionHolder.current = session;
      return session;
    },
  };
  return adapter;
}

// Re-export TRACKED_PROPS for test assertions.
export { TRACKED_PROPS };
