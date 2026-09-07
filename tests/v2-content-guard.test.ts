import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  applyRegionPatch,
  diffPageContent,
  extractPageContentFingerprint,
  validateCssPatchScope,
} from "../src/domain/content-fingerprint";
import { validateAssembledSite, type AssembledSiteSource } from "../src/domain/site-generator";
import type { ImplementationContract } from "../src/domain/implementation-planner";
import type { VisualBlueprint } from "../src/domain/visual-blueprint";
import type { ImagePlan } from "../src/domain/site-generator";
import type { BusinessFacts } from "../src/domain/lifecycle-schema";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runBuildPipeline, type BuildPipelineDeps } from "../src/domain/build-pipeline";
import { getBuildStageArtifact } from "../src/domain/stage-artifacts";
import type { CraftCapture } from "../src/domain/craft-preflight";
import { createPipelineScripts, persistPipelineScreenshot, PIPELINE_SCRIPTS_BUSINESS } from "./helpers/pipeline-scripts";
import { FIXTURE_HOME_INITIAL_HTML, FIXTURE_HOME_REALIZATION_REPAIR_HTML } from "./_generated-craft-repair-fixture";

// Issue #67 — content-preserving geometry repair.
//
// Production Build 282f9b9d: the "geometry" realization repair regenerated
// the complete page and rewrote ~40% of its visible copy (including the
// "Who we serve" -> "Who We Serve" re-case that tripped the truth lint).
// The repair is now a typed PATCH whose application is deterministic and
// whose content freeze is enforced by a fingerprint MUTATION GUARD that
// runs BEFORE promotion, BEFORE the Business Truth lint and BEFORE the
// Craft confirmation attempt.

const BUSINESS = PIPELINE_SCRIPTS_BUSINESS;

// ── The frozen production pair ──────────────────────────────────────────────

const ALL_HOME_REGIONS = new Set([
  "region_hero",
  "region_intro_trust",
  "region_editorial_split",
  "region_services",
  "region_process",
  "region_mid_content",
  "region_testimonial_break",
  "region_closing_cta",
]);

