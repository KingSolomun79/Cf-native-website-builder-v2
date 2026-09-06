import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  buildMeasuredDirectives,
  buildPreservationSet,
  buildRepairContext,
  evaluateRepairRegression,
  type RepairEvaluationSnapshot,
} from "../src/domain/repair-guard";
import { QA_A_HARD_GATE_IDS, type QaAGate } from "../src/domain/qa-stages";
import { compareGeometry, geometryFromRegions } from "../src/domain/qa-evidence";
import type { VisualBlueprint } from "../src/domain/visual-blueprint";
import type { ImplementationContract } from "../src/domain/implementation-planner";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runBuildPipeline, type BuildPipelineDeps } from "../src/domain/build-pipeline";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import { createPipelineScripts, persistPipelineScreenshot, PIPELINE_SCRIPTS_BUSINESS } from "./helpers/pipeline-scripts";

// Issue #50 — measured repair directives + preservation/regression guard.
//
// The production sequence 74 -> 71 -> 62 showed repairs were planned from
// prose and could silently break constraints that already passed. The guard
// compares candidate N+1 against candidate N on HARD CONSTRAINTS ONLY:
// composite scores are never compared (section E) — a score drop with all
// hard constraints intact is a valid repair.

const env = providedEnv as unknown as Env;

const BLUEPRINT: VisualBlueprint = {
  version: "1",
  visualThesis: "t",
  signatureTraits: [
    { id: "bp-a", description: "A" },
    { id: "bp-b", description: "B" },
    { id: "bp-c", description: "C" },
  ],
  fidelityPriorities: ["first viewport topology"],
  tokens: {},
  globalGrid: { containerLogic: "c", columnRatios: ["5/7"] },
  spacingRhythm: "s",
  typographyRoles: [{ role: "display", description: "d" }],
  colorRoles: [{ role: "ink", description: "d" }],
  surfaceLanguage: "s",
  headerNavigation: "h",
  homepageFirstViewport: { summary: "s", regionIds: ["hero"] },
  homepageRegions: [
    { id: "hero", purpose: "hero", sourceEvidenceRegionIds: ["region-1"] },
    { id: "services", purpose: "services", sourceEvidenceRegionIds: ["region-2"] },
  ],
  imageSystem: { photographyGrammar: "g", imageRoles: [{ id: "role-hero", purpose: "hero", priority: "CRITICAL" }] },
  motionGrammar: ["fade"],
  responsiveContract: ["stack"],
  innerPageVocabulary: ["page-header"],
  antiFallbackRules: ["never center"],
  accessibilityAdaptations: [],
  declaredLimitations: [],
};

function contractFixture(): ImplementationContract {
  return {
    version: "1",
    blueprintVisualThesis: "t",
    blueprintSignatureTraitIds: ["bp-a", "bp-b", "bp-c"],
    blueprintFirstViewportRegionIds: ["hero"],
    realization: {
      regionStyleBinding: [{ regionId: "hero", cssSelector: '[data-region="hero"]' }],
      classVocabularyPolicy: "css-defined-classes-only",
      contentCapacityPolicy: "copy-fits-measured-regions",
    },
    pages: [
      { id: "home", path: "/", regions: [{ id: "hero", realization: "section" }, { id: "services", realization: "section" }] },
      { id: "about", path: "/about", regions: [] },
      { id: "services", path: "/services", regions: [] },
      { id: "contact", path: "/contact", regions: [] },
    ],
    files: { sharedCss: "site.css", sharedJs: "site.js", pageFiles: { home: "index.html", about: "about.html", services: "services.html", contact: "contact.html" } },
    tokens: {},
    components: [],
    responsiveStrategy: {},
    imageSlotStrategy: {},
    formContract: { formServiceEndpoint: "https://forms.example/submit", siteFormId: "site:x", fields: ["name", "email", "message"], turnstile: false },
    approvedDependencies: [],
    blockers: [],
  };
}

const ALL_A_PASS: QaAGate[] = QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true }));

