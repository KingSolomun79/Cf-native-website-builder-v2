// Builder file-realization validation (operator GO 2026-09-11 §6: FILE-SIZED
// REALIZATION CALLS) — the deterministic gates that stand between a raw model
// payload and a frozen Build Version.
//
//   §1-§7  parseSingleFileSource: raw source passes through untouched; exactly
//          ONE surrounding Markdown code fence (with or without a language
//          tag) is tolerated and stripped; ambiguous or unterminated framing
//          is refused, never heuristic-repaired
//   §8-§13 per-file structural validation: complete HTML skeleton + asset
//          refs + exactly ONE <h1>; the CSS design-system layer; JS must be
//          code; meta/abbreviation markers and reasoning debris fail on
//          every file kind; legitimate form placeholder attributes pass
//   §14    validateBuilderFileBundle aggregates all six files

import { describe, expect, it } from "vitest";
import { parseSingleFileSource } from "../src/domain/ai-boundary";
import {
  blueprintMotionExists,
  validateBuilderFile,
  validateBuilderFileBundle,
} from "../src/simple-design/builder-file-realization";

// ── fixtures ─────────────────────────────────────────────────────────────────

const FULL_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home</title><link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head>
<body><header><nav aria-label="Primary"><a href="/about">About</a></nav></header>
<main><section class="hero"><h1>Home</h1><img src="IMG:home-hero" data-image-id="home-hero" alt="hero"></section></main>
<footer><p>Fin</p></footer></body></html>`;

const TOKENS_CSS = `:root { --accent: #7c3aed; --ink: #1a1523; --paper: #faf7f2; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: system-ui, sans-serif; }
.hero { min-height: 60vh; display: grid; place-items: center; }
.site-nav { display: flex; gap: 1.5rem; }
img { max-width: 100%; display: block; }
form { display: grid; gap: 1rem; }
a:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 767px) { .hero { min-height: 40vh; } }
@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }`;

const CODE_JS = `(function () {
  var toggle = document.querySelector('.nav-toggle');
  if (toggle) { toggle.addEventListener('click', function () { document.body.classList.toggle('nav-open'); }); }
})();`;

// ── §1-§7: deterministic single-file normalization ───────────────────────────

describe("parseSingleFileSource: raw source in, file out (GO §6)", () => {
  it("§1 raw source passes through untouched", () => {
    const parsed = parseSingleFileSource(FULL_PAGE);
    expect(parsed).toEqual({ ok: true, value: FULL_PAGE });
  });

  it("§2 exactly one surrounding fence with a language tag is stripped", () => {
    const parsed = parseSingleFileSource("```css\n" + TOKENS_CSS + "\n```");
    expect(parsed).toEqual({ ok: true, value: TOKENS_CSS });
  });

  it("§3 a bare surrounding fence (no language tag) is tolerated too", () => {
    const parsed = parseSingleFileSource("```\n" + CODE_JS + "\n```");
    expect(parsed).toEqual({ ok: true, value: CODE_JS });
  });

  it("§4 an unterminated opening fence is refused, never repaired", () => {
    const parsed = parseSingleFileSource("```html\n" + FULL_PAGE);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("never closed");
  });

  it("§5 more than one fence is refused — the framing is ambiguous", () => {
    const parsed = parseSingleFileSource("```css\n" + TOKENS_CSS + "\n```\n" + CODE_JS + "\n```");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("more than one code fence");
  });

  it("§6 an empty realization is refused", () => {
    expect(parseSingleFileSource("   \n  ").ok).toBe(false);
  });

  it("§7 a closing fence fused onto the last content line is refused", () => {
    const parsed = parseSingleFileSource("```css\nbody { margin: 0; }```");
    expect(parsed.ok).toBe(false);
  });

  it("§7b the GLM think-template delimiter is stripped deterministically: the answer is everything after the LAST </think>", () => {
    // observed live 2026-09-11: reasoning prose + </think> + answer, even with
    // enable_thinking=false
    const wrapped = "The user wants me to output only canary.css.</think>/* ok */";
    expect(parseSingleFileSource(wrapped)).toEqual({ ok: true, value: "/* ok */" });
    // a quoted delimiter inside the reasoning does not confuse the split
    const quoted = 'The template emits </think> at the end.</think>' + TOKENS_CSS;
    expect(parseSingleFileSource(quoted)).toEqual({ ok: true, value: TOKENS_CSS });
    // think-wrapped AND fenced: both layers strip
    const both = "reasoning here</think>```css\n" + TOKENS_CSS + "\n```";
    expect(parseSingleFileSource(both)).toEqual({ ok: true, value: TOKENS_CSS });
    // reasoning with NO answer after the delimiter is refused
    expect(parseSingleFileSource("only reasoning</think>").ok).toBe(false);
  });
});

// ── §8-§13: per-file structural validation ───────────────────────────────────

