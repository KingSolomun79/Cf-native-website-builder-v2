// Deterministic page-content fingerprints and the repair mutation guard
// (issue #67).
//
// Production Build 282f9b9d (2026-09-07): the "geometry" realization repair
// regenerated the complete page and rewrote ~40% of its visible text —
// including re-casing "Who we serve" into "Who We Serve", which tripped the
// truth lint and killed the build. The guard below runs BEFORE the truth
// lint and BEFORE any promotion: a geometry repair that mutates visible
// content, links, image identities, form semantics, the region order or a
// passing region's markup is a REPAIR_SCOPE_VIOLATION — deterministically,
// before any model reasoning about trust is even needed.
//
// Extraction is regex-based (no DOM parser in the Workers runtime) and
// deliberately conservative: it over-approximates "content" so a sneaky
// mutation cannot slip between tags the regex does not know.

export interface PageContentFingerprint {
  title: string | null;
  description: string | null;
  /** Visible text nodes in document order (scripts/styles excluded),
   *  entity-decoded, whitespace-collapsed, case-sensitive. */
  textNodes: string[];
  /** All href attribute values in document order. */
  hrefs: string[];
  /** All data-image-id values in document order. */
  imageIds: string[];
  /** Contact-form field names in document order (form semantics). */
  formFields: string[];
  /** Canonical region order (top-level data-region attributes). */
  regionOrder: string[];
  /** Per-region visible-text sequence, keyed by data-region. */
  regionText: Record<string, string[]>;
}

export interface RepairScopeViolation {
  id: "REPAIR_SCOPE_VIOLATION";
  rule:
    | "TEXT_MUTATED"
    | "TITLE_OR_DESCRIPTION_MUTATED"
    | "HREF_MUTATED"
    | "IMAGE_IDENTITY_MUTATED"
    | "FORM_MUTATED"
    | "REGION_ORDER_MUTATED"
    | "PASSING_REGION_MUTATED";
  detail: string;
}

export function normalizeTextNode(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHeadAndScripts(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function metaContent(html: string, name: string): string | null {
  const match = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, "i").exec(html)
    ?? new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, "i").exec(html);
  return match ? normalizeTextNode(match[1]) : null;
}

function textNodesOf(html: string): string[] {
  const body = stripHeadAndScripts(html);
  return (body.match(/>([^<>]+)</g) ?? [])
    .map((raw) => normalizeTextNode(raw.slice(1, -1)))
    .filter((text) => text.length > 0);
}

// Extracts each top-level `<section ... data-region="..."> ... </section>`
// span with a depth-tracking scanner (sections may nest inside a region —
// the pipeline validator only forbids nested REGION sections).
export function regionSpans(html: string): Array<{ regionId: string; start: number; end: number; inner: string }> {
  const spans: Array<{ regionId: string; start: number; end: number; inner: string }> = [];
  const open = /<section\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = open.exec(html)) !== null) {
    const regionMatch = /data-region=["']([^"']+)["']/i.exec(match[0]);
    if (!regionMatch) continue;
    // Walk forward tracking <section depth to find the matching close.
    const scan = /<(\/)?section\b[^>]*>/gi;
    scan.lastIndex = match.index + match[0].length;
    let depth = 1;
    let close: RegExpExecArray | null;
    while ((close = scan.exec(html)) !== null) {
      depth += close[1] ? -1 : 1;
      if (depth === 0) {
        const innerStart = match.index + match[0].length;
        spans.push({
          regionId: regionMatch[1],
          start: match.index,
          end: close.index + close[0].length,
          inner: html.slice(innerStart, close.index),
        });
        open.lastIndex = close.index + close[0].length;
        break;
      }
    }
  }
  return spans;
}

