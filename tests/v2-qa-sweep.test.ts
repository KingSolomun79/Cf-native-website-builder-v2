import { beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { createRevisionBuild, getEffectiveBusinessFacts } from "../src/domain/revision";
import { runReferenceIntake, getFrozenReferenceEvidence, type ReferenceCaptureFn } from "../src/domain/reference-intake";
import { validateAssembledSite, deriveImagePlan, type AssembledSiteSource } from "../src/domain/site-generator";
import { runTechnicalPreflight } from "../src/domain/technical-preflight";
import { evaluateQaARelease, evaluateQaBRelease, QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS, type QaAReport, type QaBReport } from "../src/domain/qa-stages";
import { applyRepairBatch, type FixPlan } from "../src/domain/automated-repair";
import { approveBuildVersion, publishApprovedBuildVersion, rollbackPublication, type PublicationDeployer } from "../src/domain/publication";
import { markSupersededPreviews } from "../src/domain/retention";
import { recordBenchmarkRun, BENCHMARK_CASES, freezeBenchmarkCases } from "../src/domain/benchmark";
import { evaluateProofGate } from "../src/domain/proof-gate";
import { acceptFormSubmission, upsertSiteConfiguration } from "../src/domain/form-service";
import { putObject } from "../src/lib/assets";
import { generateId } from "../src/lib/crypto";

// QA sweep probes (morabeza-qa pass over issues #5-#16, #24, #25).
// Each probe asserts DESSIRED behavior; failures are verified QA findings.

const env = providedEnv as unknown as Env;

async function newGeneration(options: { mode?: "REFERENCE_BOUND" | "ORIGINAL_DESIGN"; facts?: Record<string, unknown> } = {}): Promise<{
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  buildVersionId: string;
}> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: options.mode ?? "REFERENCE_BOUND",
      facts: options.facts ?? { businessName: "QA Probe Co", contactEmail: "qa@example.com" },
      ...(options.mode === "ORIGINAL_DESIGN" ? {} : { reference: { screenshotR2Key: `references/uploads/qa-${Math.random().toString(36).slice(2)}.png` } }),
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { siteGenerationId: started.siteGenerationId, siteId: started.siteId, buildId: created.buildId, buildVersionId: created.buildVersionId };
}

describe("QA #5 — Revision Request / Fact Update", () => {
  it("merges partial socials updates and treats empty changes as a no-delta revision", async () => {
    const context = await newGeneration({ facts: { businessName: "QA Probe Co", contactEmail: "qa@example.com", socials: { facebook: "https://fb.example/qa", instagram: "https://ig.example/qa" } } });

    const partial = await createRevisionBuild(env, {
      parentBuildId: context.buildId,
      payload: { changes: { facts: { socials: { instagram: null } } } },
    });
    const facts = await getEffectiveBusinessFacts(env, partial.buildId);
    expect(facts.facts.socials?.facebook).toBe("https://fb.example/qa");
    expect(facts.facts.socials?.instagram).toBeUndefined();

    // An empty delta is still a valid human intent (e.g. regenerate) — it
    // creates a new Build with zero fact updates.
    const empty = await createRevisionBuild(env, { parentBuildId: partial.buildId, payload: { requestNote: "regenerate" } });
    expect(empty.factUpdateCount).toBe(0);
    expect(empty.buildId).not.toBe(partial.buildId);
  });
});

describe("QA #7 — Reference intake", () => {
  // QA-F2 (Medium): intake freezes non-image bytes. Tripwire: flip to `it`
  // and drop this marker when fixed.
  it.fails("rejects a screenshot object whose bytes are not a real image", async () => {
    const context = await newGeneration();
    const submission = await env.DB.prepare(
      "SELECT payload_json FROM onboarding_submissions WHERE id = (SELECT onboarding_submission_id FROM site_generations WHERE id = ?)"
    )
      .bind(context.siteGenerationId)
      .first<{ payload_json: string }>();
    const payload = JSON.parse(submission!.payload_json) as { reference: { screenshotR2Key: string } };
    await putObject(env, payload.reference.screenshotR2Key, new TextEncoder().encode("definitely-not-an-image"));

    const outcome = await runReferenceIntake(env, { ...context, buildVersionNumber: 1 }).then(
      () => "accepted",
      (error: { code?: string }) => `rejected:${error.code ?? "unknown"}`
    );
    // DESIRED: non-image bytes are rejected at freeze. (Finding if accepted.)
    expect(outcome).toBe("rejected:REFERENCE_SCREENSHOT_INVALID");
  });
});

