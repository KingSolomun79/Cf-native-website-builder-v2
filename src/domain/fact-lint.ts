// Shared deterministic Business-truth lint (issue #48/#53 semantics).
//
// Extracted verbatim from the retired legacy site generator (cleanup 2026-09-10):
// this is the zero-tolerance fabrication protection that the SIMPLE pipeline's
// bundle QA (src/simple-design/bundle-qa.ts) enforces on every candidate.
// Trust-context-scoped and fact-anchored — NOT a global capitalization scan.
import type { BusinessFacts } from "./lifecycle-schema";
import type { PageId } from "./site-contracts";

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
export const TRUST_CONTEXT_PATTERN =
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

export interface TrustLabel {
  text: string;
  context: string;
}

// Words the Business Facts vouch for (lowercased). Any fact string contributes
// its words: a supplied partner/customer name in the facts is therefore
// permitted explicitly (issue #48 acceptance #3).
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