describe("preservation set and measured directives (issue #50 A/B)", () => {
  it("builds the preservation set from currently-passing hard constraints only", () => {
    const gates: QaAGate[] = QA_A_HARD_GATE_IDS.map((id, index) => ({ id, passed: index !== 2 }));
    const preservation = buildPreservationSet({
      qaAHardGates: gates,
      qaBMandatoryGates: [{ id: "ALL_PAGES_LOAD", passed: true }, { id: "NO_PAGE_OVERFLOW", passed: false }],
      macroFidelityPassed: true,
      blueprint: BLUEPRINT,
      contract: contractFixture(),
    });
    const ids = preservation.map((constraint) => constraint.id);
    expect(ids).toContain("HARD_GATE:FIRST_VIEWPORT_MATERIALLY_CORRECT");
    expect(ids).not.toContain(`HARD_GATE:${QA_A_HARD_GATE_IDS[2]}`);
    expect(ids).toContain("MANDATORY_GATE:ALL_PAGES_LOAD");
    expect(ids).not.toContain("MANDATORY_GATE:NO_PAGE_OVERFLOW");
    expect(ids).toContain("REFERENCE_MACRO_FIDELITY");
    expect(ids).toContain("REGION_ORDER");
    expect(ids).toContain("REALIZATION:hero");
    const order = preservation.find((constraint) => constraint.id === "REGION_ORDER");
    expect(order?.detail).toContain("hero > services");
  });

  it("emits per-metric measured vs target lines from the frozen comparator", () => {
    const reference = geometryFromRegions(
      [
        { id: "hero", height: 945, viewportHeightRatio: 1.05 },
        { id: "services", height: 720, viewportHeightRatio: 0.8 },
      ],
      0.4
    );
    const candidate = geometryFromRegions(
      [
        { id: "hero", height: 997, viewportHeightRatio: 1.108 },
        { id: "services", height: 2888, viewportHeightRatio: 3.209 },
      ],
      0.1
    );
    const comparison = compareGeometry(reference, candidate);
    const directives = buildMeasuredDirectives({
      geometryComparison: comparison,
      macroFidelityReason: "candidate deviates materially from the measured Reference: region_count (ref 2 vs cand 2)",
      craftPreflight: {
        attempt: 2,
        passed: false,
        findings: [
          {
            checkId: "REGION_HEIGHT_DEVIATION",
            regionId: "services",
            detail: "region 'services' renders too tall",
            measured: "3.209 viewport-heights (2888px at 900px viewport)",
            target: "0.800 viewport-heights (measured Reference evidence)",
            repairScope: "page-realization",
            affectedPage: "home",
          },
        ],
        pageRepairable: true,
        directiveText: "",
        crops: [],
      },
    });
    expect(directives).toContain("first_viewport_height_ratio: reference 1.05 vs candidate 1.108");
    expect(directives).toContain("DIRECT REFERENCE FIDELITY:");
    expect(directives).toContain("measured 3.209 viewport-heights");
    expect(directives).toContain("target 0.800 viewport-heights");
  });

  it("the full repair context carries measured context, preservation set, scope and crops", () => {
    const comparison = compareGeometry(
      geometryFromRegions([{ id: "hero", height: 945, viewportHeightRatio: 1.05 }], 0.4),
      geometryFromRegions([{ id: "hero", height: 997, viewportHeightRatio: 1.108 }], 0.4)
    );
    const context = buildRepairContext({
      blueprint: BLUEPRINT,
      contract: contractFixture(),
      qaAHardGates: ALL_A_PASS,
      qaBMandatoryGates: [{ id: "ALL_PAGES_LOAD", passed: true }],
      macroFidelityPassed: false,
      macroFidelityReason: "candidate deviates materially from the measured Reference",
      geometryComparison: comparison,
      craftPreflight: null,
      regionCropKeys: ["builds/b/v1/qa/craft/attempt-1/hero-reference.png"],
      narrowestScopeOnly: true,
    });
    expect(context).toContain("MEASURED CONTEXT");
    expect(context).toContain("first_viewport_height_ratio: reference 1.05 vs candidate 1.108");
    expect(context).toContain("PRESERVATION SET");
    expect(context).toContain("MUTATION SCOPE");
    expect(context).toContain("narrowest scope");
    expect(context).toContain("REGION CROPS");
    expect(context).toContain("hero-reference.png");
    expect(context).toContain("Composite scores are NOT a target");
  });
});

