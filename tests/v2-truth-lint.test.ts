import { describe, expect, it } from "vitest";
import { factVocabulary, lintTrustContexts, TRUST_CONTEXT_PATTERN } from "../src/domain/fact-lint";
import { buildImagePromptUserPrompt } from "../src/domain/image-pipeline";
import {
  evaluateQaARelease,
  QA_A_HARD_GATE_IDS,
  type QaAConfirmationReport,
  type QaAReport,
} from "../src/domain/qa-stages";
import type { BusinessFacts } from "../src/domain/lifecycle-schema";

// Issue #48 — fabrication defenses.
//
// The production RankForge candidate filled a Reference client-logo/trust
// band with invented entities ("Glap Thon", "Marivert", "6699", "Scap Thes",
// "Hopes" — frozen in the v3 fixture). Reproducing a trust band's STRUCTURE
// never licenses inventing its entities. These tests pin the deterministic
// Business-truth lint, the fact-safe adaptation path, and the confirmation
// seam that must never lose a fabrication finding.

const FROZEN_FABRICATED_NAMES = ["Glap Thon", "Marivert", "6699", "Scap Thes", "Hopes"];

const FACTS: BusinessFacts = {
  businessName: "RankForge Kenya",
  contactEmail: "hello@rankforge.example",
  businessType: "SEO agency",
  businessDescription: "A Nairobi-based SEO and organic-growth agency.",
  city: "Nairobi",
  country: "Kenya",
  extraInformation: "Long-standing partners: Acme Corp and Eastside Media.",
};

const CLIENT_BAND = (labels: string[]): string =>
  `<section class="logo-strip" aria-label="Trusted by">
  <h2>Trusted by</h2>
  <ul class="logo-wall">${labels.map((label) => `<li>${label}</li>`).join("")}</ul>
</section>`;

const PAGE = (main: string): string =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RankForge Kenya</title><link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head><body><header><nav aria-label="Primary"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header><main>${main}</main><footer><p>RankForge Kenya</p></footer></body></html>`;

// The legacy assembled-site validator (which used to wrap this lint) was
// removed with the legacy generator; the verdict helper now drives the shared
// lint directly, with the same trust-region-purpose derivation the pipeline
// uses (Blueprint regions whose purpose matches the trust-context pattern).
function verdictFor(homeHtml: string, facts: BusinessFacts | undefined, blueprint?: { homepageRegions: Array<{ id: string; purpose: string }> }) {
  const factWords = factVocabulary(facts);
  const businessNameWords = new Set<string>(
    (facts?.businessName ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  );
  const trustRegionPurposes = new Map<string, string>();
  for (const region of blueprint?.homepageRegions ?? []) {
    if (TRUST_CONTEXT_PATTERN.test(region.purpose)) trustRegionPurposes.set(region.id, region.purpose);
  }
  const findings = lintTrustContexts(homeHtml, "home", factWords, trustRegionPurposes, businessNameWords).map(
    (violation) => ({
      id: "FABRICATED_TRUST_ENTITY",
      detail: `home: trust label '${violation.text}' is not backed by the Business Facts (${violation.context})`,
    })
  );
  return { passed: findings.length === 0, findings };
}

const truthFindings = (findings: Array<{ id: string; detail: string }>) =>
  findings.filter((finding) => finding.id === "FABRICATED_TRUST_ENTITY");

describe("deterministic trust-context truth lint (issue #48)", () => {
  it("fails every frozen RankForge fabricated trust-strip name in a client band", () => {
    const verdict = verdictFor(PAGE(CLIENT_BAND(FROZEN_FABRICATED_NAMES)), FACTS);
    const findings = truthFindings(verdict.findings);
    expect(findings.length).toBeGreaterThanOrEqual(FROZEN_FABRICATED_NAMES.length);
    for (const name of FROZEN_FABRICATED_NAMES) {
      expect(findings.some((finding) => finding.detail.includes(`'${name}'`)), name).toBe(true);
    }
    expect(verdict.passed).toBe(false);
  });

  it("flags fabricated logos in image alt text inside a trust context", () => {
    const html = PAGE(
      `<ul class="client-logos" aria-label="Our clients"><li><img src="assets/images/x.webp" alt="Marivert"></li><li><img src="assets/images/y.webp" alt="Scap Thes"></li></ul>`
    );
    const findings = truthFindings(verdictFor(html, FACTS).findings);
    expect(findings.map((finding) => finding.detail)).toEqual(
      expect.arrayContaining([expect.stringContaining("'Marivert'"), expect.stringContaining("'Scap Thes'")])
    );
  });

  it("passes a visually equivalent fact-safe adaptation (the #48 adaptation contract)", () => {
    // Same visual rhythm — a label strip — populated with service categories,
    // topic labels, the business's own city and generic audience categories.
    const html = PAGE(
      `<section class="logo-strip" aria-label="Trusted by">
  <h2>Trusted by</h2>
  <ul class="logo-wall"><li>SEO</li><li>Web design</li><li>Nairobi businesses</li><li>Who We Help</li></ul>
  <p class="audience-line">Kenyan SMEs · Professional services · Ecommerce · Hospitality &amp; travel · B2B companies · East African brands</p>
