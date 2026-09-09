// V2 incremental REFERENCE_BOUND Site generation (issue #9, PRD sections
// 15-17). Generates a complete Home/About/Services/Contact Site from ONE
// Visual Blueprint + ONE Implementation Contract, incrementally:
//
//   1. shared design tokens/CSS (site.css)
//   2. shared runtime JS (site.js)
//   3. Home  4. About  5. Services  6. Contact
//   7. deterministic Image Plan (stable Image Slots)
//   8. deterministic cross-file assembly validation
//
// These are generation steps under the same fixed contracts, not independent
// designers: Reference-specific topology stays expressible because page
// structure mirrors the Blueprint regions, and there is no universal page
// template. Output is semantic HTML + shared site.css/site.js + minimal JS;
// images stay as unresolved IMG: slot placeholders until issue #10.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../env.d";
import { runSchemaValidatedAiStage, type AiProvenance, type RawAiGenerate } from "./ai-boundary";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { getEffectiveBusinessFacts } from "./revision";
import { getBuildStageArtifact, storeBuildStageArtifact, storeBuildStageArtifactIdempotent, StageArtifactError, sha256Hex, type StoredStageArtifact } from "./stage-artifacts";
import { deriveStageExecutionFingerprint, runStageSingleFlight } from "./stage-execution";
import type { VisualBlueprint } from "./visual-blueprint";
import type { ImplementationContract } from "./implementation-planner";
import type { BusinessFacts } from "./lifecycle-schema";
import type { ReferenceEvidence } from "./reference-evidence-schema";
import { createProductionVisionGenerate } from "./reference-analysis";
import {
  extractPageContentFingerprint,
  diffPageContent,
  applyRegionPatch,
  validateCssPatchScope,
} from "./content-fingerprint";
import {
  assemblyRepairDecision,
  extractAssemblyFingerprint,
  findingsForPage,
  findingSignatures,
  validateAssemblyRepairContent,
  canonicalNavLabel,
  type AssemblyFinding,
} from "./assembly-repair";

export const IMAGE_PLAN_SCHEMA_VERSION = "image-plan/1";

export type PageId = "home" | "about" | "services" | "contact";
export const PAGE_IDS: readonly PageId[] = ["home", "about", "services", "contact"];

// ── AI step output schemas ──────────────────────────────────────────────────

export const SharedCssSchema = Type.Object({ css: Type.String({ minLength: 200 }) }, { additionalProperties: false });
export type SharedCss = Static<typeof SharedCssSchema>;

export const SharedJsSchema = Type.Object({ js: Type.String({ minLength: 1 }) }, { additionalProperties: false });
export type SharedJs = Static<typeof SharedJsSchema>;

export const PageHtmlSchema = Type.Object({ html: Type.String({ minLength: 200 }) }, { additionalProperties: false });
export type PageHtml = Static<typeof PageHtmlSchema>;

// ── Image Plan (deterministic) ──────────────────────────────────────────────

export const ImageSlotSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 160 }),
    page: Type.Union([Type.Literal("home"), Type.Literal("about"), Type.Literal("services"), Type.Literal("contact")]),
    regionId: Type.Optional(Type.String({ minLength: 1 })),
    semanticRole: Type.String({ minLength: 1, maxLength: 2000 }),
    blueprintRole: Type.String({ minLength: 1, maxLength: 120 }),
    priority: Type.Union([Type.Literal("CRITICAL"), Type.Literal("HIGH"), Type.Literal("NORMAL")]),
    orientation: Type.Union([Type.Literal("landscape"), Type.Literal("portrait"), Type.Literal("square")]),
    negativeSpaceForText: Type.Boolean(),
  },
  { additionalProperties: false }
);
export type ImageSlot = Static<typeof ImageSlotSchema>;

export const ImagePlanSchema = Type.Object(
  { version: Type.String({ minLength: 1 }), slots: Type.Array(ImageSlotSchema, { minItems: 1 }) },
  { additionalProperties: false }
);
export type ImagePlan = Static<typeof ImagePlanSchema>;

// Stable semantic/compositional requirements derived from the Blueprint's
// image roles and homepage region mapping — deterministic, no AI. Enriched
// prompt fields (shot type, lighting, ...) are added by the KIE image prompt
// stage (issue #10); crop/remap/retries never change slot identity.
// Issue #47: slot orientation is a compositional requirement derived from
// the Blueprint role's own words — the failed production build hardcoded
// landscape on both branches of this conditional and generated a 16:9
// collage for a 2:3 portrait role.
function orientationFromRole(rolePurpose: string): ImageSlot["orientation"] {
  const text = rolePurpose.toLowerCase();
  if (/portrait|vertical|2:3|3:4|9:16|headshot/.test(text)) return "portrait";
  if (/square|1:1|avatar|icon tile/.test(text)) return "square";
  return "landscape";
}

export function deriveImagePlan(blueprint: VisualBlueprint): ImagePlan {
  const slots: ImageSlot[] = [];
  const rolesById = new Map(blueprint.imageSystem.imageRoles.map((role) => [role.id, role]));

  for (const region of blueprint.homepageRegions) {
    if (!region.imageRoleId) continue;
    const role = rolesById.get(region.imageRoleId);
    if (!role) continue;
    slots.push({
      id: `home-${region.id}`,
      page: "home",
      regionId: region.id,
      semanticRole: role.purpose,
      blueprintRole: role.id,
      priority: role.priority,
      orientation: orientationFromRole(role.purpose),
      negativeSpaceForText: region.id.includes("hero"),
    });
  }

  const innerPages: Array<{ page: PageId; suffix: string }> = [
    { page: "about", suffix: "main" },
    { page: "about", suffix: "detail" },
    { page: "services", suffix: "main" },
    { page: "services", suffix: "detail" },
    { page: "contact", suffix: "atmosphere" },
  ];
  for (const entry of innerPages) {
    const role = blueprint.imageSystem.imageRoles.find((candidate) =>
      entry.suffix === "main" ? candidate.priority !== "NORMAL" : candidate.priority === "NORMAL"
    ) ?? blueprint.imageSystem.imageRoles[0];
    slots.push({
      id: `${entry.page}-${entry.suffix}`,
      page: entry.page,
      semanticRole: role.purpose,
      blueprintRole: role.id,
      priority: entry.suffix === "main" ? "HIGH" : "NORMAL",
      orientation: orientationFromRole(role.purpose),
      negativeSpaceForText: false,
    });
  }

  return { version: "1", slots };
}

// ── Assembly validation (deterministic, cross-file) ─────────────────────────

// AssemblyFinding (the deterministic validation finding shape) lives in
// ./assembly-repair since issue #69 and is re-exported here for the
// established import path.
export type { AssemblyFinding };

export interface AssembledSiteSource {
  pages: Record<PageId, string>;
  sharedCss: string;
  sharedJs: string;
}

// Issue #47: the class vocabulary the generated CSS actually defines. The
// CSS call owns styling vocabulary; this inventory is injected verbatim into
// every page prompt and used to detect orphaned HTML classes at assembly.
export function extractCssClassInventory(css: string): string[] {
  const classes = new Set<string>();
  for (const match of css.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
    classes.add(match[1]);
  }
  return [...classes];
}

function extractHtmlClasses(html: string): Set<string> {
  const classes = new Set<string>();
  for (const match of html.matchAll(/class=(?:"([^"]*)"|'([^']*)')/g)) {
    for (const cls of (match[1] ?? match[2] ?? "").split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  }
  return classes;
}

// ── CSS rule extraction + realization classification (issue #47) ────────────

export interface ParsedCssRule {
  selectors: string[];
  declarations: string[];
  /** True when the rule sits inside an @media/@supports block. */
  conditional: boolean;
}

function collectCssRules(fragment: string, conditional: boolean, out: ParsedCssRule[]): void {
  let index = 0;
  while (index < fragment.length) {
    const open = fragment.indexOf("{", index);
    if (open === -1) return;
    const header = fragment.slice(index, open).trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < fragment.length && depth > 0) {
      const character = fragment[cursor];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      cursor += 1;
    }
    const body = fragment.slice(open + 1, cursor - 1);
    if (header.startsWith("@")) {
      // Only conditional rules carry binding weight for @media/@supports;
      // @keyframes/@font-face bodies never scope canonical region selectors.
      if (/^@(media|supports)\b/i.test(header)) collectCssRules(body, true, out);
    } else {
      const declarations = body
        .split(";")
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration.includes(":"));
      if (header.length > 0 && declarations.length > 0) {
        out.push({
          selectors: header.split(",").map((selector) => selector.trim()).filter(Boolean),
          declarations,
          conditional,
        });
      }
    }
    index = cursor;
  }
}

