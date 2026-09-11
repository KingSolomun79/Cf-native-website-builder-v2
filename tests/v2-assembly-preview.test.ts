import { describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild, createNextBuildVersion } from "../src/domain/lifecycle";
import {
  assembleBuildVersionCandidate,
  deployPreview,
  AssemblyPreflightError,
  type AssembledCandidate,
} from "../src/domain/assembly";
import { runTechnicalPreflight } from "../src/domain/technical-preflight";
import { getObject, putObject } from "../src/lib/assets";
import type { ImageSlot } from "../src/domain/site-contracts";

// Primary-seam tests for assembly, Technical Preflight and Preview
// deployment (issue #12).

const env = providedEnv as unknown as Env;

const FORM_ENDPOINT = "https://forms.wazibiz.example/api/v2/forms/submit";

const SLOTS: ImageSlot[] = [
  { id: "home-hero", page: "home", semanticRole: "hero", blueprintRole: "role-hero", priority: "CRITICAL", orientation: "landscape", negativeSpaceForText: true },
  { id: "about-main", page: "about", semanticRole: "about lead", blueprintRole: "role-detail", priority: "NORMAL", orientation: "landscape", negativeSpaceForText: false },
];

function shell(title: string, main: string, options: { jsonLd?: boolean } = {}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${title} — Rift Valley Roasters.">
<link rel="stylesheet" href="site.css">
<script src="site.js" defer></script>${options.jsonLd ? `
<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Rift Valley Roasters"}</script>` : ""}
</head>
<body>
<header><nav><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>
<main>${main}</main>
<footer><p>Rift Valley Roasters</p></footer>
</body>
</html>`;
}

function goodPages(options: { heroSrc?: string; aboutSrc?: string; jsonLd?: boolean } = {}): Record<string, string> {
  const heroSrc = options.heroSrc ?? "IMG:home-hero";
  const aboutSrc = options.aboutSrc ?? "IMG:about-main";
  return {
    home: shell("Rift Valley Roasters", `<section><h1>Small-batch roasting</h1><img src="${heroSrc}" data-image-id="home-hero" alt="Roastery"></section>`),
    about: shell("About", `<section><h1>About</h1><img src="${aboutSrc}" data-image-id="about-main" alt="Roastery interior"></section>`),
    services: shell("Services", `<section><h1>Services</h1><p>Roasting for cafes and homes.</p></section>`),
    contact: shell(
      "Contact",
      `<section><h1>Contact</h1>
<form method="post" action="${FORM_ENDPOINT}">
<input type="hidden" name="siteFormId" value="site:test-site">
<label>Name<input name="name" required></label>
<label>Email<input type="email" name="email" required></label>
<label>Message<textarea name="message" required></textarea></label>
<button type="submit">Send</button>
</form></section>`,
      { jsonLd: options.jsonLd }
    ),
  };
}

const SHARED_CSS = ":root{--ink:#111}@media (max-width:768px){main{padding:1rem}}";
const SHARED_JS = "(function(){var t=document.querySelector('.nav-toggle');if(t){t.addEventListener('click',function(){document.body.classList.toggle('open');});}})();";

async function newBuildContext(): Promise<{ siteGenerationId: string; siteId: string; buildId: string; buildVersionId: string }> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Rift Valley Roasters", contactEmail: "hi@rvr.example" },
      reference: { screenshotR2Key: `references/uploads/asm-${Math.random().toString(36).slice(2)}.png` },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return {
    siteGenerationId: started.siteGenerationId,
    siteId: started.siteId,
    buildId: created.buildId,
    buildVersionId: created.buildVersionId,
  };
}

function assemblyInput(
  context: { siteGenerationId: string; buildId: string; buildVersionId: string },
  options: {
    versionNumber?: number;
    pages?: Record<string, string>;
    acceptedImages?: Map<string, string>;
  } = {}
) {
  return {
    buildId: context.buildId,
    buildVersionId: context.buildVersionId,
    buildVersionNumber: options.versionNumber ?? 1,
    siteGenerationId: context.siteGenerationId,
    pages: options.pages ?? goodPages(),
    sharedCss: SHARED_CSS,
    sharedJs: SHARED_JS,
    imagePlanSlots: SLOTS,
    acceptedImages: options.acceptedImages ?? new Map<string, string>(),
    formServiceEndpoint: FORM_ENDPOINT,
    expectedSiteFormId: "site:test-site",
  };
}

async function seedAcceptedImages(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const slot of SLOTS) {
    const key = `builds/test-${slot.id}/v1/assets/images/${slot.id}-a1.webp`;
    await putObject(env, key, new TextEncoder().encode(`WEBP-${slot.id}`));
    map.set(slot.id, key);
  }
  return map;
}

describe("Technical Preflight", () => {
  it("rejects malformed candidates deterministically", () => {
    const pages = goodPages();
    const broken: Record<string, string> = {
      ...pages,
      home: pages.home
        .replace("<title>Rift Valley Roasters</title>", "")
        .replace('src="IMG:home-hero"', 'src="https://tmp.kie.example/xyz.webp"'),
      about: pages.about.replace("</section>", "</div>"),
    };
    const verdict = runTechnicalPreflight(
      { pages: broken, sharedCss: SHARED_CSS, sharedJs: "function ({" },
      { formServiceEndpoint: FORM_ENDPOINT, expectedSiteFormId: "site:test-site", criticalSlots: [{ slotId: "home-hero", page: "home" }] }
    );
    expect(verdict.passed).toBe(false);
    const ids = verdict.blockers.map((blocker) => blocker.id);
    expect(ids).toContain("MISSING_METADATA");
    expect(ids).toContain("TEMP_PROVIDER_URL");
    expect(ids).toContain("MALFORMED_HTML");
    expect(ids).toContain("FATAL_JS_ERROR");
    expect(ids).toContain("MISSING_CRITICAL_IMAGE");
  });

  it("passes a complete well-formed candidate", () => {
    const verdict = runTechnicalPreflight(
      { pages: goodPages({ heroSrc: "assets/images/home-hero.webp", aboutSrc: "assets/images/about-main.webp" }), sharedCss: SHARED_CSS, sharedJs: SHARED_JS },
      { formServiceEndpoint: FORM_ENDPOINT, expectedSiteFormId: "site:test-site", criticalSlots: [{ slotId: "home-hero", page: "home" }] }
    );
    expect(verdict.passed).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });
});

describe("assembly and preview deployment", () => {
  it("resolves performance-hint preload references (href=\"IMG:…\") through the same plan map (live A/B evidence 2026-09-11)", async () => {
    const context = await newBuildContext();
    const accepted = await seedAcceptedImages();
    const pages = goodPages();
    pages.home = pages.home.replace(
      "<head>",
      '<head><link rel="preload" as="image" href="IMG:home-hero" fetchpriority="high">'
    );
    const candidate = await assembleBuildVersionCandidate(env, assemblyInput(context, { acceptedImages: accepted, pages }));
    expect(candidate.pages.home).toContain('href="assets/images/home-hero.webp"');
    expect(candidate.pages.home).not.toContain("IMG:");
  });

  it("assembles the immutable candidate with resolved images and deploys the exact Build Version as Preview", async () => {
    const context = await newBuildContext();
    const accepted = await seedAcceptedImages();
    const input = assemblyInput(context, { acceptedImages: accepted, pages: goodPages() });

    const deployedFiles: Map<string, Uint8Array> = new Map();
    const deployer = vi.fn(async ({ files }: { files: Map<string, Uint8Array> }) => {
      deployedFiles.clear();
      for (const [path, bytes] of files) deployedFiles.set(path, bytes);
      return { previewUrl: `https://${"b-test"}.wazibizwebsites.workers.dev/` };
    });

    const candidate = await assembleBuildVersionCandidate(env, input);
    const deployment = await deployPreview(env, {
      buildId: context.buildId,
      buildVersionId: context.buildVersionId,
      buildVersionNumber: 1,
      candidate,
      deployer,
    });

    // Placeholders resolved to bundled assets; no temporary provider URL.
    expect(candidate.pages.home).toContain('src="assets/images/home-hero.webp"');
    expect(candidate.pages.home).not.toContain("IMG:");
    expect(candidate.pages.contact).toContain(FORM_ENDPOINT);

    // The deployed bytes are exactly the manifest files (pages, css, js, images).
    expect([...deployedFiles.keys()].sort()).toEqual(
      ["about.html", "assets/images/about-main.webp", "assets/images/home-hero.webp", "contact.html", "index.html", "services.html", "site.css", "site.js"].sort()
    );
    expect(deployer).toHaveBeenCalledTimes(1);

    // Deployment row pins the exact artifact manifest hash.
    expect(deployment.alreadyActive).toBe(false);
    expect(deployment.artifactManifestHash).toBe(candidate.artifactManifestHash);
    const row = await env.DB.prepare("SELECT * FROM build_deployments WHERE id = ?")
      .bind(deployment.deploymentId)
      .first<{ role: string; status: string; artifact_manifest_hash: string; worker_name: string }>();
    expect(row!.role).toBe("preview");
    expect(row!.status).toBe("active");
    expect(row!.artifact_manifest_hash).toBe(candidate.artifactManifestHash);

    // Manifest persisted and immutable.
    const manifest = await getObject(env, candidate.manifestR2Key);
    expect(manifest).not.toBeNull();

    // Workflow advanced to PREVIEW without regeneration between preflight
    // and deploy (same candidate object, one deploy).
    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at")
      .bind(context.buildId)
      .all<{ to_state: string }>();
    expect((events.results ?? []).map((event) => event.to_state)).toEqual([
      "INTAKE_READY", "ASSEMBLY", "TECHNICAL_PREFLIGHT", "PREVIEW",
    ]);

    // Idempotent: re-deploying the same exact candidate is a no-op read.
    const again = await deployPreview(env, {
      buildId: context.buildId, buildVersionId: context.buildVersionId, buildVersionNumber: 1, candidate, deployer,
    });
    expect(again.alreadyActive).toBe(true);
    expect(again.deploymentId).toBe(deployment.deploymentId);
    expect(deployer).toHaveBeenCalledTimes(1);
  });

  it("rejects candidates that fail preflight before anything ships", async () => {
    const context = await newBuildContext();
    // No accepted images at all: CRITICAL slot unresolved.
    await expect(assembleBuildVersionCandidate(env, assemblyInput(context))).rejects.toBeInstanceOf(AssemblyPreflightError);

    // Workflow-retry safety (issue #34 class): a retried re-run of the
    // rejected assembly re-freezes its diagnostic manifest and surfaces the
    // PREFLIGHT rejection again — never "Immutable R2 artifact already
    // exists" from its own earlier diagnostic write.
    await expect(assembleBuildVersionCandidate(env, assemblyInput(context))).rejects.toBeInstanceOf(AssemblyPreflightError);

    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ?")
      .bind(context.buildId)
      .all<{ to_state: string }>();
    expect((events.results ?? []).map((event) => event.to_state)).toEqual(["INTAKE_READY"]);

    const deployments = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_deployments WHERE build_id = ?")
      .bind(context.buildId)
      .first<{ n: number }>();
    expect(deployments!.n).toBe(0);
  });

  it("routes an un-accepted slot to an Accepted Image of the same Blueprint role before regeneration", async () => {
    const context = await newBuildContext();
    const threeSlots: ImageSlot[] = [
      ...SLOTS,
      { id: "services-detail", page: "services", semanticRole: "craft detail", blueprintRole: "role-detail", priority: "NORMAL", orientation: "landscape", negativeSpaceForText: false },
    ];
    const accepted = await seedAcceptedImages(); // home-hero + about-main only
    const input = assemblyInput(context, { acceptedImages: accepted, pages: goodPages() });
    input.imagePlanSlots = threeSlots;

    // services-detail lost its own acceptance but role-detail has one: asset
    // routing reuses it instead of spending regeneration budget.
    const candidate = await assembleBuildVersionCandidate(env, input);
    expect(candidate.routingNotes.some((note) => note.includes("services-detail") && note.includes("asset-routing"))).toBe(true);
    expect(candidate.files.has("assets/images/services-detail.webp")).toBe(true);

    // With no same-role acceptance at all, the placeholder stays and
    // Technical Preflight rejects the candidate.
    const bare = await newBuildContext();
    const onlyHero = await seedAcceptedImages();
    onlyHero.delete("about-main");
    const bareInput = assemblyInput(bare, { acceptedImages: onlyHero, pages: goodPages() });
    await expect(assembleBuildVersionCandidate(env, bareInput)).rejects.toMatchObject({
      name: "AssemblyPreflightError",
    });
  });

  it("superseding a candidate creates a distinct Build Version and deployment instead of mutating", async () => {
    const context = await newBuildContext();
    const accepted = await seedAcceptedImages();
    const input = assemblyInput(context, { acceptedImages: accepted, pages: goodPages() });

    const candidateV1 = await assembleBuildVersionCandidate(env, input);
    const deployer = vi.fn(async () => ({ previewUrl: "https://b-test.wazibizwebsites.workers.dev/" }));
    const v1 = await deployPreview(env, { buildId: context.buildId, buildVersionId: context.buildVersionId, buildVersionNumber: 1, candidate: candidateV1, deployer });

    // A material change supersedes via a NEW immutable Build Version.
    const next = await createNextBuildVersion(env, { buildId: context.buildId, cause: "automated_repair" });
    const changedPages = goodPages();
    changedPages.home = changedPages.home.replace("<h1>Small-batch roasting</h1>", "<h1>Small-batch roasting, revised</h1>");
    const candidateV2 = await assembleBuildVersionCandidate(env, {
      ...input,
      buildVersionId: next.buildVersionId,
      buildVersionNumber: next.buildVersionNumber,
      pages: changedPages,
    });
    const v2 = await deployPreview(env, { buildId: context.buildId, buildVersionId: next.buildVersionId, buildVersionNumber: next.buildVersionNumber, candidate: candidateV2, deployer });

    expect(candidateV2.artifactManifestHash).not.toBe(candidateV1.artifactManifestHash);
    expect(v2.deploymentId).not.toBe(v1.deploymentId);
    expect(v2.alreadyActive).toBe(false);

    // The v1 deployment keeps its exact deployed hash; its role status is
    // superseded by v2's preview (retention lifecycle, issue #16) but the
    // row was never mutated in content or reassigned to v2.
    const v1Row = await env.DB.prepare("SELECT artifact_manifest_hash, status FROM build_deployments WHERE id = ?")
      .bind(v1.deploymentId)
      .first<{ artifact_manifest_hash: string; status: string }>();
    expect(v1Row!.artifact_manifest_hash).toBe(candidateV1.artifactManifestHash);
    expect(v1Row!.status).toBe("superseded");

    // Both candidates' source sets coexist immutably.
    const v1Html = await getObject(env, `builds/${context.buildId}/v1/source/index.html`);
    const v2Html = await getObject(env, `builds/${context.buildId}/v2/source/index.html`);
    expect(await new Response(v1Html!).text()).toContain("Small-batch roasting</h1>");
    expect(await new Response(v2Html!).text()).toContain("revised");
  });
});
