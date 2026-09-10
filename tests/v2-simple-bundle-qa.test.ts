// SIMPLE deterministic bundle QA: truth lint (zero-tolerance facts + trust
// entities), technical checks, canonical gate mapping and release mapping
// (experiment spec sections 38-39, 43-45, 54).

import { describe, expect, it } from "vitest";
import { runDeterministicBundleQa, type BundleQaInput } from "../src/simple-design/bundle-qa";
import { buildSimpleQaPackage, simpleReleaseVerdict } from "../src/simple-design/qa-package";
import { simplePackageToQaA, simplePackageToQaB } from "../src/simple-design/release-mapping";
import { evaluateQaARelease, evaluateQaBRelease } from "../src/domain/qa-stages";
import { validateDesignBlueprintV2, type QaPackage, type SiteBundle } from "../src/simple-design/contracts";
import { FINCH_V2_KNOWN_GOOD_BLUEPRINT } from "./_generated-simple-finch-v2";

const blueprint = validateDesignBlueprintV2(FINCH_V2_KNOWN_GOOD_BLUEPRINT);
if (!blueprint.valid) throw new Error("Finch v2 fixture must validate");
const bp = blueprint.value;

const SLOT_IDS = new Set([
  ...(["home", "about", "services", "contact"] as const).map((page) => `${page}-hero`),
  ...bp.imagery.supportingImageSlots.map((slot) => slot.id),
]);

const endpoint = "https://test.example.com/api/v2/forms/submit";
const siteFormId = "site:abc123";

function head(title: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${title} meta description"><meta property="og:title" content="${title}"><meta property="og:description" content="${title}"></head>`;
}

function nav(): string {
  return `<header><nav aria-label="Primary"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>`;
}

function page(title: string, extra = ""): string {
  return `${head(title)}<body>${nav()}<main><h1>${title}</h1>${extra}</main><footer><p>Business footer line</p></footer><script src="site.js" defer></script></body></html>`;
}

function contactPage(formAction = endpoint, hidden = siteFormId): string {
  return page(
    "Contact",
    `<link rel="stylesheet" href="site.css"><section class="hero contact-hero"><img src="IMG:contact-hero" data-image-id="contact-hero" alt="contact hero image"></section><form method="post" action="${formAction}"><input type="hidden" name="siteFormId" value="${hidden}"><label for="name">Name</label><input id="name" name="name"><label for="email">Email</label><input id="email" name="email"><label for="message">Message</label><textarea id="message" name="message"></textarea><button type="submit">Send</button></form>`
  );
}

const GOOD_CSS = `
:root { --accent: #d9b380; }
body { margin: 0; }
.hero { min-height: 100vh; }
:focus-visible { outline: 2px solid var(--accent); }
@media (max-width: 767px) { .hero { min-height: 70vh; } }
@media (prefers-reduced-motion: reduce) { * { transition: none; } }
`;

function goodBundle(): SiteBundle {
  const firstSlot = [...SLOT_IDS][0];
  return {
    version: "1",
    pages: {
      home: page(
        "Home",
        `<link rel="stylesheet" href="site.css"><section class="hero"><img src="IMG:${firstSlot}" data-image-id="${firstSlot}" alt="hero image"></section>`
      ),
      about: page("About", `<link rel="stylesheet" href="site.css"><section class="hero about-hero"><img src="IMG:about-hero" data-image-id="about-hero" alt="about hero image"></section><img src="IMG:about-story" data-image-id="about-story" alt="story image">`),
      services: page("Services", `<link rel="stylesheet" href="site.css"><section class="hero services-hero"><img src="IMG:services-hero" data-image-id="services-hero" alt="services hero image"></section>`),
      contact: contactPage(),
    },
    sharedCss: GOOD_CSS,
    sharedJs: "(function(){var t=document.querySelector('.nav-toggle');if(t){t.addEventListener('click',function(){document.body.classList.toggle('nav-open');});}})();",
  };
}

function qaInput(overrides?: Partial<BundleQaInput>): BundleQaInput {
  return {
    bundle: goodBundle(),
    blueprint: bp,
    facts: {
      businessName: "RankForge Kenya",
      contactEmail: "ops@rankforge.example",
      businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
    },
    formServiceEndpoint: endpoint,
    siteFormId,
    slotIds: SLOT_IDS,
    resolvedSlotIds: SLOT_IDS,
    renderEvidence: { capturesRendered: 9, mobileCaptured: true, failedRequestCount: 0 },
    ...overrides,
  };
}

