// SIMPLE deterministic bundle QA (spec sections 37-39).
//
// After the Website Builder's bundle is assembled, BEFORE any model judges it:
//   - truth lint: unsupported fact patterns + trust-context entities, reusing
//     the legacy zero-tolerance scanners (issue #48 machinery, one copy)
//   - technical checks: the objective checklist from spec section 38
// Both feed the ONE qa-package. No LLM runs here.

import type { BusinessFacts } from "../domain/lifecycle-schema";
import { factVocabulary, lintTrustContexts, UNSUPPORTED_FACT_PATTERNS } from "../domain/site-generator";
import type { DesignBlueprint, SiteBundle } from "./contracts";
import type { TechnicalGateResults } from "./release-mapping";
import type { SimpleTechnicalFinding, SimpleTruthFinding } from "./contracts";

const PAGE_IDS = ["home", "about", "services", "contact"] as const;
type PageId = (typeof PAGE_IDS)[number];

const FILE_FOR_PAGE: Record<PageId, string> = {
  home: "index.html",
  about: "about.html",
  services: "services.html",
  contact: "contact.html",
};

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
}

export interface BundleQaInput {
  bundle: SiteBundle;
  blueprint: DesignBlueprint;
  facts: BusinessFacts;
  formServiceEndpoint: string;
  siteFormId: string;
  /** All blueprint image slot ids (the only legal IMG: placeholders). */
  slotIds: ReadonlySet<string>;
  /** Slot ids that resolved to a bundled Accepted Image during assembly. */
  resolvedSlotIds: ReadonlySet<string>;
  /** Deterministic capture evidence summary (render stage); null when the
   *  candidate could not be rendered at all. */
  renderEvidence: {
    capturesRendered: number;
    mobileCaptured: boolean;
    failedRequestCount: number;
  } | null;
}

export interface BundleQaResult {
  truthFindings: SimpleTruthFinding[];
  technicalFindings: SimpleTechnicalFinding[];
  technicalBlockerCount: number;
  gates: TechnicalGateResults;
}