describe("QA #9 — fabrication lint", () => {
  const source = (home: string): AssembledSiteSource => ({
    pages: {
      home,
      about: '<!DOCTYPE html><html><head><title>a</title><meta name="description" content="d"><meta name="viewport" content="w"></head><body><header><nav><a href="/">h</a><a href="/about">a</a><a href="/services">s</a><a href="/contact">c</a></nav></header><main><h1>About</h1></main><footer>f</footer></body></html>',
      services: '<!DOCTYPE html><html><head><title>a</title><meta name="description" content="d"><meta name="viewport" content="w"></head><body><header><nav><a href="/">h</a><a href="/about">a</a><a href="/services">s</a><a href="/contact">c</a></nav></header><main><h1>Services</h1></main><footer>f</footer></body></html>',
      contact: '<!DOCTYPE html><html><head><title>a</title><meta name="description" content="d"><meta name="viewport" content="w"></head><body><header><nav><a href="/">h</a><a href="/about">a</a><a href="/services">s</a><a href="/contact">c</a></nav></header><main><h1>Contact</h1><form method="post" action="https://forms.wazibiz.example/api/v2/forms/submit"><input type="hidden" name="siteFormId" value="site:x"></form></main><footer>f</footer></body></html>',
    },
    sharedCss: "@media (max-width:768px){body{margin:0}}",
    sharedJs: "(()=>{})();",
  });
  const contract = {
    version: "1",
    blueprintVisualThesis: "t",
    blueprintSignatureTraitIds: ["t1"],
    blueprintFirstViewportRegionIds: ["hero"],
    pages: [
      { id: "home" as const, path: "/", regions: [] },
      { id: "about" as const, path: "/about", regions: [] },
      { id: "services" as const, path: "/services", regions: [] },
      { id: "contact" as const, path: "/contact", regions: [] },
    ],
    files: { sharedCss: "site.css", sharedJs: "site.js", pageFiles: { home: "index.html", about: "about.html", services: "services.html", contact: "contact.html" } },
    tokens: {},
    components: [],
    responsiveStrategy: {},
    imageSlotStrategy: { roleIds: [] },
    formContract: { formServiceEndpoint: "https://forms.wazibiz.example/api/v2/forms/submit", siteFormId: "site:x", fields: ["name"], turnstile: false },
    approvedDependencies: [],
    blockers: [],
  };

  // QA-F3 (Medium): founding-year phrasing escapes FABRICATED_YEAR.
  it.fails("catches 'Established 1998'-style founding-year fabrication", () => {
    const home = '<!DOCTYPE html><html><head><title>h</title><meta name="description" content="d"><meta name="viewport" content="w"></head><body><header><nav><a href="/">h</a><a href="/about">a</a><a href="/services">s</a><a href="/contact">c</a></nav></header><main><h1>QA</h1><p>Established 1998 — family run ever since.</p></main><footer>f</footer></body></html>';
    const verdict = validateAssembledSite(source(home), { contract: contract as never, slots: deriveImagePlan({
      version: "1",
      visualThesis: "t",
      signatureTraits: [],
      fidelityPriorities: ["a"],
      tokens: {},
      globalGrid: { containerLogic: "c", columnRatios: ["1/1"] },
      spacingRhythm: "s",
      typographyRoles: [{ role: "r", description: "d" }],
      colorRoles: [{ role: "r", description: "d" }],
      surfaceLanguage: "s",
      headerNavigation: "h",
      homepageFirstViewport: { summary: "s", regionIds: ["hero"] },
      homepageRegions: [{ id: "hero", purpose: "p" }],
      imageSystem: { photographyGrammar: "g", imageRoles: [{ id: "r", purpose: "p", priority: "NORMAL" as const }] },
      motionGrammar: ["m"],
      responsiveContract: ["r"],
      innerPageVocabulary: ["v"],
      antiFallbackRules: ["a"],
      accessibilityAdaptations: [],
      declaredLimitations: [],
    }).slots });
    expect(verdict.findings.map((finding) => finding.id)).toContain("FABRICATED_YEAR");
  });
});