describe("mutation guard vs the frozen production repair pair (issue #67 §30)", () => {
  it("the production realization repair would have been REPAIR_SCOPE_VIOLATION — stopped before the truth lint", () => {
    const before = extractPageContentFingerprint(FIXTURE_HOME_INITIAL_HTML);
    const after = extractPageContentFingerprint(FIXTURE_HOME_REALIZATION_REPAIR_HTML);
    // Even granting the repair authority over EVERY canonical region, the
    // whole-page content mutations are violations — structure authority was
    // never content authority.
    const violations = diffPageContent({ before, after, authorizedRegions: ALL_HOME_REGIONS });
    const rules = new Set(violations.map((violation) => violation.rule));
    expect(rules.has("TEXT_MUTATED")).toBe(true);
    expect(rules.has("TITLE_OR_DESCRIPTION_MUTATED")).toBe(true);
    expect(rules.has("HREF_MUTATED")).toBe(true);
    // The exact production kill-chain: the repair re-cased the section label.
    const whoWeServe = violations.find((violation) => violation.detail.includes("Who we serve"));
    expect(whoWeServe).toBeDefined();
    expect(whoWeServe!.detail).toContain("'Who we serve' -> 'Who We Serve'");
    expect(violations.every((violation) => violation.id === "REPAIR_SCOPE_VIOLATION")).toBe(true);
  });

  it("the guard is quiet on identical content and on legitimate scoped structure work", () => {
    const before = extractPageContentFingerprint(FIXTURE_HOME_INITIAL_HTML);
    expect(diffPageContent({ before, after: extractPageContentFingerprint(FIXTURE_HOME_INITIAL_HTML), authorizedRegions: new Set() })).toEqual([]);

    // A geometry repair that ONLY restructures an authorized region's markup
    // while freezing its exact text sequence must pass.
    const restructuredHero = FIXTURE_HOME_INITIAL_HTML.replace(
      /(<section[^>]*data-region="region_hero"[^>]*>)([\s\S]*?)(<\/section>)/i,
      (_match, open: string, inner: string, close: string) => `${open}<div class="geometry-wrap">${inner}</div>${close}`
    );
    const after = extractPageContentFingerprint(restructuredHero);
    expect(diffPageContent({ before, after, authorizedRegions: new Set(["region_hero"]) })).toEqual([]);
  });

  it("every frozen dimension fires its own rule", () => {
    const base = (body: string): string =>
      `<!DOCTYPE html><html lang="en"><head><title>T</title><meta name="description" content="d"></head><body><main>${body}</main></body></html>`;
    const before = extractPageContentFingerprint(
      base(`<section data-region="r1"><h1>H</h1><p>Copy.</p><a href="/a">A</a><img src="x" data-image-id="img-1" alt="i"></section><section data-region="r2"><p>Keep.</p></section><form><input name="email"></form>`)
    );
    const diffFor = (html: string) =>
      diffPageContent({ before, after: extractPageContentFingerprint(html), authorizedRegions: new Set(["r1"]) });
    const mutate = (body: string) => diffFor(base(body));

    // Text mutated inside an AUTHORIZED region is still a violation —
    // authorization is structural, never editorial.
    expect(mutate(`<section data-region="r1"><h1>H</h1><p>New copy.</p><a href="/a">A</a><img src="x" data-image-id="img-1" alt="i"></section>`).map((v) => v.rule)).toContain("TEXT_MUTATED");
    expect(mutate(`<section data-region="r1"><h1>h</h1><p>Copy.</p><a href="/a">A</a><img src="x" data-image-id="img-1" alt="i"></section>`).map((v) => v.rule)).toContain("TEXT_MUTATED"); // case is content
    expect(diffFor(base(`<section data-region="r1"><h1>H</h1><p>Copy.</p><a href="/b">A</a><img src="x" data-image-id="img-1" alt="i"></section><section data-region="r2"><p>Keep.</p></section><form><input name="email"></form>`)).map((v) => v.rule)).toContain("HREF_MUTATED");
    expect(diffFor(base(`<section data-region="r1"><h1>H</h1><p>Copy.</p><a href="/a">A</a><img src="x" data-image-id="img-2" alt="i"></section><section data-region="r2"><p>Keep.</p></section><form><input name="email"></form>`)).map((v) => v.rule)).toContain("IMAGE_IDENTITY_MUTATED");
    expect(diffFor(base(`<section data-region="r1"><h1>H</h1><p>Copy.</p><a href="/a">A</a><img src="x" data-image-id="img-1" alt="i"></section><section data-region="r2"><p>Keep.</p></section><form><input name="email"><input name="phone"></form>`)).map((v) => v.rule)).toContain("FORM_MUTATED");
    expect(diffFor(base(`<section data-region="r2"><p>Keep.</p></section><section data-region="r1"><h1>H</h1><p>Copy.</p><a href="/a">A</a><img src="x" data-image-id="img-1" alt="i"></section><form><input name="email"></form>`)).map((v) => v.rule)).toContain("REGION_ORDER_MUTATED");
    // A PASSING region may not change so much as one word.
    expect(diffFor(base(`<section data-region="r1"><h1>H</h1><p>Copy.</p><a href="/a">A</a><img src="x" data-image-id="img-1" alt="i"></section><section data-region="r2"><p>Kept.</p></section><form><input name="email"></form>`)).map((v) => v.rule)).toContain("PASSING_REGION_MUTATED");
    // Title/description are frozen even though they are not inside a region.
    const titleMutated = diffFor(
      base(`<section data-region="r1"><h1>H</h1><p>Copy.</p><a href="/a">A</a><img src="x" data-image-id="img-1" alt="i"></section><section data-region="r2"><p>Keep.</p></section><form><input name="email"></form>`)
        .replace("<title>T</title>", "<title>T2</title>")
        .replace('<meta name="description" content="d">', '<meta name="description" content="e">')
    );
    expect(titleMutated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "TITLE_OR_DESCRIPTION_MUTATED" }),
      ])
    );
  });
});