// Deterministic, tolerant rule extraction for the generated plain-CSS
// stylesheet: strips comments, walks @media/@supports bodies, and keeps every
// rule that carries at least one real declaration.
export function parseCssRules(css: string): ParsedCssRule[] {
  const rules: ParsedCssRule[] = [];
  collectCssRules(css.replace(/\/\*[\s\S]*?\*\//g, ""), false, rules);
  return rules;
}

// Region binding selectors match modulo quote style and surrounding
// whitespace: `[data-region="hero"]` realizes `[data-region='hero']` and
// qualified/compound scopes like `section[data-region="hero"] .inner`. The
// closing `"]` makes substring matching id-exact — a different region id can
// never satisfy another region's binding.
function selectorRealizesBinding(selector: string, binding: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, " ").replace(/["']/g, "").trim();
  return normalize(selector).includes(normalize(binding));
}

// Deterministic classification of generated HTML classes that have no CSS
// rule (issue #47 section E). A class the shared runtime references, or one
// matching the reserved state conventions, is a behavior/state marker — NOT a
// styling defect. Everything else is styling intent: generated markup has no
// third-party classes, so an unrealized styling class is a vocabulary split
// (the unknown bucket fails closed into this one).
const BEHAVIOR_STATE_CLASS_PATTERN = /^(?:is|has|js)-/;
const BEHAVIOR_STATE_CLASS_NAMES = new Set([
  "active", "open", "visible", "hidden", "current", "selected",
  "expanded", "collapsed", "loading", "nav-open",
]);
const NON_STYLING_HOOK_CLASS_NAMES = new Set(["no-js"]);

export type GeneratedClassRole = "styling-intent" | "behavior-state" | "non-styling-hook";

export function classifyGeneratedClass(cls: string, sharedJs: string): GeneratedClassRole {
  if (BEHAVIOR_STATE_CLASS_PATTERN.test(cls) || BEHAVIOR_STATE_CLASS_NAMES.has(cls) || sharedJs.includes(cls)) {
    return "behavior-state";
  }
  if (NON_STYLING_HOOK_CLASS_NAMES.has(cls)) return "non-styling-hook";
  return "styling-intent";
}

// ── Business-truth trust-context lint (issue #48) ───────────────────────────
//
// Reproducing a Reference trust-band STRUCTURE never licenses inventing its
// entities: the production candidate fabricated client names ("Glap Thon",
// "Marivert", "6699", "Scap Thes", "Hopes") to fill a Reference client-logo
// band. That is a Business Truth defect, not an aesthetic one. The lint is
// deliberately context-scoped and fact-anchored — NOT a global capitalization
// scan: a label is a defect only when it sits in a trust-signaling context
// (DOM attributes/headings or a Blueprint region whose semantic role is a
// trust context), is short/logo-like, is entity-shaped, and is not backed by
// the Business Facts or the safe service/topic vocabulary.
const TRUST_CONTEXT_PATTERN =
  /\b(clients?|customers?|trusted\s+by|partners?|partnership|awards?|winners?|winning|featured\s+in|press|certif(?:ied|ication|ications?)|testimonials?|reviews?|logos?|logo\s*wall|accredited?|endorsements?)\b/i;

// Generic category/topic words that cannot constitute a fabricated entity on
// their own. A label whose content words are all generic/fact-backed is safe
// even when it appears in a trust context ("Nairobi SMEs", "SEO agencies").
const GENERIC_TRUST_LABEL_WORDS = new Set(
  ("business businesses brand brands company companies firm firms startup startups sme smes " +
    "organization organizations organisation organisations professional professionals team teams " +
    "agency agencies enterprise enterprises people entrepreneur entrepreneurs owner owners " +
    "retail ecommerce e-commerce hospitality travel tourism services service industry industries " +
    "sector sectors local global leading growing modern trusted emerging ambitious small medium large " +
    "help story work about meet contact more " +
    "signature imagery photo photograph image picture graphic visual visuals media asset banner " +
    "collage strip section band studio style show showing featuring work works crafted" +
    "the a an and or but if of for to in on at by with from as into over under between after before " +
    "during through without within who whom whose what why how when where we us our you your they them " +
    "their he she it its i me my this these those that is are was were be been being have has had do " +
    "does did will would can could should may might must not no so than too very own same s such only " +
    "every all any some both few other others another each")
    .split(" ")
);

interface TrustLabel {
  text: string;
  context: string;
}

// Words the Business Facts vouch for (lowercased). Any fact string contributes
// its words: a supplied partner/customer name in the facts is therefore
// permitted explicitly (issue #48 acceptance #3).
// Exported for the SIMPLE design pipeline's deterministic truth lint.
export function factVocabulary(facts: BusinessFacts | undefined): Set<string> {
  const words = new Set<string>(["wazibiz"]);
  if (!facts) return words;
  const strings = [
    facts.businessName,
    facts.businessType ?? "",
    facts.businessDescription ?? "",
    facts.idealClientProfile ?? "",
    facts.addressLine1 ?? "",
    facts.city ?? "",
    facts.country ?? "",
    facts.extraInformation ?? "",
  ];
  for (const text of strings) {
    for (const word of text.toLowerCase().split(/[^a-z0-9&]+/)) {
      if (word) words.add(word);
    }
  }
  return words;
}

// Entity-shaped: a short label that reads like a proper name, brand or mark
// rather than a common phrase. Sentence-case phrases ("Web design",
// "Kenyan SMEs"), acronyms ("SEO", "SMEs"), lowercase and purely generic
// labels are exempt; interior capitals ("Glap Thon"), single capitalized
// unknown words ("Marivert"), digit runs ("6699") and long all-caps tokens
// are entity signals.
function isEntityLikeLabel(label: string): boolean {
  const trimmed = label.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (/\d{2,}/.test(trimmed)) return true; // "6699" — digit-run marks
  if (trimmed === trimmed.toLowerCase()) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 6) return false; // prose/copy, not a logo label
  const vocabularyFree = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "");
  let interiorCapital = false;
  let singleCapitalizedCandidate = false;
  words.forEach((word, index) => {
    const bare = vocabularyFree(word);
    if (!bare) return;
    if (/^\d+$/.test(bare)) return;
    const isAllCaps = bare === bare.toUpperCase() && bare.length >= 2;
    const isCapitalized = /^[A-Z]/.test(word);
    if (isAllCaps && bare.length <= 5) return; // acronym: SEO, SMEs, B2B
    if (index === 0 && isCapitalized && word.slice(1) === word.slice(1).toLowerCase()) {
      singleCapitalizedCandidate = true; // may be sentence case
      return;
    }
    if (isCapitalized || (isAllCaps && bare.length > 5)) interiorCapital = true;
  });
  if (interiorCapital) return true;
  // A single-word label starting with a capital is a logo mark unless it is
  // sentence case AND generic/fact-backed ("Nairobi", "SEO").
  if (singleCapitalizedCandidate && words.length === 1) return true;
  return false;
}

function isFactSafeLabel(label: string, factWords: Set<string>): boolean {
  const words = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((word) => factWords.has(word) || GENERIC_TRUST_LABEL_WORDS.has(word));
}

// ── Issue #53: entity classification by text ROLE ───────────────────────────
//
// A trust-signaling region triggers INSPECTION, not blanket suspicion. The
// semantic question is "is this text presented as the identity of a third-
// party trust entity the Business Facts do not support?", never "is every
// text node made of fact-vocabulary words?". The production false positives
// ("Working with RankForge", "Who We Serve") were heading prose in trust-
// role regions, not fabricated client identities.
//
// Roles (minimum representation compatible with the DOM walk):
//   identity — logo-strip/name carriers: list items, image alt text,
//              elements whose own attributes signal a trust presentation
//              (class="client-logo"). Strict fact check — this is where
//              fabricated entities live ("Glap Thon", "6699" as logo).
//   heading  — h3-h6 prose. Title Case is normal heading style, not a brand
//              mark; flagged only when it carries a proper-noun claim (an
//              interior capitalized word that is neither function/common
//              heading vocabulary nor fact/business vocabulary), or when the
//              strict fact check fails.
//   text     — span/p/div copy. Kept on the strict path (short entity-shaped
//              fragments in a trust band are still identity claims), except
//              that a bare decorative numeric mark is not a company.
//   action   — CTA/navigation/action components (final SIMPLE iteration, #5):
//              anchors, buttons, role=button, action-classed elements, and
//              imperative-verb labels ("Learn More About Us"). Behavior, not
//              identity — never a third-party entity claim, no matter what
//              trust-classed ANCESTOR they sit in. Genuine trust identities
//              (testimonial authors, client/partner logos, awards, press,
//              review attribution) keep the strict path.

type TrustTextRole = "identity" | "heading" | "text" | "action";

// Imperative-verb-led short phrases are call-to-action copy, not entity
// marks. Conservative shape: verb-led, short, no digits ("Learn More About
// Us" passes; "Digital Africa Awards" and "Zynthara Labs" do not — "digital"
// and "zynthara" are not action verbs). Semantic role, NOT an exact-string
// whitelist.
const ACTION_LABEL_PATTERN =
  /^(?:learn|read|see|view|explore|discover|meet|talk|hear|find|check|browse|get|start|join|book|call|email|contact|reach|connect|follow|subscribe|share|visit|dive|unlock|skip|try|download|watch|listen|sign|log|chat|message|request|schedule|reserve|apply|donate|support|search|filter|sort|next|previous|back|continue|return|go|more)\b/i;

function isActionOrientedLabel(label: string): boolean {
  const trimmed = label.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 40) return false;
  if (/\d/.test(trimmed)) return false;
  if (trimmed.split(/\s+/).length > 6) return false;
  return ACTION_LABEL_PATTERN.test(trimmed);
}

// Elements whose own presentation marks them as an action component — their
// text is behavior, never an entity claim, regardless of the trust-classed
// container they sit in.
const ACTION_ELEMENT_PATTERN = /\b(?:btn|button|cta|nav|navbar|navigation|menu|link|action)\b/i;