describe("QA #11 — Form Service", () => {
  it("returns 404 for a real Site with no Form Service configuration", async () => {
    const context = await newGeneration();
    const outcome = await acceptFormSubmission(env, {
      origin: "https://qa.example",
      remoteAddress: "203.0.113.1",
      payload: { siteFormId: `site:${context.siteId}`, name: "Q", email: "q@visitor.example", message: "hi" },
    }).then(() => "accepted", (error: { code?: string }) => `rejected:${error.code}`);
    expect(outcome).toBe("rejected:SITE_NOT_FOUND");
  });

  it("accepts exact boundary field lengths and rejects one char over", async () => {
    const context = await newGeneration();
    await upsertSiteConfiguration(env, { siteId: context.siteId, formDestination: "owner@qa.example", allowedOrigins: ["https://qa.example"] });
    const base = { siteFormId: `site:${context.siteId}`, email: "q@visitor.example" };
    const atBoundary = await acceptFormSubmission(env, {
      origin: "https://qa.example", remoteAddress: "203.0.113.2",
      payload: { ...base, name: "x".repeat(200), message: "y".repeat(5000) },
    }).then(() => "accepted", (error: { code?: string }) => `rejected:${error.code}`);
    expect(atBoundary).toBe("accepted");

    const overBoundary = await acceptFormSubmission(env, {
      origin: "https://qa.example", remoteAddress: "203.0.113.3",
      payload: { ...base, name: "x".repeat(201), message: "y".repeat(5001) },
    }).then(() => "accepted", (error: { code?: string }) => `rejected:${error.code}`);
    expect(overBoundary).toBe("rejected:FIELDS_INVALID");
  });
});

describe("QA #12 — Technical Preflight", () => {
  // QA-F4 (Low): literal-null JSON parses as valid JSON-LD.
  it.fails("rejects a JSON-LD block that parses but is not a truth-parsable object", () => {
    const page = (jsonLd: string) => `<!DOCTYPE html><html><head><title>t</title><meta name="description" content="d"><meta name="viewport" content="w"><script type="application/ld+json">${jsonLd}</script></head><body><header><nav><a href="/">h</a><a href="/about">a</a><a href="/services">s</a><a href="/contact">c</a></nav></header><main><h1>H</h1></main><footer>f</footer></body></html>`;
    const verdict = runTechnicalPreflight(
      { pages: { home: page("null"), about: page("{}"), services: page("{}"), contact: page("{}") }, sharedCss: "@media(m){}", sharedJs: "" },
      { formServiceEndpoint: "https://forms.wazibiz.example/api/v2/forms/submit", expectedSiteFormId: "site:x", criticalSlotIds: [] }
    );
    // DESIRED: a JSON-LD payload of literal null is not valid structured data.
    expect(verdict.blockers.map((blocker) => blocker.id)).toContain("INVALID_JSON_LD");
  });
});

describe("QA #13 — release evaluation boundaries", () => {
  it("treats exactly-90 scores as passing and 89 as failing", () => {
    const base = { version: "1", fabrication: false, hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })), findings: [] };
    expect(evaluateQaARelease({ ...base, visualScore: 90, contentScore: 90 } as QaAReport).releaseReady).toBe(true);
    expect(evaluateQaARelease({ ...base, visualScore: 89, contentScore: 95 } as QaAReport).releaseReady).toBe(false);
    expect(evaluateQaBRelease({ version: "1", technicalScore: 90, gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })), findings: [] } as QaBReport).releaseReady).toBe(true);
    expect(evaluateQaBRelease({ version: "1", technicalScore: 89, gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })), findings: [] } as QaBReport).releaseReady).toBe(false);
  });
});

