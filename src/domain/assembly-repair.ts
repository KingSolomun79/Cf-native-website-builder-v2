// Assembly repair preservation contract (issue #69).
//
// The 2026-09-07 fresh production run (Build 436c357a) proved the informed
// assembly repair can fix nothing while DEGRADING the candidate: the repair
// output for home introduced three orphan classes, contact gained `pill-row`,
// and services silently lost its H1 tail (", not vanity metrics." — a frozen
// Business positioning statement). The pre-repair pages were cleaner than
// their repairs.
//
// This module is the deterministic preservation contract for that ONE bounded
// repair (budget unchanged, #69 §18):
//
// - Mutation AUTHORITY per finding type (§12): only class/CSS realization
//   (ORPHANED_CLASS, REGION_STYLE_MISSING) and exact navigation-target fixes
//   (BROKEN_NAV_LINK) authorize an informed repair. FABRICATED_TRUST_ENTITY —
//   and every finding type not explicitly enumerated — escalates the page
//   deterministically instead of regenerating it.
// - CONTENT freeze (§14): visible text, title/meta, hrefs (except the exact
//   authorized navigation targets), image identities, form fields and region
//   order are fingerprint-frozen; violations are REPAIR_SCOPE_VIOLATION.
// - ADOPTION (§15-17): a repair becomes the effective page only when its
//   content guard holds AND the page's deterministic findings are fully
//   resolved with no new findings. Otherwise the original pre-repair page
//   stays effective and the stored repair artifact remains as evidence.

import {
  diffPageContent,
  extractPageContentFingerprint,
  normalizeTextNode,
  type PageContentFingerprint,
  type RepairScopeViolation,
} from "./content-fingerprint";

export type AssemblyPageId = "home" | "about" | "services" | "contact";

export interface AssemblyFinding {
  id: string;
  detail: string;
}

// §12 mutation authority: only these finding types authorize an informed
// assembly repair at all. Everything else escalates — repair is never
// generic page-regeneration permission.
//
// Documented final choices (issue #69 §12):
// - ORPHANED_CLASS / REGION_STYLE_MISSING: class + CSS realization.
// - BROKEN_NAV_LINK: exact navigation targets only.
// - Structural findings (NON_SEMANTIC_STRUCTURE, MISSING_H1,
//   MISSING_SHARED_CSS_LINK, MISSING_SHARED_JS_LINK, MISSING_VIEWPORT_META,
//   MISSING_REGION): authorized — fixing them is markup structure only, and
//   the content freeze guards every word. Restoring a missing <footer> or
//   stylesheet link cannot fabricate facts. (This keeps the #52 structural
//   repair contract intact.)
// - FABRICATED_TRUST_ENTITY: ESCALATE — fabrication is never a repair input;
//   deterministic review with the pre-repair candidate retained.
// - MULTIPLE_H1, IMG_*, FORM_CONTRACT_VIOLATION, MISSING_PAGE, unsupported-
//   fact patterns: ESCALATE (conservative default — content/image/form
//   adjacent, or no rejected page to repair from).
export const REPAIR_AUTHORIZED_FINDING_IDS: ReadonlySet<string> = new Set([
  "ORPHANED_CLASS",
  "REGION_STYLE_MISSING",
  "BROKEN_NAV_LINK",
  "NON_SEMANTIC_STRUCTURE",
  "MISSING_H1",
  "MISSING_SHARED_CSS_LINK",
  "MISSING_SHARED_JS_LINK",
  "MISSING_VIEWPORT_META",
  "MISSING_REGION",
]);

export interface AssemblyRepairScope {
  /** ORPHANED_CLASS / REGION_STYLE_MISSING: classes may be reassigned or
   *  removed and missing CSS rules may be added. Content stays frozen. */
  classRealization: boolean;
  /** The exact broken href values a BROKEN_NAV_LINK finding authorizes
   *  replacing (only these values may change, and only to a canonical page
   *  href). */
  brokenHrefs: string[];
  /** Navigation targets a "navigation misses link" finding authorizes
   *  adding (one anchor per target, labeled with its canonical label). */
  navAdditions: string[];
}

export type AssemblyRepairDecision =
  | { action: "repair"; scope: AssemblyRepairScope }
  | { action: "escalate"; reason: string };

const CANONICAL_HREFS: ReadonlySet<string> = new Set(["/", "/about", "/services", "/contact"]);
const LABEL_BY_HREF: Readonly<Record<string, string>> = {
  "/": "Home",
  "/about": "About",
  "/services": "Services",
  "/contact": "Contact",
};

export function canonicalNavLabel(href: string): string | null {
  return LABEL_BY_HREF[href] ?? null;
}

