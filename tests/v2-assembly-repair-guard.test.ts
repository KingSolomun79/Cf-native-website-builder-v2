import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import {
  assemblyRepairDecision,
  canonicalNavLabel,
  extractAssemblyFingerprint,
  findingsForPage,
  validateAssemblyRepairContent,
} from "../src/domain/assembly-repair";
import { getObject } from "../src/lib/assets";
import type { Env } from "../src/env.d";
import type { BuildPipelineDeps } from "../src/domain/build-pipeline";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { startSiteGeneration } from "../src/domain/lifecycle";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import { persistPipelineScreenshot, createPipelineScripts } from "./helpers/pipeline-scripts";
import { FIXTURE_ASSEMBLY_REGRESSION } from "./_generated-assembly-regression-fixture";

// Issue #69 — assembly repair preservation contract.
//
// Production Build 436c357a (2026-09-07) proved the informed assembly repair
// can DEGRADE the candidate: the repair output for home introduced three
// orphan classes, contact gained `pill-row`, and services silently dropped
// its H1 positioning tail (", not vanity metrics."). The pre-repair pages
// were cleaner than their repairs, and the repair became effective anyway.
// These tests pin the #69 contract from those frozen pairs plus the pipeline
// seam: mutation authority per finding type, fingerprint content freeze with
// exact navigation allowances, adopt-only-if-clean, keep-original-on-fail,
// and the repair-trigger provenance.

const env = providedEnv as unknown as Env;

describe("mutation authority per finding type (issue #69 §12)", () => {
  it("authorizes class realization for ORPHANED_CLASS", () => {
    const decision = assemblyRepairDecision([{ id: "ORPHANED_CLASS", detail: "about: narrow-narrative" }]);
    expect(decision).toEqual({ action: "repair", scope: { classRealization: true, brokenHrefs: [], navAdditions: [] } });
  });

  it("authorizes exactly the broken href a BROKEN_NAV_LINK names", () => {
    const decision = assemblyRepairDecision([
      { id: "BROKEN_NAV_LINK", detail: `home: internal link href="/contct" resolves to no generated page` },
    ]);
    expect(decision).toEqual({ action: "repair", scope: { classRealization: false, brokenHrefs: ["/contct"], navAdditions: [] } });
  });

  it("authorizes exactly the missing nav target a BROKEN_NAV_LINK names", () => {
    const decision = assemblyRepairDecision([
      { id: "BROKEN_NAV_LINK", detail: `home: navigation misses link to 'about' (href="/about")` },
    ]);
    expect(decision).toEqual({ action: "repair", scope: { classRealization: false, brokenHrefs: [], navAdditions: ["/about"] } });
    expect(canonicalNavLabel("/about")).toBe("About");
  });

  it("escalates FABRICATED_TRUST_ENTITY instead of granting repair permission", () => {
    const decision = assemblyRepairDecision([
      { id: "FABRICATED_TRUST_ENTITY", detail: "about: trust label 'Glap Thon' is not backed by the Business Facts" },
    ]);
    expect(decision.action).toBe("escalate");
    expect(decision.action === "escalate" && decision.reason).toContain("FABRICATED_TRUST_ENTITY");
  });

  it("escalates the whole page when any finding exceeds the authority", () => {
    const decision = assemblyRepairDecision([
      { id: "ORPHANED_CLASS", detail: "about: narrow-narrative" },
      { id: "FABRICATED_TRUST_ENTITY", detail: "about: trust label 'Glap Thon' is not backed by the Business Facts" },
    ]);
    expect(decision.action).toBe("escalate");
  });

  it("authorizes pure-structural findings (markup structure only, content frozen)", () => {
    const decision = assemblyRepairDecision([{ id: "NON_SEMANTIC_STRUCTURE", detail: "home: missing semantic <footer>" }]);
    expect(decision.action).toBe("repair");
    expect(decision.action === "repair" && decision.scope.classRealization).toBe(false);
  });

  it("escalates finding types that are not enumerated by the contract", () => {
    const decision = assemblyRepairDecision([{ id: "MULTIPLE_H1", detail: "about: 2 H1 elements" }]);
    expect(decision.action).toBe("escalate");
  });
});

