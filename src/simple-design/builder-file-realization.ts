// Builder file-realization validation (operator GO 2026-09-11 §6: FILE-SIZED
// REALIZATION CALLS).
//
// Each Builder call returns ONE raw source file — no schema envelopes the
// payload, so a deterministic per-file gate is what stands between a
// meta-stub and a frozen Build Version. The structured-transport
// qualifications (9bbd77d, 1af7cc5) showed schema-valid output whose fields
// held placeholder PROSE describing the file instead of the file itself, and
// reasoning-template debris leaking into values. Structural validation plus a
// meta-marker scan catches that class deterministically, per file, BEFORE
// anything freezes.
//
// Deliberately structural only — it does NOT score design quality. The
// downstream Technical/Visual QA remains authoritative; this gate merely
// prevents non-source output from reaching them.

import type { SiteBundle } from "./contracts";

export interface BuilderFileValidationResult {
  passed: boolean;
  /** Deterministic failure ids with the offending file — evidence for
   *  the fail-closed error, never model-facing content. */
  failures: string[];
}

export type BuilderFileKind = "site-css" | "page-home" | "page-about" | "page-services" | "page-contact" | "site-js";

// Case-insensitive abbreviation / meta-stub markers. "placeholder" alone is
// deliberately NOT a marker: the form contract legitimately uses placeholder
// attributes; the phrase "placeholder for" is the stub idiom. The <think>
// idioms are the GLM reasoning-template debris observed leaking into
// structured output during the 1af7cc5 qualification — legitimate site source
// never contains them.
const META_MARKERS: Array<{ marker: string; label: string }> = [
  { marker: "truncated", label: "truncated" },
  { marker: "full content was returned", label: "'full content was returned'" },
  { marker: "rest unchanged", label: "'rest unchanged'" },
  { marker: "rest of the", label: "'rest of the'" },
  { marker: "remaining content", label: "'remaining content'" },
  { marker: "omitted from", label: "'omitted from'" },
  { marker: "omitted for brevity", label: "'omitted for brevity'" },
  { marker: "omitted for length", label: "'omitted for length'" },
  { marker: "placeholder for", label: "'placeholder for'" },
  { marker: "would go here", label: "'would go here'" },
  { marker: "and so on", label: "'and so on'" },
  { marker: "todo", label: "TODO" },
  { marker: "<think>", label: "<think> reasoning debris" },
  { marker: "</think>", label: "</think> reasoning debris" },
];

function metaMarkerHits(source: string): string[] {
  const haystack = source.toLowerCase();
  return META_MARKERS.filter((entry) => haystack.includes(entry.marker)).map((entry) => entry.label);
}

// Every page must be a complete semantic HTML document (objective,
// structural characteristics of this Builder's own contract).
function validatePage(page: string, label: string, failures: string[]): void {
  const html = page.toLowerCase();
  const required: Array<[string, string]> = [
    ["<!doctype html", "<!DOCTYPE html>"],
    ["<html", "<html>"],
    ["<head", "<head>"],
    ["<body", "<body>"],
    ["<header", "<header>"],
    ["<nav", "<nav>"],
    ["<main", "<main>"],
    ["<footer", "<footer>"],
    ["</html>", "</html>"],
  ];
  for (const [needle, display] of required) {
    if (!html.includes(needle)) failures.push(`${label} is missing required HTML structure: ${display}`);
  }
  if (!html.includes("site.css")) failures.push(`${label} does not reference site.css`);
  if (!html.includes("site.js")) failures.push(`${label} does not reference site.js`);
  const h1Count = (page.match(/<h1[\s>]/gi) ?? []).length;
  if (h1Count !== 1) failures.push(`${label} must contain exactly ONE <h1> (found ${h1Count})`);
  const hits = metaMarkerHits(page);
  if (hits.length > 0) failures.push(`${label} contains meta/abbreviation marker(s): ${hits.join(", ")}`);
}

// The shared stylesheet must carry the design-system layer this Builder
// contract requires — structural indicators, never arbitrary length floors.
function validateCss(css: string, motionExists: boolean, failures: string[]): void {
  const ruleCount = (css.match(/\{[^{}]*\}/g) ?? []).length;
  if (ruleCount < 10) failures.push(`site.css has too few CSS rules to be a real stylesheet (${ruleCount})`);
  if (!/(^|[^-])--[\w-]+\s*:/.test(css) && !css.includes(":root")) {
    failures.push("site.css is missing the custom-property design-token layer (no `--*` declarations or :root block)");
  }
  if (!css.includes("@media")) failures.push("site.css is missing a responsive @media block");
  if (!css.includes(":focus-visible")) failures.push("site.css is missing :focus-visible styling (accessibility contract)");
  if (motionExists && !css.toLowerCase().includes("prefers-reduced-motion")) {
    failures.push("site.css is missing a prefers-reduced-motion block although the Blueprint defines motion");
  }
  const hits = metaMarkerHits(css);
  if (hits.length > 0) failures.push(`site.css contains meta/abbreviation marker(s): ${hits.join(", ")}`);
}

// Shared JS may legitimately be small — reject prose/meta-description and
// obviously non-code output; Technical QA judges runtime details later.
function validateJs(js: string, failures: string[]): void {
  const codeIndicators = ["function", "=>", "addEventListener", "querySelector", "document.", "const ", "let ", "var "];
  if (!codeIndicators.some((indicator) => js.includes(indicator))) {
    failures.push("site.js does not look like JavaScript source (no code constructs found)");
  }
  const hits = metaMarkerHits(js);
  if (hits.length > 0) failures.push(`site.js contains meta/abbreviation marker(s): ${hits.join(", ")}`);
}

/** Deterministic validation for ONE realized Builder file. */
export function validateBuilderFile(
  kind: BuilderFileKind,
  source: string,
  options?: { blueprintMotionExists?: boolean }
): BuilderFileValidationResult {
  const failures: string[] = [];
  if (typeof source !== "string" || source.length === 0) {
    return { passed: false, failures: [`${kind} realization is empty`] };
  }
  if (kind === "site-css") validateCss(source, options?.blueprintMotionExists ?? true, failures);
  else if (kind === "site-js") validateJs(source, failures);
  else validatePage(source, `${kind} page`, failures);
  return { passed: failures.length === 0, failures };
}

/** Whole-bundle convenience: every file of a realized bundle, same rules. */
export function validateBuilderFileBundle(
  bundle: Pick<SiteBundle, "pages" | "sharedCss" | "sharedJs">,
  options?: { blueprintMotionExists?: boolean }
): BuilderFileValidationResult {
  const failures: string[] = [];
  for (const page of ["home", "about", "services", "contact"] as const) {
    const result = validateBuilderFile(`page-${page}`, bundle.pages[page], options);
    failures.push(...result.failures);
  }
  failures.push(...validateBuilderFile("site-css", bundle.sharedCss, options).failures);
  failures.push(...validateBuilderFile("site-js", bundle.sharedJs, options).failures);
  return { passed: failures.length === 0, failures };
}

/** Deterministic motion detection: the Blueprint defines motion when its own
 *  text names motion/animation/transition/reveal idioms. */
export function blueprintMotionExists(blueprint: unknown): boolean {
  return /motion|animation|animate|transition|reveal|parallax|hover/i.test(JSON.stringify(blueprint));
}
