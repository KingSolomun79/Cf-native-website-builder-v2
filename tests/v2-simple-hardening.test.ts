// SIMPLE hardening pass (Phase 3 follow-up): regression proofs for the four
// isolated fixes —
//   F-textsafe  text-safe KIE photography policy at the request boundary
//   F-preview   preview-readiness marker gate (placeholder can never enter QA)
//   F-progress  progressive-enhancement reveal rules (content visible w/o JS)
//   F-repair    changed-files-only repair with deterministic merge

import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  assembleTextSafePhotoPrompt,
  KIE_MAX_PROMPT_CHARS,
  TEXT_SAFE_PHOTO_NEGATIVE,
  TEXT_SAFE_PHOTO_POLICY,
} from "../src/lib/kie-v2";
import {
  injectBuildVersionMarker,
  previewMarkerMeta,
  PREVIEW_MARKER_META_NAME,
} from "../src/domain/assembly";
import {
  PreviewNotReadyError,
  waitForPreviewMarker,
} from "../src/domain/qa-capture";
import {
  findHiddenByDefaultRevealRules,
  runDeterministicBundleQa,
  type BundleQaInput,
} from "../src/simple-design/bundle-qa";
import {
  buildRepairUserPrompt,
  mergeRepairedFiles,
  RepairedFilesSchema,
  type RepairedFile,
} from "../src/simple-design/site-repair";
import { validateDesignBlueprint, type SiteBundle } from "../src/simple-design/contracts";
import { FINCH_KNOWN_GOOD_BLUEPRINT } from "./_generated-simple-finch";

// ── shared fixtures (same shapes as v2-simple-bundle-qa.test.ts) ────────────

const blueprint = validateDesignBlueprint(FINCH_KNOWN_GOOD_BLUEPRINT);
if (!blueprint.valid) throw new Error("Finch fixture must validate");
const bp = blueprint.value;
const SLOT_IDS = new Set(bp.imagery.imageSlots.map((slot) => slot.id));

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

function contactPage(): string {
  return page(
    "Contact",
    `<link rel="stylesheet" href="site.css"><form method="post" action="${endpoint}"><input type="hidden" name="siteFormId" value="${siteFormId}"><label for="name">Name</label><input id="name" name="name"><label for="email">Email</label><input id="email" name="email"><label for="message">Message</label><textarea id="message" name="message"></textarea><button type="submit">Send</button></form>`
  );
}