function isActionElement(attributes: string): boolean {
  return ACTION_ELEMENT_PATTERN.test(attributes) || /\brole=["']?button/i.test(attributes);
}

// Common verbs/nouns of descriptive headings — cannot constitute an entity
// claim even when Title-Cased ("Who We Serve", "Our Approach"). Deliberately
// narrow; every word must ALSO survive the shape gate, and any word not in
// this set, the generic set, or the fact/business vocabulary still fails.
const HEADING_COMMON_WORDS = new Set(
  ("serve serves served serving approach work works working worked build builds building built " +
    "grow grows growing grown improving improve improve")
    .split(" ")
    .filter(Boolean)
);

function bareWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Capitalized words in ANY position (acronyms of <=5 letters excluded — the
// shape gate already treats them as non-proper). This is the proper-noun
// signal set used by every role-aware exemption below.
function capitalizedWords(label: string): string[] {
  const found: string[] = [];
  for (const word of label.trim().split(/\s+/)) {
    const bare = bareWord(word);
    if (!bare || /^\d+$/.test(bare)) continue;
    if (/^[A-Z]/.test(word) && !(bare === bare.toUpperCase() && bare.length <= 5)) found.push(bare);
  }
  return found;
}

// The Business name's distinguishing token — its longest word ("rankforge"
// for "RankForge Kenya"). A label is a BUSINESS SELF-REFERENCE only when all
// of its capitalized words are safe vocabulary AND the distinctive token is
// present, so "Working with RankForge" is exempt while "Acme Kenya" (merely
// borrowing the name's geographic word) is not.
function businessNameDistinctiveToken(businessNameWords: Set<string>): string {
  return [...businessNameWords].reduce((a, b) => (b.length > a.length ? b : a), "");
}

// A bare numeric/symbolic mark ("6699", "+", "*") presented as copy or a
// heading is decoration, not a company — unless it sits in an identity slot
// (li / alt / logo-class), where marks read as brand labels.
function isDecorativeNumericMark(label: string): boolean {
  const trimmed = label.trim();
  return /^[\d\s.,+\-()#*·:']+$/.test(trimmed) && /\d/.test(trimmed);
}

// The single failing predicate for one collected label (issue #53). Returns
// false when the label is safe. A trust region triggers INSPECTION; whether a
// label is an entity claim depends on its presentation role:
//   identity (li, img alt, logo-class elements) — strict #48 semantics:
//     shape gate + every-word fact check. This is where fabricated entities
//     live ("Glap Thon", "6699" rendered as a logo).
//   heading (h3-h6 prose) — Title Case is heading style, not a brand mark:
//     flagged only when a capitalized word is neither function/common-heading
//     vocabulary nor fact/business vocabulary ("Digital Africa Awards" fails;
//     "Who We Serve", "Our Approach" pass), or on strict fact-check failure.
//   text (span/p/div copy) — strict, except a bare decorative numeric mark.
// Business self-reference ("Working with RankForge") is safe in every role.
function classifyTrustLabelFailure(
  label: string,
  role: TrustTextRole,
  factWords: Set<string>,
  businessNameWords: Set<string>
): boolean {
  if (role === "action") return false; // CTA/nav component — behavior, not identity
  if (!isEntityLikeLabel(label)) return false;
  if (isActionOrientedLabel(label)) return false; // action-oriented copy in any carrier
  const caps = capitalizedWords(label);
  const safe = caps.every(
    (word) => GENERIC_TRUST_LABEL_WORDS.has(word) || HEADING_COMMON_WORDS.has(word) || factWords.has(word) || businessNameWords.has(word)
  );
  const distinctive = businessNameDistinctiveToken(businessNameWords);
  if (safe && distinctive !== "" && caps.includes(distinctive)) return false; // business self-reference
  if (role === "heading" && safe) return false; // descriptive heading, no proper-noun claim
  if (role !== "identity" && isDecorativeNumericMark(label)) return false; // decorative mark
  return !isFactSafeLabel(label, factWords);
}

// Collect short entity-carrying labels from a trust context's inner HTML,
// each with its presentation ROLE (issue #53): list items, image alt texts,
// text-only elements, and — as pure "action" roles that can never fail —
// anchors/buttons and action-classed elements (final SIMPLE iteration #5:
// a CTA inside a testimonial-classed container is navigation, not a client).
function collectTrustLabels(innerHtml: string): Array<{ text: string; role: TrustTextRole }> {
  const labels: Array<{ text: string; role: TrustTextRole }> = [];
  const stripTags = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  for (const match of innerHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = stripTags(match[1]);
    if (text) labels.push({ text, role: "identity" });
  }
  for (const match of innerHtml.matchAll(/<img\b[^>]*>/gi)) {
    const alt = /alt=(?:"([^"]*)"|'([^']*)')/i.exec(match[0]);
    const text = (alt?.[1] ?? alt?.[2] ?? "").trim();
    if (text) labels.push({ text, role: "identity" });
  }
  for (const match of innerHtml.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const text = stripTags(match[3]);
    if (text) labels.push({ text, role: "action" });
  }
  for (const match of innerHtml.matchAll(/<(span|p|h3|h4|h5|h6|div)\b([^>]*)>([^<]*)<\/\1>/gi)) {
    const text = match[3].replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const tagName = match[1].toLowerCase();
    const attributes = match[2] ?? "";
    // An element presenting itself as an action component (button/CTA/nav/
    // link classes, role=button) is behavior, not an identity slot.
    if (isActionElement(attributes)) {
      labels.push({ text, role: "action" });
      continue;
    }
    // h3-h6 are heading prose; eyebrow/kicker presentation is descriptive
    // kicker text in a non-heading element — production (Build 282f9b9d)
    // proved `<p class="eyebrow">Who We Serve</p>` is the same descriptive
    // heading prose #53 already exempts, merely styled as a kicker (issue
    // #67 §31); an element whose own attributes signal a trust/logo
    // presentation (class="client-logo", aria-label="Our clients") is an
    // identity slot regardless of tag; everything else is copy.
    const role: TrustTextRole = /^h[3-6]$/.test(tagName) || /\b(?:eyebrow|kicker)\b/i.test(attributes)
      ? "heading"
      : TRUST_CONTEXT_PATTERN.test(attributes)
        ? "identity"
        : "text";
    labels.push({ text, role });
  }
  return labels;
}

// A heading is a trust-context signal only when the trust phrase dominates
// it: the text matches the trust pattern and every word OUTSIDE the matched
// phrase is generic/function vocabulary.
function isTrustHeading(headingText: string): boolean {
  if (headingText.length === 0 || headingText.length > 40) return false;
  const match = TRUST_CONTEXT_PATTERN.exec(headingText);
  if (!match) return false;
  const remainder = (headingText.slice(0, match.index) + " " + headingText.slice(match.index + match[0].length))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return remainder.every((word) => GENERIC_TRUST_LABEL_WORDS.has(word));
}

// Deterministic scan of one page: find trust contexts (an attribute match on
// a container, a trust heading inside it, or a Blueprint region whose
// semantic purpose is a trust context) and entity-check every short label
// inside them. Violations are deduplicated by label text.
export function lintTrustContexts(
  html: string,
  pageId: PageId,
  factWords: Set<string>,
  trustRegionPurposes: Map<string, string>,
  businessNameWords: Set<string> = new Set()
): TrustLabel[] {
  const violations = new Map<string, TrustLabel>();
  const contextRegions = new Set(trustRegionPurposes.keys());

  interface Frame {
    tagName: string;
    innerStart: number;
    attributes: string;
    regionId: string | null;
    trustByAttribute: boolean;
    trustByHeading: boolean;
  }
  const stack: Frame[] = [];

  const consider = (innerHtml: string, context: string) => {
    for (const label of collectTrustLabels(innerHtml)) {
      if (classifyTrustLabelFailure(label.text, label.role, factWords, businessNameWords)) {
        if (!violations.has(label.text)) violations.set(label.text, { text: label.text, context });
      }
    }
  };

  const token = /<(\/)?(section|div|ul|ol|footer|aside|nav|article|h[1-6])\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html)) !== null) {
    const [full, closing, tagNameRaw, attributes] = match;
    const tagName = tagNameRaw.toLowerCase();
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].tagName === tagName) {
          const frame = stack[index];
          const trustByRegion = frame.regionId !== null && contextRegions.has(frame.regionId);
          if (frame.trustByAttribute || frame.trustByHeading || trustByRegion) {
            const regionPurpose = frame.regionId ? trustRegionPurposes.get(frame.regionId) : undefined;
            const context = regionPurpose
              ? `${pageId}: Blueprint trust region '${frame.regionId}' (${regionPurpose})`
              : `${pageId}: trust context <${frame.tagName} ${frame.attributes.trim().slice(0, 80)}>`;
            consider(html.slice(frame.innerStart, match.index), context);
          }
          stack.length = index;
          break;
        }
      }
      continue;
    }
    if (/^h[1-6]$/.test(tagName)) {
      // A short trust heading ("Trusted by", "Our clients") signals a trust
      // context for its container. A heading that merely CONTAINS a trust
      // word inside a proper noun — the Business name as H1 ("… & Vale
      // Partners") — does not: after removing the matched phrase, every
      // remaining word must be generic/function vocabulary.
      const headingEnd = html.indexOf(`</${tagName}>`, match.index + full.length);
      const headingText = headingEnd === -1 ? "" : stripHtml(html.slice(match.index + full.length, headingEnd));
      if (stack.length > 0 && isTrustHeading(headingText)) {
        stack[stack.length - 1].trustByHeading = true;
      }
      continue;
    }
    const regionMatch = /data-region="([^"]*)"/i.exec(attributes);
    const regionId = regionMatch ? regionMatch[1] : stack.length > 0 ? stack[stack.length - 1].regionId : null;
    stack.push({
      tagName,
      innerStart: match.index + full.length,
      attributes,
      regionId,
      trustByAttribute: TRUST_CONTEXT_PATTERN.test(attributes),
      trustByHeading: false,
    });
  }
  return [...violations.values()];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

// Exported for the SIMPLE design pipeline's deterministic truth lint
// (src/simple-design/bundle-qa.ts) — same zero-tolerance patterns, one copy.
export const UNSUPPORTED_FACT_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "FABRICATED_AWARD", pattern: /\b(award|winner|winning|prize|certified|certification|accredited)\b/i },
  { id: "FABRICATED_SOCIAL_PROOF", pattern: /\b\d+\s?\+?\s?(clients|customers|projects|reviews|testimonials|jobs)\b/i },
  { id: "FABRICATED_EXPERIENCE", pattern: /\b\d+\s?years?\s(of\s)?(experience|in business|serving)\b/i },
  { id: "FABRICATED_YEAR", pattern: /\bsince\s+(19|20)\d{2}\b/i },
  // Founding-year phrasing ("Established 1998", "Founded in 2004", "Est.
  // 1999") is an unsupported founding-date claim unless supplied as a fact.
  // Contextual verbs keep arbitrary years in addresses, phone numbers or
  // copyright lines from matching (QA-F3).
  { id: "FABRICATED_FOUNDING_YEAR", pattern: /\b(established|founded|est\.?)\s*(in\s+)?(19|20)\d{2}\b/i },
  { id: "FABRICATED_RATING", pattern: /\b(5\.0|four|five)\s?[- ]?star\b|\brated\s+\d(\.\d)?\/5\b/i },
];

// Deterministic cross-file validation of the assembled source (PRD section 15
// step 8). Semantic, navigation, contract, slot and fact-provenance rules.
// `facts` and `blueprint` are optional so frozen callers stay valid; when
// present they anchor the Business-truth trust-context lint (issue #48).
export function validateAssembledSite(
  source: AssembledSiteSource,
  context: { contract: ImplementationContract; slots: ImageSlot[]; facts?: BusinessFacts; blueprint?: VisualBlueprint }
): { passed: boolean; findings: AssemblyFinding[] } {
  const findings: AssemblyFinding[] = [];
  const pageFiles = new Set(
    Object.values(context.contract.files.pageFiles).map((file) => `/${file === "index.html" ? "" : file.replace(/\.html$/, "")}`)
  );
  const slotIds = new Set(context.slots.map((slot) => slot.id));

  for (const pageId of PAGE_IDS) {
    const html = source.pages[pageId];
    if (typeof html !== "string" || html.length === 0) {
      findings.push({ id: "MISSING_PAGE", detail: `page '${pageId}' was not generated` });
      continue;
    }
    const doc = html.toLowerCase();

    if (!doc.trimStart().startsWith("<!doctype html")) {
      findings.push({ id: "NON_SEMANTIC_STRUCTURE", detail: `${pageId}: missing <!DOCTYPE html>` });
    }
    for (const tag of ["<header", "<nav", "<main", "<footer"]) {
      if (!doc.includes(tag)) findings.push({ id: "NON_SEMANTIC_STRUCTURE", detail: `${pageId}: missing semantic <${tag.slice(1)}>` });
    }
    const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
    if (h1Count === 0) findings.push({ id: "MISSING_H1", detail: `${pageId}: no H1` });
    if (h1Count > 1) findings.push({ id: "MULTIPLE_H1", detail: `${pageId}: ${h1Count} H1 elements` });

    const stylesheetLinked = [/href="site\.css"/i, /href='site\.css'/i, /href="\.\/site\.css"/i, /href="\/site\.css"/i].some((pattern) => pattern.test(html));
    if (!stylesheetLinked) {
      findings.push({ id: "MISSING_SHARED_CSS_LINK", detail: `${pageId}: site.css not linked` });
    }
    if (!/src="(?:\.?\/)?site\.js"/i.test(html)) {
      findings.push({ id: "MISSING_SHARED_JS_LINK", detail: `${pageId}: site.js not referenced` });
    }
    if (!doc.includes('name="viewport"')) {
      findings.push({ id: "MISSING_VIEWPORT_META", detail: `${pageId}: no responsive viewport meta` });
    }

    // Issue #69: the href character class must cover hyphens/digits — a
    // broken href like "/broken-about" used to escape the scan entirely
    // (the match stopped at the hyphen), so the repair authority never
    // learned the exact broken value to authorize.
    for (const href of html.match(/href="\/[a-z0-9-]*"/gi) ?? []) {
      if (!pageFiles.has(href.slice(6, -1)) && href.slice(6, -1) !== "/") {
        findings.push({ id: "BROKEN_NAV_LINK", detail: `${pageId}: internal link ${href} resolves to no generated page` });
      }
    }
    for (const other of PAGE_IDS) {
      if (other === pageId) continue;
      const target = other === "home" ? 'href="/"' : `href="/${other}"`;
      if (!html.includes(target)) {
        findings.push({ id: "BROKEN_NAV_LINK", detail: `${pageId}: navigation misses link to '${other}' (${target})` });
      }
    }

    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const src = /src="([^"]+)"/i.exec(tag)?.[1] ?? "";
      const dataId = /data-image-id="([^"]+)"/i.exec(tag)?.[1];
      if (!src.startsWith("IMG:")) {
        findings.push({ id: "IMG_NOT_SLOT_PLACEHOLDER", detail: `${pageId}: <img src="${src}"> is not an IMG: slot placeholder` });
      } else if (dataId !== src.slice(4)) {
        findings.push({ id: "IMG_MISSING_DATA_ID", detail: `${pageId}: data-image-id '${dataId ?? ""}' does not match slot src '${src}'` });
      } else if (!slotIds.has(src.slice(4))) {
        findings.push({ id: "UNKNOWN_IMG_SLOT", detail: `${pageId}: '${src.slice(4)}' is not a planned Image Slot` });
      }
    }

    for (const { id, pattern } of UNSUPPORTED_FACT_PATTERNS) {
      const text = html.replace(/<[^>]+>/g, " ");
      if (pattern.test(text)) {
        findings.push({ id, detail: `${pageId}: generated content invents an unsupported Business Fact (${pattern.source})` });
      }
    }

    // Issue #48: trust/identity contexts may only carry fact-backed labels.
    // A Blueprint region whose semantic role is a trust context (client logo
    // band, testimonials, awards…) triggers the same lint on its markup.
    const trustRegionPurposes = new Map<string, string>();
    for (const region of context.blueprint?.homepageRegions ?? []) {
      if (TRUST_CONTEXT_PATTERN.test(region.purpose)) trustRegionPurposes.set(region.id, region.purpose);
    }
    if (context.facts || trustRegionPurposes.size > 0) {
      const factWords = factVocabulary(context.facts);
      const businessNameWords = new Set<string>(
        (context.facts?.businessName ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
      );
      for (const violation of lintTrustContexts(html, pageId, factWords, trustRegionPurposes, businessNameWords)) {
        findings.push({
          id: "FABRICATED_TRUST_ENTITY",
          detail: `${pageId}: trust label '${violation.text}' is not backed by the Business Facts (${violation.context}) — reproducing a Reference trust structure never licenses inventing its entities`,
        });
      }
    }
  }

  // Home mirrors Blueprint homepage topology via data-region attributes.
  const home = source.pages.home ?? "";
  for (const region of context.contract.pages.find((page) => page.id === "home")?.regions ?? []) {
    if (!home.includes(`data-region="${region.id}"`)) {
      findings.push({ id: "MISSING_REGION", detail: `home: Blueprint region '${region.id}' not realized (data-region)` });
    }
  }

  // Issue #47: CSS/HTML realization binding. The failed production build
  // generated a Blueprint-faithful stylesheet that the pages never used
  // (split class vocabularies) — the 4-up grid, full-bleed hero and display
  // typography rules all existed but nothing applied them. Two mechanical
  // checks close that seam: every canonical region must have a real CSS rule
  // scoped to its bound selector (a rule with declarations — not a bare
  // mention), and every styling-intent class the pages use must exist in the
  // CSS vocabulary. Behavior/state classes (JS hooks) are classified and
  // exempt; unknown classes fail closed as styling intent.
  if (context.contract.realization) {
    const rules = parseCssRules(source.sharedCss);
    for (const binding of context.contract.realization.regionStyleBinding) {
      const realized = rules.some((rule) =>
        rule.selectors.some((selector) => selectorRealizesBinding(selector, binding.cssSelector))
      );
      if (!realized) {
        findings.push({
          id: "REGION_STYLE_MISSING",
          detail: `home: canonical region '${binding.regionId}' has no CSS rule scoped to '${binding.cssSelector}' (realization binding)`,
        });
      }
    }
    const cssClasses = new Set(extractCssClassInventory(source.sharedCss));
    for (const pageId of PAGE_IDS) {
      const html = source.pages[pageId] ?? "";
      const orphaned = [...extractHtmlClasses(html)].filter((cls) => !cssClasses.has(cls));
      const unrealized = orphaned.filter((cls) => classifyGeneratedClass(cls, source.sharedJs) === "styling-intent");
      if (unrealized.length > 0) {
        findings.push({
          id: "ORPHANED_CLASS",
          detail: `${pageId}: ${unrealized.length} styling-intent class${unrealized.length === 1 ? " has" : "es have"} no rule in site.css (CSS/HTML vocabulary contract): ${unrealized.slice(0, 8).join(", ")}`,
        });
      }
    }
  }

  // Contact form browser contract: platform endpoint, no browser-controlled
  // recipient/sender/template fields.
  const contact = source.pages.contact ?? "";
  if (contact) {
    if (!contact.includes(`action="${context.contract.formContract.formServiceEndpoint}"`)) {
      findings.push({ id: "FORM_CONTRACT_VIOLATION", detail: "contact: form does not post to the WAZIBIZ Form Service endpoint" });
    }
    for (const forbidden of ['name="recipient"', 'name="to"', 'name="from"', 'name="sender"', 'name="template"']) {
      if (contact.toLowerCase().includes(forbidden)) {
        findings.push({ id: "FORM_CONTRACT_VIOLATION", detail: `contact: browser code controls delivery via ${forbidden}` });
      }
    }
  }

  if (!source.sharedCss.includes("@media")) {
    findings.push({ id: "NON_RESPONSIVE_CSS", detail: "site.css contains no @media responsive rules" });
  }
  if (source.sharedJs.trim().length === 0) {
    findings.push({ id: "MISSING_SHARED_JS", detail: "site.js is empty" });
  }

  return { passed: findings.length === 0, findings };
}

