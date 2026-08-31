import type { StyleTokens } from "../types";

export interface BundleValidationIssue {
  severity: "critical" | "major" | "minor";
  file: string;
  issue: string;
  recommendedFix: string;
}

export interface BundleValidationResult {
  valid: boolean;
  issues: BundleValidationIssue[];
}

const CRITICAL_HTML_FILES = ["index.html", "services/index.html", "about/index.html", "contact/index.html"];
const MIN_RENDERED_SECTIONS: Record<string, number> = {
  "index.html": 5,
  "services/index.html": 5,
  "about/index.html": 3,
  "contact/index.html": 2,
};
const BOOTSTRAP_PATTERNS = [
  /^container-fluid$/,
  /^row$/,
  /^col(?:-(?:sm|md|lg|xl|xxl))?-\d+$/,
  /^btn(?:-[a-z-]+)?$/,
  /^navbar(?:-[a-z-]+)?$/,
  /^form-control$/,
  /^alert(?:-[a-z-]+)?$/,
];
const TAILWIND_SIGNAL_PATTERNS = [
  /\b(?:flex|grid|hidden|block|inline-flex)\b/,
  /\b(?:px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|space-x|space-y)-/,
  /\b(?:text|bg|border|tracking|leading|min-h|max-w|w|h)-/,
  /\[[^\]]+\]/,
];

function isTextFile(path: string): boolean {
  return path.endsWith(".html") || path.endsWith(".css") || path.endsWith(".js") || path.endsWith(".json") || path.endsWith(".xml") || path.endsWith(".txt") || path.endsWith(".svg");
}

function getTextFile(files: Map<string, string | ArrayBuffer>, path: string): string | null {
  const value = files.get(path);
  if (typeof value === "string") return value;
  return null;
}

function hasTailwindSignals(html: string): boolean {
  return TAILWIND_SIGNAL_PATTERNS.some((pattern) => pattern.test(html));
}

function extractClassTokens(html: string): string[] {
  const tokens: string[] = [];
  const classMatches = html.matchAll(/class\s*=\s*"([^"]+)"/g);
  for (const match of classMatches) {
    tokens.push(...match[1].split(/\s+/).filter(Boolean));
  }
  return tokens;
}

function hasBootstrapSignals(html: string): boolean {
  const tokens = extractClassTokens(html);
  return tokens.some((token) => BOOTSTRAP_PATTERNS.some((pattern) => pattern.test(token)));
}

function countRenderedSections(html: string): number {
  return (html.match(/<section\b/gi) || []).length;
}