function multisetDiff(before: string[], after: string[]): { removed: string[]; added: string[] } {
  const counts = new Map<string, number>();
  for (const value of before) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of after) counts.set(value, (counts.get(value) ?? 0) - 1);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [value, count] of counts) {
    for (let i = 0; i < Math.abs(count); i++) (count > 0 ? removed : added).push(value);
  }
  return { removed, added };
}

/** Page-scoped finding extraction: assembly findings carry their page as the
 *  `pageId:` detail prefix (the pipeline's established convention). */
export function pageIdOfFinding(detail: string): AssemblyPageId | null {
  const match = /^(home|about|services|contact):/.exec(detail);
  return match ? (match[1] as AssemblyPageId) : null;
}

export function findingsForPage(findings: AssemblyFinding[], pageId: AssemblyPageId): AssemblyFinding[] {
  return findings.filter((finding) => pageIdOfFinding(finding.detail) === pageId);
}

/** §12: the deterministic finding-type -> mutation-authority mapping. */
export function assemblyRepairDecision(pageFindings: AssemblyFinding[]): AssemblyRepairDecision {
  const unauthorized = pageFindings.filter((finding) => !REPAIR_AUTHORIZED_FINDING_IDS.has(finding.id));
  if (unauthorized.length > 0) {
    const ids = [...new Set(unauthorized.map((finding) => finding.id))].join(", ");
    return {
      action: "escalate",
      reason: `finding types beyond assembly-repair mutation authority (${ids}) — deterministic escalation, pre-repair candidate retained for review`,
    };
  }
  const brokenHrefs: string[] = [];
  const navAdditions: string[] = [];
  for (const finding of pageFindings) {
    if (finding.id !== "BROKEN_NAV_LINK") continue;
    const broken = /internal link href="([^"]+)" resolves to no generated page/.exec(finding.detail);
    if (broken) {
      brokenHrefs.push(broken[1]);
      continue;
    }
    const missing = /navigation misses link to '[^']*' \(href="([^"]+)"\)/.exec(finding.detail);
    if (missing) navAdditions.push(missing[1]);
  }
  return {
    action: "repair",
    scope: {
      classRealization: pageFindings.some((finding) => finding.id === "ORPHANED_CLASS" || finding.id === "REGION_STYLE_MISSING"),
      brokenHrefs,
      navAdditions,
    },
  };
}

function hrefDiffWithinScope(before: string[], after: string[], scope: AssemblyRepairScope): boolean {
  const { removed, added } = multisetDiff(before, after);
  // Every removed/changed href must be an EXACTLY authorized broken value,
  // and every replacement must be a canonical page href.
  if (!removed.every((href) => scope.brokenHrefs.includes(href))) return false;
  if (!added.every((href) => CANONICAL_HREFS.has(href) || scope.navAdditions.includes(href))) return false;
  return true;
}

function textDiffWithinNavAdditions(before: string[], after: string[], scope: AssemblyRepairScope): boolean {
  const { removed, added } = multisetDiff(before.map(normalizeTextNode), after.map(normalizeTextNode));
  if (removed.length > 0) return false;
  // Each authorized nav addition may introduce exactly its canonical label.
  const allowed = new Map<string, number>();
  for (const href of scope.navAdditions) {
    const label = LABEL_BY_HREF[href];
    if (label) allowed.set(label, (allowed.get(label) ?? 0) + 1);
  }
  for (const text of added) {
    const count = allowed.get(text) ?? 0;
    if (count === 0) return false;
    allowed.set(text, count - 1);
  }
  return true;
}

export interface AssemblyGuardVerdict {
  violations: RepairScopeViolation[];
}

/** §14 content freeze for the assembly repair: the #67 fingerprint diff runs
 *  with NO authorized regions (region order and per-region text stay frozen),
 *  then the only excusable diffs are the §12 navigation allowances. Any other
 *  mutation — a dropped H1 tail, a new claim, a new orphan label — is a
 *  REPAIR_SCOPE_VIOLATION. */
export function validateAssemblyRepairContent(
  before: PageContentFingerprint,
  after: PageContentFingerprint,
  scope: AssemblyRepairScope
): AssemblyGuardVerdict {
  const raw = diffPageContent({ before, after, authorizedRegions: new Set() });
  const violations = raw.filter((violation) => {
    if (violation.rule === "HREF_MUTATED" && hrefDiffWithinScope(before.hrefs, after.hrefs, scope)) return false;
    if (violation.rule === "TEXT_MUTATED" && textDiffWithinNavAdditions(before.textNodes, after.textNodes, scope)) return false;
    return true;
  });
  return { violations };
}

export function extractAssemblyFingerprint(html: string): PageContentFingerprint {
  return extractPageContentFingerprint(html);
}

/** §15 finding-preservation signature: deterministic per-page finding set
 *  used to prove target findings resolved with no new findings. */
export function findingSignatures(findings: AssemblyFinding[]): string[] {
  return findings.map((finding) => `${finding.id}::${finding.detail}`).sort();
}