describe("SIMPLE deterministic truth lint (spec section 39)", () => {
  it("clean bundle: zero truth findings and zero technical blockers", () => {
    const result = runDeterministicBundleQa(qaInput());
    expect(result.truthFindings).toEqual([]);
    expect(result.technicalFindings).toEqual([]);
    expect(result.technicalBlockerCount).toBe(0);
  });

  it("fabricated award / rating / founding-year / social-proof claims are caught verbatim", () => {
    const result = runDeterministicBundleQa(
      qaInput({
        bundle: (() => {
          const bundle = goodBundle();
          bundle.pages.home = page(
            "Home",
            "<p>Award-winning agency since 1994. Rated 5.0/5 by 200+ clients.</p>"
          );
          return bundle;
        })(),
      })
    );
    const ids = result.truthFindings.map((finding) => finding.id);
    expect(ids).toContain("FABRICATED_AWARD");
    expect(ids).toContain("FABRICATED_YEAR");
    expect(ids).toContain("FABRICATED_SOCIAL_PROOF");
    expect(ids).toContain("FABRICATED_RATING");
  });

  it("entity-shaped trust labels not backed by facts are caught (issue #48 machinery)", () => {
    const result = runDeterministicBundleQa(
      qaInput({
        bundle: (() => {
          const bundle = goodBundle();
          bundle.pages.about = page(
            "About",
            `<link rel="stylesheet" href="site.css"><section><h2>Trusted by</h2><ul><li>Glap Thon</li><li>Marivert Group</li></ul></section>`
          );
          return bundle;
        })(),
      })
    );
    expect(result.truthFindings.some((finding) => finding.id === "FABRICATED_TRUST_ENTITY")).toBe(true);
  });

  it("facts vocabulary vouches for supplied names", () => {
    const result = runDeterministicBundleQa(
      qaInput({
        facts: {
          businessName: "RankForge Kenya",
          contactEmail: "ops@rankforge.example",
          extraInformation: "Featured in Travel and Leisure 2025; partner Glap Thon",
        },
        bundle: (() => {
          const bundle = goodBundle();
          bundle.pages.about = page(
            "About",
            `<link rel="stylesheet" href="site.css"><section><h2>Featured in Travel and Leisure 2025</h2><p>Partner Glap Thon.</p></section>`
          );
          return bundle;
        })(),
      })
    );
    expect(result.truthFindings).toEqual([]);
  });
});

describe("SIMPLE deterministic technical checks (spec section 38)", () => {
  it("broken nav links, unknown slots and remote images are blockers", () => {
    const bundle = goodBundle();
    bundle.pages.services = page(
      "Services",
      `<link rel="stylesheet" href="site.css"><a href="/aboutt">broken</a><img src="IMG:not-a-slot" data-image-id="not-a-slot" alt="x"><img src="https://cdn.example/pic.webp" alt="remote">`
    );
    const result = runDeterministicBundleQa(qaInput({ bundle }));
    const ids = result.technicalFindings.map((finding) => finding.id);
    expect(ids).toContain("BROKEN_NAV_LINK");
    expect(ids).toContain("UNKNOWN_IMG_SLOT");
    expect(ids).toContain("NO_PROVIDER_URLS");
    expect(result.technicalBlockerCount).toBeGreaterThan(0);
    expect(result.gates.INTERNAL_NAVIGATION).toBe(false);
    expect(result.gates.IMAGE_MANIFEST_RESOLUTION).toBe(false);
    expect(result.gates.NO_PROVIDER_URLS).toBe(false);
  });

  it("unresolved slots (no Accepted Image) are blockers", () => {
    const result = runDeterministicBundleQa(qaInput({ resolvedSlotIds: new Set(["home-hero"]) }));
    expect(result.technicalFindings.some((finding) => finding.id === "UNRESOLVED_IMAGE_SLOT")).toBe(true);
  });

  it("form contract violations are blockers", () => {
    const bundle = goodBundle();
    bundle.pages.contact = contactPage("https://evil.example/submit");
    const result = runDeterministicBundleQa(qaInput({ bundle }));
    expect(result.technicalFindings.some((finding) => finding.id === "FORM_CONTRACT_FAILURE")).toBe(true);
    expect(result.gates.FORM_SERVICE_CONTRACT).toBe(false);
  });

  it("missing reduced-motion handling is a blocker when the blueprint declares motion", () => {
    const bundle = goodBundle();
    bundle.sharedCss = "body { margin: 0; } :focus-visible { outline: 2px solid; } @media (max-width: 767px) { body { color: red; } }";
    const result = runDeterministicBundleQa(qaInput({ bundle }));
    expect(result.technicalFindings.some((finding) => finding.id === "REDUCED_MOTION_MISSING")).toBe(true);
  });

  it("render evidence feeds the capture-backed gates", () => {
    const failed = runDeterministicBundleQa(
      qaInput({ renderEvidence: { capturesRendered: 9, mobileCaptured: true, failedRequestCount: 3 } })
    );
    expect(failed.gates.RUNTIME_CONSOLE_NETWORK_CLEAN).toBe(false);
    const noRender = runDeterministicBundleQa(qaInput({ renderEvidence: null }));
    expect(noRender.gates.ALL_PAGES_LOAD).toBe(false);
  });
});

