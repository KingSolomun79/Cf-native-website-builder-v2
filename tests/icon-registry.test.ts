import { describe, expect, it } from "vitest";
import {
  LUCIDE_ICONS,
  LUCIDE_ICON_NAMES,
  LUCIDE_NOTICE,
  isAllowedIcon,
  getLucideIcon,
  renderIcon,
  ALLOWED_INTENTS,
  iconNameForIntent,
  isAllowedIntent,
  inferIntentFromText,
  declaredIntents,
} from "../src/render/icons";
import { renderCard } from "../src/render/primitives";
import { renderBlueprintSite } from "../src/render/site-renderer";
import { buildRenderContent } from "../src/render/content";
import { validateBundle } from "../src/lib/bundle-validation";
import { makeDesign, makeInteraction, makeIntake } from "./helpers/blueprint-fixtures";
import type { StyleTokens } from "../src/types";

const noneTokens: StyleTokens = { cssVars: {}, googleFonts: [], framework: "none" };

describe("lucide icon registry — allowed catalog", () => {
  it("exposes a small, reviewed allowlist", () => {
    expect(LUCIDE_ICON_NAMES.length).toBeGreaterThanOrEqual(9);
    for (const name of LUCIDE_ICON_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9-]+$/);
    }
  });

  it("every allowed intent maps to an allowed icon", () => {
    for (const intent of ALLOWED_INTENTS) {
      const name = iconNameForIntent(intent);
      expect(name, `intent ${intent} should resolve`).not.toBeNull();
      expect(isAllowedIcon(name)).toBe(true);
      const icon = getLucideIcon(name);
      expect(icon).not.toBeNull();
      expect(icon!.inner.length).toBeGreaterThan(0);
    }
  });

  it("every catalog icon renders valid inline svg markup", () => {
    for (const name of LUCIDE_ICON_NAMES) {
      const html = renderIcon({ name });
      expect(html).toMatch(/^<svg\b/);
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain("</svg>");
    }
  });
});

describe("lucide icon registry — unknown intent fallback", () => {
  it("returns null for an unknown intent", () => {
    expect(iconNameForIntent("totally-made-up")).toBeNull();
    expect(iconNameForIntent(undefined)).toBeNull();
    expect(iconNameForIntent("Education")).toBeNull();
  });

  it("omits the icon for an unknown intent rather than emitting a placeholder", () => {
    expect(renderIcon({ name: "not-an-icon" })).toBe("");
    const card = renderCard({ title: "X", body: "Y", iconIntent: "not-an-intent" });
    expect(card).not.toContain("<svg");
    expect(card).toContain("<article");
  });

  it("isAllowedIntent guards the closed intent set", () => {
    expect(isAllowedIntent("location")).toBe(true);
    expect(isAllowedIntent("Location")).toBe(false);
    expect(isAllowedIntent("places")).toBe(false);
  });
});

