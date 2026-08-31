import { describe, expect, it, vi } from "vitest";
import { renderBlueprintSite } from "../src/render/site-renderer";
import { buildRenderContent } from "../src/render/content";
import { designBlueprintToTokens } from "../src/render/blueprint-tokens";
import { interactionBlueprintToCss, interactionBlueprintToJs } from "../src/render/blueprint-interactions";
import { buildPrimitiveCss } from "../src/render/primitive-styles";
import { KieImageProvider } from "../src/lib/kie";
import { sanitizeColor, sanitizeFontName, sanitizeLength, sanitizeUrl, sanitizeIdentifier, text } from "../src/render/sanitize";
import { renderButton, renderCard, renderAccordion, renderContactForm, renderNav } from "../src/render/primitives";
import { validateBundle } from "../src/lib/bundle-validation";
import { parseDesignBlueprint, parseInteractionBlueprint } from "../src/lib/blueprint-schema-v2";
import type { StyleTokens } from "../src/types";
import type { Env } from "../src/env.d";
import { makeDesign, makeInteraction, makeIntake } from "./helpers/blueprint-fixtures";

function renderBundle() {
  const intake = makeIntake();
  const content = buildRenderContent(intake);
  return renderBlueprintSite({
    design: makeDesign(),
    interaction: makeInteraction(),
    content,
    siteUrl: "https://acme.example",
  });
}

const noneTokens: StyleTokens = { cssVars: {}, googleFonts: [], framework: "none" };

describe("blueprint renderer — sanitization layer", () => {
  it("accepts valid hex and rgb()/hsl() colors", () => {
    expect(sanitizeColor("#fff", "#000")).toBe("#fff");
    expect(sanitizeColor("#1a2b3c", "#000")).toBe("#1a2b3c");
    expect(sanitizeColor("rgb(1, 2, 3)", "#000")).toBe("rgb(1, 2, 3)");
    expect(sanitizeColor("hsla(120, 50%, 50%, 0.5)", "#000")).toBe("hsla(120, 50%, 50%, 0.5)");
  });

  it("rejects colors that could break out of a CSS value", () => {
    expect(sanitizeColor("red; } body { background: black", "#fff")).toBe("#fff");
    expect(sanitizeColor("#fff; --x: url(javascript:alert(1))", "#fff")).toBe("#fff");
    expect(sanitizeColor("inherit', evil", "#fff")).toBe("#fff");
    expect(sanitizeColor(undefined, "#fff")).toBe("#fff");
  });

  it("strips dangerous characters from font names", () => {
    expect(sanitizeFontName("Inter", "sans-serif")).toBe("Inter");
    expect(sanitizeFontName("Playfair Display", "sans-serif")).toBe("Playfair Display");
    expect(sanitizeFontName("Inter'; } body { --x", "sans-serif")).toBe("sans-serif");
    expect(sanitizeFontName("Georgia\"", "sans-serif")).toBe("sans-serif");
  });

  it("only accepts clean lengths", () => {
    expect(sanitizeLength("1rem", "0")).toBe("1rem");
    expect(sanitizeLength("5rem", "0")).toBe("5rem");
    expect(sanitizeLength("1rem; } body{}", "0")).toBe("0");
    expect(sanitizeLength("calc(100% - 1px)", "0")).toBe("0");
  });

  it("restricts urls to safe schemes", () => {
    expect(sanitizeUrl("https://example.com", "#")).toBe("https://example.com");
    expect(sanitizeUrl("/about", "#")).toBe("/about");
    expect(sanitizeUrl("javascript:alert(1)", "#")).toBe("#");
    expect(sanitizeUrl("data:text/html,<script>", "#")).toBe("#");
    expect(sanitizeUrl("//evil.example/path", "#")).toBe("#");
  });

  it("restricts identifiers to slug-safe characters", () => {
    expect(sanitizeIdentifier("hero", "x")).toBe("hero");
    expect(sanitizeIdentifier("Hero Section!", "x")).toBe("x");
    expect(sanitizeIdentifier("a]left", "x")).toBe("x");
  });

  it("html-escapes text so model content cannot inject markup", () => {
    expect(text("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(text("a\"b")).toBe("a&quot;b");
  });
});

