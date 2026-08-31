import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import type { ProvenanceManifestV1, SiteSpec } from "../src/types";
import {
  attachProvenanceManifestToSiteSpec,
  attachProvenanceToSiteSpec,
  buildProvenanceManifest,
  extractHtmlBlocks,
  validateProvenanceManifest,
  verifyProvenanceAgainstBundle,
} from "../src/lib/provenance";
import { createProvenanceArtifact, createSiteVersion } from "../src/lib/db";
import { buildRenderContent } from "../src/render/content";
import { renderBlueprintSite } from "../src/render/site-renderer";
import { makeDesign, makeInteraction, makeIntake } from "./helpers/blueprint-fixtures";

const context = {
  jobId: "job-provenance",
  siteId: "site-provenance",
  clientSlug: "acme",
  siteVersion: 1,
  createdAt: "2026-08-11T12:00:00.000Z",
};

function minimalSpec(body: string): SiteSpec {
  return {
    site: {
      companyName: "Acme Studio",
      clientEmail: "hello@acme.example",
      businessType: "design services",
      brandSummary: "Acme Studio crafts brand identities for ambitious startups.",
      idealClientProfile: "early-stage startups",
      mode: "light",
      logoUrl: "",
      socials: { facebook: null, instagram: null, twitter: null, linkedin: null, other: null },
    },
    pages: [{
      slug: "/",
      name: "Home",
      seoTitle: "Acme Studio design services",
      metaDescription: "Acme Studio crafts brand identities for ambitious startups.",
      h1: "Acme Studio",
      sections: [{ type: "text-block", heading: "About", subheading: null, body, items: null, ctaLabel: null, ctaHref: null, inverted: false }],
      images: [],
      internalLinks: [],
    }],
    seo: { localBusiness: { name: "Acme Studio", addressLocality: null, addressCountry: null, telephone: null, url: "https://acme.example" }, sameAs: [] },
  };
}