function findUnsafeHtml(html: string): string | null {
  const forbiddenTag = html.match(/<(iframe|object|embed|base)\b/i);
  if (forbiddenTag) return `forbidden <${forbiddenTag[1].toLowerCase()}> tag`;
  if (/\son[a-z]+\s*=/i.test(html) || /\ssrcdoc\s*=/i.test(html)) return "executable HTML attribute";
  if (/\s(?:href|src|action)\s*=\s*["']\s*(?:javascript:|data:text\/html)/i.test(html)) return "unsafe URL scheme";
  return null;
}

export function validateBundle(files: Map<string, string | ArrayBuffer>, tokens?: StyleTokens): BundleValidationResult {
  const issues: BundleValidationIssue[] = [];
  const framework = tokens?.framework ?? "none";

  const stylesCss = getTextFile(files, "assets/styles.css");
  if (!stylesCss) {
    issues.push({
      severity: "critical",
      file: "assets/styles.css",
      issue: "Generated bundle is missing the stylesheet asset.",
      recommendedFix: "Ensure the manifest builder always emits /assets/styles.css and page heads link it.",
    });
  }

  for (const path of CRITICAL_HTML_FILES) {
    const html = getTextFile(files, path);
    if (!html) {
      issues.push({
        severity: "critical",
        file: path,
        issue: "Required HTML page is missing from the bundle.",
        recommendedFix: "Ensure all 4 required pages are rendered into the bundle before deploy.",
      });
      continue;
    }

    if (!html.includes('<link rel="stylesheet" href="/assets/styles.css">')) {
      issues.push({
        severity: "critical",
        file: path,
        issue: "Generated HTML does not link the shared stylesheet.",
        recommendedFix: "Inject /assets/styles.css in the document head for every rendered page.",
      });
    }

    const unsafeHtml = findUnsafeHtml(html);
    if (unsafeHtml) {
      issues.push({
        severity: "critical",
        file: path,
        issue: `Generated HTML contains ${unsafeHtml}.`,
        recommendedFix: "Regenerate the page without executable markup or unsafe embedded content.",
      });
    }

    if (framework === "tailwind") {
      if (!html.includes("https://cdn.tailwindcss.com")) {
        issues.push({
          severity: "critical",
          file: path,
          issue: "Tailwind is the configured framework but the page does not load Tailwind.",
          recommendedFix: "Inject the Tailwind CDN script or a compiled Tailwind stylesheet into every generated page.",
        });
      }

      if (hasBootstrapSignals(html)) {
        issues.push({
          severity: "critical",
          file: path,
          issue: "Bootstrap class patterns were found in a Tailwind bundle.",
          recommendedFix: "Do not mix Bootstrap classes into Tailwind-based style packages or rendered templates.",
        });
      }
    }

    if (framework === "bootstrap" && hasTailwindSignals(html)) {
      issues.push({
        severity: "critical",
        file: path,
        issue: "Tailwind utility patterns were found in a Bootstrap bundle.",
        recommendedFix: "Use Bootstrap-only classes when the selected framework is Bootstrap.",
      });
    }

    if (/<h1[^>]*>\s*<\/h1>/i.test(html)) {
      issues.push({
        severity: "critical",
        file: path,
        issue: "Page contains an empty h1 element.",
        recommendedFix: "Ensure every page has a non-empty hero headline before rendering HTML.",
      });
    }

    if (/<(?:a|button)[^>]*>\s*<\/(?:a|button)>/i.test(html)) {
      issues.push({
        severity: "major",
        file: path,
        issue: "Interactive element rendered with no visible label.",
        recommendedFix: "Require non-empty CTA labels in the site spec and rendered sections.",
      });
    }

    if (/<p[^>]*>\s*<\/p>/i.test(html)) {
      issues.push({
        severity: "major",
        file: path,
        issue: "One or more paragraph elements are empty.",
        recommendedFix: "Do not render empty paragraph tags; omit them or populate them with real content.",
      });
    }

    if (html.includes("Unknown section type:")) {
      issues.push({
        severity: "critical",
        file: path,
        issue: "Renderer emitted an unknown section fallback.",
        recommendedFix: "Validate section types before rendering and align all generated sections with supported templates.",
      });
    }

    if (!html.includes('<script src="/assets/app.js" defer></script>')) {
      issues.push({
        severity: "major",
        file: path,
        issue: "Generated page is missing the shared contact/app script tag.",
        recommendedFix: "Inject /assets/app.js on all generated pages so form behavior remains consistent.",
      });
    }

    if (path === "contact/index.html" && !/action="\/api\/contact"/.test(html)) {
      issues.push({
        severity: "critical",
        file: path,
        issue: "Contact page is missing a form with action='/api/contact'.",
        recommendedFix: "Ensure the contact page always renders a contact-form section or inject a default form during page rendering.",
      });
    }

    const minimumSections = MIN_RENDERED_SECTIONS[path];
    if (minimumSections) {
      const sectionCount = countRenderedSections(html);
      if (sectionCount < minimumSections) {
        issues.push({
          severity: "major",
          file: path,
          issue: `Page renders only ${sectionCount} sections; expected at least ${minimumSections}.`,
          recommendedFix: "Strengthen site-spec generation rules and validation so this page includes richer structure before deploy.",
        });
      }
    }
  }

  for (const [path, value] of files) {
    if (!isTextFile(path) || typeof value !== "string") continue;
    if (path.endsWith(".html") || path.endsWith(".css")) continue;
  }

  return {
    valid: !issues.some((issue) => issue.severity === "critical" || issue.severity === "major"),
    issues,
  };
}