describe("regression guard (issue #50 D/E/F)", () => {
  const previous: RepairEvaluationSnapshot = {
    qaAHardGates: ALL_A_PASS,
    qaBMandatoryGates: [
      { id: "ALL_PAGES_LOAD", passed: true },
      { id: "NO_PAGE_OVERFLOW", passed: true },
    ],
    blockers: [{ severity: "P1", domain: "visual-fidelity", description: "hero heading contrast too weak", evidenceRef: "qa/home-1440-first.png" }],
  };

  it("flags a previously passing hard gate that now fails", () => {
    const verdict = evaluateRepairRegression({
      previous,
      confirmationAHardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: id !== "MOBILE_PRESERVES_VISUAL_IDENTITY" })),
      confirmationBMandatoryGates: previous.qaBMandatoryGates,
      confirmationBlockers: [],
    });
    expect(verdict.regression).toBe(true);
    expect(verdict.regressions.join(" ")).toContain("MOBILE_PRESERVES_VISUAL_IDENTITY");
    expect(verdict.conflict).toBe(false);
  });

  it("flags a brand-new ACTIVE P0/P1 domain the previous blockers never covered", () => {
    const verdict = evaluateRepairRegression({
      previous,
      confirmationAHardGates: ALL_A_PASS,
      confirmationBMandatoryGates: previous.qaBMandatoryGates,
      confirmationBlockers: [{ severity: "P1", domain: "form-contract", description: "form stopped posting to the Form Service", evidenceRef: "qa/contact.html" }],
    });
    expect(verdict.regression).toBe(true);
    expect(verdict.regressions.join(" ")).toContain("form-contract");
  });

  it("classifies old blockers remaining + new regressions as a constraint conflict", () => {
    const verdict = evaluateRepairRegression({
      previous,
      confirmationAHardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: id !== "MOBILE_PRESERVES_VISUAL_IDENTITY" })),
      confirmationBMandatoryGates: previous.qaBMandatoryGates,
      confirmationBlockers: [{ severity: "P1", domain: "visual-fidelity", description: "hero heading contrast STILL too weak", evidenceRef: "qa/home-1440-first.png" }],
    });
    expect(verdict.regression).toBe(true);
    expect(verdict.conflict).toBe(true);
  });

  it("resolving the previous blocker with no new damage is not a regression", () => {
    const verdict = evaluateRepairRegression({
      previous,
      confirmationAHardGates: ALL_A_PASS,
      confirmationBMandatoryGates: previous.qaBMandatoryGates,
      confirmationBlockers: [],
    });
    expect(verdict.regression).toBe(false);
    expect(verdict.conflict).toBe(false);
  });
});

// ── Pipeline integration ─────────────────────────────────────────────────────

async function newPipelineContext(): Promise<{ siteGenerationId: string; buildId: string }> {
  const screenshotKey = `references/uploads/rg-${Math.random().toString(36).slice(2)}.png`;
  await persistPipelineScreenshot(env, screenshotKey);
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
      reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { siteGenerationId: started.siteGenerationId, buildId: created.buildId };
}

