import type { Env } from "../env.d";
import type { QaReport, QaIssue, ProvenanceManifestV1, SiteSpec } from "../types";
import { checkLinks } from "../qa/checks/links";
import { checkImages } from "../qa/checks/images";
import { checkMeta } from "../qa/checks/meta";
import { checkLayout } from "../qa/checks/layout";
import { checkSocials } from "../qa/checks/socials";
import { checkAccessibility } from "../qa/checks/accessibility";
import { verifyProvenanceAgainstBundle } from "./provenance";
import type { BrowserAdapter } from "./browser-adapter";
import type { DesignBlueprintV2, InteractionBlueprintV2 } from "./blueprint-schema-v2";
import { canPublishQualityGate, inspectIconMarkup, runVisualQualityGate, scoreQualityGate } from "./visual-quality-gate";
import { putObject } from "./assets";

export const QA_PAGE_PATHS = ["/", "/services", "/about", "/contact"] as const;
const PAGES = QA_PAGE_PATHS;

interface PreviewReadinessOptions {
  attempts?: number;
  delayMs?: number;
  fetcher?: (input: string) => Promise<{ ok: boolean; status: number }>;
  sleep?: (delayMs: number) => Promise<void>;
}

export class PreviewReadinessError extends Error {
  readonly statuses: Record<string, number | null>;

  constructor(statuses: Record<string, number | null>) {
    super(`Preview routes did not become reachable before QA: ${Object.entries(statuses).map(([path, status]) => `${path}=${status ?? "network-error"}`).join(", ")}`);
    this.name = "PreviewReadinessError";
    this.statuses = statuses;
  }
}

function previewPageUrl(previewUrl: string, path: string): string {
  return `${previewUrl.replace(/\/$/, "")}${path === "/" ? "" : path}`;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForPreviewReadiness(previewUrl: string, options: PreviewReadinessOptions = {}): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 30);
  const delayMs = Math.max(0, options.delayMs ?? 2_000);
  const fetcher = options.fetcher ?? ((input: string) => fetch(input));
  const sleep = options.sleep ?? wait;
  let statuses: Record<string, number | null> = {};

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const results = await Promise.all(PAGES.map(async (path) => {
      try {
        const response = await fetcher(previewPageUrl(previewUrl, path));
        return [path, response.status] as const;
      } catch {
        return [path, null] as const;
      }
    }));
    statuses = Object.fromEntries(results);
    if (Object.values(statuses).every((status) => status !== null && status >= 200 && status < 400)) return;
    if (attempt < attempts) await sleep(delayMs);
  }

  throw new PreviewReadinessError(statuses);
}

interface PageCheckResult {
  links: "pass" | "fail";
  images: "pass" | "fail";
  meta: "pass" | "fail";
  layout: "pass" | "fail";
  accessibility: "pass" | "fail";
  issues: QaIssue[];
}

interface QaPageContext {
  url: string;
  pageSlug: string;
  viewport: { name: string; width: number; height: number };
  html: string;
  spec: SiteSpec;
}