// ── Prompt builders ─────────────────────────────────────────────────────────

function factsBlock(facts: BusinessFacts): string {
  return `SUPPORTED BUSINESS FACTS (use ONLY these; never invent awards, ratings, counts, years, prices, guarantees or testimonials):
${JSON.stringify(facts, null, 2)}`;
}

function cssPrompt(blueprint: VisualBlueprint, contract: ImplementationContract): string {
  // Issue #47: the CSS call owns the styling vocabulary. The binding block
  // makes the canonical-region selectors non-negotiable and tells the model
  // that the pages are generated against THIS stylesheet's class inventory —
  // the failed production build wrote a faithful stylesheet whose classes
  // the page calls never discovered.
  const realizationBlock = contract.realization
    ? `
STYLING CONTRACT (binding, issue #47):
- You own the styling vocabulary. The four pages are generated AFTER you, against YOUR class inventory — every styling class you expect the markup to use must be defined in this stylesheet, with clear reusable names.
- The canonical homepage regions MUST be styled through their data-region attribute selectors. Include at least one rule for EACH of these selectors (layout, surface, spacing or component geometry as the Blueprint demands): ${contract.realization.regionStyleBinding.map((binding) => binding.cssSelector).join(", ")}.
- Define the shared component classes the Blueprint's header/navigation, pills/badges, buttons, cards, splits and footer language need — the pages will use these names verbatim.
- The first-viewport region(s) (${blueprint.homepageFirstViewport.regionIds.join(", ")}) MUST realize the Blueprint first-viewport geometry (full-bleed media role, viewport-height target, display type scale) in the rules scoped to their data-region selector.`
    : "";
  return `Generate the shared stylesheet 'site.css' for the four-page Site. Realize the Visual Blueprint visual thesis, tokens, typography roles, color roles, global grid/container logic (including asymmetric column ratios), spacing rhythm, surface language, header/navigation language, motion grammar (transitions only, no libraries) and the responsive contract with real @media rules — and give the signature traits and homepage regions their distinct visual form (surface treatments, component geometry, spacing identity). Reference-specific grids, overlaps, clipping and asymmetry must survive — do NOT normalize to a generic centered template. Class names may be domain-specific to this design; there is no universal layout template. Anti-fallback rules are binding.${realizationBlock}

CONTENT CAPACITY (remediation Part 9): where the Blueprint records measured region proportions, the regions' geometry is binding — derived copy must fit the measured capacity (tighten or shorten copy rather than shrinking or restructuring a region).

CONTRACT FILES: shared CSS file name '${contract.files.sharedCss}'.
BLUEPRINT:
${JSON.stringify(
    {
      visualThesis: blueprint.visualThesis,
      tokens: blueprint.tokens,
      globalGrid: blueprint.globalGrid,
      spacingRhythm: blueprint.spacingRhythm,
      typographyRoles: blueprint.typographyRoles,
      colorRoles: blueprint.colorRoles,
      surfaceLanguage: blueprint.surfaceLanguage,
      headerNavigation: blueprint.headerNavigation,
      motionGrammar: blueprint.motionGrammar,
      responsiveContract: blueprint.responsiveContract,
      antiFallbackRules: blueprint.antiFallbackRules,
      accessibilityAdaptations: blueprint.accessibilityAdaptations,
      signatureTraits: blueprint.signatureTraits,
      homepageFirstViewport: blueprint.homepageFirstViewport,
      homepageRegions: blueprint.homepageRegions,
    },
    null,
    2
  )}`;
}

function jsPrompt(blueprint: VisualBlueprint): string {
  return `Generate the minimal shared runtime 'site.js' (no libraries, no frameworks). Requirements derived from the Blueprint: navigation menu toggle for the collapsed mobile nav, subtle reveal-on-scroll behavior matching the motion grammar with a prefers-reduced-motion guard, and nothing else.

MOTION GRAMMAR: ${JSON.stringify(blueprint.motionGrammar)}
RESPONSIVE CONTRACT: ${JSON.stringify(blueprint.responsiveContract)}`;
}

function pagePrompt(input: {
  pageId: PageId;
  blueprint: VisualBlueprint;
  contract: ImplementationContract;
  facts: BusinessFacts;
  slots: ImageSlot[];
  compositionTargets?: Array<{ regionId: string; viewportHeightRatio: number; evidenceSegmentCount: number }>;
  cssClassInventory?: string[];
}): string {
  const { pageId, blueprint, contract, facts, slots } = input;
  const slotsForPage = (page: PageId, all: ImageSlot[]) => all.filter((slot) => slot.page === page).map((slot) => slot.id);
  const page = contract.pages.find((candidate) => candidate.id === pageId)!;
  // Issue #47: the generated stylesheet's actual class inventory — the
  // markup must style itself with THESE classes, not invent a second
  // vocabulary the stylesheet has never heard of.
  const stylingContract = input.cssClassInventory?.length
    ? `
- STYLING CONTRACT (binding): site.css has been generated and defines EXACTLY these styling classes: ${input.cssClassInventory.join(", ")}. Use ONLY these classes for styling (plus the canonical data-region attributes). Do NOT invent class names that are not in this list — an unstyled class is a validation failure. Canonical homepage regions are styled through their data-region attribute selectors; attach the matching classes for components inside them.`
    : "";
  const base = `Generate the complete semantic HTML page '${page.path}' (document for page id '${pageId}'). Requirements:
- <!DOCTYPE html>, <html lang>, semantic <header>/<nav>/<main>/<footer>, exactly ONE <h1>. The literal elements <header>, <nav>, <main> and <footer> are REQUIRED and validated mechanically: when a region section wraps the page footer, the <footer> element itself must still exist inside it — a <section> in place of <footer> fails validation.
- Include EXACTLY these tags in <head>/<body>: <link rel="stylesheet" href="site.css"> and <script src="site.js" defer></script>, plus the responsive viewport meta.
- Navigation links to /, /about, /services, /contact exactly.
- Every image is an unresolved placeholder: <img src="IMG:{slotId}" data-image-id="{slotId}" alt="..."> using ONLY the slot ids listed below.
- ${factsBlock(facts)}
- TRUST-CONTEXT TRUTH RULE (binding, issue #48/#53): if the Blueprint realizes a Reference trust band (client-logo wall, testimonials, awards, press, credibility band), preserve its visual composition but populate it ONLY with Business-Fact-backed entities or fact-safe substitutes (service categories, audience categories from the ideal-client profile, locations, process terms, abstract non-entity marks), presented so they are never mistaken for clients, partners or endorsements. NEVER invent clients, partners, companies, awards, certifications, publications, reviewers or endorsements. Headings inside such regions must be descriptive ("Who We Serve", "Our approach") or Business-name self-references ("Working with ${facts.businessName}") — never unsupported third-party names.
- Derived marketing copy may interpret these facts safely but must not invent unsupported facts. Fit copy to the Blueprint's measured region capacities — shorten or tighten copy rather than dropping required region geometry.${stylingContract}`;

  if (pageId === "home") {
    const compositionTargets = (input.compositionTargets ?? []).length
      ? `\n- MEASURED COMPOSITION TARGETS (frozen Reference Evidence measurements aggregated per canonical Blueprint region; QA validates the canonical topology against the Blueprint AND these measured proportions on the rendered page): keep each canonical region's rendered height near its target — ${input.compositionTargets!.map((region) => `${region.regionId} ≈ ${region.viewportHeightRatio.toFixed(2)} viewport-heights (aggregated from ${region.evidenceSegmentCount} measured evidence segment${region.evidenceSegmentCount === 1 ? "" : "s"})`).join(", ")}. The FIRST viewport ends at the boundary of the first-viewport region(s) totaling ≈ 1.0 viewport-height — do not make the first region trivially short or the page one long uniform stack. Each canonical region is realized as ONE top-level <section data-region>; internal wrappers inside a canonical region are allowed, but never split one canonical region into several top-level data-region sections.`
      : "";
    return `${base}
- The page structure MUST realize the Blueprint homepage topology in order: each canonical region rendered as exactly one top-level <section data-region="{regionId}"> using EXACTLY these region ids, in order, verbatim (no other ids, no renames): ${blueprint.homepageRegions.map((region) => region.id).join(", ")}. Each section carries its region's purpose.
- First viewport must match the Blueprint first-viewport description.${compositionTargets}
- Anti-fallback rules are binding: ${JSON.stringify(blueprint.antiFallbackRules)}.

HOMEPAGE REGIONS (ordered canonical topology): ${JSON.stringify(blueprint.homepageRegions)}
FIRST VIEWPORT: ${JSON.stringify(blueprint.homepageFirstViewport)}
SIGNATURE TRAITS (must be visually expressed through structure/classes): ${JSON.stringify(blueprint.signatureTraits)}
AVAILABLE IMAGE SLOTS (use EXACTLY these ids, verbatim): ${slotsForPage("home", slots).join(", ")}.`;
  }
  if (pageId === "contact") {
    return `${base}
- Include the contact form implementing the platform form contract EXACTLY: <form method="post" action="${contract.formContract.formServiceEndpoint}"> with fields ${JSON.stringify(contract.formContract.fields)} plus a hidden input name="siteFormId" value="${contract.formContract.siteFormId}".
- Browser code must NOT contain any recipient, sender, template or credential control.
- Present supported contact facts (email/phone/address only when present in the facts).

FORM CONTRACT: ${JSON.stringify(contract.formContract)}
AVAILABLE IMAGE SLOTS (use EXACTLY these ids, verbatim): ${slotsForPage("contact", slots).join(", ")}.`;
  }
  return `${base}
- Build the page from the Blueprint inner-page vocabulary: ${JSON.stringify(blueprint.innerPageVocabulary)}.
- Present only supported facts for this Business (description, type, city/country, socials when present).

AVAILABLE IMAGE SLOTS (use EXACTLY these ids, verbatim): ${slotsForPage(pageId, slots).join(", ")}.`;
}