describe("blueprint renderer — token mapping", () => {
  it("maps color roles to semantic css custom properties", () => {
    const tokens = designBlueprintToTokens(makeDesign());
    expect(tokens.cssVars["--background"]).toBe("#ffffff");
    expect(tokens.cssVars["--foreground"]).toBe("#111111");
    expect(tokens.cssVars["--primary"]).toBe("#2563eb");
    expect(tokens.cssVars["--accent"]).toBe("#0ea5e9");
    expect(tokens.cssVars["--surface"]).toBe("#f1f5f9");
    expect(tokens.cssVars["--border"]).toBe("#e2e8f0");
  });

  it("derives readable foreground tokens via luminance", () => {
    const tokens = designBlueprintToTokens(makeDesign());
    expect(tokens.cssVars["--primary-foreground"]).toBe("#ffffff");
    const dark = designBlueprintToTokens(makeDesign({
      colors: { roles: [{ role: "primary", value: "#f8fafc", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 }] },
    }));
    expect(dark.cssVars["--primary-foreground"]).toBe("#000000");
  });

  it("uses fallbacks for malformed model values", () => {
    const tokens = designBlueprintToTokens(makeDesign({
      colors: { roles: [{ role: "background", value: "red; body{}", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 }] },
      typography: {
        body: { element: "body", fontFamily: "Inter'; evil", fontSize: "calc(bad)", fontWeight: "wat", lineHeight: "x", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 },
        headings: [], scale: "not-a-number",
      },
    }));
    expect(tokens.cssVars["--background"]).toBe("#ffffff");
    expect(tokens.cssVars["--font-body"]).toContain("system-ui");
    expect(tokens.cssVars["--font-body-weight"]).toBe("400");
    expect(tokens.cssVars["--type-scale"]).toBe("1.25");
  });

  it("corrects unreadable semantic text colors while retaining palette backgrounds", () => {
    const tokens = designBlueprintToTokens(makeDesign({
      colors: { roles: [
        { role: "background", value: "#ffffff", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 },
        { role: "text", value: "#fefefe", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 },
        { role: "primary", value: "hsl(0, 0%, 90%)", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 },
      ] },
    }));
    expect(tokens.cssVars["--foreground"]).toBe("#000000");
    expect(tokens.cssVars["--primary-text"]).toBe("#000000");
    expect(tokens.cssVars["--primary"]).toBe("hsl(0, 0%, 90%)");
  });

  it("corrects borderline normal-text contrast with a safety margin", () => {
    const tokens = designBlueprintToTokens(makeDesign({
      colors: { roles: [
        { role: "background", value: "#ffffff", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 },
        { role: "primary", value: "#8B7355", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 },
      ] },
    }));
    expect(tokens.cssVars["--primary-text"]).toBe("#000000");
  });

  it("never adds a framework dependency", () => {
    const tokens = designBlueprintToTokens(makeDesign());
    expect(tokens.framework).toBe("none");
    expect(tokens.googleFonts).not.toContain(expect.stringMatching(/tailwind|bootstrap/i));
  });
});