describe("content freeze on the frozen production pairs (issue #69 §14)", () => {
  const classScope = { classRealization: true, brokenHrefs: [] as string[], navAdditions: [] as string[] };

  it("the services repair's dropped H1 tail is a REPAIR_SCOPE_VIOLATION", () => {
    const before = extractAssemblyFingerprint(FIXTURE_ASSEMBLY_REGRESSION.services.pre);
    const after = extractAssemblyFingerprint(FIXTURE_ASSEMBLY_REGRESSION.services.repaired);
    const { violations } = validateAssemblyRepairContent(before, after, classScope);
    const textViolation = violations.find((violation) => violation.rule === "TEXT_MUTATED");
    expect(textViolation).toBeDefined();
    // The dropped H1 positioning tail is exactly what the freeze protects:
    expect(before.textNodes.join(" ")).toContain("vanity metrics");
    expect(after.textNodes.join(" ")).not.toContain("vanity metrics");
  });

  it("the home repair's rewrite is refused by the content freeze", () => {
    const before = extractAssemblyFingerprint(FIXTURE_ASSEMBLY_REGRESSION.home.pre);
    const after = extractAssemblyFingerprint(FIXTURE_ASSEMBLY_REGRESSION.home.repaired);
    const { violations } = validateAssemblyRepairContent(before, after, classScope);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((violation) => violation.id === "REPAIR_SCOPE_VIOLATION")).toBe(true);
  });

  it("an unrelated content mutation is refused", () => {
    const before = extractAssemblyFingerprint(FIXTURE_ASSEMBLY_REGRESSION.services.pre);
    const mutated = FIXTURE_ASSEMBLY_REGRESSION.services.pre.replace(
      "</main>",
      "<p>Trusted by 200+ businesses across East Africa.</p></main>"
    );
    const after = extractAssemblyFingerprint(mutated);
    const { violations } = validateAssemblyRepairContent(before, after, classScope);
    expect(violations.some((violation) => violation.rule === "TEXT_MUTATED")).toBe(true);
  });

  it("a legitimate exact nav href correction is allowed", () => {
    // Build a rejected page whose ONLY defect is one broken href, then a
    // repair that replaces exactly that href with the canonical one.
    const withBrokenHref = FIXTURE_ASSEMBLY_REGRESSION.services.pre.replace('href="/services"', 'href="/servces"');
    const repaired = FIXTURE_ASSEMBLY_REGRESSION.services.pre;
    const before = extractAssemblyFingerprint(withBrokenHref);
    const after = extractAssemblyFingerprint(repaired);
    const { violations } = validateAssemblyRepairContent(before, after, {
      classRealization: false,
      brokenHrefs: ["/servces"],
      navAdditions: [],
    });
    expect(violations).toEqual([]);
  });

  it("a legitimate class correction is allowed (class-only change, text untouched)", () => {
    const withOrphanClass = FIXTURE_ASSEMBLY_REGRESSION.services.pre.replace('<section class="services-grid">', '<section class="services-grid compact-v2">');
    const repaired = FIXTURE_ASSEMBLY_REGRESSION.services.pre;
    const before = extractAssemblyFingerprint(withOrphanClass);
    const after = extractAssemblyFingerprint(repaired);
    const { violations } = validateAssemblyRepairContent(before, after, classScope);
    expect(violations).toEqual([]);
  });

  it("a nav addition is allowed exactly with its canonical label — not with any other copy", () => {
    const before = extractAssemblyFingerprint(FIXTURE_ASSEMBLY_REGRESSION.services.pre);
    // The About anchor is already present on the page; add it once more the
    // way a nav-addition repair would, with the canonical label.
    const repairedCanonical = FIXTURE_ASSEMBLY_REGRESSION.services.pre.replace(
      "</main>",
      '<a href="/about">About</a></main>'
    );
    const canonical = validateAssemblyRepairContent(before, extractAssemblyFingerprint(repairedCanonical), {
      classRealization: false,
      brokenHrefs: [],
      navAdditions: ["/about"],
    });
    expect(canonical.violations).toEqual([]);
    // The same insertion carrying invented copy is NOT excused.
    const repairedInvented = FIXTURE_ASSEMBLY_REGRESSION.services.pre.replace(
      "</main>",
      '<a href="/about">About our award-winning team</a></main>'
    );
    const invented = validateAssemblyRepairContent(before, extractAssemblyFingerprint(repairedInvented), {
      classRealization: false,
      brokenHrefs: [],
      navAdditions: ["/about"],
    });
    expect(invented.violations.some((violation) => violation.rule === "TEXT_MUTATED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pipeline seam: adopt-only-if-clean, keep-original-on-fail, escalation and
// the §19 repair-trigger provenance.
// ---------------------------------------------------------------------------

const BLOCKER = '<section class="narrow-narrative"></section>';

function scriptsForRepairKind(kind: "mutates-copy" | "new-orphan" | "clean-fix"): BuildPipelineDeps {
  const base = createPipelineScripts();
  const generate: RawAiGenerate = async (system, user) => {
    // Intercept the repair call BEFORE delegating: the production repair
    // prompt embeds the phrase "shared stylesheet", which the base helper's
    // css branch would otherwise match first.
    const isRepair = user.includes("Assembly repair directives") && user.includes("page id 'about'");
    const isInitialAbout = user.includes("page id 'about'") && !isRepair;
    if (isRepair || isInitialAbout) {
      // Neutralize the "shared stylesheet" phrase the production repair
      // prompt legitimately carries — delegated bare, the base helper's css
      // branch would answer the repair call instead of the page branch.
      const result = await base.generate!(system, user.replaceAll("shared stylesheet", "shared style sheet"));
      const page = JSON.parse(result.content) as { html: string };
      if (isInitialAbout) {
        // Initial generation carries the deterministic blocker (no text, so
        // a clean fix can be text-identical).
        page.html = page.html.replace("</main>", `${BLOCKER}</main>`);
        return { ...result, content: JSON.stringify(page) };
      }
      const fixed = page.html.split(BLOCKER).join(""); // remove the blocker
      if (kind === "clean-fix") return { ...result, content: JSON.stringify({ ...page, html: fixed }) };
      if (kind === "mutates-copy") {
        const tampered = fixed.replace(/<h1([^>]*)>[^<]*<\/h1>/, `<h1$1>Tampered headline copy</h1>`);
        return { ...result, content: JSON.stringify({ ...page, html: tampered }) };
      }
      // new-orphan: blocker removed but a fresh styling-intent class appears.
      const regressed = fixed.replace("</main>", '<section class="wide-narrative"></section></main>');
      return { ...result, content: JSON.stringify({ ...page, html: regressed }) };
    }
    return base.generate!(system, user);
  };
  return { ...base, generate };
}

function scriptsForFabrication(): BuildPipelineDeps {
  const base = createPipelineScripts();
  const generate: RawAiGenerate = async (system, user) => {
    if (!user.includes("page id 'about'")) return base.generate!(system, user);
    const result = await base.generate!(system, user);
    const page = JSON.parse(result.content) as { html: string };
    page.html = page.html.replace("</main>", '<section aria-label="Our clients"><ul><li>Glap Thon</li></ul></section></main>');
    return { ...result, content: JSON.stringify(page) };
  };
  return { ...base, generate };
}

async function buildVersionIdOf(buildId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ?1 ORDER BY version_number LIMIT 1")
    .bind(buildId)
    .first<{ id: string }>();
  return row!.id;
}

async function workflowEvents(buildId: string): Promise<Array<{ stage: string; detail: string; to_state: string }>> {
  const { results } = await env.DB.prepare("SELECT stage, detail, to_state FROM build_workflow_events WHERE build_id = ?1 ORDER BY created_at")
    .bind(buildId)
    .all<{ stage: string; detail: string; to_state: string }>();
  return results;
}

async function pageSubkeys(versionId: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT subkey FROM build_stage_artifacts WHERE build_version_id = ?1 AND kind = 'generated_page'")
    .bind(versionId)
    .all<{ subkey: string }>();
  return results.map((row) => row.subkey);
}

describe("assembly repair preservation at the pipeline seam (issue #69)", () => {
  it("keeps the original page when the repair mutates copy, and records the trigger provenance", async () => {
    await persistPipelineScreenshot(env, "references/pipeline/repair-guard-copy.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Pipeline Wiring Smoke Business", contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: "references/pipeline/repair-guard-copy.png", url: "https://meridian-atelier.example.com/" },
      },
    });
    const outcome = await runBuildPipeline(env, { siteGenerationId: started.siteGenerationId, deps: scriptsForRepairKind("mutates-copy") });

    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.reasons.join("\n")).toContain("ORPHANED_CLASS");
    const events = await workflowEvents(outcome.buildId!);
    const revert = events.find((event) => event.stage === "assembly_repair" && event.detail.includes("REVERTED_SCOPE_VIOLATION"));
    expect(revert).toBeDefined();
    expect(revert!.detail).toContain("ORPHANED_CLASS");
    expect(revert!.detail).toContain("class-realization");

    const versionId = await buildVersionIdOf(outcome.buildId!);
    // The repair artifact exists as evidence, and carries the §19 provenance.
    expect(await pageSubkeys(versionId)).toContain("about.assembly-repair-1");
    const provenanceRow = await env.DB.prepare(
      "SELECT provenance_json FROM build_stage_artifacts WHERE build_version_id = ?1 AND subkey = 'about.assembly-repair-1'"
    )
      .bind(versionId)
      .first<{ provenance_json: string }>();
    const provenance = JSON.parse(provenanceRow!.provenance_json!);
    expect(provenance.repairTriggerFindingIds).toEqual(["ORPHANED_CLASS"]);
    expect(provenance.repairScopeSummary).toContain("class-realization");

    // The EFFECTIVE candidate is the pre-repair page: the candidate manifest
    // points at the base 'about' artifact, not the discarded repair.
    const manifestRow = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ?1 AND kind = 'candidate_manifest'"
    )
      .bind(versionId)
      .first<{ artifact_r2_key: string }>();
    const manifest = JSON.parse(await new Response(await getObject(env, manifestRow!.artifact_r2_key)).text());
    expect(manifest.pages.about.subkey).toBe("about");
    const baseChecksum = await env.DB.prepare("SELECT checksum FROM build_stage_artifacts WHERE build_version_id = ?1 AND subkey = 'about'")
      .bind(versionId)
      .first<{ checksum: string }>();
    expect(manifest.pages.about.checksum).toBe(baseChecksum!.checksum);
  });

  it("keeps the original page when the repair introduces a NEW orphan class", async () => {
    await persistPipelineScreenshot(env, "references/pipeline/repair-guard-orphan.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Pipeline Wiring Smoke Business", contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: "references/pipeline/repair-guard-orphan.png", url: "https://meridian-atelier.example.com/" },
      },
    });
    const outcome = await runBuildPipeline(env, { siteGenerationId: started.siteGenerationId, deps: scriptsForRepairKind("new-orphan") });

    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    const events = await workflowEvents(outcome.buildId!);
    const revert = events.find((event) => event.stage === "assembly_repair" && event.detail.includes("REVERTED_REGRESSION"));
    expect(revert).toBeDefined();
    expect(revert!.detail).toContain("post-repair findings=[ORPHANED_CLASS]");
    // No second repair budget: exactly one repair artifact exists.
    const versionId = await buildVersionIdOf(outcome.buildId!);
    expect((await pageSubkeys(versionId)).filter((subkey) => subkey === "about.assembly-repair-1")).toHaveLength(1);
  });

  it("adopts a clean, scope-respecting repair and the pipeline advances", async () => {
    await persistPipelineScreenshot(env, "references/pipeline/repair-guard-clean.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Pipeline Wiring Smoke Business", contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: "references/pipeline/repair-guard-clean.png", url: "https://meridian-atelier.example.com/" },
      },
    });
    const outcome = await runBuildPipeline(env, { siteGenerationId: started.siteGenerationId, deps: scriptsForRepairKind("clean-fix") });

    expect(outcome.terminal).toBe("RELEASE_READY");
    const events = await workflowEvents(outcome.buildId!);
    const adopt = events.find((event) => event.stage === "assembly_repair" && event.detail.includes("ADOPTED"));
    expect(adopt).toBeDefined();
    expect(adopt!.detail).toContain("preservation=intact");
    const versionId = await buildVersionIdOf(outcome.buildId!);
    const manifestRow = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ?1 AND kind = 'candidate_manifest'"
    )
      .bind(versionId)
      .first<{ artifact_r2_key: string }>();
    const manifest = JSON.parse(await new Response(await getObject(env, manifestRow!.artifact_r2_key)).text());
    expect(manifest.pages.about.subkey).toBe("about.assembly-repair-1");
  });

  it("escalates FABRICATED_TRUST_ENTITY deterministically without any repair attempt", async () => {
    await persistPipelineScreenshot(env, "references/pipeline/repair-guard-fabrication.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Pipeline Wiring Smoke Business", contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: "references/pipeline/repair-guard-fabrication.png", url: "https://meridian-atelier.example.com/" },
      },
    });
    const outcome = await runBuildPipeline(env, { siteGenerationId: started.siteGenerationId, deps: scriptsForFabrication() });

    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.reasons.join("\n")).toContain("FABRICATED_TRUST_ENTITY");
    const events = await workflowEvents(outcome.buildId!);
    const escalation = events.find((event) => event.stage === "assembly_repair" && event.detail.includes("ESCALATED"));
    expect(escalation).toBeDefined();
    expect(escalation!.detail).toContain("FABRICATED_TRUST_ENTITY");
    // No repair ran: no repair artifact exists for the page.
    const versionId = await buildVersionIdOf(outcome.buildId!);
    expect(await pageSubkeys(versionId)).not.toContain("about.assembly-repair-1");
  });
});

describe("finding provenance extraction (issue #69 §19)", () => {
  it("extracts page-scoped findings for the repair record", () => {
    const findings = [
      { id: "ORPHANED_CLASS", detail: "about: narrow-narrative" },
      { id: "ORPHANED_CLASS", detail: "home: brand-name" },
      { id: "BROKEN_NAV_LINK", detail: "about: internal link href=\"/x\" resolves to no generated page" },
    ];
    const aboutFindings = findingsForPage(findings, "about");
    expect(aboutFindings.map((finding) => finding.id)).toEqual(["ORPHANED_CLASS", "BROKEN_NAV_LINK"]);
  });
});