// ── Generation service ──────────────────────────────────────────────────────

export class SiteGenerationValidationError extends Error {
  constructor(readonly findings: AssemblyFinding[]) {
    super(`Assembled Site failed deterministic assembly validation: ${findings.map((finding) => `${finding.id} (${finding.detail})`).join("; ")}`);
    this.name = "SiteGenerationValidationError";
  }
}

export interface GenerateCompleteSiteInput {
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  blueprint: VisualBlueprint;
  blueprintR2Key: string;
  contract: ImplementationContract;
  contractR2Key: string;
  generate?: RawAiGenerate;
  /** Bounded Automated Repair directives (issue #14): realization-only fixes
   *  appended to every generation prompt when regenerating a repaired Build
   *  Version. Never carries Business Fact / Reference / Build Mode / Blueprint
   *  changes (assertRepairPlanWithinBounds guards the plan itself). */
  repairDirectives?: string;
  /** Measured Reference composition aggregated per canonical Blueprint region
   *  through provenance (issue #37): the numeric proportions QA hard-gates.
   *  The Blueprint topology stays the only binding structure; these numbers
   *  are contextual measured evidence for each canonical region. */
  compositionTargets?: Array<{ regionId: string; viewportHeightRatio: number; evidenceSegmentCount: number }>;
  /** Normalized visual inputs from the Reference Visual Package (issue #43):
   *  in REFERENCE_BOUND the generator SEES the reference it must faithfully
   *  realize. Absent for ORIGINAL_DESIGN and undecodable evidence. */
  visualInputs?: NonNullable<ReferenceEvidence["visualInputs"]>;
  /** Multimodal generate seam (issue #43); defaults to the production vision
   *  adapter when visual inputs exist. */
  visionGenerate?: RawAiGenerate;
}

// Reference context block (issue #43): the attached visual source is
// supplementary ground truth for realizing the binding Blueprint — layout,
// composition, style, proportion and visual grammar ONLY. Reference
// content/branding isolation is restated on every generation call because the
// model now sees reference pixels; Business Fact and fabrication gates stay
// authoritative. Reference fidelity outranks generic design convention.
function referenceContextBlock(visualInputs: NonNullable<ReferenceEvidence["visualInputs"]>): string {
  return `

REFERENCE VISUAL CONTEXT (issue #43): a normalized rendering of the canonical Reference Screenshot is ATTACHED to this call (${JSON.stringify(
    visualInputs.map((input) => ({ kind: input.kind, width: input.width, height: input.height }))
  )}). The binding Visual Blueprint and Implementation Contract remain the authority for WHAT to build; the attached image is supplementary visual ground truth for HOW faithfully to realize them — layout, composition, style, proportion, visual grammar, component geometry, surface rhythm and spacing identity.
DO NOT copy from the Reference under any circumstances: written copy, business names, logos, testimonials, factual claims, contact information, images or assets. The Reference is a design source only; all content comes from the SUPPORTED BUSINESS FACTS and derived marketing language.
REFERENCE FIDELITY OVERRIDES GENERIC CONVENTION: when generic web/SaaS/agency design conventions conflict with the Blueprint + reference visual context, the reference wins. An unusual reference design stays unusual.`;
}

export interface GeneratedSite extends AssembledSiteSource {
  imagePlan: ImagePlan;
  validation: { passed: boolean; findings: AssemblyFinding[] };
  artifacts: Array<{ kind: string; subkey: string; r2Key: string }>;
  /** Issue #66: the exact immutable artifact composing each page of THIS
   *  candidate — base subkey or the informed assembly-repair subkey that
   *  superseded it. Never a timestamp guess. */
  effectivePages: Record<PageId, { subkey: string; checksum: string }>;
  effectiveSharedSource: { css: { subkey: string; checksum: string }; js: { subkey: string; checksum: string } };
}

// ── Effective candidate lineage (issue #66) ─────────────────────────────────
//
// The 2026-09-07 production failure (Build 282f9b9d): after the informed
// assembly repairs, the Home realization repair reassembled the candidate
// from BASE page artifacts — silently discarding the applied
// assembly-repair-1 fixes of the untouched pages and reintroducing
// BROKEN_NAV_LINK / ORPHANED_CLASS findings. 8 of 9 terminal findings came
// from that regression. The candidate therefore carries an explicit
// effective-page artifact map (the candidate manifest): every repair updates
// ONE pointer, unaffected pages keep their exact artifact, and assembly
// provenance answers "which Home? which About?" deterministically.

export const CANDIDATE_MANIFEST_SCHEMA_VERSION = "candidate-manifest/1";

export interface EffectivePageEntry {
  subkey: string;
  checksum: string;
}

export interface CandidateManifest {
  schemaVersion: string;
  /** How this manifest came to be: initial generation, or the realized
   *  repair that updated the pointers. */
  lineage: string;
  pages: Record<PageId, EffectivePageEntry>;
  sharedCss: EffectivePageEntry;
  sharedJs: EffectivePageEntry;
  /** Issue #66 §15: per-page before/after checksums for pages the targeted
   *  repair did NOT touch — recorded so preservation is auditable. */
  unaffectedHashes?: Array<{ pageId: PageId; beforeSha256: string; afterSha256: string }>;
}

export function buildCandidateManifest(input: {
  lineage: string;
  pages: Record<PageId, EffectivePageEntry>;
  sharedCss: EffectivePageEntry;
  sharedJs: EffectivePageEntry;
  unaffectedHashes?: Array<{ pageId: PageId; beforeSha256: string; afterSha256: string }>;
}): CandidateManifest {
  return {
    schemaVersion: CANDIDATE_MANIFEST_SCHEMA_VERSION,
    lineage: input.lineage,
    pages: { ...input.pages },
    sharedCss: { ...input.sharedCss },
    sharedJs: { ...input.sharedJs },
    ...(input.unaffectedHashes ? { unaffectedHashes: input.unaffectedHashes } : {}),
  };
}