describe("factual provenance contracts", () => {
  it("stores source metadata and hashes without persisting raw personal facts", async () => {
    const intake = makeIntake();
    const manifest = await buildProvenanceManifest({
      ...context,
      intake,
      blocks: [{ path: "index.html#text[0]", page: "index.html", text: "Email hello@acme.example at 12 Market Street" }],
    });
    const serialized = JSON.stringify(manifest);
    expect(manifest.sources.find((source) => source.id === "client:clientEmail")).toMatchObject({
      type: "client_input",
      location: "intake.clientEmail",
      extractedAt: context.createdAt,
      confidence: null,
    });
    expect(serialized).not.toContain("hello@acme.example");
    expect(serialized).not.toContain("12 Market Street");
    expect(manifest.sources.every((source) => /^[a-f0-9]{64}$/.test(source.valueHash))).toBe(true);
  });

  it.each([
    ["numbers", "We have served 500 clients."],
    ["testimonials", "Five-star testimonials prove our quality."],
    ["credentials", "We are certified and accredited."],
    ["locations", "Visit us on Invented Road in Nairobi city."],
    ["partnerships", "We are partnered with a global foundation."],
    ["awards", "We are an award-winning organization."],
    ["organizational claims", "Acme Studio operates the region's largest creative team."],
  ])("blocks invented high-risk %s", async (_category, text) => {
    const manifest = await buildProvenanceManifest({ ...context, intake: makeIntake({ addressLine1: null, city: null, county: null }), blocks: [{ path: "pages[0].sections[0].body", text }] });
    const result = validateProvenanceManifest(manifest);
    expect(result.blocking).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PROVENANCE_UNSUPPORTED_FACT", severity: "critical" })]));
    expect(JSON.stringify(result)).not.toContain(text);
  });

  it("accepts a high-risk claim when the client supplied that exact fact", async () => {
    const intake = makeIntake({ businessDescription: "Acme Studio has served 500 clients since 2019." });
    const manifest = await buildProvenanceManifest({ ...context, intake, blocks: [{ path: "pages[0].body", text: intake.businessDescription! }] });
    expect(validateProvenanceManifest(manifest)).toMatchObject({ valid: true, blocking: false });
    expect(manifest.claims[0]).toMatchObject({ classification: "factual", risk: "high", status: "accepted", sourceIds: ["client:businessDescription"] });
  });

  it("accepts a high-risk claim from an explicitly approved source", async () => {
    const intake = makeIntake({
      approvedSourceFacts: [{
        schemaVersion: 1,
        id: "registry-record",
        value: "Acme Studio was registered in 2019.",
        location: "approved.registry.record-1",
        extractedAt: context.createdAt,
        confidence: 0.95,
      }],
    });
    const manifest = await buildProvenanceManifest({ ...context, intake, blocks: [{ path: "pages[0].body", text: "Acme Studio was registered in 2019." }] });
    expect(validateProvenanceManifest(manifest)).toMatchObject({ valid: true, blocking: false });
    expect(manifest.claims[0].sourceIds).toContain("approved:registry-record");
  });

  it("does not treat the company name alone as support for a larger factual claim", async () => {
    const manifest = await buildProvenanceManifest({
      ...context,
      intake: makeIntake({ businessType: "design services", businessDescription: null }),
      blocks: [{ path: "pages[0].body", text: "Acme Studio offers free legal services." }],
    });
    expect(manifest.claims[0]).toMatchObject({ classification: "factual", status: "unsupported", sourceIds: [] });
    expect(validateProvenanceManifest(manifest)).toMatchObject({ valid: false, blocking: true });
  });

  it("accepts deterministic labels composed only from exact client fields", async () => {
    const manifest = await buildProvenanceManifest({
      ...context,
      intake: makeIntake({ businessType: "design services" }),
      blocks: [{ path: "index.html#text[0]", text: "Our Design Services - Acme Studio" }],
    });
    expect(manifest.claims[0]).toMatchObject({ classification: "factual", status: "accepted" });
    expect(manifest.claims[0].sourceIds).toEqual(expect.arrayContaining(["client:companyName", "client:businessType"]));
  });

  it.each([
    "We help hospitals manage patient records.",
    "Based in Inventedville.",
    "Trusted by Global Foundation.",
  ])("blocks unsupported standard factual language: %s", async (text) => {
    const manifest = await buildProvenanceManifest({ ...context, intake: makeIntake(), blocks: [{ path: "pages[0].body", text }] });
    expect(manifest.claims[0]).toMatchObject({ classification: "factual", status: "unsupported", sourceIds: [] });
    expect(validateProvenanceManifest(manifest).valid).toBe(false);
  });

  it("never accepts reference-design evidence as a client fact", () => {
    const manifest: ProvenanceManifestV1 = {
      schemaVersion: 1,
      id: "manifest-reference",
      ...context,
      parentArtifactId: null,
      createdAt: context.createdAt,
      sources: [{ id: "reference:homepage", type: "reference_design", location: "reference.homepage", extractedAt: context.createdAt, confidence: 0.9, valueHash: "a".repeat(64) }],
      claims: [{ id: "claim:1", path: "pages[0].body", textHash: "b".repeat(64), classification: "factual", risk: "high", status: "accepted", sourceIds: ["reference:homepage"] }],
      pageEvidence: [],
    };
    const result = validateProvenanceManifest(manifest);
    expect(result.blocking).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toContain("PROVENANCE_REFERENCE_AS_CLIENT_FACT");
  });

  it("distinguishes non-factual marketing language from sourced facts", async () => {
    const manifest = await buildProvenanceManifest({
      ...context,
      intake: makeIntake(),
      blocks: [
        { path: "index.html#text[0]", text: "Explore what is possible." },
        { path: "index.html#text[1]", text: "Acme Studio" },
      ],
    });
    expect(manifest.claims[0]).toMatchObject({ classification: "marketing", status: "accepted", sourceIds: [] });
    expect(manifest.claims[1]).toMatchObject({ classification: "factual", status: "accepted", sourceIds: ["client:companyName"] });
  });

  it("attaches claim references and preserves revision lineage", async () => {
    const initial = await attachProvenanceToSiteSpec(minimalSpec("Acme Studio crafts brand identities for ambitious startups."), { ...context, intake: makeIntake() });
    const revised = await attachProvenanceToSiteSpec(minimalSpec("Acme Studio supports early-stage startups."), {
      ...context,
      siteVersion: 2,
      intake: makeIntake(),
      parentArtifactId: initial.provenance!.id,
    });
    expect(initial.pages[0].sections[0].provenanceClaimIds!.length).toBeGreaterThan(0);
    expect(revised.provenance!.parentArtifactId).toBe(initial.provenance!.id);
    expect(revised.provenance!.siteVersion).toBe(2);
  });

  it("attaches the persisted rendered manifest without introducing an orphan parent", async () => {
    const initial = await attachProvenanceToSiteSpec(minimalSpec("Acme Studio crafts brand identities for ambitious startups."), { ...context, intake: makeIntake() });
    const finalManifest = await buildProvenanceManifest({
      ...context,
      siteVersion: 2,
      intake: makeIntake(),
      parentArtifactId: initial.provenance!.id,
      blocks: [{ path: "pages[0].sections[0].body", text: "Acme Studio supports early-stage startups." }],
    });
    const attached = attachProvenanceManifestToSiteSpec(minimalSpec("Acme Studio supports early-stage startups."), finalManifest);

    expect(attached.provenance).toBe(finalManifest);
    expect(attached.provenance!.parentArtifactId).toBe(initial.provenance!.id);
    expect(attached.pages[0].sections[0].provenanceClaimIds).toEqual([finalManifest.claims[0].id]);
  });

  it("detects rendered text changes after provenance acceptance", async () => {
    const files = new Map<string, string | ArrayBuffer>([["index.html", "<!doctype html><html><head><title>Acme Studio</title></head><body><h1>Acme Studio</h1><p>Explore what is possible.</p></body></html>"]]);
    const manifest = await buildProvenanceManifest({ ...context, intake: makeIntake(), blocks: extractHtmlBlocks(files) });
    expect(await verifyProvenanceAgainstBundle(manifest, files)).toMatchObject({ valid: true, blocking: false });
    files.set("index.html", "<!doctype html><html><head><title>Acme Studio</title></head><body><h1>Acme Studio</h1><p>We have served 500 clients.</p></body></html>");
    const result = await verifyProvenanceAgainstBundle(manifest, files);
    expect(result.blocking).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toContain("PROVENANCE_BUNDLE_MISMATCH");
  });

  it("accepts the complete deterministic blueprint bundle from client facts", async () => {
    const intake = makeIntake();
    const rendered = renderBlueprintSite({
      design: makeDesign(),
      interaction: makeInteraction(),
      content: buildRenderContent(intake),
      siteUrl: "https://acme.example",
    });
    const blocks = extractHtmlBlocks(rendered.files);
    const manifest = await buildProvenanceManifest({ ...context, intake, blocks });
    expect(manifest.claims.filter((claim) => claim.status === "unsupported").map((claim) => ({ path: claim.path, text: blocks.find((block) => block.path === claim.path)?.text }))).toEqual([]);
    expect(validateProvenanceManifest(manifest)).toMatchObject({ valid: true, blocking: false });
    expect(await verifyProvenanceAgainstBundle(manifest, rendered.files)).toMatchObject({ valid: true, blocking: false });
  });
});