describe("SIMPLE release mapping through the KEEP-list gates (spec section 54)", () => {
  function packageWith(overrides?: { visualScores?: Partial<QaPackage["visual"] extends null ? never : Record<string, number>>; bundleMutator?: (bundle: SiteBundle) => void }): QaPackage {
    const bundle = goodBundle();
    overrides?.bundleMutator?.(bundle);
    const deterministic = runDeterministicBundleQa(qaInput({ bundle }));
    const scores = {
      macroLayout: 94, typography: 93, spacingRhythm: 94, surfaceColor: 93,
      imageTreatment: 91, components: 94, signatureElements: 93, responsive: 92,
      overall: 93,
      ...(overrides?.visualScores ?? {}),
    };
    return buildSimpleQaPackage({
      buildVersionNumber: 1,
      visual: {
        version: "1",
        scores,
        findings: [],
        summary: "Same underlying design.",
      },
      deterministic,
      referenceScreenshotKeys: { desktop: "ref/desktop.png" },
      candidateScreenshotKeys: { desktop: "cand/desktop.png", mobile: "cand/mobile.png" },
    });
  }

  it("a passing package evaluates RELEASE_READY through the legacy evaluators", () => {
    const pkg = packageWith();
    const verdict = simpleReleaseVerdict(pkg, runDeterministicBundleQa(qaInput()).gates);
    expect(verdict.releaseReady).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it("a failing visual category and low overall block release with reasons", () => {
    const pkg = packageWith({ visualScores: { typography: 68, overall: 70 } });
    const verdict = simpleReleaseVerdict(pkg, runDeterministicBundleQa(qaInput()).gates);
    expect(verdict.releaseReady).toBe(false);
    expect(verdict.reasons.join("; ")).toContain("visual fidelity 70 < 90");
  });

  it("truth blockers map to fabrication and block release", () => {
    const dirtyBundle = goodBundle();
    dirtyBundle.pages.home = page("Home", "<p>Award-winning since 1994.</p>");
    const deterministic = runDeterministicBundleQa(qaInput({ bundle: dirtyBundle }));
    const pkg = buildSimpleQaPackage({
      buildVersionNumber: 1,
      visual: null,
      deterministic,
      referenceScreenshotKeys: { desktop: "ref.png" },
      candidateScreenshotKeys: { desktop: "cand.png" },
    });
    const qaA = simplePackageToQaA(pkg);
    expect(qaA.fabrication).toBe(true);
    const verdict = simpleReleaseVerdict(pkg, deterministic.gates);
    expect(verdict.releaseReady).toBe(false);
    expect(verdict.reasons.join("; ")).toContain("fabricated Business Facts");
  });

  it("technical blockers zero the technical score and fail QA-B gates", () => {
    const bundle = goodBundle();
    bundle.pages.about = page("About", `<link rel="stylesheet" href="site.css"><a href="/nope">x</a>`);
    const deterministic = runDeterministicBundleQa(qaInput({ bundle }));
    const pkg = buildSimpleQaPackage({
      buildVersionNumber: 1,
      visual: null,
      deterministic,
      referenceScreenshotKeys: { desktop: "ref.png" },
      candidateScreenshotKeys: { desktop: "cand.png" },
    });
    const qaB = simplePackageToQaB(pkg, deterministic.gates);
    expect(qaB.technicalScore).toBe(0);
    expect(evaluateQaBRelease(qaB).releaseReady).toBe(false);
    const qaA = simplePackageToQaA(pkg);
    expect(evaluateQaARelease(qaA).releaseReady).toBe(false);
  });

  it("every canonical QA-B gate is backed by a named deterministic check", () => {
    const gates = runDeterministicBundleQa(qaInput()).gates;
    for (const [id, passed] of Object.entries(gates)) {
      expect(passed, `gate ${id} should pass on the clean bundle`).toBe(true);
    }
  });
});