// ── CSS patch scoping (issue #67 §24) ───────────────────────────────────────

describe("cssPatch scope validation", () => {
  const regions = new Set(["r1", "r2"]);
  const images = new Set(["home-r1"]);

  it("accepts page-scoped selectors, including inside @media", () => {
    expect(validateCssPatchScope('[data-region="r1"] h1 { max-width: 900px; }', regions, images)).toEqual([]);
    expect(
      validateCssPatchScope(
        '@media (max-width: 768px) { [data-region="r2"] { min-height: auto; } }',
        regions,
        images
      )
    ).toEqual([]);
    expect(validateCssPatchScope('[data-image-id="home-r1"] { object-position: center; }', regions, images)).toEqual([]);
  });

  it("refuses global selectors, foreign ids, forbidden at-rules and rule-less patches", () => {
    const refusals = (css: string) => validateCssPatchScope(css, regions, images).join(" | ");
    expect(refusals("h1 { max-width: 900px; }")).toContain("not scoped to this page");
    expect(refusals('* { box-sizing: border-box; }')).toContain("not scoped to this page");
    expect(refusals('[data-region="r9"] { min-height: 1px; }')).toContain("outside the authorized mutation scope");
    expect(refusals('[data-image-id="other-slot"] { width: 100%; }')).toContain("outside the authorized mutation scope");
    expect(refusals('@import url("evil.css"); [data-region="r1"] { min-height: 1px; }')).toContain("forbidden at-rule");
    expect(refusals("@font-face { font-family: X; src: url(x.woff2); }")).toContain("forbidden at-rule");
    expect(refusals("/* only a comment */")).toContain("no parseable rules");
  });
});

// ── Region patch application (issue #67 §28) ────────────────────────────────

describe("deterministic region patch applier", () => {
  const page = `<main><section data-region="r1"><h1>H</h1><p>Copy.</p></section><section data-region="r2"><p>Keep.</p></section></main>`;

  it("replaces exactly one region's inner HTML and leaves the rest byte-identical", () => {
    const patched = applyRegionPatch(page, "r1", '<div class="grid"><h1>H</h1><p>Copy.</p></div>');
    expect(patched).toContain('<section data-region="r1"><div class="grid"><h1>H</h1><p>Copy.</p></div></section>');
    expect(patched).toContain('<section data-region="r2"><p>Keep.</p></section>');
    // Deterministic: same inputs, same bytes.
    expect(patched).toBe(applyRegionPatch(page, "r1", '<div class="grid"><h1>H</h1><p>Copy.</p></div>'));
  });

  it("refuses scripts, inline styles, region redefinition and ambiguous targets", () => {
    expect(() => applyRegionPatch(page, "r1", "<p>x</p><script>steal()</script>")).toThrow(/<script>/);
    expect(() => applyRegionPatch(page, "r1", "<style>p{}</style>")).toThrow(/inline <style>/);
    expect(() => applyRegionPatch(page, "r1", '<section data-region="r1">nested</section>')).toThrow(/data-region/);
    expect(() => applyRegionPatch(page, "rX", "<p>missing</p>")).toThrow(/matched 0 sections/);
  });

  it("refuses script-capable smuggles the fingerprint cannot see: event handlers, javascript: URIs, embeds", () => {
    expect(() => applyRegionPatch(page, "r1", '<img src="x" onerror="alert(1)">')).toThrow(/inline event handler/);
    expect(() => applyRegionPatch(page, "r1", '<a href="javascript:alert(1)">A</a>')).toThrow(/javascript: URI/);
    expect(() => applyRegionPatch(page, "r1", '<iframe src="https://evil.example"></iframe>')).toThrow(/forbidden element/);
    expect(() => applyRegionPatch(page, "r1", '<object data="x"></object>')).toThrow(/forbidden element/);
    expect(() => applyRegionPatch(page, "r1", '<embed src="x">')).toThrow(/forbidden element/);
  });
});