export async function generateCompleteSite(
  env: Env,
  input: GenerateCompleteSiteInput
): Promise<GeneratedSite> {
  const factsResult = await getEffectiveBusinessFacts(env, input.buildId);
  const facts = factsResult.facts;
  const repairBlock = input.repairDirectives
    ? `\n\nBOUNDED REPAIR DIRECTIVES (realization-only fixes from the Fix Coordinator; they may not contradict the fixed Blueprint/Contract/facts):\n${input.repairDirectives}`
    : "";
  // Reference visual context (issue #43): when normalized visual inputs
  // exist, every generation step receives the attached reference image via
  // the vision path plus the isolation/authority clause. Without them
  // (ORIGINAL_DESIGN, undecodable evidence) prompts are unchanged.
  const visualInputs = input.visualInputs ?? [];
  const referenceBlock = visualInputs.length > 0 ? referenceContextBlock(visualInputs) : "";
  const visionSeam =
    input.visionGenerate ??
    (visualInputs.length > 0
      ? createProductionVisionGenerate(env, visualInputs, {
          buildId: input.buildId,
          buildVersionNumber: input.buildVersionNumber,
        })
      : undefined);
  const stageInput = {
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [
      input.blueprintR2Key,
      input.contractR2Key,
      ...visualInputs.map((input) => input.artifact),
    ],
    generate: visionSeam ?? input.generate,
    temperature: 0.35,
  };

  // Workflow-step retry safety (issues #52 + #54): each generation subkey
  // reuses its frozen artifact for this Build Version verbatim; only missing
  // subkeys invoke the model (LLM output is nondeterministic — regeneration
  // would collide with the artifact immutability boundary). Since #54 the
  // provider call itself is single-flight: a deterministic execution claim is
  // inserted ATOMICALLY before the call, so overlapping engine attempts can
  // never both invoke the provider for the same slot — production
  // (build 91764d47) showed exactly that duplicate-call race before claims
  // existed. Base pages and shared sources reuse ANY stored artifact for the
  // slot (existence-only, per #47–#52): repair directives legitimately evolve
  // between engine re-entries, so content identity gates only the repair
  // subkeys and the collision safety net, never base-slot reuse.
  const runOrReuse = async <T extends { [key: string]: unknown }>(
    kind: "generated_shared_source" | "generated_page",
    subkey: string,
    schema: ReturnType<typeof Type.Object> | ReturnType<typeof Type.String> extends never ? never : import("@sinclair/typebox").TSchema,
    schemaVersion: string,
    userPrompt: string
  ): Promise<{ value: T; artifactR2Key: string; checksum: string }> => {
    const requestFingerprint = await deriveStageExecutionFingerprint({
      binding: "website-generator-run/1",
      buildId: input.buildId,
      buildVersionId: input.buildVersionId,
      kind,
      subkey,
      schemaVersion,
      model: env.LLM_MODEL,
      provider: env.PRIMARY_PROVIDER,
      userPromptSha256: await sha256Hex(userPrompt),
    });
    const result = await runStageSingleFlight<T>(env, {
      buildId: input.buildId,
      buildVersionId: input.buildVersionId,
      kind,
      subkey,
      requestFingerprint,
      loadExisting: () => getBuildStageArtifact<T>(env, input.buildVersionId, kind, subkey),
      verifyExisting: () => true,
      run: () =>
        runSchemaValidatedAiStage<T>(env, {
          ...stageInput,
          stage: "website-generator",
          schema: schema as Parameters<typeof runSchemaValidatedAiStage>[1]["schema"],
          schemaVersion,
          userPrompt,
        }),
      store: (produced) =>
        storeBuildStageArtifact(env, {
          buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
          kind, subkey, schemaVersion, value: produced.value,
          provenance: produced.provenance as AiProvenance | undefined,
        }),
    });
    // Both paths return the immutable STAGE artifact key: the AI-run record
    // key differs per execution, so returning it on the generate path made
    // first execution and engine re-entry observationally different (issue
    // #52) and pointed manifest provenance at run records instead of the
    // frozen stage artifacts.
    return { value: result.value, artifactR2Key: result.artifactR2Key, checksum: result.checksum };
  };

  // 1. shared tokens/CSS  2. shared runtime JS — incremental steps.
  const cssRun = await runOrReuse<SharedCss>("generated_shared_source", "site.css", SharedCssSchema, "generated-source/site-css/1", cssPrompt(input.blueprint, input.contract) + referenceBlock + repairBlock);
  const jsRun = await runOrReuse<SharedJs>("generated_shared_source", "site.js", SharedJsSchema, "generated-source/site-js/1", jsPrompt(input.blueprint) + referenceBlock + repairBlock);
  // Issue #47: pages are generated against the ACTUAL generated stylesheet —
  // the class inventory closes the CSS/HTML vocabulary split at the source.
  const cssClassInventory = extractCssClassInventory(cssRun.value.css);

  // 7 (computed early). deterministic Image Plan (stable Image Slots) — the
  // exact slot ids are enumerated in every page prompt so generated markup
  // only ever references planned slots.
  const imagePlan = deriveImagePlan(input.blueprint);
  if (!Value.Check(ImagePlanSchema, imagePlan)) {
    throw new Error("derived image plan failed its schema");
  }

  // 3-6. one page at a time under the same fixed contracts.
  const pages: Partial<Record<PageId, string>> = {};
  const pageRuns: Array<{ pageId: PageId; subkey: string; run: { value: PageHtml; artifactR2Key: string; checksum: string } }> = [];
  const pagePromptFor = (pageId: PageId) =>
    pagePrompt({ pageId, blueprint: input.blueprint, contract: input.contract, facts, slots: imagePlan.slots, compositionTargets: input.compositionTargets, cssClassInventory }) + referenceBlock + repairBlock;
  for (const pageId of PAGE_IDS) {
    const run = await runOrReuse<PageHtml>("generated_page", pageId, PageHtmlSchema, `generated-source/page-${pageId}/1`, pagePromptFor(pageId));
    pages[pageId] = run.value.html;
    pageRuns.push({ pageId, subkey: pageId, run: { value: run.value, artifactR2Key: run.artifactR2Key, checksum: run.checksum } });
  }

  const source: AssembledSiteSource = {
    pages: pages as Record<PageId, string>,
    sharedCss: cssRun.value.css,
    sharedJs: jsRun.value.js,
  };

  // 8. deterministic cross-file assembly validation BEFORE anything flows
  // downstream. Timed for resource observability (issue #55 §17): profiled
  // against production build 91764d47, this whole validation over four real
  // pages costs ~2ms of CPU — recorded so future regressions in the
  // deterministic lint path are visible in worker logs without payload data.
  const validationStart = Date.now();
  const validation = validateAssembledSite(source, { contract: input.contract, slots: imagePlan.slots, facts, blueprint: input.blueprint });
  console.log(
    `(info) stage_cpu_timings { stage: 'website-generator', buildId: '${input.buildId}', phase: 'assembly-validation', ms: ${Date.now() - validationStart}, findings: ${validation.findings.length} }`
  );

  // Bounded targeted assembly repair (production retest 2026-09-05): the
  // frozen per-page subkeys are reused verbatim by engine retries, so a
  // validation failure can never heal through blind re-runs. Deterministic
  // findings instead drive ONE informed regeneration per affected page under
  // a NEW immutable subkey, then the whole site is re-validated once.
  //
  // Issue #52: the repair artifact itself follows the same reuse-before-
  // generate discipline as every other immutable stage. Reuse is INPUT-BOUND:
  // a stored {pageId}.assembly-repair-1 is honored only when its provenance
  // fingerprint matches the current deterministic repair request (build
  // version, page, attempt, directives hash, immutable input artifacts); a
  // mismatch is terminal corruption — never a model re-call, never a rewrite.
  if (!validation.passed) {
    const affected = new Set<PageId>();
    for (const finding of validation.findings) {
      const match = /^(home|about|services|contact):/.exec(finding.detail);
      if (match) affected.add(match[1] as PageId);
    }
    const validationContext = { contract: input.contract, slots: imagePlan.slots, facts, blueprint: input.blueprint };
    for (const pageId of PAGE_IDS) {
      if (!affected.has(pageId)) continue;
      const pageRun = pageRuns.find((entry) => entry.pageId === pageId)!;
      const preFindings: AssemblyFinding[] = findingsForPage(validation.findings as AssemblyFinding[], pageId);
      // Issue #69 §12: deterministic finding-type -> mutation-authority map.
      // FABRICATED_TRUST_ENTITY (and any non-enumerated type) escalates the
      // page instead of regenerating it; the pre-repair candidate stays.
      const decision = assemblyRepairDecision(preFindings);
      const scopeSummary = decision.action === "repair"
        ? [
            decision.scope.classRealization ? "class-realization" : null,
            decision.scope.brokenHrefs.length ? `href-fix:${decision.scope.brokenHrefs.join("|")}` : null,
            decision.scope.navAdditions.length ? `nav-add:${decision.scope.navAdditions.join("|")}` : null,
          ].filter(Boolean).join("; ")
        : "none";
      if (decision.action === "escalate") {
        await appendBuildWorkflowEvent(env, {
          buildId: input.buildId, buildVersionId: input.buildVersionId,
          fromState: "SITE_GENERATION", toState: "SITE_GENERATION", stage: "assembly_repair",
          detail: `Assembly repair [${pageId}] ESCALATED (issue #69): ${decision.reason.slice(0, 300)}; trigger findings=[${preFindings.map((finding) => finding.id).join(", ")}]`,
        });
        continue;
      }

      const subkey = `${pageId}.assembly-repair-1`;
      // Issue #69 §13: the repair prompt receives the EXACT rejected page and
      // the explicit mutation scope — never a generic regeneration prompt.
      const repairDirectives = `\n\n## Assembly repair directives
Your previously generated page FAILED deterministic assembly validation. Here is the EXACT rejected page — repair THIS markup, preserving everything the authorized scope does not explicitly allow changing:
\`\`\`html
${pageRun.run.value.html}
\`\`\`

Findings to fix:
${preFindings.map((finding) => `- ${finding.id}: ${finding.detail}`).join("\n")}

AUTHORIZED mutation scope for this repair (deterministically enforced):
${decision.scope.classRealization ? "- Classes: reassign or remove classes, and add/extend the missing CSS rules (the shared stylesheet class inventory in this prompt lists every available class)." : ""}
${decision.scope.brokenHrefs.length ? `- Hrefs: replace exactly these broken href values with the correct generated page href: ${decision.scope.brokenHrefs.join(", ")}.` : ""}
${decision.scope.navAdditions.length ? `- Navigation: add the missing link(s) to exactly: ${decision.scope.navAdditions.join(", ")} (label each with its canonical page label: ${decision.scope.navAdditions.map((href) => `${href} -> "${canonicalNavLabel(href) ?? href}"`).join(", ")}).` : ""}

PRESERVATION requirements (violations are deterministically rejected and the repair discarded):
- Visible text is FROZEN — fixing layout/classes must never add, remove or reword copy (including headings), except exactly the canonical nav link labels authorized above.
- title, meta description, hrefs (outside the authorized fixes), data-image-id identities, form fields and the data-region order are FROZEN.
- Do not introduce new classes that have no CSS rule; do not introduce new Business claims.
The literal semantic elements <header>, <nav>, <main> and <footer> are mechanically required (a region <section> may wrap the <footer> element, but the <footer> element itself must exist).

BUSINESS TRUTH (binding, issue #48/#53 — inherited by every repair): fixing layout must never introduce unsupported facts. No invented clients, partners, companies, awards, certifications, publications, reviewers or endorsements, and no third-party identity labels inside trust-signaling regions (client bands, credibility bands, testimonials). Populate trust-like regions only with Business-Fact-backed entities or fact-safe substitutes (service categories, audience categories, locations, process terms, abstract marks); descriptive headings and the Business's own name are always safe.`;
      // Content identity only: the immutable input artifacts' checksums.
      // (Artifact R2 keys are NOT stable across execution modes — the
      // generate path surfaces the AI-run key, the reuse path the stage
      // key — so keys must never enter a request fingerprint.)
      const repairRequestFingerprint = await sha256Hex(
        JSON.stringify({
          binding: "assembly-repair/1",
          buildId: input.buildId,
          buildVersionId: input.buildVersionId,
          pageId,
          repairAttempt: 1,
          directivesSha256: await sha256Hex(repairDirectives),
          basePageChecksum: pageRun.run.checksum,
          sharedCssChecksum: cssRun.checksum,
          sharedJsChecksum: jsRun.checksum,
          blueprintR2Key: input.blueprintR2Key,
          contractR2Key: input.contractR2Key,
        })
      );
      // Issue #54: the repair provider call is single-flight like every
      // other immutable stage. Reuse stays INPUT-BOUND (#52): a stored
      // repair is honored only when its provenance fingerprint matches the
      // current deterministic repair request; a mismatch is terminal
      // corruption — never a model re-call, never a rewrite.
      const repaired = await runStageSingleFlight<PageHtml>(env, {
        buildId: input.buildId,
        buildVersionId: input.buildVersionId,
        kind: "generated_page",
        subkey,
        requestFingerprint: repairRequestFingerprint,
        loadExisting: () => getBuildStageArtifact<PageHtml>(env, input.buildVersionId, "generated_page", subkey),
        verifyExisting: (existing) => existing.provenance?.repairRequestFingerprint === repairRequestFingerprint,
        existingMismatchError: () =>
          new StageArtifactError(
            "REPAIR_ARTIFACT_MISMATCH",
            `REPAIR_ARTIFACT_MISMATCH: informed assembly repair artifact '${subkey}' exists for Build Version ${input.buildVersionId} but its provenance does not match the current deterministic repair request (issue #52); refusing to reuse a foreign repair or overwrite the immutable artifact`
          ),
        run: () =>
          runSchemaValidatedAiStage<PageHtml>(env, {
            ...stageInput,
            stage: "website-generator",
            schema: PageHtmlSchema as Parameters<typeof runSchemaValidatedAiStage>[1]["schema"],
            schemaVersion: `generated-source/page-${pageId}/1`,
            userPrompt: pagePromptFor(pageId) + repairDirectives,
          }),
        store: (produced) =>
          storeBuildStageArtifact(env, {
            buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
            kind: "generated_page", subkey, schemaVersion: `generated-source/page-${pageId}/1`,
            value: produced.value,
            provenance: {
              ...(produced.provenance as AiProvenance),
              repairRequestFingerprint,
              repairTriggerFindingIds: preFindings.map((finding) => finding.id),
              repairScopeSummary: scopeSummary,
            },
          }),
      });

      // Issue #69 §14-17: the repair becomes effective ONLY when the content
      // guard holds AND the page's deterministic findings fully resolve with
      // no new findings. Otherwise the ORIGINAL pre-repair page stays
      // effective and the stored repair artifact remains as evidence.
      const afterFingerprint = extractAssemblyFingerprint(repaired.value.html);
      const guard = validateAssemblyRepairContent(extractAssemblyFingerprint(pageRun.run.value.html), afterFingerprint, decision.scope);
      let postFindings: AssemblyFinding[] = [];
      if (guard.violations.length === 0) {
        postFindings = findingsForPage(
          validateAssembledSite({ ...source, pages: { ...source.pages, [pageId]: repaired.value.html } }, validationContext).findings as AssemblyFinding[],
          pageId
        );
      }
      const scopeViolation = guard.violations.length > 0;
      const regression = !scopeViolation && postFindings.length > 0;
      if (scopeViolation || regression) {
        await appendBuildWorkflowEvent(env, {
          buildId: input.buildId, buildVersionId: input.buildVersionId,
          fromState: "SITE_GENERATION", toState: "SITE_GENERATION", stage: "assembly_repair",
          detail: `Assembly repair [${pageId}] ${scopeViolation ? "REVERTED_SCOPE_VIOLATION" : "REVERTED_REGRESSION"} (issue #69): trigger findings=[${preFindings.map((finding) => finding.id).join(", ")}]; authorized scope=[${scopeSummary}]; preservation=${scopeViolation ? guard.violations.map((violation) => violation.rule).join(",") : "intact"}; post-repair findings=[${postFindings.map((finding) => finding.id).join(", ") || "n/a"}]; pre-repair candidate retained`,
        });
        continue;
      }
      pageRun.run = { value: repaired.value, artifactR2Key: repaired.artifactR2Key, checksum: repaired.checksum };
      pageRun.subkey = subkey;
      source.pages[pageId] = repaired.value.html;
      await appendBuildWorkflowEvent(env, {
        buildId: input.buildId, buildVersionId: input.buildVersionId,
        fromState: "SITE_GENERATION", toState: "SITE_GENERATION", stage: "assembly_repair",
        detail: `Assembly repair [${pageId}] ADOPTED (issue #69): trigger findings=[${preFindings.map((finding) => finding.id).join(", ")}]; authorized scope=[${scopeSummary}]; preservation=intact; post-repair findings=[clean]`,
      });
    }
  }

  // Issue #66/#69: freeze the effective candidate lineage BEFORE the final
  // validation gate. The manifest is the authoritative lineage (never the
  // artifact-namespace heuristic, which cannot know a repair was reverted),
  // and it must exist for EVERY terminal outcome that retains artifacts —
  // including a #69 HUMAN_REVIEW_REQUIRED whose effective pages are the
  // original pre-repair ones. Deterministic content (frozen artifact
  // checksums) makes the idempotent store a re-entry success.
  const effectivePages = Object.fromEntries(
    pageRuns.map(({ pageId, subkey, run }) => [pageId, { subkey, checksum: run.checksum }])
  ) as Record<PageId, EffectivePageEntry>;
  const manifest = buildCandidateManifest({
    lineage: "initial-generation",
    pages: effectivePages,
    sharedCss: { subkey: "site.css", checksum: cssRun.checksum },
    sharedJs: { subkey: "site.js", checksum: jsRun.checksum },
  });
  const manifestStored = await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
    kind: "candidate_manifest", schemaVersion: CANDIDATE_MANIFEST_SCHEMA_VERSION, value: manifest,
  });

  const finalValidation = validation.passed
    ? validation
    : validateAssembledSite(source, { contract: input.contract, slots: imagePlan.slots, facts, blueprint: input.blueprint });
  if (!finalValidation.passed) {
    throw new SiteGenerationValidationError(finalValidation.findings);
  }

  // Generated source artifacts were persisted per subkey as they were
  // produced (runOrReuse) — immutability is enforced at that boundary.
  const artifacts: GeneratedSite["artifacts"] = [
    { kind: "generated_shared_source", subkey: "site.css", r2Key: cssRun.artifactR2Key },
    { kind: "generated_shared_source", subkey: "site.js", r2Key: jsRun.artifactR2Key },
    ...pageRuns.map(({ pageId, subkey, run }) => ({ kind: "generated_page" as const, subkey, r2Key: run.artifactR2Key })),
  ];
  const imagePlanStored: StoredStageArtifact = await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
    kind: "image_plan", schemaVersion: IMAGE_PLAN_SCHEMA_VERSION, value: imagePlan,
  });
  artifacts.push({ kind: "image_plan", subkey: "", r2Key: imagePlanStored.artifactR2Key });
  artifacts.push({ kind: "candidate_manifest", subkey: "", r2Key: manifestStored.artifactR2Key });

  // NOTE: the canonical builds/{id}/v{n}/source/* freeze happens in the
  // assembly stage with image placeholders RESOLVED; generation itself only
  // persists the immutable stage artifacts above.

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId,
    fromState: "IMPLEMENTATION_PLAN", toState: "SITE_GENERATION", stage: "site_generation",
    detail: `Four pages + shared source + ${imagePlan.slots.length} Image Slots generated incrementally from one Blueprint + one Implementation Contract`,
  });
  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId,
    fromState: "SITE_GENERATION", toState: "SITE_VALIDATION", stage: "site_validation",
    detail: "Deterministic cross-file assembly validation passed",
  });

  return {
    ...source,
    imagePlan,
    validation: finalValidation,
    artifacts,
    effectivePages,
    effectiveSharedSource: {
      css: { subkey: "site.css", checksum: cssRun.checksum },
      js: { subkey: "site.js", checksum: jsRun.checksum },
    },
  };
}