describe("lucide icon registry — consistency", () => {
  it("applies a single fixed geometry to every emitted icon", () => {
    for (const name of LUCIDE_ICON_NAMES) {
      const html = renderIcon({ name });
      expect(html).toContain('width="24"');
      expect(html).toContain('height="24"');
      expect(html).toContain('stroke-width="2"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('fill="none"');
      expect(html).toContain('stroke-linecap="round"');
      expect(html).toContain('stroke-linejoin="round"');
    }
  });

  it("emits the same svg for the same name (deterministic)", () => {
    for (const name of LUCIDE_ICON_NAMES) {
      expect(renderIcon({ name })).toBe(renderIcon({ name }));
    }
  });
});

describe("lucide icon registry — accessibility", () => {
  it("decorative icons are hidden from assistive tech", () => {
    const html = renderIcon({ name: "mail", decorative: true });
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("<title");
  });

  it("meaningful icons expose role=img and an accessible label", () => {
    const html = renderIcon({ name: "mail", decorative: false, title: "Email us" });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Email us"');
    expect(html).not.toContain("aria-labelledby=");
    expect(html).not.toContain('aria-hidden="true"');
  });

  it("does not emit duplicate ids when a meaningful icon repeats", () => {
    const html = [
      renderIcon({ name: "mail", decorative: false, title: "Email sales" }),
      renderIcon({ name: "mail", decorative: false, title: "Email support" }),
    ].join("");
    expect(html).not.toMatch(/\sid=/);
    expect(html).toContain('aria-label="Email sales"');
    expect(html).toContain('aria-label="Email support"');
  });

  it("falls back to decorative when a meaningful icon has no title", () => {
    const html = renderIcon({ name: "mail", decorative: false });
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });

  it("escapes a malicious title so it cannot inject markup", () => {
    const html = renderIcon({ name: "mail", decorative: false, title: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("lucide icon registry — no external requests", () => {
  it("never emits a url, href, <use>, or remote fetch", () => {
    for (const name of LUCIDE_ICON_NAMES) {
      const html = renderIcon({ name, decorative: false, title: "t" });
      // The mandatory xmlns namespace is the only permitted http occurrence; it
      // is a namespace identifier, not a network fetch.
      const stripped = html.replace('xmlns="http://www.w3.org/2000/svg"', "");
      expect(stripped).not.toMatch(/\bhttps?:\/\//i);
      expect(stripped).not.toMatch(/<use\b/i);
      expect(stripped).not.toMatch(/\bhref\s*=/i);
      expect(stripped).not.toMatch(/\burl\(/i);
    }
  });

  it("emits no on* event handlers", () => {
    for (const name of LUCIDE_ICON_NAMES) {
      expect(renderIcon({ name })).not.toMatch(/\son[a-z]+\s*=/i);
    }
  });
});

describe("lucide icon registry — intent inference", () => {
  it("infers intent from card text", () => {
    expect(inferIntentFromText("Location", "12 Market Street")).toBe("location");
    expect(inferIntentFromText("Intended clients", "early-stage startups")).toBe("community");
    expect(inferIntentFromText("Contact us", "")).toBe("contact");
  });

  it.each([
    ["education", "Education academy"],
    ["health", "Healthcare clinic"],
    ["community", "Community members"],
    ["location", "Business address"],
    ["contact", "General enquiries"],
    ["security", "Security and protection"],
    ["growth", "Scaling revenue"],
    ["support", "Support services"],
    ["accessibility", "Accessibility and disability inclusion"],
  ])("infers the %s intent from representative content", (intent, content) => {
    expect(inferIntentFromText(content)).toBe(intent);
  });

  it("returns null when no keyword matches", () => {
    expect(inferIntentFromText("Business focus", "bespoke digital work")).toBeNull();
    expect(inferIntentFromText("")).toBeNull();
  });

  it("dedupes and filters declared intents to the allowed set", () => {
    const design = makeDesign({
      icons: {
        intents: [
          { slot: "a", intent: "location", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 },
          { slot: "b", intent: "location", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 },
          { slot: "c", intent: "growth", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 },
          { slot: "d", intent: "bogus", evidenceIds: ["e1"], evidence: { source: "screenshot", artifactKey: "a" }, confidence: 0.9 },
        ],
      },
    });
    expect(declaredIntents(design)).toEqual(["location", "growth"]);
  });
});

describe("lucide icon registry — overuse validation", () => {
  function renderWithIntents(intents: string[]) {
    const evidence = { source: "screenshot" as const, artifactKey: "a" };
    const design = makeDesign({
      icons: { intents: intents.map((intent, i) => ({ slot: `s${i}`, intent, evidenceIds: ["e1"], evidence, confidence: 0.9 })) },
    });
    return renderBlueprintSite({
      design,
      interaction: makeInteraction(),
      content: buildRenderContent(makeIntake()),
      siteUrl: "https://acme.example",
    });
  }

  it("renders icons only when the blueprint declares intents", () => {
    const none = renderWithIntents([]);
    for (const html of none.files.values()) {
      if (typeof html === "string") expect(html).not.toContain("<svg");
    }
  });

  it("caps icons per page at MAX_ICONS_PER_PAGE even with many cards/intents", () => {
    const all = ["education", "health", "community", "location", "contact", "security", "growth", "support", "accessibility"];
    const { files } = renderWithIntents(all);
    for (const path of ["index.html", "services/index.html", "about/index.html", "contact/index.html"]) {
      const html = files.get(path)!;
      const count = (html.match(/<svg\b/g) || []).length;
      expect(count, `${path} exceeded icon cap`).toBeLessThanOrEqual(6);
    }
  });

  it("places at most one icon per card", () => {
    const { files } = renderWithIntents(["growth", "location", "community"]);
    for (const path of ["index.html", "services/index.html", "about/index.html"]) {
      const html = files.get(path)!;
      const cards = html.match(/<article class="card">[\s\S]*?<\/article>/g) || [];
      for (const card of cards) {
        expect((card.match(/<svg\b/g) || []).length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("lucide icon registry — renderer integration", () => {
  function renderWithIntents(intents: string[]) {
    const evidence = { source: "screenshot" as const, artifactKey: "a" };
    const design = makeDesign({
      icons: { intents: intents.map((intent, i) => ({ slot: `s${i}`, intent, evidenceIds: ["e1"], evidence, confidence: 0.9 })) },
    });
    return renderBlueprintSite({
      design,
      interaction: makeInteraction(),
      content: buildRenderContent(makeIntake()),
      siteUrl: "https://acme.example",
    });
  }

  it("renders inline lucide svg for declared intents", () => {
    const { files } = renderWithIntents(["location", "community", "growth"]);
    const services = files.get("services/index.html")!;
    expect(services).toContain("<svg");
    expect(services).toContain('viewBox="0 0 24 24"');
    expect(services).toContain('aria-hidden="true"');
  });

  it("keeps icons out of the bundle when no intent is declared", () => {
    const { files } = renderBlueprintSite({
      design: makeDesign(),
      interaction: makeInteraction(),
      content: buildRenderContent(makeIntake()),
      siteUrl: "https://acme.example",
    });
    for (const path of ["index.html", "services/index.html", "about/index.html", "contact/index.html"]) {
      expect(files.get(path)!).not.toContain("<svg");
    }
    expect(files.has("THIRD_PARTY_NOTICES.txt")).toBe(false);
  });

  it("includes the Lucide license notice when icons are bundled", () => {
    const { files } = renderWithIntents(["location", "community"]);
    expect(files.get("THIRD_PARTY_NOTICES.txt")).toBe(LUCIDE_NOTICE);
    expect(LUCIDE_NOTICE).toContain("Lucide Contributors 2022");
    expect(LUCIDE_NOTICE).toContain("permission notice appear in all copies");
  });

  it("still passes the bundle-safety validator with icons present", () => {
    const { files } = renderWithIntents(["location", "community", "growth", "contact"]);
    const result = validateBundle(files, noneTokens);
    expect(result.issues.filter((i) => i.severity === "critical" || i.severity === "major")).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("does not alter the rendered page set", () => {
    const { files } = renderWithIntents(["growth"]);
    expect([...files.keys()].sort()).toEqual(
      ["about/index.html", "assets/app.js", "assets/styles.css", "contact/index.html", "index.html", "robots.txt", "services/index.html", "sitemap.xml"].sort()
    );
  });
});