describe("blueprint renderer — interaction mapping", () => {
  it("gates all animated css behind prefers-reduced-motion: no-preference", () => {
    const { css } = interactionBlueprintToCss(makeInteraction());
    expect(css).toContain("prefers-reduced-motion: no-preference");
    const motionBlocks = css.split("@media (prefers-reduced-motion: no-preference)").length - 1;
    const transitionCount = (css.match(/transition:/g) || []).length;
    expect(motionBlocks).toBeGreaterThan(0);
    expect(transitionCount).toBeGreaterThan(0);
  });

  it("never interpolates reduced-motion strategy text into css", () => {
    const payload = "*/ body { display:none } /*";
    const { css } = interactionBlueprintToCss(makeInteraction({ reducedMotionStrategy: payload }));
    expect(css).not.toContain(payload);
    expect(css).not.toContain("body { display:none }");
  });

  it("does not include scroll-reveal css when the kind is absent", () => {
    const { css, enabledKinds } = interactionBlueprintToCss(makeInteraction({
      interactions: [{ trigger: "hover", target: "buttons", selector: ".btn", property: "transform", duration: "0.2s", easing: "ease", delay: "0s", hover: "lift", focus: "outline", active: "press", scrollBehavior: "none", reducedMotionBehavior: "none", observed: true, evidenceIds: ["e1"], evidence: { source: "interaction", artifactKey: "a" }, confidence: 0.8 }],
    }));
    expect(enabledKinds.has("scroll-reveal")).toBe(false);
    expect(css).not.toContain("[data-reveal]");
  });

  it("js exposes reveal + accordion + nav behavior, and respects reduced motion", () => {
    const { css } = interactionBlueprintToCss(makeInteraction());
    const js = interactionBlueprintToJs(new Set(["scroll-reveal", "toggle", "sticky"]));
    expect(css).toContain("html.motion-ready [data-reveal]");
    expect(js).toContain("classList.add('motion-ready')");
    expect(js).toContain("IntersectionObserver");
    expect(js).toContain("prefers-reduced-motion: reduce");
    expect(js).toContain("accordion__trigger");
    expect(js).toContain("nav__toggle");
  });

  it("restores surface text colors for cards nested in colored sections", () => {
    const css = buildPrimitiveCss();
    expect(css).toContain(".section--inverted .card p");
    expect(css).toContain(".section--accent .card p");
    expect(css).toContain("color: var(--surface-foreground)");
  });

  it("preserves safe one-to-four value section padding", () => {
    const tokens = designBlueprintToTokens(makeDesign({
      spacing: { sectionPadding: "4rem 2rem", rhythm: "consistent", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.8 },
    }));
    expect(tokens.cssVars["--space-section"]).toBe("4rem 2rem");
  });

  it("keeps required accordion behavior when no toggle was observed", () => {
    const js = interactionBlueprintToJs(new Set(["hover"]));
    expect(js).toContain("accordion__trigger");
  });
});