describe("provenance persistence", () => {
  it("stores the artifact with job and site-version lineage", async () => {
    const env: Env = providedEnv;
    const suffix = crypto.randomUUID();
    const clientId = `client-${suffix}`;
    const siteId = `site-${suffix}`;
    const jobId = `job-${suffix}`;
    const versionId = `version-${suffix}`;
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO clients (id, slug, company_name, client_email, mode, website_overall_style, created_at, updated_at) VALUES (?, ?, ?, ?, 'light', 'minimalist-monochrome', ?, ?)").bind(clientId, `slug-${suffix}`, "Acme", "hello@acme.example", now, now).run();
    await env.DB.prepare("INSERT INTO sites (id, client_id, status, style_key, style_version, created_at, updated_at) VALUES (?, ?, 'running', 'minimalist-monochrome', '1', ?, ?)").bind(siteId, clientId, now, now).run();
    await env.DB.prepare("INSERT INTO jobs (id, site_id, client_id, job_type, status, created_at, updated_at) VALUES (?, ?, ?, 'initial_build', 'running', ?, ?)").bind(jobId, siteId, clientId, now, now).run();
    const version = {
      id: versionId,
      site_id: siteId,
      version_number: 1,
      source_type: "initial_build",
      source_job_id: jobId,
      build_manifest_r2_key: "slug/versions/v1/bundle/manifest.json",
      static_bundle_r2_prefix: "slug/versions/v1/bundle",
      deployed_worker_name: "site-acme",
      preview_url: "https://preview.example",
      qa_report_id: null,
    };
    await createSiteVersion(env.DB, version);
    await createSiteVersion(env.DB, version);
    const manifest = await buildProvenanceManifest({ ...context, jobId, siteId, intake: makeIntake(), blocks: [{ path: "index.html#text[0]", text: "Acme Studio", page: "index.html" }] });
    await createProvenanceArtifact(env.DB, {
      id: manifest.id,
      job_id: jobId,
      site_version_id: versionId,
      site_version: 1,
      schema_version: 1,
      parent_artifact_id: null,
      r2_key: `slug/versions/v1/provenance/${manifest.id}/manifest.json`,
      manifest_json: JSON.stringify(manifest),
      validation_json: JSON.stringify(validateProvenanceManifest(manifest)),
      created_at: manifest.createdAt,
    });
    await createProvenanceArtifact(env.DB, {
      id: manifest.id,
      job_id: jobId,
      site_version_id: versionId,
      site_version: 1,
      schema_version: 1,
      parent_artifact_id: null,
      r2_key: `slug/versions/v1/provenance/${manifest.id}/manifest.json`,
      manifest_json: JSON.stringify(manifest),
      validation_json: JSON.stringify(validateProvenanceManifest(manifest)),
      created_at: manifest.createdAt,
    });
    await expect(createProvenanceArtifact(env.DB, {
      id: manifest.id,
      job_id: jobId,
      site_version_id: versionId,
      site_version: 1,
      schema_version: 1,
      parent_artifact_id: null,
      r2_key: "slug/versions/v1/provenance/conflicting/manifest.json",
      manifest_json: JSON.stringify(manifest),
      validation_json: JSON.stringify(validateProvenanceManifest(manifest)),
      created_at: manifest.createdAt,
    })).rejects.toThrow("conflicts with an existing immutable record");
    const stored = await env.DB.prepare("SELECT job_id, site_version_id, site_version, schema_version, r2_key FROM provenance_artifacts WHERE id = ?").bind(manifest.id).first<Record<string, unknown>>();
    expect(stored).toMatchObject({ job_id: jobId, site_version_id: versionId, site_version: 1, schema_version: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM site_versions WHERE id = ?").bind(versionId).first<{ count: number }>()).toEqual({ count: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM provenance_artifacts WHERE id = ?").bind(manifest.id).first<{ count: number }>()).toEqual({ count: 1 });
  });
});