describe("QA #14 — repair budget", () => {
  it("escalates blueprint-root defects from the Release Blocker Fix path too", async () => {
    const context = await newGeneration();
    const outcome = await applyRepairBatch(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      sourceBuildVersionId: context.buildVersionId,
      kind: "release_blocker_fix",
      plan: { version: "1", rootCauses: [{ findingRef: "qa/home-390.png", domain: "visual", rootCause: "r" }], repairs: [{ target: "implementation", strategy: "css_geometry_crop", description: "fix crop" }], blueprintReviewRequired: true, blueprintReviewReason: "first viewport impossible" } satisfies FixPlan,
    });
    expect(outcome.status).toBe("BLUEPRINT_REVIEW_REQUIRED");
  });
});

describe("QA #15 — publication corners", () => {
  const publishDeployer: PublicationDeployer = async ({ workerName }) => ({ publishedUrl: `https://${workerName}.example/` });

  it("refuses rollback right after the FIRST publication (no retained version)", async () => {
    const context = await newGeneration();
    await import("../src/domain/stage-artifacts").then((m) => m.storeBuildStageArtifact(env, {
      buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
      kind: "assembled_manifest", schemaVersion: "build-manifest/1",
      value: { artifactManifestHash: "qa-h1", files: [{ path: "index.html", sha256: "a", bytes: 1 }] },
    }));
    await putObject(env, `builds/${context.buildId}/v1/source/index.html`, "<!DOCTYPE html><html><body>qa</body></html>");
    const { assignReleaseReady } = await import("../src/domain/release");
    const { QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS } = await import("../src/domain/qa-stages");
    await assignReleaseReady(env, {
      buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
      qaA: { version: "1", visualScore: 94, contentScore: 93, fabrication: false, hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })), findings: [] },
      qaB: { version: "1", technicalScore: 95, gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })), findings: [] },
      qaBuildVersionId: context.buildVersionId,
    });
    await approveBuildVersion(env, context);
    await publishApprovedBuildVersion(env, { ...context, buildVersionNumber: 1, deployer: publishDeployer });

    const rollback = await rollbackPublication(env, { siteId: context.siteId }).then(
      () => "rolled-back",
      (error: { code?: string }) => `rejected:${error.code}`
    );
    expect(rollback).toBe("rejected:NO_ROLLBACK_VERSION");
  });

  it("refuses approval when the version has no assembled manifest", async () => {
    const context = await newGeneration();
    await env.DB.prepare(
      `INSERT INTO build_release_records (build_version_id, build_id, qa_a_visual_score, qa_a_content_score, qa_b_technical_score, fabrication, hard_gates_json, blockers_json, polish_json, assigned_at)
       VALUES (?, ?, 90, 90, 90, 0, '[]', '[]', '[]', '2026-09-01T00:00:00Z')`
    )
      .bind(context.buildVersionId, context.buildId)
      .run();
    const outcome = await approveBuildVersion(env, context).then(
      () => "approved",
      (error: { code?: string }) => `rejected:${error.code}`
    );
    expect(outcome).toBe("rejected:NOT_RELEASE_READY");
  });
});

describe("QA #16 — retention", () => {
  it("markSupersededPreviews is a no-op for the active version itself", async () => {
    const context = await newGeneration();
    const changed = await markSupersededPreviews(env, { buildId: context.buildId, activeBuildVersionId: context.buildVersionId });
    expect(changed).toBe(0);
  });
});