// ── §32 truth-lint regression matrix ────────────────────────────────────────

const FACTS_NO_PARTNERS: BusinessFacts = {
  businessName: "RankForge Kenya",
  contactEmail: "hello@rankforge.example",
  businessType: "SEO agency",
  businessDescription: "A Nairobi-based SEO and organic-growth agency.",
  city: "Nairobi",
  country: "Kenya",
  extraInformation: "Services: SEO Strategy, Technical SEO, Local SEO.",
};

const MATRIX_PAGE = (main: string): string =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RankForge Kenya</title><link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head><body><header><nav aria-label="Primary"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header><main>${main}</main><footer><p>RankForge Kenya</p></footer></body></html>`;

function matrixContract(): ImplementationContract {
  return {
    version: "1",
    blueprintVisualThesis: "t",
    blueprintSignatureTraitIds: ["bp-trait"],
    blueprintFirstViewportRegionIds: ["hero"],
    pages: [
      { id: "home", path: "/", regions: [{ id: "hero", realization: "section" }] },
      { id: "about", path: "/about", regions: [] },
      { id: "services", path: "/services", regions: [] },
      { id: "contact", path: "/contact", regions: [] },
    ],
    files: { sharedCss: "site.css", sharedJs: "site.js", pageFiles: { home: "index.html", about: "about.html", services: "services.html", contact: "contact.html" } },
    tokens: {},
    components: [],
    responsiveStrategy: {},
    imageSlotStrategy: {},
    formContract: {
      formServiceEndpoint: "https://forms.wazibiz.example/api/v2/forms/submit",
      siteFormId: "site:test-site",
      fields: ["name", "email", "message"],
      turnstile: false,
    },
    approvedDependencies: [],
    blockers: [],
  };
}

function truthVerdict(homeHtml: string) {
  const source: AssembledSiteSource = {
    pages: { home: homeHtml, about: "", services: "", contact: "" },
    sharedCss: '[data-region="hero"] { min-height: 50vh; }',
    sharedJs: "(function(){})();",
  };
  return validateAssembledSite(source, { contract: matrixContract(), slots: [], facts: FACTS_NO_PARTNERS });
}

const truthFindings = (findings: Array<{ id: string; detail: string }>) =>
  findings.filter((finding) => finding.id === "FABRICATED_TRUST_ENTITY");

describe("§32 truth-lint regression matrix (issue #67 §31 — #53 eyebrow/kicker completion)", () => {
  const TRUST_BAND = (inner: string): string =>
    `<section class="credibility-band" data-region="hero" aria-label="Trusted by">${inner}</section>`;

  it("PASSES 'Who We Serve' as semantic presentation: <p class=\"eyebrow\">", () => {
    const verdict = truthVerdict(MATRIX_PAGE(TRUST_BAND(`<p class="eyebrow">Who We Serve</p><p>Search growth built around commercial outcomes.</p>`)));
    expect(truthFindings(verdict.findings)).toEqual([]);
  });

  it("PASSES kicker presentation: <p class=\"kicker\">Working with RankForge</p>", () => {
    const verdict = truthVerdict(MATRIX_PAGE(TRUST_BAND(`<p class="kicker">Working with RankForge</p>`)));
    expect(truthFindings(verdict.findings)).toEqual([]);
  });

  it("PASSES <h2>Who We Serve</h2> (the #53 heading exemption is unchanged)", () => {
    const verdict = truthVerdict(MATRIX_PAGE(TRUST_BAND(`<h2>Who We Serve</h2>`)));
    expect(truthFindings(verdict.findings)).toEqual([]);
  });

  it("FAILS a third-party name wearing the eyebrow class — the fix classifies presentation, it does not whitelist the string", () => {
    const verdict = truthVerdict(MATRIX_PAGE(TRUST_BAND(`<p class="eyebrow">Zynthara Labs</p>`)));
    const findings = truthFindings(verdict.findings);
    expect(findings.some((finding) => finding.detail.includes("'Zynthara Labs'"))).toBe(true);
  });

  it("FAILS an invented client logo name and a partner alt identity in the trust band", () => {
    const verdict = truthVerdict(
      MATRIX_PAGE(TRUST_BAND(`<ul class="logo-wall"><li>Zynthara Labs</li></ul><img src="p.png" alt="Acme Kenya">`))
    );
    const details = truthFindings(verdict.findings).map((finding) => finding.detail).join(" ");
    expect(details).toContain("'Zynthara Labs'");
    expect(details).toContain("'Acme Kenya'");
  });

  it("FAILS award/press entity claims even as trust-band headings", () => {
    const verdict = truthVerdict(MATRIX_PAGE(TRUST_BAND(`<h3>Digital Africa Awards</h3><h4>Forbes Kenya</h4>`)));
    const details = truthFindings(verdict.findings).map((finding) => finding.detail).join(" ");
    expect(details).toContain("'Digital Africa Awards'");
    expect(details).toContain("'Forbes Kenya'");
  });
});

// ── Pipeline integration (issue #67 §33-§35) ────────────────────────────────

const env = providedEnv as unknown as Env;

async function newPipelineContext(): Promise<{ siteGenerationId: string; buildId: string }> {
  const screenshotKey = `references/uploads/cg-${Math.random().toString(36).slice(2)}.png`;
  await persistPipelineScreenshot(env, screenshotKey, { decodable: true });
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
      reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { siteGenerationId: started.siteGenerationId, buildId: created.buildId };
}

// The failed candidate shape: the r1 band collapses to 180px against its
// 720px measured target and the headline is pushed off-canvas (x+w > 1440).
function failingCapture(): CraftCapture {
  return {
    layout: {
      finalUrl: "https://preview.example/",
      title: BUSINESS,
      lang: "en",
      description: BUSINESS,
      viewportMeta: "width=device-width, initial-scale=1",
      sections: [
        { order: 0, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 0, width: 1440, height: 180 }, evidenceId: null, dataRegion: "r1" },
        { order: 1, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 180, width: 1440, height: 880 }, evidenceId: null, dataRegion: "r2" },
        { order: 2, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 1060, width: 1440, height: 800 }, evidenceId: null, dataRegion: "r3" },
        { order: 3, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 1860, width: 1440, height: 640 }, evidenceId: null, dataRegion: "r4" },
      ],
      typography: [],
      colors: { background: "rgb(250,247,242)", text: "rgb(26,26,26)", accents: [] },
      nav: [],
      images: [],
      spacing: null,
      contrastSamples: [],
      consentDetected: false,
      headline: { text: BUSINESS, fontFamily: "system-ui", fontSize: "32px", bounds: { x: 1100, y: 20, width: 700, height: 90 } },
      viewportHeight: 900,
      viewportWidth: 1440,
    },
    fullPageScreenshot: new TextEncoder().encode("not-a-png-attempt-1"),
    viewportWidth: 1440,
    viewportHeight: 900,
  };
}

describe("content-preserving realization repair — pipeline integration (issue #67)", () => {
  it("a scoped cssPatch-only repair freezes the page bytes, composes a new CSS artifact, updates the manifest, and confirms via Craft attempt 2", async () => {
    const context = await newPipelineContext();
    const base = createPipelineScripts({ visionReference: true });
    const captured = { repairPrompts: [] as string[] };
    let craftCalls = 0;
    const generate: RawAiGenerate = async (system, user) => {
      if (user.includes("Repair the GEOMETRY of the rendered page")) {
        captured.repairPrompts.push(user);
        return base.generate!(system, user);
      }
      return base.generate!(system, user);
    };
    const scripted: BuildPipelineDeps = {
      ...base,
      generate,
      visionGenerate: generate,
      craftCapture: async () => {
        craftCalls += 1;
        return craftCalls === 1 ? failingCapture() : base.craftCapture();
      },
    };

    const outcome = await runBuildPipeline(env, { siteGenerationId: context.siteGenerationId, buildId: context.buildId, deps: scripted });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const version = await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1")
      .bind(outcome.buildId).first<{ id: string }>();
    const buildVersionId = version!.id;

    // The patch and the applied page are frozen under their immutable subkeys.
    const patchArtifact = await getBuildStageArtifact<{ targetPageId: string; cssPatch: string; regionPatches: unknown[] }>(
      env, buildVersionId, "generated_page", "home.realization-repair-1.patch"
    );
    expect(patchArtifact).not.toBeNull();
    expect(patchArtifact!.schemaVersion).toBe("realization-repair-patch/1");
    expect(patchArtifact!.value.targetPageId).toBe("home");
    expect(patchArtifact!.value.regionPatches).toEqual([]);

    const appliedPage = await getBuildStageArtifact<{ html: string }>(env, buildVersionId, "generated_page", "home.realization-repair-1");
    const basePage = await getBuildStageArtifact<{ html: string }>(env, buildVersionId, "generated_page", "home");
    expect(appliedPage).not.toBeNull();
    // THE content-freeze proof: a cssPatch-only repair leaves the page HTML
    // byte-identical — zero words, hrefs, image ids or form fields touched.
    expect(appliedPage!.value.html).toBe(basePage!.value.html);

    // The CSS patch is a NEW layered artifact over the frozen stylesheet —
    // never an inline <style>, never an edit of the frozen CSS.
    const frozenCss = await getBuildStageArtifact<{ css: string }>(env, buildVersionId, "generated_shared_source", "site.css");
    const composedCss = await getBuildStageArtifact<{ css: string }>(env, buildVersionId, "generated_shared_source", "site.css.realization-repair-1");
    expect(composedCss).not.toBeNull();
    expect(composedCss!.value.css.startsWith(frozenCss!.value.css)).toBe(true);
    expect(composedCss!.value.css).toContain("/* realization-repair-1 — scoped geometry patch (issue #67) */");
    expect(composedCss!.value.css).toContain('[data-region="r1"] h1 { max-width: 900px; }');
    expect(frozenCss!.value.css).not.toContain("max-width: 900px");
    expect(appliedPage!.value.html).not.toContain("<style");

    // The candidate manifest points home AND the shared CSS at the repaired
    // artifacts; the other pages keep their exact pointers.
    const manifest = await getBuildStageArtifact<{ lineage: string; pages: Record<string, { subkey: string }>; sharedCss: { subkey: string } }>(
      env, buildVersionId, "candidate_manifest", "realization-repair-1"
    );
    expect(manifest).not.toBeNull();
    expect(manifest!.value.pages.home.subkey).toBe("home.realization-repair-1");
    expect(manifest!.value.pages.about.subkey).toBe("about");
    expect(manifest!.value.sharedCss.subkey).toBe("site.css.realization-repair-1");
    expect(manifest!.value.lineage).toContain("realization-repair/home");

    // The repair prompt carried the previous candidate, the frozen CSS, the
    // mutation scope, honest crop labels and the anti-Goodharting rule.
    expect(captured.repairPrompts).toHaveLength(1);
    const prompt = captured.repairPrompts[0];
    expect(prompt).toContain('Repair the GEOMETRY of the rendered page \'home\'');
    expect(prompt).toContain('<h1>Pipeline Wiring Smoke Business</h1>');
    expect(prompt).toContain('data-region="r1"');
    expect(prompt).toContain('[data-region="r1"] { min-height: 92vh');
    expect(prompt).toContain("Authorized regions (regionPatches allowed):");
    expect(prompt).toContain("Passing regions (MUST remain byte-identical):");
    expect(prompt).toContain("REFERENCE slice(s) from the frozen Reference Screenshot");
    expect(prompt).toContain("min-height equal to a measured target is not a repair");

    // The craft confirmation ran on the repaired candidate; the QA repair
    // budget was never consumed by the realization repair.
    const batches = await env.DB.prepare("SELECT COUNT(*) AS n FROM repair_batches WHERE build_id = ?")
      .bind(outcome.buildId).first<{ n: number }>();
    expect(batches!.n).toBe(0);
    const event = await env.DB.prepare("SELECT detail FROM build_workflow_events WHERE build_id = ? AND stage = 'realization_repair' ORDER BY rowid DESC LIMIT 1")
      .bind(outcome.buildId).first<{ detail: string }>();
    expect(event!.detail).toContain("Content-preserving realization repair applied to home");
  });

  it("a patch that rewrites copy is a REPAIR_SCOPE_VIOLATION — stopped before Craft attempt 2, before promotion, with nothing stored", async () => {
    const context = await newPipelineContext();
    const base = createPipelineScripts({ visionReference: true });
    const captured = { repairPrompts: [] as string[] };
    let craftCalls = 0;
    const generate: RawAiGenerate = async (system, user) => {
      if (user.includes("Repair the GEOMETRY of the rendered page")) {
        captured.repairPrompts.push(user);
        return {
          content: JSON.stringify({
            targetPageId: "home",
            reasoning: "rewrites the hero copy",
            cssPatch: '[data-region="r1"] { min-height: 80vh; }',
            regionPatches: [
              { regionId: "r1", html: `<h1>${BUSINESS}</h1><p>Compelling invented marketing copy that was never on the page.</p>` },
            ],
          }),
          provider: "test",
          model: "test-model-g",
        };
      }
      return base.generate!(system, user);
    };
    const scripted: BuildPipelineDeps = {
      ...base,
      generate,
      visionGenerate: generate,
      craftCapture: async () => {
        craftCalls += 1;
        return craftCalls === 1 ? failingCapture() : base.craftCapture();
      },
    };

    const outcome = await runBuildPipeline(env, { siteGenerationId: context.siteGenerationId, buildId: context.buildId, deps: scripted });
    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    // The mutation guard runs BEFORE the Craft confirmation — no second
    // capture, no promotion of mutated content.
    expect(craftCalls).toBe(1);
    const event = await env.DB.prepare("SELECT detail FROM build_workflow_events WHERE build_id = ? AND stage = 'realization_repair' ORDER BY rowid DESC LIMIT 1")
      .bind(outcome.buildId).first<{ detail: string }>();
    expect(event!.detail).toContain("REPAIR_SCOPE_VIOLATION");
    expect(event!.detail).toContain("TEXT_MUTATED");
    // Nothing was persisted: no patch, no applied page, no composed CSS.
    const artifacts = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM build_stage_artifacts WHERE build_id = ? AND (subkey LIKE 'home.realization-repair%' OR subkey = 'site.css.realization-repair-1')"
    ).bind(outcome.buildId).first<{ n: number }>();
    expect(artifacts!.n).toBe(0);
  });

  it("a declared-insufficient patch escalates to human review instead of fabricating content", async () => {
    const context = await newPipelineContext();
    const base = createPipelineScripts({ visionReference: true });
    let craftCalls = 0;
    const generate: RawAiGenerate = async (system, user) => {
      if (user.includes("Repair the GEOMETRY of the rendered page")) {
        return {
          content: JSON.stringify({
            targetPageId: "home",
            insufficient: true,
            insufficientReason: "the frozen content mass cannot fill the measured 720px band without fabricating sections",
            cssPatch: '[data-region="r1"] { min-height: 80vh; }',
            regionPatches: [],
          }),
          provider: "test",
          model: "test-model-g",
        };
      }
      return base.generate!(system, user);
    };
    const scripted: BuildPipelineDeps = {
      ...base,
      generate,
      visionGenerate: generate,
      craftCapture: async () => {
        craftCalls += 1;
        return craftCalls === 1 ? failingCapture() : base.craftCapture();
      },
    };

    const outcome = await runBuildPipeline(env, { siteGenerationId: context.siteGenerationId, buildId: context.buildId, deps: scripted });
    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(craftCalls).toBe(1);
    const event = await env.DB.prepare("SELECT detail FROM build_workflow_events WHERE build_id = ? AND stage = 'realization_repair' ORDER BY rowid DESC LIMIT 1")
      .bind(outcome.buildId).first<{ detail: string }>();
    expect(event!.detail).toContain("REALIZATION_REPAIR_INSUFFICIENT");
    const artifacts = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM build_stage_artifacts WHERE build_id = ? AND subkey LIKE 'home.realization-repair%'"
    ).bind(outcome.buildId).first<{ n: number }>();
    expect(artifacts!.n).toBe(0);
  });

  it("a workflow retry replays the frozen patch deterministically — no model call, identical applied page, manifest still correct", async () => {
    const context = await newPipelineContext();
    const base = createPipelineScripts({ visionReference: true });
    let craftCalls = 0;
    const scripted: BuildPipelineDeps = {
      ...base,
      craftCapture: async () => {
        craftCalls += 1;
        return craftCalls === 1 ? failingCapture() : base.craftCapture();
      },
    };
    const outcome = await runBuildPipeline(env, { siteGenerationId: context.siteGenerationId, buildId: context.buildId, deps: scripted });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const buildRow = await env.DB.prepare("SELECT site_generation_id FROM builds WHERE id = ?").bind(outcome.buildId).first<{ site_generation_id: string }>();
    const version = await env.DB.prepare("SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1")
      .bind(outcome.buildId).first<{ id: string; version_number: number }>();
    const blueprint = (await getBuildStageArtifact<VisualBlueprint>(env, version!.id, "visual_blueprint"))!.value;
    const contract = (await getBuildStageArtifact<ImplementationContract>(env, version!.id, "implementation_contract"))!.value;
    const imagePlan = (await getBuildStageArtifact<ImagePlan>(env, version!.id, "image_plan"))!.value;

    // Engine-retry replay: the AI seam is a tripwire — the frozen patch must
    // be re-applied deterministically without any model involvement.
    const tripwire: RawAiGenerate = async () => {
      throw new Error("REPLAY MUST NOT CALL THE MODEL");
    };
    const replayed = await import("../src/domain/site-generator").then((m) =>
      m.regeneratePagesForRealization(env, {
        siteGenerationId: buildRow!.site_generation_id,
        siteId: "",
        buildId: outcome.buildId,
        buildVersionId: version!.id,
        buildVersionNumber: version!.version_number,
        blueprint,
        blueprintR2Key: "builds/x/v1/ai/blueprint.json",
        contract,
        contractR2Key: "builds/x/v1/ai/contract.json",
        imagePlan,
        affected: ["home"],
        findingDirectives: "replay",
        authorizedRegions: ["r1"],
        passingRegions: ["r2", "r3", "r4"],
        cropDescriptors: "",
        generate: tripwire,
      })
    );

    const storedPage = await getBuildStageArtifact<{ html: string }>(env, version!.id, "generated_page", "home.realization-repair-1");
    expect(replayed.pages.home).toBe(storedPage!.value.html);
    expect(replayed.regenerated).toEqual(["home"]);
    expect(replayed.sharedCss).toContain('[data-region="r1"] h1 { max-width: 900px; }');
    expect(replayed.unaffectedHashes).toHaveLength(3);
    for (const hash of replayed.unaffectedHashes) {
      expect(hash.beforeSha256).toBe(hash.afterSha256);
    }
    const manifest = await getBuildStageArtifact<{ pages: Record<string, { subkey: string }>; sharedCss: { subkey: string } }>(
      env, version!.id, "candidate_manifest", "realization-repair-1"
    );
    expect(manifest!.value.pages.home.subkey).toBe("home.realization-repair-1");
    expect(manifest!.value.sharedCss.subkey).toBe("site.css.realization-repair-1");
  });
});