// ── Realization repair (issue #47, remediation Part 21) ────────────────────
//
// The deterministic realization precheck runs AFTER assembly/preview and
// BEFORE expensive QA. When it finds gross realization errors, at most ONE
// informed per-page regeneration is allowed: the frozen shared CSS/JS and
// the unaffected pages are reused verbatim from the stage-artifact store,
// only affected pages are regenerated under NEW immutable subkeys carrying
// the measured findings as directives. Never consumes the QA repair budget.

export interface RegeneratePagesForRealizationInput {
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  blueprint: VisualBlueprint;
  blueprintR2Key: string;
  contract: ImplementationContract;
  contractR2Key: string;
  imagePlan: ImagePlan;
  affected: PageId[];
  /** Measured precheck findings — exact numbers, targets and tolerances. */
  findingDirectives: string;
  compositionTargets?: Array<{ regionId: string; viewportHeightRatio: number; evidenceSegmentCount: number }>;
  visualInputs?: NonNullable<ReferenceEvidence["visualInputs"]>;
  /** Issue #67: deterministic mutation-scope authorization. */
  authorizedRegions: string[];
  passingRegions: string[];
  /** Issue #67 §9/#65: honest per-region crop descriptions — which regions
   *  carry REFERENCE slices and which are REFERENCE CROP UNAVAILABLE. */
  cropDescriptors: string;
  visionGenerate?: RawAiGenerate;
  generate?: RawAiGenerate;
}

export interface RealizationRegenerationResult {
  pages: Record<PageId, string>;
  sharedCss: string;
  sharedJs: string;
  regenerated: PageId[];
  /** Issue #66 §15: unaffected pages' before/after artifact checksums —
   *  verified identical before this result is returned. */
  unaffectedHashes: Array<{ pageId: PageId; beforeSha256: string; afterSha256: string }>;
}

export interface ResolvedEffectivePages {
  lineage: string;
  pages: Record<PageId, EffectivePageEntry>;
  sharedCss: EffectivePageEntry;
  sharedJs: EffectivePageEntry;
}

// Issue #66 §12-13: effective page artifacts resolve from the explicit
// candidate manifest — NEVER by timestamp guessing or filename heuristics.
// For Build Versions created before the manifest existed, the documented
// artifact-namespace rule reconstructs the lineage deterministically: a
// `{pageId}.assembly-repair-1` stage artifact exists only because this
// version's informed assembly repair produced it to SUPERSEDE the base page,
// so its presence IS the pointer. The lineage source is recorded either way.
export async function resolveEffectivePages(env: Env, buildVersionId: string): Promise<ResolvedEffectivePages> {
  const manifestRecord = await getBuildStageArtifact<CandidateManifest>(env, buildVersionId, "candidate_manifest", "");
  if (manifestRecord) {
    const manifest = manifestRecord.value;
    return {
      lineage: `manifest/${manifest.lineage}`,
      pages: manifest.pages,
      sharedCss: manifest.sharedCss,
      sharedJs: manifest.sharedJs,
    };
  }
  const pages = {} as Record<PageId, EffectivePageEntry>;
  for (const pageId of PAGE_IDS) {
    const repair = await getBuildStageArtifact<PageHtml>(env, buildVersionId, "generated_page", `${pageId}.assembly-repair-1`);
    const base = await getBuildStageArtifact<PageHtml>(env, buildVersionId, "generated_page", pageId);
    if (!base && !repair) {
      throw new Error(`effective page resolution found no artifact for '${pageId}' in Build Version ${buildVersionId}`);
    }
    pages[pageId] = repair
      ? { subkey: `${pageId}.assembly-repair-1`, checksum: repair.checksum }
      : { subkey: pageId, checksum: base!.checksum };
  }
  const css = await getBuildStageArtifact<SharedCss>(env, buildVersionId, "generated_shared_source", "site.css");
  const js = await getBuildStageArtifact<SharedJs>(env, buildVersionId, "generated_shared_source", "site.js");
  if (!css || !js) {
    throw new Error(`effective page resolution found no shared source in Build Version ${buildVersionId}`);
  }
  return {
    lineage: "reconstructed/assembly-repair-namespace",
    pages,
    sharedCss: { subkey: "site.css", checksum: css.checksum },
    sharedJs: { subkey: "site.js", checksum: js.checksum },
  };
}

// ── Realization repair patch contract (issue #67) ───────────────────────────
//
// The Level-4 "regenerate the COMPLETE page" repair is rejected: production
// (Build 282f9b9d) showed it rewrites ~40% of visible text, invents content
// mass and re-cases labels until the truth lint kills the build. The repair
// is now a typed, content-preserving PATCH:
//   Level 1/2 — scoped cssPatch (every selector pinned to this page's
//               [data-region=]/[data-image-id=] ids)
//   Level 3   — regionPatches: new inner HTML for named FAILED regions with
//               text/hrefs/image identities frozen by fingerprint
// Full-page regeneration is not part of this contract.

export const REALIZATION_REPAIR_PATCH_SCHEMA_VERSION = "realization-repair-patch/1";

export const RealizationRepairPatchSchema = Type.Object(
  {
    targetPageId: Type.Union([
      Type.Literal("home"), Type.Literal("about"), Type.Literal("services"), Type.Literal("contact"),
    ]),
    reasoning: Type.Optional(Type.String({ maxLength: 2000 })),
    /** True when the existing content cannot realize the stated geometry
     *  without fabrication — escalates to human review instead. */
    insufficient: Type.Optional(Type.Boolean()),
    insufficientReason: Type.Optional(Type.String({ maxLength: 1000 })),
    cssPatch: Type.String({ maxLength: 24000 }),
    regionPatches: Type.Array(
      Type.Object(
        {
          regionId: Type.String({ minLength: 1 }),
          html: Type.String({ maxLength: 80000 }),
        },
        { additionalProperties: false }
      ),
      { maxItems: 8 }
    ),
  },
  { additionalProperties: false }
);
export type RealizationRepairPatch = Static<typeof RealizationRepairPatchSchema>;

// The repair declared the existing content insufficient for the measured
// geometry — a deterministic escalation to human review (issue #67 §22),
// never an invitation to fabricate mass.
export class RealizationRepairEscalationError extends Error {
  constructor(
    readonly code: "REALIZATION_REPAIR_INSUFFICIENT" | "REPAIR_SCOPE_VIOLATION",
    readonly details: string[]
  ) {
    super(`${code}: ${details.join("; ")}`);
    this.name = "RealizationRepairEscalationError";
  }
}