// The named deterministic checks behind each canonical QA-B mandatory gate.
// Gate semantics survive; the LLM browser stage does not (spec section 38:
// "Keep objective checks", and the model budget in section 9 has no QA-B
// model call).
export function runDeterministicBundleQa(input: BundleQaInput): BundleQaResult {
  const { bundle, facts, blueprint } = input;
  const truthFindings: SimpleTruthFinding[] = [];
  const technicalFindings: SimpleTechnicalFinding[] = [];
  const technical = (id: string, severity: "blocker" | "warning", detail: string) =>
    technicalFindings.push({ id, severity, detail });

  const factWords = factVocabulary(facts);
  const businessNameWords = new Set<string>(
    facts.businessName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  );
  const slotIds = input.slotIds;

  const pageText: Partial<Record<PageId, string>> = {};
  for (const pageId of PAGE_IDS) {    const html = bundle.pages[pageId];
    if (typeof html !== "string" || html.length === 0) {
      technical("MISSING_CORE_PAGE", "blocker", `page '${pageId}' missing from bundle`);
      continue;
    }
    const text = stripTags(html);
    pageText[pageId] = text;

    // ── Truth lint (zero tolerance, spec section 39) ──
    for (const { id, pattern } of UNSUPPORTED_FACT_PATTERNS) {
      if (pattern.test(text)) {
        truthFindings.push({
          id,
          detail: `${pageId}: generated content matches unsupported claim pattern /${pattern.source}/ — no such Business Fact exists`,
        });
      }
    }
    for (const violation of lintTrustContexts(html, pageId, factWords, new Map(), businessNameWords)) {
      truthFindings.push({
        id: "FABRICATED_TRUST_ENTITY",
        detail: `${pageId}: trust label '${violation.text}' is not backed by the Business Facts (${violation.context})`,
      });
    }

    // ── Technical: structure, links, slots, contract ──
    const doc = html.toLowerCase();
    if (!doc.trimStart().startsWith("<!doctype html")) {
      technical("MALFORMED_HTML", "blocker", `${pageId}: missing <!DOCTYPE html>`);
    }
    const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
    if (h1Count === 0) technical("MISSING_H1", "blocker", `${pageId}: no H1`);
    if (h1Count > 1) technical("DUPLICATE_H1", "blocker", `${pageId}: ${h1Count} H1 elements`);
    if (!doc.includes('name="viewport"')) {
      technical("MISSING_VIEWPORT_META", "blocker", `${pageId}: no responsive viewport meta`);
    }
    if (!/href="(?:\.?\/)?site\.css"/i.test(html)) {
      technical("MISSING_SHARED_CSS", "blocker", `${pageId}: site.css not linked`);
    }
    if (!/src="(?:\.?\/)?site\.js"/i.test(html)) {
      technical("MISSING_SHARED_JS", "blocker", `${pageId}: site.js not referenced`);
    }
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const src = /src="([^"]+)"/i.exec(match[0])?.[1] ?? "";
      if (src.startsWith("IMG:")) {
        if (!slotIds.has(src.slice(4))) {
          technical("UNKNOWN_IMG_SLOT", "blocker", `${pageId}: '${src.slice(4)}' is not a blueprint Image Slot`);
        } else if (!input.resolvedSlotIds.has(src.slice(4))) {
          technical("UNRESOLVED_IMAGE_SLOT", "blocker", `${pageId}: slot '${src.slice(4)}' has no Accepted Image`);
        }
      } else if (/^https?:\/\//i.test(src)) {
        technical("NO_PROVIDER_URLS", "blocker", `${pageId}: remote image URL '${src.slice(0, 120)}' — only bundled Accepted Images may ship`);
      }
    }
    // Navigation completeness: every page links to the other three, and every
    // internal href resolves to a generated page (issue #69's lesson: scan the
    // whole href, hyphens and digits included).
    const pageFileTargets = new Set(["/", "/about", "/services", "/contact"]);
    for (const href of html.match(/href="\/[a-z0-9-]*"/gi) ?? []) {
      const target = href.slice(6, -1);
      if (!pageFileTargets.has(target)) {
        technical("BROKEN_NAV_LINK", "blocker", `${pageId}: internal link '${href}' resolves to no generated page`);
      }
    }
    for (const other of PAGE_IDS) {
      if (other === pageId) continue;
      const target = other === "home" ? 'href="/"' : `href="/${other}"`;
      if (!html.includes(target)) {
        technical("BROKEN_NAV_LINK", "blocker", `${pageId}: missing nav link to '${other}'`);
      }
    }
  }

  // ── Contact form contract (central Form Service, spec KEEP list) ──
  const contact = bundle.pages.contact;
  const formOk =
    typeof contact === "string" &&
    contact.includes(`action="${input.formServiceEndpoint}"`) &&
    contact.includes(`name="siteFormId"`) &&
    contact.includes(`value="${input.siteFormId}"`) &&
    !/name="(recipient|to|from|sender|replyTo|template)"/i.test(contact);
  if (!formOk) {
    technical("FORM_CONTRACT_FAILURE", "blocker", "contact form does not post to the central Form Service contract (action + hidden siteFormId, no browser-controlled delivery fields)");
  }

  // ── Metadata / SEO / crawlability ──
  for (const pageId of PAGE_IDS) {
    const html = bundle.pages[pageId];
    if (typeof html !== "string") continue;
    const doc = html.toLowerCase();
    if (!doc.includes("<title>")) technical("MISSING_METADATA", "blocker", `${pageId}: no <title>`);
    if (!doc.includes('name="description"')) technical("MISSING_METADATA", "blocker", `${pageId}: no meta description`);
    if (!doc.includes("property=\"og:title\"") && !doc.includes("property='og:title'")) {
      technical("MISSING_METADATA", "warning", `${pageId}: no og:title`);
    }
    if (doc.includes('name="robots"') && /noindex/i.test(doc)) {
      technical("CRAWLABILITY", "blocker", `${pageId}: noindex robots meta`);
    }
  }

  // ── Accessibility + responsive mechanics in the shared CSS ──
  const css = bundle.sharedCss;
  const motionPresent = blueprint.motion.interactions.length > 0;
  if (motionPresent && !css.includes("prefers-reduced-motion")) {
    technical("REDUCED_MOTION_MISSING", "blocker", "blueprint declares motion but site.css has no prefers-reduced-motion handling");
  }
  if (!css.includes(":focus-visible")) {
    technical("FOCUS_VISIBLE_MISSING", "blocker", "site.css has no :focus-visible style");
  }
  // Progressive-enhancement gate (benchmark hardening F2): reveal-style
  // hidden resting states make content disappear without JavaScript — the
  // exact defect that rendered valid sections blank in static captures. A
  // bundle whose script animates via IntersectionObserver must not define
  // reveal/fade content hidden (opacity 0 / visibility hidden) as its
  // resting CSS state outside prefers-reduced-motion blocks.
  const hiddenRevealSelectors = findHiddenByDefaultRevealRules(css);
  if (hiddenRevealSelectors.length > 0) {
    technical(
      "CONTENT_HIDDEN_WITHOUT_JS",
      /IntersectionObserver/.test(bundle.sharedJs) || motionPresent ? "blocker" : "warning",
      `site.css hides content by default (JavaScript would be required to reveal it): ${hiddenRevealSelectors.join("; ")}`
    );
  }
  const hasMediaQueries = /@media[^{]+\d{3,4}px/.test(css);
  const fixedWide = /(?:width|min-width)\s*:\s*(1[0-9]{3,}|[2-9][0-9]{3,})px/.test(css);
  if (fixedWide && !hasMediaQueries) {
    technical("PAGE_HORIZONTAL_OVERFLOW", "blocker", "fixed >=1000px widths with no responsive media queries");
  }

  // ── Render-evidence-backed gates (may be null when assembly failed) ──
  const evidence = input.renderEvidence;
  const evidenceOk = evidence !== null;

  const gateResults: TechnicalGateResults = {
    ALL_PAGES_LOAD:
      PAGE_IDS.every((pageId) => typeof bundle.pages[pageId] === "string" && bundle.pages[pageId].length > 0) &&
      (evidenceOk ? evidence.capturesRendered >= 4 : false),
    INTERNAL_NAVIGATION: !technicalFindings.some((finding) => finding.id === "BROKEN_NAV_LINK"),
    MOBILE_MENU:
      /nav|menu/i.test(bundle.sharedJs) &&
      (evidenceOk ? evidence.mobileCaptured : false),
    RESPONSIVE_MECHANICS: hasMediaQueries && (evidenceOk ? evidence.mobileCaptured : false),
    NO_PAGE_OVERFLOW: !technicalFindings.some((finding) => finding.id === "PAGE_HORIZONTAL_OVERFLOW"),
    KEYBOARD_FOCUS_ACCESSIBILITY: css.includes(":focus-visible"),
    FORM_SERVICE_CONTRACT: formOk,
    // The SIMPLE form contract ships no Turnstile fields (platform-side
    // verification only), so the gate is satisfied by that exact absence.
    TURNSTILE_INTEGRATION: !/turnstile/i.test(bundle.pages.contact ?? ""),
    RUNTIME_CONSOLE_NETWORK_CLEAN: evidenceOk ? evidence.failedRequestCount === 0 : false,
    IMAGE_MANIFEST_RESOLUTION: !technicalFindings.some(
      (finding) => finding.id === "UNRESOLVED_IMAGE_SLOT" || finding.id === "UNKNOWN_IMG_SLOT"
    ),
    NO_PROVIDER_URLS: !technicalFindings.some((finding) => finding.id === "NO_PROVIDER_URLS"),
    METADATA_CANONICAL_OG: !technicalFindings.some((finding) => finding.id === "MISSING_METADATA"),
    TRUTHFUL_JSON_LD:
      !technicalFindings.some((finding) => finding.id === "MALFORMED_HTML") &&
      truthFindings.length === 0,
    CRAWLABILITY: !technicalFindings.some((finding) => finding.id === "CRAWLABILITY"),
    // The SIMPLE pipeline has no separate Implementation Contract artifact by
    // design; its equivalent is the deterministic bundle/blueprint conformance
    // above (slots, nav, shared CSS/JS, form contract).
    IMPLEMENTATION_CONTRACT_INTEGRITY: !technicalFindings.some(
      (finding) =>
        finding.id === "MISSING_SHARED_CSS" ||
        finding.id === "MISSING_SHARED_JS" ||
        finding.id === "UNKNOWN_IMG_SLOT" ||
        finding.id === "CONTENT_HIDDEN_WITHOUT_JS"
    ),
  };

  return {
    truthFindings,
    technicalFindings,
    technicalBlockerCount: technicalFindings.filter((finding) => finding.severity === "blocker").length,
    gates: gateResults,
  };
}