describe("validateBuilderFile: HTML pages must be complete semantic documents", () => {
  it("§8 a complete page passes", () => {
    expect(validateBuilderFile("page-home", FULL_PAGE).passed).toBe(true);
  });

  it("§9 missing structure fails with the specific element", () => {
    for (const [needle, label] of [
      ["<!DOCTYPE html>", "doctype"],
      ["<footer>", "footer"],
      ['href="site.css"', "stylesheet"],
      ["site.js", "script"],
    ] as const) {
      const broken = FULL_PAGE.replace(needle, "");
      const result = validateBuilderFile("page-home", broken);
      expect(result.passed, label).toBe(false);
    }
  });

  it("§10 exactly ONE <h1>: zero and two each fail", () => {
    expect(validateBuilderFile("page-about", FULL_PAGE.replace(/<h1>.*?<\/h1>/, "")).passed).toBe(false);
    const twoH1 = FULL_PAGE.replace("</section>", "<h2>x</h2></section>").replace("<h1>Home</h1>", "<h1>Home</h1><h1>Again</h1>");
    const result = validateBuilderFile("page-home", twoH1);
    expect(result.failures.some((f) => f.includes("exactly ONE <h1> (found 2)"))).toBe(true);
  });

  it("§11 meta/abbreviation markers fail the page", () => {
    const stub = FULL_PAGE.replace("<h1>Home</h1>", "<h1>Home</h1><!-- rest of the page omitted for brevity -->");
    const result = validateBuilderFile("page-home", stub);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("meta/abbreviation marker"))).toBe(true);
  });

  it("§12 reasoning-template debris fails every file kind", () => {
    for (const [kind, source] of [
      ["page-home", FULL_PAGE.replace("</body>", "</think></body>")],
      ["site-css", TOKENS_CSS + "\n/* </think> */"],
      ["site-js", CODE_JS + "\n// <think>"],
    ] as const) {
      const result = validateBuilderFile(kind, source);
      expect(result.passed, kind).toBe(false);
      expect(result.failures.some((f) => f.includes("reasoning debris"))).toBe(true);
    }
  });

  it("§13 a legitimate form placeholder attribute is NOT a stub marker", () => {
    const contact = FULL_PAGE.replace(
      "</main>",
      '<main-section><input name="message" placeholder="How can we help?"></main-section></main>'
    );
    expect(validateBuilderFile("page-contact", contact).passed).toBe(true);
    // ...while the "placeholder for" stub idiom still fails
    const stub = FULL_PAGE.replace("<h1>Home</h1>", "<h1>Home</h1><p>placeholder for the services grid</p>");
    expect(validateBuilderFile("page-home", stub).passed).toBe(false);
  });
});

describe("validateBuilderFile: the stylesheet carries the contracted design-system layer", () => {
  it("§14 tokens + responsive + focus-visible + reduced-motion pass", () => {
    expect(validateBuilderFile("site-css", TOKENS_CSS, { blueprintMotionExists: true }).passed).toBe(true);
  });

  it("§15 each contracted layer is required", () => {
    // token layer gone: no --* declarations and no :root block (rule count kept)
    expect(validateBuilderFile("site-css", TOKENS_CSS.replace(":root { --accent: #7c3aed; --ink: #1a1523; --paper: #faf7f2; }", "html { accent-color: #7c3aed; }"), { blueprintMotionExists: true }).passed).toBe(false);
    // responsive layer gone: both @media blocks replaced by plain rules
    // (rule count kept; the reduced-motion requirement is switched off so the
    // ONLY failure is the missing responsive layer)
    const noMedia = TOKENS_CSS
      .replace("@media (max-width: 767px) { .hero { min-height: 40vh; } }", ".hero-sm { min-height: 40vh; }")
      .replace("@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }", ".quiet { scroll-behavior: auto; }");
    expect(validateBuilderFile("site-css", noMedia, { blueprintMotionExists: false }).passed).toBe(false);
    // accessibility layer gone (rule count kept)
    expect(validateBuilderFile("site-css", TOKENS_CSS.replace(":focus-visible", ":focus"), { blueprintMotionExists: true }).passed).toBe(false);
  });

  it("§16 prefers-reduced-motion is required only when the Blueprint defines motion", () => {
    const noMotionCss = TOKENS_CSS.replace(
      "@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }",
      ".quiet { scroll-behavior: auto; }"
    );
    expect(validateBuilderFile("site-css", noMotionCss, { blueprintMotionExists: true }).passed).toBe(false);
    expect(validateBuilderFile("site-css", noMotionCss, { blueprintMotionExists: false }).passed).toBe(true);
  });

  it("§17 too few rules is not a stylesheet", () => {
    expect(validateBuilderFile("site-css", ":root { --a: #111; }\nbody { margin: 0; }", { blueprintMotionExists: false }).passed).toBe(false);
  });
});

describe("validateBuilderFile: the shared script must be code", () => {
  it("§18 real code passes; prose or meta-description fails", () => {
    expect(validateBuilderFile("site-js", CODE_JS).passed).toBe(true);
    const prose = validateBuilderFile("site-js", "The site.js contains the complete navigation logic for the entire site and beyond.");
    expect(prose.passed).toBe(false);
    expect(prose.failures.some((f) => f.includes("does not look like JavaScript"))).toBe(true);
  });
});

describe("validateBuilderFileBundle: the six realized files together", () => {
  it("§19 a complete bundle passes; any incomplete file is reported with its identity", () => {
    const bundle = {
      pages: { home: FULL_PAGE, about: FULL_PAGE, services: FULL_PAGE, contact: FULL_PAGE },
      sharedCss: TOKENS_CSS,
      sharedJs: CODE_JS,
    };
    expect(validateBuilderFileBundle(bundle, { blueprintMotionExists: true }).passed).toBe(true);

    const broken = { ...bundle, pages: { ...bundle.pages, services: "stub" } };
    const result = validateBuilderFileBundle(broken, { blueprintMotionExists: true });
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.startsWith("page-services realization is empty") || f.includes("page-services"))).toBe(true);
  });
});

describe("blueprintMotionExists: deterministic motion detection", () => {
  it("§20 motion idioms in the Blueprint enable the reduced-motion requirement", () => {
    expect(blueprintMotionExists({ sections: [{ motion: "parallax drift" }] })).toBe(true);
    expect(blueprintMotionExists({ sections: [{ name: "hover states" }] })).toBe(true);
    expect(blueprintMotionExists({ sections: [{ name: "static band" }] })).toBe(false);
  });
});