function realizationRepairUserPrompt(input: RegeneratePagesForRealizationInput, pageId: PageId, currentHtml: string, currentCss: string): string {
  const authorized = input.authorizedRegions.join(", ");
  const passing = input.passingRegions.join(", ");
  const targets = (input.compositionTargets ?? []).length
    ? `\nMEASURED COMPOSITION TARGETS (binding evaluation constraints, NOT implementation values): ${input.compositionTargets!.map((region) => `${region.regionId} ≈ ${region.viewportHeightRatio.toFixed(2)} viewport-heights`).join(", ")}.`
    : "";
  return `Repair the GEOMETRY of the rendered page '${pageId}'. A deterministic Craft Preflight measured the deviations below with full provenance. Repair structure, never content.

## Measured findings (binding)
${input.findingDirectives}${targets}

## Mutation scope (mechanically enforced)
- Authorized regions (regionPatches allowed): ${authorized || "(none)"}
- Passing regions (MUST remain byte-identical): ${passing || "(none)"}
- Everything not listed as authorized is frozen: visible text, title, meta description, hrefs, image identities (data-image-id), form fields, canonical region order.

## Region crop evidence (labeled honestly)
${input.cropDescriptors || "(no region crops attached for this repair)"}

## Current ${pageId} HTML (the page you are repairing)
${currentHtml}

## Current shared stylesheet (frozen; your cssPatch is APPENDED under a scoped marker — it cannot edit these rules)
${currentCss}

Produce the patch JSON now. Remember: min-height equal to a measured target is not a repair; fix the structure. If the existing content cannot realize the stated geometry, set "insufficient": true with the reason — never invent content.`;
}

export async function regeneratePagesForRealization(
  env: Env,
  input: RegeneratePagesForRealizationInput
): Promise<RealizationRegenerationResult> {
  const cssArtifact = await getBuildStageArtifact<SharedCss>(env, input.buildVersionId, "generated_shared_source", "site.css");
  const jsArtifact = await getBuildStageArtifact<SharedJs>(env, input.buildVersionId, "generated_shared_source", "site.js");
  if (!cssArtifact || !jsArtifact) {
    throw new Error("realization repair requires the frozen shared source of the same Build Version");
  }
  // Issue #66: the repair assembles the CURRENT EFFECTIVE candidate — pages
  // already carrying informed assembly repairs keep those exact artifacts.
  const effective = await resolveEffectivePages(env, input.buildVersionId);
  const factsResult = await getEffectiveBusinessFacts(env, input.buildId);
  const facts = factsResult.facts;
  const visualInputs = input.visualInputs ?? [];
  const stageInput = {
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [input.blueprintR2Key, input.contractR2Key, ...visualInputs.map((entry) => entry.artifact)],
    generate: input.visionGenerate ?? input.generate,
    temperature: 0.35,
  };
  const authorizedRegions = new Set(input.authorizedRegions);
  const pages: Partial<Record<PageId, string>> = {};
  const regenerated: PageId[] = [];
  const regeneratedEntries: Partial<Record<PageId, EffectivePageEntry>> = {};
  const unaffectedHashes: Array<{ pageId: PageId; beforeSha256: string; afterSha256: string }> = [];
  let cssPatchApplied = "";
  let cssPatchRules = 0;
  let regionPatchCount = 0;

  for (const pageId of PAGE_IDS) {
    if (input.affected.includes(pageId)) {
      const pageSubkey = `${pageId}.realization-repair-1`;
      const patchSubkey = `${pageId}.realization-repair-1.patch`;
      // Workflow-retry safety: the frozen patch artifact for this Build
      // Version is reused verbatim and re-applied deterministically.
      const existingPatch = await getBuildStageArtifact<RealizationRepairPatch>(env, input.buildVersionId, "generated_page", patchSubkey);
      const currentHtml = (await getBuildStageArtifact<PageHtml>(env, input.buildVersionId, "generated_page", effective.pages[pageId].subkey))!.value.html;
      let patch: RealizationRepairPatch;
      let run: Awaited<ReturnType<typeof runSchemaValidatedAiStage<RealizationRepairPatch>>> | undefined;
      if (existingPatch) {
        patch = existingPatch.value;
      } else {
        run = await runSchemaValidatedAiStage<RealizationRepairPatch>(env, {
          ...stageInput,
          stage: "realization-repair",
          schema: RealizationRepairPatchSchema as Parameters<typeof runSchemaValidatedAiStage>[1]["schema"],
          schemaVersion: REALIZATION_REPAIR_PATCH_SCHEMA_VERSION,
          userPrompt: realizationRepairUserPrompt(input, pageId, currentHtml, cssArtifact.value.css),
        });
        patch = run.value;
        if (patch.insufficient) {
          throw new RealizationRepairEscalationError("REALIZATION_REPAIR_INSUFFICIENT", [
            `${pageId}: the existing content cannot realize the measured geometry without fabrication (${patch.insufficientReason ?? "no reason given"}) — escalated for review instead of inventing content`,
          ]);
        }
      }
      // ── Deterministic application + mutation guard (issue #67 §30) ──
      // Runs on BOTH paths: a fresh patch and a replayed frozen patch must
      // pass the same guards and produce the same applied page.
      {
        const before = extractPageContentFingerprint(currentHtml);
        let patched = currentHtml;
        const imageIdsOnPage = new Set(before.imageIds);
        for (const regionPatch of patch.regionPatches) {
          if (!authorizedRegions.has(regionPatch.regionId)) {
            throw new RealizationRepairEscalationError("REPAIR_SCOPE_VIOLATION", [
              `region patch targets '${regionPatch.regionId}' which is outside the authorized mutation scope`,
            ]);
          }
          patched = applyRegionPatch(patched, regionPatch.regionId, regionPatch.html);
          regionPatchCount += 1;
        }
        const cssRefusals = validateCssPatchScope(patch.cssPatch, authorizedRegions, imageIdsOnPage);
        if (cssRefusals.length > 0) {
          throw new RealizationRepairEscalationError("REPAIR_SCOPE_VIOLATION", cssRefusals);
        }
        cssPatchApplied = patch.cssPatch;
        cssPatchRules = (patch.cssPatch.match(/\{/g) ?? []).length;
        const after = extractPageContentFingerprint(patched);
        const violations = diffPageContent({ before, after, authorizedRegions });
        if (violations.length > 0) {
          throw new RealizationRepairEscalationError(
            "REPAIR_SCOPE_VIOLATION",
            violations.map((violation) => `${violation.rule}: ${violation.detail}`)
          );
        }
        if (existingPatch) {
          // Replay: the patch and its applied page were already frozen by the
          // first attempt. Determinism demands the re-application reproduce
          // the stored page byte-for-byte; anything else is corruption.
          const storedPage = await getBuildStageArtifact<PageHtml>(env, input.buildVersionId, "generated_page", pageSubkey);
          if (!storedPage || storedPage.value.html !== patched) {
            throw new Error(`REPAIR_REPLAY_MISMATCH: re-applying the frozen patch for '${pageId}' did not reproduce the stored repair artifact`);
          }
          regeneratedEntries[pageId] = { subkey: pageSubkey, checksum: storedPage.checksum };
        } else {
          // The patch output is frozen under its own immutable subkey; the
          // applied page is frozen under the #66-compatible page subkey.
          const storedPatch = await storeBuildStageArtifact(env, {
            buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
            kind: "generated_page", subkey: patchSubkey, schemaVersion: REALIZATION_REPAIR_PATCH_SCHEMA_VERSION,
            value: patch, provenance: run!.provenance,
          });
          const pageValue: PageHtml = { html: patched };
          const stored = await storeBuildStageArtifact(env, {
            buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
            kind: "generated_page", subkey: pageSubkey, schemaVersion: `generated-source/page-${pageId}/1`,
            value: pageValue,
            provenance: { ...run!.provenance, inputArtifactIds: [...run!.provenance.inputArtifactIds, storedPatch.artifactR2Key] },
          });
          regeneratedEntries[pageId] = { subkey: pageSubkey, checksum: stored.checksum };
        }
      }
      pages[pageId] = (await getBuildStageArtifact<PageHtml>(env, input.buildVersionId, "generated_page", pageSubkey))!.value.html;
      regenerated.push(pageId);
      continue;
    }
    // Issue #66 §14: an unaffected page resolves through the candidate
    // manifest — its already-applied assembly repair survives untouched.
    const effectiveEntry = effective.pages[pageId];
    const frozen = await getBuildStageArtifact<PageHtml>(env, input.buildVersionId, "generated_page", effectiveEntry.subkey);
    if (!frozen) throw new Error(`realization repair missing effective page artifact '${effectiveEntry.subkey}' for '${pageId}'`);
    pages[pageId] = frozen.value.html;
    unaffectedHashes.push({ pageId, beforeSha256: effectiveEntry.checksum, afterSha256: frozen.checksum });
  }

  // Issue #67 §24: the CSS patch is a NEW immutable shared-source artifact
  // layered over the frozen stylesheet at assembly — never an inline
  // <style> in the page, never an edit of the frozen CSS.
  const composedCss = cssPatchApplied
    ? `${cssArtifact.value.css}\n\n/* realization-repair-1 — scoped geometry patch (issue #67) */\n${cssPatchApplied}`
    : cssArtifact.value.css;
  if (cssPatchApplied) {
    await storeBuildStageArtifactIdempotent(env, {
      buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
      kind: "generated_shared_source", subkey: "site.css.realization-repair-1",
      schemaVersion: "generated-source/site-css-realization-repair/1",
      value: { css: composedCss } satisfies SharedCss,
    });
  }

  const source: AssembledSiteSource = { pages: pages as Record<PageId, string>, sharedCss: composedCss, sharedJs: jsArtifact.value.js };
  // Defense in depth: the deterministic Business Truth lint runs on the
  // patched source AFTER the content freeze guard already held.
  const validation = validateAssembledSite(source, { contract: input.contract, slots: input.imagePlan.slots, facts, blueprint: input.blueprint });
  if (!validation.passed) {
    throw new SiteGenerationValidationError(validation.findings);
  }
  // Issue #66 §15: an unaffected page's artifact MUST be byte-identical
  // before and after the targeted repair — any drift is corruption.
  for (const hash of unaffectedHashes) {
    if (hash.beforeSha256 !== hash.afterSha256) {
      throw new Error(`REPAIR_PRESERVATION_VIOLATION: unaffected page '${hash.pageId}' changed artifact checksum during realization repair (${hash.beforeSha256} -> ${hash.afterSha256})`);
    }
  }
  // Update the candidate manifest: the affected pages now point at their
  // realization-repair artifacts; every other pointer stays IDENTICAL.
  const repairedManifest = buildCandidateManifest({
    lineage: `realization-repair/${regenerated.join(",")}`,
    pages: {
      ...(Object.fromEntries(
        Object.entries(effective.pages).map(([pageId, entry]) => [
          pageId,
          regeneratedEntries[pageId as PageId] ?? entry,
        ])
      ) as Record<PageId, EffectivePageEntry>),
    },
    sharedCss: cssPatchApplied
      ? { subkey: "site.css.realization-repair-1", checksum: (await getBuildStageArtifact<SharedCss>(env, input.buildVersionId, "generated_shared_source", "site.css.realization-repair-1"))!.checksum }
      : effective.sharedCss,
    sharedJs: effective.sharedJs,
    unaffectedHashes,
  });
  await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
    kind: "candidate_manifest", schemaVersion: CANDIDATE_MANIFEST_SCHEMA_VERSION,
    subkey: "realization-repair-1", value: repairedManifest,
  });
  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId,
    fromState: "SITE_GENERATION", toState: "SITE_VALIDATION", stage: "realization_repair",
    detail: `Content-preserving realization repair applied to ${regenerated.join(", ")}: ${regionPatchCount} region patch(es), ${cssPatchRules} scoped CSS rule(s); text/hrefs/image identities frozen by fingerprint guard; one bounded round, no QA repair budget consumed; effective lineage ${effective.lineage}; ${unaffectedHashes.length} unaffected page(s) hash-preserved`,
  });
  return { pages: source.pages, sharedCss: source.sharedCss, sharedJs: source.sharedJs, regenerated, unaffectedHashes };
}