export const SIMPLE_PAGE_FILES = FILE_FOR_PAGE;

// ── Progressive-enhancement CSS analysis (benchmark hardening F2) ───────────

// Flattens @media blocks so their inner rules scan like top-level rules;
// prefers-reduced-motion blocks are dropped entirely — hiding rules there are
// the FIX (reduce animation), not a content-visibility defect.
function flattenMediaBlocks(css: string): string {
  let out = "";
  let index = 0;
  while (index < css.length) {
    const start = css.indexOf("@media", index);
    if (start < 0) {
      out += css.slice(index);
      break;
    }
    out += css.slice(index, start);
    const braceOpen = css.indexOf("{", start);
    if (braceOpen < 0) {
      out += css.slice(start);
      break;
    }
    let depth = 1;
    let cursor = braceOpen + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth += 1;
      else if (css[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    const inner = css.slice(braceOpen + 1, cursor - 1);
    if (!/prefers-reduced-motion/i.test(css.slice(start, braceOpen))) {
      out += inner;
    }
    index = cursor;
  }
  return out;
}

// Reports reveal/fade-style selectors whose resting state HIDES content
// (opacity 0 or visibility hidden) — content that would vanish without
// JavaScript or before any scroll event fires.
export function findHiddenByDefaultRevealRules(css: string): string[] {
  const flattened = flattenMediaBlocks(css);
  const offenders: string[] = [];
  for (const match of flattened.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    if (!/reveal|fade|animate|entrance|appear/i.test(selector)) continue;
    if (selector.includes("@")) continue;
    const declarations = match[2].toLowerCase();
    if (/(^|[;{\s])opacity\s*:\s*0\s*(!important)?\s*(;|$)/.test(declarations) || /visibility\s*:\s*hidden/.test(declarations)) {
      offenders.push(selector.slice(0, 120));
    }
  }
  return offenders;
}