</section>`
    );
    expect(truthFindings(verdictFor(html, FACTS).findings)).toEqual([]);
  });

  it("permits customer/partner names that the Business Facts explicitly supply", () => {
    const html = PAGE(CLIENT_BAND(["Acme Corp", "Eastside Media"]));
    expect(truthFindings(verdictFor(html, FACTS).findings)).toEqual([]);
  });

  it("does not police ordinary containers — only trust-signaling contexts", () => {
    const html = PAGE(`<div class="random-band"><ul><li>Glap Thon</li><li>Marivert</li></ul></div>`);
    expect(truthFindings(verdictFor(html, FACTS).findings)).toEqual([]);
  });

  it("treats a Blueprint trust region purpose as a trigger even without DOM trust wording", () => {
    const violations = lintTrustContexts(
      `<section data-region="client_logos_band"><ul><li>Glap Thon</li></ul></section>`,
      "home",
      new Set(["rankforge", "kenya", "seo"]),
      new Map([["client_logos_band", "Client logos band from the Reference"]])
    );
    expect(violations.map((violation) => violation.text)).toEqual(["Glap Thon"]);
  });
});

describe("fabrication is a tracked, unloseable release blocker (issue #48)", () => {
  const hardGates = QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true }));

  it("fresh QA-A turns a fabrication verdict into a business-truth blocker", () => {
    const report: QaAReport = {
      version: "1",
      visualScore: 95,
      contentScore: 95,
      fabrication: true,
      hardGates,
      findings: [],
    };
    const verdict = evaluateQaARelease(report);
    expect(verdict.releaseReady).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("fabricated");
    expect(verdict.blockers).toHaveLength(1);
    expect(verdict.blockers[0].domain).toBe("business-truth");
    expect(verdict.blockers[0].severity).toBe("P1");
  });

  it("confirmation cannot pass while fabrication is active — even with every visual defect resolved", () => {
    const confirmation: QaAConfirmationReport = {
      version: "1",
      visualScore: 96,
      contentScore: 95,
      fabrication: true,
      hardGates,
      findings: [
        {
          severity: "P1",
          domain: "visual-fidelity",
          description: "Previously identified hero contrast defect",
          evidenceRef: "qa/home-1440-first.png",
          status: "RESOLVED",
        },
      ],
    };
    const verdict = evaluateQaARelease(confirmation);
    expect(verdict.releaseReady).toBe(false);
    expect(verdict.blockers.some((blocker) => blocker.domain === "business-truth" && blocker.status !== "RESOLVED")).toBe(true);
    expect(verdict.resolved).toHaveLength(1);
  });

  it("a genuinely removed fabricated band allows release when everything else passes", () => {
    const confirmation: QaAConfirmationReport = {
      version: "1",
      visualScore: 95,
      contentScore: 94,
      fabrication: false,
      hardGates,
      findings: [
        {
          severity: "P1",
          domain: "business-truth",
          description: "Previously identified fabricated client-logo strip",
          evidenceRef: "qa/home-1440.png",
          status: "RESOLVED",
        },
      ],
    };
    const verdict = evaluateQaARelease(confirmation);
    expect(verdict.releaseReady).toBe(true);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.resolved).toHaveLength(1);
  });
});

describe("generated imagery cannot carry fabricated identity (issue #48)", () => {
  it("every KIE prompt carries the binding identity prohibition", () => {
    const prompt = buildImagePromptUserPrompt([
      {
        id: "home-hero",
        page: "home",
        semanticRole: "editorial hero",
        blueprintRole: "role-hero",
        priority: "CRITICAL",
        orientation: "landscape",
        negativeSpaceForText: true,
      },
    ]);
    expect(prompt).toContain("IDENTITY PROHIBITION");
    expect(prompt).toContain("NO readable text");
    expect(prompt).toContain("logo");
    expect(prompt).toContain("screenshot-like composition");
  });
});

// ── Issue #53: role-aware entity classification ─────────────────────────────
//
// The #48 principle is unchanged — invented third-party trust identities are
// fabrication — but the lint must ask "is this text presented as the identity
// of an unsupported third-party trust entity?", not "is every text node made
// of fact-vocabulary words?". The production false positives were heading
// prose inside Blueprint trust regions, not client names.

const FACTS_WITHOUT_PARTNERS: BusinessFacts = {
  ...FACTS,
  extraInformation: "Services: SEO Strategy, Technical SEO, Local SEO.",
};

describe("role-aware trust-entity classification (issue #53)", () => {
  it("PASSES descriptive and self-referential headings inside a trust-signaling region", () => {
    const html = PAGE(`<section class="credibility-band" data-region="hero" aria-label="Trusted by">
  <h3>Who We Serve</h3>
  <h4>Working with RankForge</h4>
  <h3>Our Approach</h3>
  <h4>Built for growing teams</h4>
  <h3>RankForge Kenya</h3>
  <p>Search growth built around commercial outcomes.</p>