export async function runQaReview(
  env: Env,
  previewUrl: string,
  clientSlug: string,
  version: number,
  spec: SiteSpec,
  provenance: ProvenanceManifestV1,
  design: DesignBlueprintV2,
  interaction: InteractionBlueprintV2,
  attempt = 1,
  adapter?: BrowserAdapter
): Promise<QaReport> {
  await waitForPreviewReadiness(previewUrl);
  const allIssues: QaIssue[] = [];
  const checks = {
    links: "pass" as "pass" | "fail",
    socials: "pass" as "pass" | "fail",
    images: "pass" as "pass" | "fail",
    seo_meta: "pass" as "pass" | "fail",
    overflow: "pass" as "pass" | "fail",
    form_render: "pass" as "pass" | "fail",
    accessibility: "pass" as "pass" | "fail",
    provenance: "pass" as "pass" | "fail",
    visual: "pass" as "pass" | "fail",
    interaction: "pass" as "pass" | "fail",
    icons: "pass" as "pass" | "fail",
  };
  const fetchedPages = new Map<string, string | ArrayBuffer>();
  const addStaticFailure = (
    category: QaIssue["category"],
    page: string,
    selector: string,
    issue: string,
    expected: string,
    recommendedFix: string,
    severity: QaIssue["severity"] = "major"
  ) => {
    allIssues.push({
      severity,
      category,
      page,
      selector,
      issue,
      expected,
      actual: "Deterministic markup check returned fail.",
      evidence: `Static HTML validation for ${page}`,
      recommendedFix,
    });
  };

  const screenshots: QaReport["screenshots"] = {
    desktop: {},
    tablet: {},
    mobile: {},
  };

  for (const pageSlug of PAGES) {
    const pageUrl = `${previewUrl}${pageSlug === "/" ? "" : pageSlug}`;

    let html: string;
    try {
      const resp = await fetch(pageUrl);
      if (!resp.ok) {
        checks.links = "fail";
        allIssues.push({
          severity: "critical",
          category: "links",
          page: pageSlug,
          selector: "",
          issue: `Page returned HTTP ${resp.status}`,
          recommendedFix: "Check the deployed site and routing configuration",
        });
        continue;
      }
      html = await resp.text();
      const pagePath = pageSlug === "/" ? "index.html" : `${pageSlug.slice(1)}/index.html`;
      fetchedPages.set(pagePath, html);
      const iconIssues = inspectIconMarkup(html, pageSlug);
      if (iconIssues.length > 0) checks.icons = "fail";
      allIssues.push(...iconIssues);
    } catch {
      checks.links = "fail";
      allIssues.push({
        severity: "critical",
        category: "links",
        page: pageSlug,
        selector: "",
        issue: `Failed to fetch page: ${pageUrl}`,
        recommendedFix: "Verify the preview URL is accessible",
      });
      continue;
    }

    const pageSpec = spec.pages.find((p) => p.slug === pageSlug);
    const socialsFromSpec = spec.site.socials;

    const linkResult = checkLinks(html, pageSlug, previewUrl, spec.pages.map((p) => p.slug));
    if (linkResult === "fail") {
      checks.links = "fail";
      addStaticFailure("links", pageSlug, "a[href]", "Page contains an invalid internal or external link.", "Every link resolves to a known site route or a valid absolute URL.", "Correct or remove the invalid href.");
    }

    const imageResult = checkImages(html, pageSlug);
    if (imageResult === "fail") {
      checks.images = "fail";
      addStaticFailure("images", pageSlug, "img", "Image markup is missing a usable source or alternative text.", "Every image has a non-empty src and relevant alt text.", "Add a valid image source and concise alternative text.");
    }

    const metaResult = checkMeta(html, pageSlug, pageSpec);
    if (metaResult === "fail") {
      checks.seo_meta = "fail";
      addStaticFailure("seo", pageSlug, "head, h1", "Required page metadata or heading structure is incomplete.", "The page has a title, description, canonical URL, language, and exactly one h1.", "Restore the required metadata and single-h1 structure.");
    }

    const layoutResult = checkLayout(html, pageSlug);
    if (layoutResult === "fail") {
      checks.overflow = "fail";
      addStaticFailure("layout", pageSlug, "header, nav, footer", "Required global layout landmarks are missing.", "Every page includes navigation/header and footer landmarks.", "Render the shared navigation/header and footer.");
    }

    const socialResult = checkSocials(html, socialsFromSpec);
    if (socialResult === "fail") {
      checks.socials = "fail";
      addStaticFailure("social", pageSlug, "a[href]", "An accepted social profile is absent from the rendered page.", "Every provided social profile is rendered without inventing URLs.", "Render the accepted social link verbatim or remove it from the structured specification.", "minor");
    }

    const a11yResult = checkAccessibility(html, pageSlug);
    if (a11yResult === "fail") {
      checks.accessibility = "fail";
      addStaticFailure("accessibility", pageSlug, "html, button, input, .skip-link", "Required accessibility markup is incomplete.", "The page declares a language, offers a skip link, and labels interactive controls.", "Restore language, skip-link, and accessible-name markup.");
    }

    if (pageSlug === "/contact") {
      const formPresent = html.includes('action="/api/contact"') || html.includes('"/api/contact"');
      if (!formPresent) {
        checks.form_render = "fail";
        allIssues.push({
          severity: "critical",
          category: "form",
          page: pageSlug,
          selector: "form",
          issue: "Contact form not found or missing submit endpoint",
          recommendedFix: "Ensure the contact form section renders with action='/api/contact'",
        });
      }
    }
  }

  const provenanceValidation = await verifyProvenanceAgainstBundle(provenance, fetchedPages);
  if (!provenanceValidation.valid) {
    checks.provenance = "fail";
    for (const issue of provenanceValidation.issues) {
      allIssues.push({
        severity: issue.severity,
        category: "provenance",
        page: pageSlugFromProvenancePath(issue.path),
        selector: issue.claimId ?? "",
        issue: `${issue.code}: ${issue.message}`,
        recommendedFix: issue.recommendedFix,
      });
    }
  }

  const visualGate = await runVisualQualityGate(env, {
    previewUrl,
    clientSlug,
    version,
    attempt,
    design,
    interaction,
    adapter,
  });
  allIssues.push(...visualGate.issues);
  Object.assign(screenshots.desktop, visualGate.screenshots.desktop);
  Object.assign(screenshots.tablet, visualGate.screenshots.tablet);
  Object.assign(screenshots.mobile, visualGate.screenshots.mobile);
  if (visualGate.issues.some((finding) => finding.category === "visual")) checks.visual = "fail";
  if (visualGate.issues.some((finding) => finding.category === "interaction")) checks.interaction = "fail";

  const combinedScore = scoreQualityGate(allIssues);
  const combinedPublishable = canPublishQualityGate(combinedScore, visualGate.threshold, allIssues);
  const verdict = combinedPublishable ? deriveVerdict(allIssues) : "failed";
  const summary = generateSummary(verdict, allIssues, checks);

  const report: QaReport = {
    verdict,
    summary,
    checks,
    issues: allIssues,
    screenshots,
    qualityGate: {
      score: combinedScore,
      threshold: visualGate.threshold,
      publishable: combinedPublishable,
      attempt,
      reportR2Key: visualGate.reportR2Key,
      interactionEvidenceR2Key: visualGate.interactionEvidenceR2Key,
    },
    provenance: {
      manifestId: provenance.id,
      schemaVersion: provenance.schemaVersion,
      sourceCount: provenance.sources.length,
      claimCount: provenance.claims.length,
      failureIds: provenanceValidation.issues.map((issue) => issue.id),
    },
  };
  await putObject(env, visualGate.reportR2Key, JSON.stringify(report, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return report;
}

function pageSlugFromProvenancePath(path: string): string {
  if (path.startsWith("services/")) return "/services";
  if (path.startsWith("about/")) return "/about";
  if (path.startsWith("contact/")) return "/contact";
  return "/";
}

function deriveVerdict(issues: QaIssue[]): QaReport["verdict"] {
  const hasCritical = issues.some((i) => i.severity === "critical");
  const hasMajor = issues.some((i) => i.severity === "major");

  if (hasCritical) return "failed";
  if (hasMajor) return "needs_revision";
  if (issues.length > 0) return "pass_with_minor_issues";
  return "pass";
}

function generateSummary(
  verdict: QaReport["verdict"],
  issues: QaIssue[],
  checks: QaReport["checks"]
): string {
  const totalIssues = issues.length;
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const majorCount = issues.filter((i) => i.severity === "major").length;
  const minorCount = issues.filter((i) => i.severity === "minor").length;

  const failedChecks = Object.entries(checks)
    .filter(([, v]) => v === "fail")
    .map(([k]) => k);

  if (verdict === "pass") {
    return "QA review passed with no issues found.";
  }

  if (verdict === "pass_with_minor_issues") {
    return `QA passed with ${minorCount} minor issue(s). ${failedChecks.length > 0 ? `Areas to review: ${failedChecks.join(", ")}.` : ""}`;
  }

  if (verdict === "needs_revision") {
    return `QA needs revision: ${majorCount} major issue(s) and ${minorCount} minor issue(s) found. ${failedChecks.length > 0 ? `Failed checks: ${failedChecks.join(", ")}.` : ""}`;
  }

  return `QA failed: ${criticalCount} critical issue(s) found. Build is not servable. Failed checks: ${failedChecks.join(", ")}.`;
}