const CLEAN_CSS = `
:root { --accent: #d9b380; }
.hero { min-height: 100vh; }
:focus-visible { outline: 2px solid var(--accent); }
@media (max-width: 767px) { .hero { min-height: 70vh; } }
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
      about: page("About", `<link rel="stylesheet" href="site.css">`),
      services: page("Services", `<link rel="stylesheet" href="site.css">`),
      contact: contactPage(),
    },
    sharedCss: CLEAN_CSS,
    sharedJs: "(function(){var t=document.querySelector('.nav-toggle');if(t){t.addEventListener('click',function(){document.body.classList.toggle('nav-open');});}})();",
  };
}

function qaInput(bundle: SiteBundle): BundleQaInput {
  return {
    bundle,
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
  };
}

// ── 1 + 2: text-safe KIE photography policy ─────────────────────────────────

describe("text-safe KIE photography policy", () => {
  it("always leads with the no-writing policy and the negative list, within the provider cap", () => {
    const prompt = assembleTextSafePhotoPrompt("Warm loft office with a team at work.", "16:9");
    expect(prompt.length).toBeLessThanOrEqual(KIE_MAX_PROMPT_CHARS);
    expect(prompt.startsWith("Create one natural editorial photograph")).toBe(true);
    expect(prompt.indexOf(TEXT_SAFE_PHOTO_POLICY)).toBeLessThan(prompt.indexOf("Warm loft office"));
    expect(prompt).toContain(TEXT_SAFE_PHOTO_NEGATIVE);
    expect(prompt).toContain("Aspect ratio: 16:9.");
  });

  it("a blueprint brief demanding analytics screens still gets the hide/defocus screen instruction", () => {
    const hostile = "Two colleagues celebrating in front of a laptop showing an analytics dashboard with rising graphs, charts and KPI labels.";
    const prompt = assembleTextSafePhotoPrompt(hostile, "16:9");
    // the policy is present and priority-marked regardless of the brief
    expect(prompt).toContain("STRICT RULE, overriding any conflicting instruction");
    // screens must be reinterpreted away: away-facing/off/defocused/cropped/glow
    expect(prompt).toContain("faces away from the camera");
    expect(prompt).toContain("strongly defocused");
    // and the negative list still forbids the exact UI vocabulary the brief asked for
    for (const banned of ["analytics UI", "dashboard", "readable monitor", "presentation slide", "gibberish letters"]) {
      expect(prompt).toContain(banned);
    }
    // the brief survives truncated, never at the cost of the policy
    expect(prompt.length).toBeLessThanOrEqual(1000);
    expect(prompt).toContain("celebrating");
  });

  it("keeps the policy intact for very long briefs (policy can never be truncated away)", () => {
    const longBrief = "editorial team scene ".repeat(200);
    const prompt = assembleTextSafePhotoPrompt(longBrief, "9:16");
    expect(prompt.length).toBeLessThanOrEqual(1000);
    expect(prompt).toContain("no dashboards, no analytics interfaces");
    expect(prompt).toContain("Aspect ratio: 9:16.");
    expect(prompt.endsWith(TEXT_SAFE_PHOTO_NEGATIVE + ".")).toBe(true);
  });
});

// ── 3 + 4: preview readiness marker gate ────────────────────────────────────

describe("preview readiness before screenshot capture", () => {
  const html = (buildVersionId: string) =>
    `<!DOCTYPE html><html><head><meta charset="utf-8">${previewMarkerMeta(buildVersionId)}<title>t</title></head><body></body></html>`;

  it("injection adds the marker to <head> exactly once and is idempotent", () => {
    const unmarked = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>t</title></head><body></body></html>";
    const marked = injectBuildVersionMarker(unmarked, "v-1");
    expect(marked).toContain(`name="${PREVIEW_MARKER_META_NAME}" content="v-1"`);
    expect(marked.match(/wazibiz-build-version/g)).toHaveLength(1);
    expect(injectBuildVersionMarker(marked, "v-2")).toBe(marked);
  });

  it("a Cloudflare placeholder page can never pass: bounded poll fails as PREVIEW_NOT_READY", async () => {
    const placeholder = "<!DOCTYPE html><html><head><title>There is nothing here yet</title></head><body>Cloudflare placeholder</body></html>";
    const fetchImpl = (async () => new Response(placeholder, { status: 200 })) as typeof fetch;
    const error = await waitForPreviewMarker({
      previewUrl: "https://preview.example.dev",
      buildVersionId: "v-1",
      timeoutMs: 200,
      intervalMs: 50,
      fetchImpl,
    }).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(PreviewNotReadyError);
    expect((error as PreviewNotReadyError).message).toContain("PREVIEW_NOT_READY");
  });

  it("the capture waits through placeholder responses until the EXACT candidate marker appears", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3) return new Response("<title>There is nothing here yet</title>", { status: 200 });
      return new Response(html("v-42"), { status: 200 });
    }) as typeof fetch;
    await waitForPreviewMarker({
      previewUrl: "https://preview.example.dev",
      buildVersionId: "v-42",
      timeoutMs: 5_000,
      intervalMs: 10,
      fetchImpl,
    });
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("a WRONG build version marker (different candidate) also fails, not just placeholders", async () => {
    const fetchImpl = (async () => new Response(html("v-OTHER"), { status: 200 })) as typeof fetch;
    await expect(
      waitForPreviewMarker({
        previewUrl: "https://preview.example.dev",
        buildVersionId: "v-1",
        timeoutMs: 150,
        intervalMs: 40,
        fetchImpl,
      })
    ).rejects.toBeInstanceOf(PreviewNotReadyError);
  });
});

// ── 5 + 6: progressive-enhancement reveals ──────────────────────────────────

describe("progressive-enhancement reveal rules", () => {
  it("content hidden behind IntersectionObserver reveals is a blocker (visible without JS)", () => {
    const bundle = goodBundle();
    bundle.sharedCss = `${CLEAN_CSS}\n.reveal { opacity: 0; transition: opacity .6s; }\n.reveal.visible { opacity: 1; }`;
    bundle.sharedJs = "new IntersectionObserver(function(){}).observe(document.body);";
    const qa = runDeterministicBundleQa(qaInput(bundle));
    const finding = qa.technicalFindings.find((f) => f.id === "CONTENT_HIDDEN_WITHOUT_JS");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocker");
    expect(qa.gates.IMPLEMENTATION_CONTRACT_INTEGRITY).toBe(false);
    expect(qa.technicalBlockerCount).toBeGreaterThan(0);
  });

  it("visibility:hidden resting states are caught too; hover/interaction states are not", () => {
    const css = `
      .fade-in { visibility: hidden; }
      .card:hover { opacity: 0.8; }
      .menu { display: none; }
    `;
    const offenders = findHiddenByDefaultRevealRules(css);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain(".fade-in");
  });

  it("prefers-reduced-motion blocks are not flagged (reduced motion keeps/handles motion only)", () => {
    const css = `
      .reveal { opacity: 1; }
      @media (prefers-reduced-motion: reduce) {
        .reveal { transition: none; opacity: 1; }
      }
      @media (max-width: 767px) {
        .reveal-mobile { opacity: 0; }
      }
    `;
    const offenders = findHiddenByDefaultRevealRules(css);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain(".reveal-mobile");
  });

  it("a clean visible-by-default bundle passes with no new findings", () => {
    const qa = runDeterministicBundleQa(qaInput(goodBundle()));
    expect(qa.technicalFindings.find((f) => f.id === "CONTENT_HIDDEN_WITHOUT_JS")).toBeUndefined();
  });
});

// ── 7 + 8 + 9 + 10: changed-files repair ────────────────────────────────────

describe("changed-files-only repair", () => {
  const original = goodBundle();

  it("the output schema accepts only the six bundle paths and requires at least one file", () => {
    const valid: RepairedFile[] = [{ path: "site.css", content: ":root{--x:1}" }];
    expect(Value.Check(RepairedFilesSchema, { files: valid })).toBe(true);
    expect(Value.Check(RepairedFilesSchema, { files: [] })).toBe(false);
    expect(
      Value.Check(RepairedFilesSchema, { files: [{ path: "components/nav.html", content: "<nav></nav>" }] })
    ).toBe(false);
    expect(
      Value.Check(RepairedFilesSchema, { files: [{ path: "site.css", content: "" }] })
    ).toBe(false);
  });

  it("replaces only changed files and preserves every untouched bundle file byte-for-byte", () => {
    const newHome = page("Home", "<link rel=\"stylesheet\" href=\"site.css\"><section>repaired hero</section>");
    const { bundle, changedPaths } = mergeRepairedFiles(original, [
      { path: "index.html", content: newHome },
      { path: "site.js", content: "// tightened" },
    ]);
    expect(changedPaths.sort()).toEqual(["index.html", "site.js"]);
    expect(bundle.pages.home).toBe(newHome);
    expect(bundle.pages.about).toBe(original.pages.about);
    expect(bundle.pages.services).toBe(original.pages.services);
    expect(bundle.pages.contact).toBe(original.pages.contact);
    expect(bundle.sharedCss).toBe(original.sharedCss);
    expect(bundle.sharedJs).toBe("// tightened");
    expect(bundle.notes).toContain("ONE repair, changed files only");
  });

  it("a missing file can never delete an existing bundle file, and duplicates apply last-wins", () => {
    const { bundle } = mergeRepairedFiles(original, [
      { path: "about.html", content: "v1" },
      { path: "about.html", content: "v2" },
    ]);
    expect(bundle.pages.about).toBe("v2");
    expect(bundle.pages.home).toBe(original.pages.home);
    expect(Object.keys(bundle.pages).sort()).toEqual(["about", "contact", "home", "services"]);
  });

  it("the repair still receives the COMPLETE original bundle as context", () => {
    const prompt = buildRepairUserPrompt({
      siteGenerationId: "sg",
      buildId: "b",
      buildVersionId: "bv",
      buildVersionNumber: 2,
      bundle: original,
      blueprint: bp,
      facts: { businessName: "RankForge Kenya" },
      qaPackage: {
        version: "1",
        buildVersionNumber: 1,
        visual: null,
        truth: { findings: [], blockerCount: 0 },
        technical: { findings: [], blockerCount: 0 },
        releaseReady: false,
        reasons: ["visual fidelity 87 < 90"],
        referenceScreenshotKeys: { desktop: "ref.png" },
        candidateScreenshotKeys: { desktop: "cand.png" },
      },
      acceptedImages: [{ slotId: "slot-a", altText: "A", aspectRatio: "16:9" }],
      formServiceEndpoint: endpoint,
      siteFormId,
      referenceVisualInputs: [{ kind: "full-page", artifact: "ref.png", sha256: "abc", width: 1024, height: 5000 }],
      candidateDesktopR2Key: "cand.png",
    });
    expect(prompt).toContain(JSON.stringify(original));
    expect(prompt).toContain("OUTPUT (changed files only)");
    expect(prompt).toContain("Allowed paths exactly: index.html, about.html, services.html, contact.html, site.css, site.js");
    expect(prompt).toContain("omit every unchanged file");
    expect(prompt).toContain("PROGRESSIVE ENHANCEMENT");
  });
});