</section>`);
    const verdict = verdictFor(html, FACTS_WITHOUT_PARTNERS);
    expect(truthFindings(verdict.findings)).toEqual([]);
  });

  it("PASSES fact-backed service and location labels in an identity slot", () => {
    const html = PAGE(CLIENT_BAND(["SEO Strategy", "Technical SEO", "Nairobi", "Kenya"]));
    expect(truthFindings(verdictFor(html, FACTS_WITHOUT_PARTNERS).findings)).toEqual([]);
  });

  it("PASSES a bare decorative numeric mark outside identity slots", () => {
    const html = PAGE(`<section data-region="region_07"><p>6699</p><span>+ · ·</span></section>`);
    expect(truthFindings(verdictFor(html, FACTS_WITHOUT_PARTNERS).findings)).toEqual([]);
  });

  it("FAILS unsupported third-party names in identity slots, including novel shapes (fail closed)", () => {
    const html = PAGE(CLIENT_BAND(["Acme Kenya", "Marivert", "Northstar Group", "Zynthara Labs"]));
    const findings = truthFindings(verdictFor(html, FACTS_WITHOUT_PARTNERS).findings);
    for (const name of ["Acme Kenya", "Marivert", "Northstar Group", "Zynthara Labs"]) {
      expect(findings.some((f) => f.detail.includes(`'${name}'`)), name).toBe(true);
    }
  });

  it("FAILS award/press/person entity claims even when presented as trust-band headings", () => {
    const html = PAGE(`<section class="logo-strip" aria-label="Trusted by">
  <h3>Digital Africa Awards</h3>
  <h4>Forbes Kenya</h4>
  <h3>John Kamau</h3>
</section>`);
    const findings = truthFindings(verdictFor(html, FACTS_WITHOUT_PARTNERS).findings);
    for (const name of ["Digital Africa Awards", "Forbes Kenya", "John Kamau"]) {
      expect(findings.some((f) => f.detail.includes(`'${name}'`)), name).toBe(true);
    }
  });

  it("the business self-reference exemption never swallows a third-party name", () => {
    const html = PAGE(`<section class="logo-strip" aria-label="Trusted by"><h3>RankForge Partners with Microsoft</h3></section>`);
    const findings = truthFindings(verdictFor(html, FACTS_WITHOUT_PARTNERS).findings);
    expect(findings.some((f) => f.detail.includes("'RankForge Partners with Microsoft'"))).toBe(true);
  });

  it("still FAILS the frozen fabricated identities in identity slots (no #48 regression)", () => {
    const verdict = verdictFor(PAGE(CLIENT_BAND(FROZEN_FABRICATED_NAMES)), FACTS_WITHOUT_PARTNERS);
    const findings = truthFindings(verdict.findings);
    for (const name of FROZEN_FABRICATED_NAMES) {
      expect(findings.some((f) => f.detail.includes(`'${name}'`)), name).toBe(true);
    }
  });

  it("numeric marks in IDENTITY slots stay blocked — presentation context decides", () => {
    const html = PAGE(`<section class="logo-strip" aria-label="Our clients"><ul class="logo-wall"><li>6699</li><li><img src="assets/images/a.webp" alt="4455"></li></ul></section>`);
    const findings = truthFindings(verdictFor(html, FACTS_WITHOUT_PARTNERS).findings);
    const labels = findings.map((f) => /'([^']+)'/.exec(f.detail)?.[1]).sort();
    expect(labels).toEqual(["4455", "6699"]);
  });
});