describe("repair guard pipeline integration (issue #50)", () => {
  it("repair prompts carry the measured context and the guard blocks a regressing repair", async () => {
    const context = await newPipelineContext();
    const base = createPipelineScripts({ firstQaAFails: true });
    const prompts: string[] = [];
    // The repaired version's confirmation fails a gate that previously
    // passed (mobile identity) while reporting the old blocker RESOLVED —
    // a textbook REPAIR_REGRESSION.
    const generate: RawAiGenerate = async (system, user) => {
      prompts.push(user);
      if (user.includes("QA-A Confirmation")) {
        return {
          content: JSON.stringify({
            version: "1",
            visualScore: 94,
            contentScore: 93,
            fabrication: false,
            hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: id !== "MOBILE_PRESERVES_VISUAL_IDENTITY" })),
            findings: [
              {
                severity: "P1",
                domain: "visual-fidelity",
                description: "hero heading contrast defect fixed on this Build Version",
                evidenceRef: "qa/home-1440-first.png",
                status: "RESOLVED",
              },
            ],
          }),
          provider: "test",
          model: "test-model-g",
        };
      }
      return base.generate!(system, user);
    };
    const scripted: BuildPipelineDeps = { ...base, generate };

    const outcome = await runBuildPipeline(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      deps: scripted,
    });

    // The regression blocks promotion even though the confirmation resolved
    // the previous blocker.
    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.reasons.join(" ")).toContain("REPAIR_REGRESSION");
    expect(outcome.reasons.join(" ")).toContain("MOBILE_PRESERVES_VISUAL_IDENTITY");
    const releaseRecords = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_release_records WHERE build_id = ?")
      .bind(context.buildId)
      .first<{ n: number }>();
    expect(releaseRecords!.n).toBe(0);
    // Automation stopped: exactly the one Fix Coordinator batch ran.
    const batches = await env.DB.prepare("SELECT kind FROM repair_batches WHERE build_id = ?")
      .bind(context.buildId)
      .all<{ kind: string }>();
    expect((batches.results ?? []).map((row) => row.kind)).toEqual(["fix_coordinator"]);
    // Both repair planners' prompts carried the deterministic context.
    const fixPrompt = prompts.find((prompt) => prompt.includes("Plan ONE coordinated main Automated Repair batch"));
    expect(fixPrompt).toContain("PRESERVATION SET");
    expect(fixPrompt).toContain("MUTATION SCOPE");
    expect(fixPrompt).toContain("CONSTRAINT CONFLICTS");
    const event = await env.DB.prepare("SELECT stage FROM build_workflow_events WHERE build_id = ? AND stage = 'repair_regression'")
      .bind(context.buildId)
      .first();
    expect(event).not.toBeNull();
  });

  it("a score drop with all hard constraints intact is a valid release (no score monotonicity)", async () => {
    const context = await newPipelineContext();
    const base = createPipelineScripts();
    let qaACalls = 0;
    const generate: RawAiGenerate = async (system, user) => {
      if (user.includes("hard composition gate") || user.includes("QA-A Confirmation")) {
        qaACalls += 1;
        if (qaACalls === 1) {
          // First evaluation: high visual score but one P1 blocker.
          return {
            content: JSON.stringify({
              version: "1",
              visualScore: 95,
              contentScore: 93,
              fabrication: false,
              hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
              findings: [
                { severity: "P1", domain: "visual-fidelity", description: "hero heading contrast too weak in first viewport", evidenceRef: "qa/home-1440-first.png" },
              ],
            }),
            provider: "test",
            model: "test-model-g",
          };
        }
        // Repaired version: score DROPPED 95 -> 91, all constraints intact,
        // previous blocker verifiably resolved.
        return {
          content: JSON.stringify({
            version: "1",
            visualScore: 91,
            contentScore: 92,
            fabrication: false,
            hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
            findings: [
              { severity: "P1", domain: "visual-fidelity", description: "hero heading contrast defect fixed", evidenceRef: "qa/home-1440-first.png", status: "RESOLVED" },
            ],
          }),
          provider: "test",
          model: "test-model-g",
        };
      }
      return base.generate!(system, user);
    };

    const outcome = await runBuildPipeline(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      deps: { ...base, generate },
    });

    expect(outcome.terminal).toBe("RELEASE_READY");
    const releaseRecords = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_release_records WHERE build_id = ?")
      .bind(context.buildId)
      .first<{ n: number }>();
    expect(releaseRecords!.n).toBe(1);
  });
});