describe("QA #24 — ORIGINAL_DESIGN mode gate", () => {
  beforeAll(async () => {
    await freezeBenchmarkCases(env);
    // Deterministically SHUT the gate.
    for (const definition of BENCHMARK_CASES) {
      const started = await startSiteGeneration(env, {
        payload: {
          buildMode: "REFERENCE_BOUND",
          facts: { businessName: "QA Gate Co", contactEmail: "qa-gate@example.com" },
          reference: { screenshotR2Key: `references/uploads/qag-${Math.random().toString(36).slice(2)}.png` },
        },
      });
      const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
      await recordBenchmarkRun(env, {
        benchmarkCaseId: definition.id,
        siteGenerationId: started.siteGenerationId,
        buildId: created.buildId,
        buildVersionId: created.buildVersionId,
        releaseReady: false, imageSpendUsd: 1, manualSourceEdits: 0, rootCause: "GENERATOR",
      });
    }
    expect((await evaluateProofGate(env)).gateOpen).toBe(false);
  });

  // QA-F1 (Medium): the proof gate is bypassable via Revision Request on a
  // pre-existing ORIGINAL_DESIGN build (#24 acceptance-criterion gap).
  it.fails("blocks starting an ORIGINAL_DESIGN Build through the Revision Request path too", async () => {
    // Seed one existing ORIGINAL_DESIGN build from a period when the gate
    // was open (fresh DBs start shut, so we open then shut around it).
    for (const definition of BENCHMARK_CASES) {
      const started = await startSiteGeneration(env, {
        payload: {
          buildMode: "REFERENCE_BOUND",
          facts: { businessName: "QA Open Co", contactEmail: "qa-open@example.com" },
          reference: { screenshotR2Key: `references/uploads/qao-${Math.random().toString(36).slice(2)}.png` },
        },
      });
      const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
      await recordBenchmarkRun(env, {
        benchmarkCaseId: definition.id,
        siteGenerationId: started.siteGenerationId,
        buildId: created.buildId,
        buildVersionId: created.buildVersionId,
        releaseReady: true, imageSpendUsd: 1.5, manualSourceEdits: 0,
      });
    }
    expect((await evaluateProofGate(env)).gateOpen).toBe(true);
    const od = await newGeneration({ mode: "ORIGINAL_DESIGN" });
    // Shut the gate again.
    for (const definition of BENCHMARK_CASES) {
      const started = await startSiteGeneration(env, {
        payload: {
          buildMode: "REFERENCE_BOUND",
          facts: { businessName: "QA Shut Co", contactEmail: "qa-shut@example.com" },
          reference: { screenshotR2Key: `references/uploads/qas-${Math.random().toString(36).slice(2)}.png` },
        },
      });
      const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
      await recordBenchmarkRun(env, {
        benchmarkCaseId: definition.id,
        siteGenerationId: started.siteGenerationId,
        buildId: created.buildId,
        buildVersionId: created.buildVersionId,
        releaseReady: false, imageSpendUsd: 1, manualSourceEdits: 0, rootCause: "GENERATOR",
      });
    }
    expect((await evaluateProofGate(env)).gateOpen).toBe(false);

    // DESIRED: a new Build in ORIGINAL_DESIGN mode cannot start while the
    // gate is shut — including via Revision Request.
    const outcome = await createRevisionBuild(env, {
      parentBuildId: od.buildId,
      payload: { requestNote: "revision while gate shut" },
    }).then(() => "created", (error: { code?: string }) => `rejected:${error.code ?? error.message}`);
    expect(outcome).toBe("rejected:ORIGINAL_DESIGN_LOCKED");
  });
});

describe("QA #25 — contracted tree", () => {
  it("keeps the kie-callback ack write-free (no database statements at all)", async () => {
    const { handleKieCallback } = await import("../src/routes/internal.kie-callback");
    const originalPrepare = env.DB.prepare.bind(env.DB);
    let statements = 0;
    (env.DB as { prepare: unknown }).prepare = (...args: unknown[]) => {
      statements += 1;
      return (originalPrepare as (...a: unknown[]) => unknown)(...args);
    };
    try {
      const response = await handleKieCallback({
        req: { json: async () => ({ data: { taskId: `qa-${generateId()}`, state: "success" } }) } as never,
        json: ((data: unknown, status: number) => new Response(JSON.stringify(data), { status })) as never,
      } as never);
      expect(response.status).toBe(200);
      expect(statements).toBe(0);
    } finally {
      (env.DB as { prepare: unknown }).prepare = originalPrepare;
    }
  });
});