export function extractPageContentFingerprint(html: string): PageContentFingerprint {
  const titleMatch = /<title>([^<]*)<\/title>/i.exec(html);
  const regionText: Record<string, string[]> = {};
  const regionOrder: string[] = [];
  for (const span of regionSpans(html)) {
    regionOrder.push(span.regionId);
    regionText[span.regionId] = textNodesOf(span.inner);
  }
  return {
    title: titleMatch ? normalizeTextNode(titleMatch[1]) : null,
    description: metaContent(html, "description"),
    textNodes: textNodesOf(html),
    hrefs: (html.match(/href\s*=\s*["']([^"']*)["']/gi) ?? []).map((raw) => normalizeTextNode(raw.replace(/^href\s*=\s*/i, "").replace(/^["']|["']$/g, ""))),
    imageIds: [...html.matchAll(/data-image-id=["']([^"']+)["']/gi)].map((match) => match[1]),
    formFields: [...html.matchAll(/<(?:input|select|textarea)\b[^>]*name=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]),
    regionOrder,
    regionText,
  };
}

export interface MutationGuardInput {
  before: PageContentFingerprint;
  after: PageContentFingerprint;
  /** Canonical regions the repair contract explicitly authorizes. */
  authorizedRegions: Set<string>;
}

// Issue #67 §30: compare fingerprints and return every violation. Empty
// result = the patch preserved content exactly. Runs BEFORE the Business
// Truth lint (which remains defense in depth).
export function diffPageContent(input: MutationGuardInput): RepairScopeViolation[] {
  const { before, after, authorizedRegions } = input;
  const violations: RepairScopeViolation[] = [];
  const violation = (rule: RepairScopeViolation["rule"], detail: string) => violations.push({ id: "REPAIR_SCOPE_VIOLATION", rule, detail });

  const sequenceDiff = (a: string[], b: string[]): string | null => {
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if (a[index] !== b[index]) {
        return index < a.length && index < b.length
          ? `'${a[index].slice(0, 60)}' -> '${b[index].slice(0, 60)}'`
          : `count ${a.length} -> ${b.length}`;
      }
    }
    return null;
  };

  const textDiff = sequenceDiff(before.textNodes, after.textNodes);
  if (textDiff !== null) {
    violation("TEXT_MUTATED", `visible text changed: ${textDiff}`);
  }
  if (before.title !== after.title) {
    violation("TITLE_OR_DESCRIPTION_MUTATED", `title changed: '${before.title}' -> '${after.title}'`);
  }
  if (before.description !== after.description) {
    violation("TITLE_OR_DESCRIPTION_MUTATED", `meta description changed`);
  }
  const hrefDiff = sequenceDiff(before.hrefs, after.hrefs);
  if (hrefDiff !== null) {
    violation("HREF_MUTATED", `link targets changed: ${hrefDiff}`);
  }
  const imageDiff = sequenceDiff(before.imageIds, after.imageIds);
  if (imageDiff !== null) {
    violation("IMAGE_IDENTITY_MUTATED", `Accepted Image identity changed: ${imageDiff}`);
  }
  const formDiff = sequenceDiff(before.formFields, after.formFields);
  if (formDiff !== null) {
    violation("FORM_MUTATED", `form semantics changed: ${formDiff}`);
  }
  const orderDiff = sequenceDiff(before.regionOrder, after.regionOrder);
  if (orderDiff !== null) {
    violation("REGION_ORDER_MUTATED", `canonical region order changed: ${orderDiff}`);
  }

  // Passing regions must be markup-identical; authorized regions must still
  // carry their exact text sequence (structure may move, words may not).
  for (const regionId of before.regionOrder) {
    const beforeText = before.regionText[regionId] ?? [];
    const afterRegion = after.regionText[regionId];
    if (!afterRegion) {
      if (!authorizedRegions.has(regionId)) {
        violation("PASSING_REGION_MUTATED", `region '${regionId}' disappeared`);
      }
      continue;
    }
    const regionDiff = sequenceDiff(beforeText, afterRegion);
    if (regionDiff !== null) {
      const rule = authorizedRegions.has(regionId) ? "TEXT_MUTATED" : "PASSING_REGION_MUTATED";
      violation(rule, `region '${regionId}' text changed: ${regionDiff}`);
    }
  }
  for (const regionId of after.regionOrder) {
    if (!(regionId in before.regionText)) {
      violation("REGION_ORDER_MUTATED", `new region '${regionId}' appeared`);
    }
  }

  return violations;
}

// ── CSS patch scoping (issue #67 §24) ───────────────────────────────────────

const FORBIDDEN_AT_RULES = /@(?:import|charset|namespace|font-face)\b/i;

/** Validates the repair's CSS patch: every rule selector (top-level or
 *  nested inside @media) must scope the patch to THIS page through a
 *  data-region or data-image-id attribute selector belonging to it, and no
 *  global-reaching at-rules are allowed. Returns refusal reasons; empty =
 *  accepted. */
export function validateCssPatchScope(
  cssPatch: string,
  allowedRegionIds: ReadonlySet<string>,
  allowedImageIds: ReadonlySet<string>
): string[] {
  const refusals: string[] = [];
  if (FORBIDDEN_AT_RULES.test(cssPatch)) {
    refusals.push("cssPatch contains a forbidden at-rule (@import/@charset/@namespace/@font-face)");
  }
  // The innermost-rule pattern matches declarations inside @media wrappers
  // too, with the @media prelude riding along in the captured selector —
  // which cannot un-scope an otherwise scoped rule, but correctly refuses an
  // unscoped one. Braces are never rewritten, so rule structure survives.
  const rulePattern = /([^{}]+)\{[^{}]*\}/g;
  let rule: RegExpExecArray | null;
  let sawRule = false;
  while ((rule = rulePattern.exec(cssPatch)) !== null) {
    const selector = rule[1].trim();
    if (!selector) continue;
    sawRule = true;
    const regionIds = [...selector.matchAll(/data-region=["']?([a-zA-Z0-9_-]+)["']?/gi)].map((match) => match[1]);
    const imageIds = [...selector.matchAll(/data-image-id=["']?([a-zA-Z0-9_-]+)["']?/gi)].map((match) => match[1]);
    const scoped = regionIds.length > 0 || imageIds.length > 0;
    const idsKnown =
      regionIds.every((id) => allowedRegionIds.has(id)) && imageIds.every((id) => allowedImageIds.has(id));
    if (!scoped) {
      refusals.push(`cssPatch selector is not scoped to this page: '${selector.slice(0, 80)}'`);
    } else if (!idsKnown) {
      refusals.push(`cssPatch selector references ids outside the authorized mutation scope: '${selector.slice(0, 80)}'`);
    }
  }
  if (!sawRule && cssPatch.trim().length > 0) {
    refusals.push("cssPatch contains no parseable rules");
  }
  return [...new Set(refusals)];
}

// ── Region patch application (issue #67 §28) ────────────────────────────────

/** Replaces the inner HTML of one canonical region section. Throws when the
 *  region does not exist exactly once or the patch would redefine regions,
 *  smuggle scripts, attach inline event handlers, or inject script-capable
 *  elements/schemes. Content preservation is enforced by the fingerprint
 *  guard on the WHOLE page after all patches apply. */
export function applyRegionPatch(html: string, regionId: string, patchHtml: string): string {
  if (/<script\b/i.test(patchHtml)) {
    throw new Error(`REPAIR_SCOPE_VIOLATION: region patch for '${regionId}' contains <script>`);
  }
  if (/<(?:iframe|object|embed|base|meta)\b/i.test(patchHtml)) {
    throw new Error(`REPAIR_SCOPE_VIOLATION: region patch for '${regionId}' contains a forbidden element (iframe/object/embed/base/meta)`);
  }
  if (/\son[a-z]+\s*=/i.test(patchHtml)) {
    throw new Error(`REPAIR_SCOPE_VIOLATION: region patch for '${regionId}' contains an inline event handler`);
  }
  if (/=\s*["']?\s*javascript:/i.test(patchHtml)) {
    throw new Error(`REPAIR_SCOPE_VIOLATION: region patch for '${regionId}' contains a javascript: URI`);
  }
  if (/data-region\s*=/i.test(patchHtml)) {
    throw new Error(`REPAIR_SCOPE_VIOLATION: region patch for '${regionId}' redefines data-region attributes`);
  }
  if (/<style\b/i.test(patchHtml)) {
    throw new Error(`REPAIR_SCOPE_VIOLATION: region patch for '${regionId}' contains inline <style> (CSS goes through the scoped cssPatch)`);
  }
  const spans = regionSpans(html).filter((span) => span.regionId === regionId);
  if (spans.length !== 1) {
    throw new Error(`REPAIR_SCOPE_VIOLATION: region '${regionId}' matched ${spans.length} sections, expected exactly 1`);
  }
  const span = spans[0];
  const openTagEnd = html.indexOf(">", span.start) + 1;
  const closeTagStart = span.end - "</section>".length;
  return html.slice(0, openTagEnd) + patchHtml + html.slice(closeTagStart);
}
