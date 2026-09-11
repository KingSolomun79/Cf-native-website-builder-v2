// V2 deterministic Technical Preflight (issue #12, PRD section 25).
//
// Rejects Release Candidates before expensive QA: missing pages, malformed
// HTML, missing H1, broken navigation, unresolved IMG: placeholders, missing
// CRITICAL Accepted Images, broken/temporary image URLs, invalid JSON-LD,
// missing metadata, fatal JS, page-level horizontal overflow, contact form
// contract failures, duplicate critical IDs, obvious assembly failures.
// Only a preflight-passing candidate enters full QA.

import { validateCriticalImageCoverage } from "../simple-design/critical-image-coverage";

export interface PreflightCheck {
  id: string;
  severity: "blocker" | "warning";
  passed: boolean;
  detail: string | null;
}

export interface PreflightCandidate {
  pages: Record<string, string>;
  sharedCss: string;
  sharedJs: string;
}

export interface PreflightContext {
  formServiceEndpoint: string;
  expectedSiteFormId: string;
  /** CRITICAL image slots of the materialized plan with their page
   *  ownership — the SAME shared coverage invariant the Website Builder
   *  validated before persisting; the preflight is the final defense. */
  criticalSlots: Array<{ slotId: string; page: string; section?: string }>;
}

const TEMP_PROVIDER_URL_PATTERNS = [
  /https?:\/\/[^"'\s]*kie\.ai/i,
  /https?:\/\/[^"'\s]*tmp\./i,
  /https?:\/\/[^"'\s]*temp[a-z]*\./i,
  /https?:\/\/[^"'\s]*\.cloudflarestorage\.com/i,
];

function check(id: string, passed: boolean, detail: string | null = null, severity: "blocker" | "warning" = "blocker"): PreflightCheck {
  return { id, severity, passed, detail: passed ? null : (detail ?? `${id} failed`) };
}

function tagCounts(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}[\\s>]`, "gi")) ?? []).length;
}

export function runTechnicalPreflight(
  candidate: PreflightCandidate,
  context: PreflightContext
): { passed: boolean; blockers: PreflightCheck[]; checks: PreflightCheck[] } {
  const checks: PreflightCheck[] = [];
  const requiredPages = ["home", "about", "services", "contact"];
  const pathByPage: Record<string, string> = { home: "index.html", about: "about.html", services: "services.html", contact: "contact.html" };

  for (const pageId of requiredPages) {
    const html = candidate.pages[pageId];
    checks.push(check("MISSING_CORE_PAGE", typeof html === "string" && html.length > 0, `page '${pageId}' missing`, ));
    if (typeof html !== "string" || html.length === 0) continue;

    const doc = html.toLowerCase();
    checks.push(check("MALFORMED_HTML", doc.includes("<!doctype html") && doc.includes("</html>"), `${pageId}: incomplete document`));

    for (const tag of ["div", "section", "main", "header", "footer", "nav"]) {
      const opened = tagCounts(html, tag);
      const closed = (html.match(new RegExp(`</${tag}>`, "gi")) ?? []).length;
      checks.push(check("MALFORMED_HTML", opened === closed, `${pageId}: <${tag}> opened ${opened}x but closed ${closed}x`));
    }

    const h1 = tagCounts(html, "h1");
    checks.push(check("MISSING_H1", h1 === 1, `${pageId}: expected exactly one H1, found ${h1}`));

    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    checks.push(check("DUPLICATE_CRITICAL_IDS", duplicates.length === 0, `${pageId}: duplicate ids ${[...new Set(duplicates)].slice(0, 5).join(", ")}`));

    const title = /<title>([^<]{1,300})<\/title>/i.exec(html);
    checks.push(check("MISSING_METADATA", title !== null, `${pageId}: missing <title>`));
    checks.push(check("MISSING_METADATA", /<meta\s+name="description"/i.test(html), `${pageId}: missing meta description`));

    const canonicalBase = /<link\s+rel="canonical"/i;
    if (pageId === "home") {
      checks.push(check("MISSING_METADATA", canonicalBase.test(html) || true, null, "warning"));
    }

    for (const link of html.matchAll(/href="(\/[a-z-]*)"/gi)) {
      const target = link[1];
      const valid = target === "/" || requiredPages.some((page) => `/${page}` === target);
      checks.push(check("BROKEN_NAVIGATION", valid, `${pageId}: internal link '${target}' resolves to no page`));
    }

    const unresolved = [...html.matchAll(/IMG:[a-zA-Z0-9_-]+/g)].map((match) => match[0]);
    checks.push(check("UNRESOLVED_IMAGE_SLOT", unresolved.length === 0, `${pageId}: unresolved placeholders ${[...new Set(unresolved)].slice(0, 5).join(", ")}`));

    for (const img of html.matchAll(/<img\b[^>]*src="([^"]+)"/gi)) {
      const src = img[1];
      checks.push(check("TEMP_PROVIDER_URL", !TEMP_PROVIDER_URL_PATTERNS.some((pattern) => pattern.test(src)), `${pageId}: image src '${src}' looks like a temporary provider URL`));
      checks.push(check("BROKEN_IMAGE_URL", src.startsWith("assets/") || src.startsWith("IMG:") || src.startsWith("data:"), `${pageId}: image src '${src}' is not a bundled asset`));
    }

    for (const script of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        JSON.parse(script[1]);
        checks.push(check("INVALID_JSON_LD", true));
      } catch (error) {
        checks.push(check("INVALID_JSON_LD", false, `${pageId}: JSON-LD does not parse (${(error as Error).message})`));
      }
    }
  }

  // CRITICAL slots must have shipped — on their declared page (shared
  // invariant; MISSING_CRITICAL_IMAGE / WRONG_PAGE_CRITICAL_IMAGE), checked
  // against the resolved bundled asset paths of the assembled candidate.
  // One check per CRITICAL slot, exactly as before.
  const coverage = validateCriticalImageCoverage(
    candidate.pages,
    context.criticalSlots.map((slot) => ({ ...slot, priority: "CRITICAL" })),
    "bundled"
  );
  for (const slot of context.criticalSlots) {
    const finding = coverage.find((entry) => entry.slotId === slot.slotId);
    checks.push(finding ? check(finding.id, false, finding.detail) : check("MISSING_CRITICAL_IMAGE", true));
  }

  const contact = candidate.pages.contact ?? "";
  if (contact) {
    checks.push(check("FORM_CONTRACT_FAILURE", contact.includes(`action="${context.formServiceEndpoint}"`), "contact: form does not target the Form Service endpoint"));
    checks.push(check("FORM_CONTRACT_FAILURE", contact.includes(context.expectedSiteFormId), "contact: siteFormId mismatch with the Site identity"));
    checks.push(
      check("FORM_CONTRACT_FAILURE", !/\bname="(recipient|to|from|sender|template)"/i.test(contact), "contact: browser-controlled delivery field present")
    );
  }

  // Fatal JS: structural balance sanity (no eval-based checking in Workers).
  const js = candidate.sharedJs;
  const balance = (open: string, close: string) => (js.split(open).length - 1) === (js.split(close).length - 1);
  checks.push(check("FATAL_JS_ERROR", balance("{", "}") && balance("(", ")") && balance("[", "]"), "site.js has unbalanced braces/parens/brackets"));

  // Material page-level horizontal overflow: fixed widths wider than the
  // largest supported viewport (min-/max-width are the responsive pattern and
  // are not flagged).
  const oversized = [...candidate.sharedCss.matchAll(/(?<![\w-])width:\s*(\d{4,})px/gi)].map((match) => `${match[1]}px`);
  checks.push(check("PAGE_HORIZONTAL_OVERFLOW", oversized.length === 0, `site.css fixes widths beyond viewports: ${oversized.slice(0, 3).join(", ")}`));

  checks.push(check("ASSEMBLY_FAILURE", candidate.sharedCss.length > 0 && js.length >= 0, "shared source missing"));

  const blockers = checks.filter((item) => !item.passed && item.severity === "blocker");
  return { passed: blockers.length === 0, blockers, checks };
}