describe("blueprint renderer — image prompts", () => {
  it("requests editorial photography and explicitly rejects interface mockups", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: { taskId: "task-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const provider = new KieImageProvider({
        KIE_API_URL: "https://kie.example",
        KIE_API_KEY: "secret",
        KIE_MODEL: "model",
        PUBLIC_APP_URL: "https://factory.example",
      } as Env);
      await provider.createTask({ slot: "hero", page: "/", aspectRatio: "16:9", prompt: "Students walking to school", altText: "Students", outputFilename: "hero.webp" });
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { input: { prompt: string } };
      expect(body.input.prompt).toContain("editorial photograph");
      expect(body.input.prompt).toContain("no website");
      expect(body.input.prompt).toContain("no website, browser, application interface");
      expect(body.input.prompt).toContain("Do not add text");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("blueprint renderer — accepted artifact parsing", () => {
  it("accepts schema-valid persisted blueprints", () => {
    expect(parseDesignBlueprint(makeDesign()).schemaVersion).toBe(1);
    expect(parseInteractionBlueprint(makeInteraction()).schemaVersion).toBe(1);
  });

  it("rejects corrupted persisted blueprints before rendering", () => {
    expect(() => parseDesignBlueprint({ schemaVersion: 1 })).toThrow("Invalid accepted design blueprint");
    expect(() => parseInteractionBlueprint({ schemaVersion: 1 })).toThrow("Invalid accepted interaction blueprint");
  });
});

describe("blueprint renderer — primitives", () => {
  it("renders a labelled link button and escapes content", () => {
    const html = renderButton({ label: '<img src=x onerror=alert(1)>', href: "/contact" });
    expect(html).toContain("btn btn--primary");
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/\sonerror\s*="/i);
  });

  it("renders nothing for an empty button label", () => {
    expect(renderButton({ label: "", href: "/x" })).toBe("");
  });

  it("renders a card with semantic heading", () => {
    const html = renderCard({ title: "Design", body: "We design things." });
    expect(html).toContain("<article");
    expect(html).toContain('<h3 class="card__title">Design</h3>');
  });

  it("renders an accessible accordion (aria-expanded, controls, region)", () => {
    const html = renderAccordion([{ summary: "Q?", detail: "A." }]);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls=");
    expect(html).toContain('role="region"');
    expect(html).toContain("hidden");
  });

  it("renders a labelled, accessible contact form", () => {
    const html = renderContactForm({ action: "/api/contact", fields: [{ name: "email", label: "Email", type: "email", required: true, autocomplete: "email" }] });
    expect(html).toContain('action="/api/contact"');
    expect(html).toContain('for="field-email"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-live="polite"');
  });

  it("renders a nav with a toggle and aria-current on the active link", () => {
    const html = renderNav({ brand: "Acme", items: [{ label: "Home", href: "/" }, { label: "About", href: "/about" }], currentSlug: "/about" });
    expect(html).toContain('role="banner"');
    expect(html).toContain('aria-label="Toggle navigation menu"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('id="nav-menu"');
  });
});

describe("blueprint renderer — site bundle", () => {
  it("emits exactly the four required pages plus assets", () => {
    const { files } = renderBundle();
    expect([...files.keys()].sort()).toEqual(
      ["about/index.html", "assets/app.js", "assets/styles.css", "contact/index.html", "index.html", "robots.txt", "services/index.html", "sitemap.xml"].sort()
    );
  });

  it("renders enough sections per page and meets the minimum structure", () => {
    const { files } = renderBundle();
    const indexSections = (files.get("index.html")!.match(/<section\b/gi) || []).length;
    const servicesSections = (files.get("services/index.html")!.match(/<section\b/gi) || []).length;
    const aboutSections = (files.get("about/index.html")!.match(/<section\b/gi) || []).length;
    const contactSections = (files.get("contact/index.html")!.match(/<section\b/gi) || []).length;
    expect(indexSections).toBeGreaterThanOrEqual(5);
    expect(servicesSections).toBeGreaterThanOrEqual(5);
    expect(aboutSections).toBeGreaterThanOrEqual(3);
    expect(contactSections).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic: identical inputs yield identical output", () => {
    const a = renderBundle();
    const b = renderBundle();
    expect(a.files.get("index.html")).toBe(b.files.get("index.html"));
    expect(a.files.get("assets/styles.css")).toBe(b.files.get("assets/styles.css"));
  });

  it("passes the bundle-safety validator (no executable markup, all assets present)", () => {
    const { files } = renderBundle();
    const result = validateBundle(files, noneTokens);
    expect(result.issues.filter((i) => i.severity === "critical" || i.severity === "major")).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("renders supported homepage sections in blueprint order", () => {
    const base = makeDesign();
    const evidence = { source: "screenshot" as const, artifactKey: "a" };
    const section = (id: string, type: string, order: number) => ({ id, type, role: null, order, composition: "default", evidenceIds: ["e1"], evidence, confidence: 0.9 });
    const design = makeDesign({
      layout: {
        ...base.layout,
        sections: [section("about", "about", 3), section("cta", "cta", 2), section("hero", "hero", 0), section("features", "features", 4), section("stats", "stats", 1)],
      },
    });
    const content = buildRenderContent(makeIntake());
    const { files } = renderBlueprintSite({ design, interaction: makeInteraction(), content, siteUrl: "https://acme.example" });
    const types = [...files.get("index.html")!.matchAll(/data-section="([^"]+)"/g)].map((match) => match[1]);
    expect(types.slice(0, 5)).toEqual(["hero", "stats", "cta", "about", "features"]);
  });

  it("omits unsupported blueprint sections and fills required structure with grounded overviews", () => {
    const base = makeDesign();
    const evidence = { source: "screenshot" as const, artifactKey: "a" };
    const design = makeDesign({
      layout: {
        ...base.layout,
        sections: [
          { id: "hero", type: "hero", role: null, order: 0, composition: "default", evidenceIds: ["e1"], evidence, confidence: 0.9 },
          { id: "unsupported", type: "testimonials", role: null, order: 1, composition: "carousel", evidenceIds: ["e1"], evidence, confidence: 0.9 },
        ],
      },
    });
    const content = buildRenderContent(makeIntake());
    const { files } = renderBlueprintSite({ design, interaction: makeInteraction(), content, siteUrl: "https://acme.example" });
    const home = files.get("index.html")!;
    expect(home).not.toContain('data-section="testimonials"');
    expect((home.match(/data-section="overview"/g) || []).length).toBe(2);
    expect((home.match(/<img\b/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((home.match(/<section\b/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  it("renders working contact links and the bundled logo path", () => {
    const content = buildRenderContent(makeIntake({ logoUrl: "https://uploads.example/logo.png" }));
    const { files } = renderBlueprintSite({ design: makeDesign(), interaction: makeInteraction(), content, siteUrl: "https://acme.example" });
    expect(files.get("contact/index.html")).toContain('href="mailto:hello@acme.example"');
    expect(files.get("contact/index.html")).toContain('href="tel:+254700000000"');
    expect(files.get("index.html")).toContain('src="/assets/images/logo.webp"');
  });

  it("generates and renders every declared homepage image slot", () => {
    const design = makeDesign({ imagery: { treatment: "photographic", slots: ["hero", "about"] } });
    const content = buildRenderContent(makeIntake());
    const { files, imageTasks } = renderBlueprintSite({ design, interaction: makeInteraction(), content, siteUrl: "https://acme.example" });
    expect(imageTasks.map((task) => task.outputFilename)).toEqual(["hero-home.webp", "image-2-home.webp"]);
    expect(files.get("index.html")).toContain('src="/assets/images/hero-home.webp"');
    expect(files.get("index.html")).toContain('src="/assets/images/image-2-home.webp"');
  });

  it("generates and renders the required page-aware image plan", () => {
    const content = buildRenderContent(makeIntake());
    const { files, imageTasks } = renderBlueprintSite({ design: makeDesign(), interaction: makeInteraction(), content, siteUrl: "https://acme.example" });
    expect(imageTasks.filter((task) => task.page === "/")).toHaveLength(3);
    expect(imageTasks.filter((task) => task.page === "/services")).toHaveLength(3);
    expect(imageTasks.filter((task) => task.page === "/about")).toHaveLength(1);
    expect(imageTasks.filter((task) => task.page === "/contact")).toHaveLength(1);
    expect(files.get("services/index.html")).toContain('src="/assets/images/hero-services.webp"');
    expect(files.get("about/index.html")).toContain('src="/assets/images/hero-about.webp"');
    expect(files.get("contact/index.html")).toContain('src="/assets/images/hero-contact.webp"');
  });

  it("does not invent quantitative, service, or guarantee claims", () => {
    const { files } = renderBundle();
    const bundleText = [...files.values()].join("\n");
    expect(bundleText).not.toMatch(/>100%<|>1:1<|no-obligation|expert advice|quality assurance|you can trust|we will be in touch/i);
  });
});

describe("blueprint renderer — accessibility structure", () => {
  const bundle = renderBundle();
  const home = bundle.files.get("index.html")!;

  it("has exactly one h1 per page", () => {
    for (const path of ["index.html", "services/index.html", "about/index.html", "contact/index.html"]) {
      const html = bundle.files.get(path)!;
      const h1 = (html.match(/<h1\b/gi) || []).length;
      expect(h1, `${path} should have one h1`).toBe(1);
    }
  });

  it("has landmarks: header, main, footer, nav", () => {
    expect(home).toContain('role="banner"');
    expect(home).toContain('<main id="main">');
    expect(home).toContain('role="contentinfo"');
    expect(home).toContain('aria-label="Primary"');
  });

  it("has a skip link targeting main", () => {
    expect(home).toContain('href="#main"');
    expect(home).toContain('class="skip-link"');
  });

  it("always includes keyboard focus styles even when focus motion was not observed", () => {
    const content = buildRenderContent(makeIntake());
    const interaction = makeInteraction({
      interactions: [{ trigger: "sticky", target: "navigation", selector: ".nav", property: "position", duration: "0s", easing: "linear", delay: "0s", hover: "none", focus: "none", active: "none", scrollBehavior: "sticky", reducedMotionBehavior: "unchanged", observed: true, evidenceIds: ["e1"], evidence: { source: "interaction", artifactKey: "a" }, confidence: 0.8 }],
    });
    const { files } = renderBlueprintSite({ design: makeDesign(), interaction, content, siteUrl: "https://acme.example" });
    expect(files.get("assets/styles.css")).toContain("button:focus-visible");
  });

  it("every img has a non-empty alt", () => {
    for (const path of ["index.html", "services/index.html", "about/index.html", "contact/index.html"]) {
      const html = bundle.files.get(path)!;
      const imgs = html.match(/<img\b[^>]*>/gi) || [];
      for (const img of imgs) {
        const altMatch = img.match(/alt="([^"]*)"/i);
        expect(altMatch, `${path} img missing alt: ${img}`).not.toBeNull();
      }
    }
  });

  it("links the stylesheet and the app script on every page", () => {
    for (const path of ["index.html", "services/index.html", "about/index.html", "contact/index.html"]) {
      const html = bundle.files.get(path)!;
      expect(html).toContain('<link rel="stylesheet" href="/assets/styles.css">');
      expect(html).toContain('<script src="/assets/app.js" defer></script>');
    }
  });
});

describe("blueprint renderer — model cannot inject unsafe content", () => {
  it("drops a malicious color payload from the generated css", () => {
    const content = buildRenderContent(makeIntake());
    const { files } = renderBlueprintSite({
      design: makeDesign({
        colors: { roles: [{ role: "primary", value: "#2563eb; } body { background: url(javascript:alert(1)) } .x {", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 }] },
      }),
      interaction: makeInteraction(),
      content,
      siteUrl: "https://acme.example",
    });
    const css = files.get("assets/styles.css")!;
    expect(css).not.toContain("javascript:alert");
    expect(css).not.toContain("} body {");
  });

  it("escapes a malicious company name in every rendered page", () => {
    const content = buildRenderContent(makeIntake({ companyName: '<script>alert("x")</script>' }));
    const { files } = renderBlueprintSite({ design: makeDesign(), interaction: makeInteraction(), content, siteUrl: "https://x" });
    for (const path of ["index.html", "services/index.html", "about/index.html", "contact/index.html"]) {
      const html = files.get(path)!;
      expect(html).not.toContain("<script>alert");
      expect(html).not.toMatch(/<script\b[^>]*>\s*alert/i);
      expect(html).toContain("&lt;script&gt;");
    }
  });

  it("never renders live event handlers or unsafe tags from content", () => {
    const content = buildRenderContent(makeIntake({ businessDescription: '"><img src=x onerror=alert(1)><iframe src=x></iframe>' }));
    const { files } = renderBlueprintSite({ design: makeDesign(), interaction: makeInteraction(), content, siteUrl: "https://x" });
    for (const path of ["index.html", "services/index.html", "about/index.html", "contact/index.html"]) {
      const html = files.get(path)!;
      expect(html).not.toMatch(/<iframe\b/i);
      expect(html).not.toMatch(/\sonerror\s*="/i);
      expect(html).not.toMatch(/<img[^>]*onerror/i);
    }
  });
});
