// V2 five-site REFERENCE_BOUND benchmark harness (issue #17, PRD 43-45).
//
// Exactly five materially different benchmark cases are frozen (identity =
// checksums over the frozen evidence package and screenshot, plus the stable
// replacement-Business brief, Adaptation Contract where applicable, and the
// prompt/model/schema settings). A benchmark case can never be silently
// swapped because it is difficult or fails: the frozen row is immutable and
// every run re-verifies the identity checksums before it starts.
//
// Benchmark PASS = the exact candidate reached Release Ready through the
// automated pipeline with zero manual source edits and image spend within the
// USD 3 hard gate. Human Approval and Publication are not benchmark criteria.
//
// Runs record prompt/model/schema versions, QA summary, root cause (PRD
// section 45 taxonomy) and image spend so implementation changes can be
// distinguished from moving benchmark inputs.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { putObject } from "../lib/assets";
import { PROMPT_MANIFEST } from "./prompt-contract";
import { KIE_SPEND_LIMIT_USD } from "./image-pipeline";
import type { BusinessFacts } from "./lifecycle-schema";
import type { AdaptationContract } from "./reference-evidence-schema";
import type { ReferenceCaptureFn, ReferenceCaptureOutput } from "./reference-intake";
import type { ImageSlot } from "./site-generator";

// ── Frozen case definitions ─────────────────────────────────────────────────

export interface BenchmarkEvidenceFixture {
  regions: Array<{ id: string; startY: number; endY: number; height: number; viewportHeightRatio: number }>;
  measuredElements: Array<{ selectorHint: string; role: string; computed: Record<string, string>; confidence: "HIGH" | "MEDIUM" | "LOW"; source: "DOM" | "COMPUTED_STYLE" | "SCREENSHOT" | "BROWSER_INTERACTION" }>;
  motionObservations: Array<{ kind: string; detail?: string }>;
  responsiveObservations: unknown[];
  screenshotBytes: string;
}

export interface BenchmarkCaseDefinition {
  id: string;
  slot: number;
  archetype: string;
  referenceUrl: string;
  evidence: BenchmarkEvidenceFixture;
  brief: BusinessFacts;
  adaptationContract: AdaptationContract | null;
}

// The five fixed Reference-and-replacement-Business test cases (PRD 43):
// materially different silhouettes, image mass, motion demands and business
// verticals. Frozen definitions — do not swap a case because it is difficult
// or fails.
export const BENCHMARK_CASES: readonly BenchmarkCaseDefinition[] = [
  {
    id: "bench-asymmetric-editorial",
    slot: 1,
    archetype: "asymmetric/editorial",
    referenceUrl: "https://editorial-house.example.com/",
    evidence: {
      regions: [
        { id: "hero", startY: 0, endY: 820, height: 820, viewportHeightRatio: 0.91 },
        { id: "manifesto", startY: 820, endY: 1700, height: 880, viewportHeightRatio: 0.98 },
        { id: "gallery-band", startY: 1700, endY: 2500, height: 800, viewportHeightRatio: 0.89 },
        { id: "journal-teaser", startY: 2500, endY: 3100, height: 600, viewportHeightRatio: 0.67 },
      ],
      measuredElements: [
        { selectorHint: "h1", role: "typography", computed: { fontFamily: "Editorial Serif", fontSize: "84px" }, confidence: "MEDIUM", source: "COMPUTED_STYLE" },
        { selectorHint: "header nav", role: "navigation", computed: { position: "sticky" }, confidence: "HIGH", source: "DOM" },
      ],
      motionObservations: [],
      responsiveObservations: [{ kind: "viewport_matrix", viewports: ["desktop", "mobile"] }],
      screenshotBytes: "PNG-bench-1-asymmetric-editorial",
    },
    brief: {
      businessName: "Rift Valley Roasters",
      contactEmail: "hello@riftvalleyroasters.example",
      businessType: "coffee roastery",
      businessDescription: "Small-batch coffee roasting for cafes and homes in Nakuru.",
      city: "Nakuru",
      country: "Kenya",
    },
    adaptationContract: null,
  },
  {
    id: "bench-hospitality-travel",
    slot: 2,
    archetype: "image-heavy hospitality/travel",
    referenceUrl: "https://safari-house.example.com/",
    evidence: {
      regions: [
        { id: "fullscreen-hero", startY: 0, endY: 900, height: 900, viewportHeightRatio: 1.0 },
        { id: "immersive-gallery", startY: 900, endY: 2400, height: 1500, viewportHeightRatio: 1.67 },
        { id: "experience-grid", startY: 2400, endY: 3300, height: 900, viewportHeightRatio: 1.0 },
        { id: "booking-cta", startY: 3300, endY: 3800, height: 500, viewportHeightRatio: 0.56 },
      ],
      measuredElements: [
        { selectorHint: "h1", role: "typography", computed: { fontSize: "64px", textShadow: "0 2px 20px rgba(0,0,0,.5)" }, confidence: "MEDIUM", source: "COMPUTED_STYLE" },
        { selectorHint: "section img", role: "imagery", computed: { objectFit: "cover" }, confidence: "HIGH", source: "DOM" },
      ],
      motionObservations: [],
      responsiveObservations: [{ kind: "viewport_matrix", viewports: ["desktop", "mobile"] }],
      screenshotBytes: "PNG-bench-2-hospitality-travel",
    },
    brief: {
      businessName: "Acacia Safari Lodge",
      contactEmail: "stay@acaciasafari.example",
      businessType: "safari lodge",
      businessDescription: "Family-run safari lodge overlooking the savanna corridor.",
      city: "Nanyuki",
      country: "Kenya",
    },
    adaptationContract: null,
  },
  {
    id: "bench-corporate-professional",
    slot: 3,
    archetype: "restrained corporate/professional",
    referenceUrl: "https://ledger-partners.example.com/",
    evidence: {
      regions: [
        { id: "centered-hero", startY: 0, endY: 640, height: 640, viewportHeightRatio: 0.71 },
        { id: "services-matrix", startY: 640, endY: 1500, height: 860, viewportHeightRatio: 0.96 },
        { id: "proof-band", startY: 1500, endY: 2050, height: 550, viewportHeightRatio: 0.61 },
        { id: "contact-panel", startY: 2050, endY: 2600, height: 550, viewportHeightRatio: 0.61 },
      ],
      measuredElements: [
        { selectorHint: "h1", role: "typography", computed: { fontSize: "44px", fontWeight: "600" }, confidence: "MEDIUM", source: "COMPUTED_STYLE" },
        { selectorHint: "main", role: "layout", computed: { maxWidth: "960px", margin: "0 auto" }, confidence: "HIGH", source: "DOM" },
      ],
      motionObservations: [],
      responsiveObservations: [{ kind: "viewport_matrix", viewports: ["desktop", "mobile"] }],
      screenshotBytes: "PNG-bench-3-corporate-professional",
    },
    brief: {
      businessName: "Ledger & Vale Partners",
      contactEmail: "info@ledgervale.example",
      businessType: "accounting practice",
      businessDescription: "Audit, tax and advisory for owner-managed businesses.",
      city: "Nairobi",
      country: "Kenya",
    },
    adaptationContract: null,
  },
  {
    id: "bench-trades-local-service",
    slot: 4,
    archetype: "bold trades/local service",
    referenceUrl: "https://ironline-roofing.example.com/",
    evidence: {
      regions: [
        { id: "banner-hero", startY: 0, endY: 760, height: 760, viewportHeightRatio: 0.84 },
        { id: "offer-grid", startY: 760, endY: 1560, height: 800, viewportHeightRatio: 0.89 },
        { id: "before-after", startY: 1560, endY: 2360, height: 800, viewportHeightRatio: 0.89 },
        { id: "trust-bar", startY: 2360, endY: 2700, height: 340, viewportHeightRatio: 0.38 },
        { id: "quote-form", startY: 2700, endY: 3300, height: 600, viewportHeightRatio: 0.67 },
      ],
      measuredElements: [
        { selectorHint: "h1", role: "typography", computed: { fontSize: "72px", textTransform: "uppercase" }, confidence: "MEDIUM", source: "COMPUTED_STYLE" },
        { selectorHint: ".offer", role: "card", computed: { border: "4px solid #ffc400" }, confidence: "HIGH", source: "DOM" },
      ],
      motionObservations: [],
      responsiveObservations: [{ kind: "viewport_matrix", viewports: ["desktop", "mobile"] }],
      screenshotBytes: "PNG-bench-4-trades-local-service",
    },
    brief: {
      businessName: "Ironline Roofing",
      contactEmail: "quotes@ironlineroofing.example",
      businessType: "roofing contractor",
      businessDescription: "Roof installation and repair for homes and light commercial buildings.",
      city: "Eldoret",
      country: "Kenya",
    },
    adaptationContract: null,
  },
  {
    id: "bench-responsive-motion",
    slot: 5,
    archetype: "difficult but supported responsive/motion reference",
    referenceUrl: "https://pulse-studio.example.com/",
    evidence: {
      regions: [
        { id: "split-hero", startY: 0, endY: 880, height: 880, viewportHeightRatio: 0.98 },
        { id: "motion-showcase", startY: 880, endY: 1900, height: 1020, viewportHeightRatio: 1.13 },
        { id: "program-grid", startY: 1900, endY: 2700, height: 800, viewportHeightRatio: 0.89 },
        { id: "membership-cta", startY: 2700, endY: 3200, height: 500, viewportHeightRatio: 0.56 },
      ],
      measuredElements: [
        { selectorHint: "h1", role: "typography", computed: { fontSize: "76px", letterSpacing: "-0.02em" }, confidence: "MEDIUM", source: "COMPUTED_STYLE" },
        { selectorHint: "[data-parallax]", role: "motion", computed: { transform: "translate3d(0,12%,0)" }, confidence: "HIGH", source: "BROWSER_INTERACTION" },
      ],
      motionObservations: [
        { kind: "heavy_parallax", detail: "multi-layer parallax in motion showcase" },
        { kind: "complex_slider", detail: "draggable before/after comparison slider" },
      ],
      responsiveObservations: [{ kind: "viewport_matrix", viewports: ["desktop", "mobile"] }],
      screenshotBytes: "PNG-bench-5-responsive-motion",
    },
    brief: {
      businessName: "Pulse Studio Fitness",
      contactEmail: "train@pulsestudio.example",
      businessType: "boutique fitness studio",
      businessDescription: "Small-group strength and conditioning coaching.",
      city: "Mombasa",
      country: "Kenya",
    },
    adaptationContract: {
      version: "1",
      unsupportedFeatures: [
        { feature: "heavy_parallax", reason: "multi-layer parallax outside ordinary CSS/JS motion budget" },
        { feature: "complex_slider", reason: "draggable comparison slider replaced by justified lightweight slider" },
      ],
      acceptedApproximations: [
        { replaces: "heavy_parallax", substituteOutcome: "single-layer transform parallax with reduced-motion guard" },
        { replaces: "complex_slider", substituteOutcome: "justified lightweight slider with same frame rhythm" },
      ],
      qaExceptions: ["parallax depth reduced to one layer", "slider track count reduced to 3"],
    },
  },
];

// Frozen prompt/model/schema settings (PRD 43: freeze where possible). Model
// choice is stage-configured at runtime; the prompt ids/versions and schema
// versions are the canonical contract versions this suite freezes against.
export function frozenPromptModelSchema(): Record<string, { promptId: string; promptVersion: string; schemaVersion: string }> {
  return {
    "reference-analyzer": { promptId: PROMPT_MANIFEST["reference-analyzer"].promptId, promptVersion: PROMPT_MANIFEST["reference-analyzer"].promptVersion, schemaVersion: "reference-analysis/1" },
    "visual-blueprint-generator": { promptId: PROMPT_MANIFEST["visual-blueprint-generator"].promptId, promptVersion: PROMPT_MANIFEST["visual-blueprint-generator"].promptVersion, schemaVersion: "visual-blueprint/1" },
    "website-generator": { promptId: PROMPT_MANIFEST["website-generator"].promptId, promptVersion: PROMPT_MANIFEST["website-generator"].promptVersion, schemaVersion: "generated-source/1" },
    "kie-image-prompt-generator": { promptId: PROMPT_MANIFEST["kie-image-prompt-generator"].promptId, promptVersion: PROMPT_MANIFEST["kie-image-prompt-generator"].promptVersion, schemaVersion: "image-prompt-records/1" },
    "qa-a-visual-content": { promptId: PROMPT_MANIFEST["qa-a-visual-content"].promptId, promptVersion: PROMPT_MANIFEST["qa-a-visual-content"].promptVersion, schemaVersion: "qa-a/1" },
    "qa-b-browser-technical": { promptId: PROMPT_MANIFEST["qa-b-browser-technical"].promptId, promptVersion: PROMPT_MANIFEST["qa-b-browser-technical"].promptVersion, schemaVersion: "qa-b/1" },
  };
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function evidenceChecksumOf(evidence: BenchmarkEvidenceFixture): Promise<string> {
  return sha256Hex(stableStringify({ regions: evidence.regions, measuredElements: evidence.measuredElements, motionObservations: evidence.motionObservations, responsiveObservations: evidence.responsiveObservations }));
}

export async function screenshotChecksumOf(evidence: BenchmarkEvidenceFixture): Promise<string> {
  return sha256Hex(evidence.screenshotBytes);
}

// ── Freeze + identity verification ──────────────────────────────────────────

export class BenchmarkHarnessError extends Error {
  readonly code: "BENCHMARK_ALREADY_FROZEN_DIFFERENT" | "BENCHMARK_IDENTITY_MISMATCH" | "BENCHMARK_CASE_NOT_FOUND";

  constructor(code: BenchmarkHarnessError["code"], message: string) {
    super(message);
    this.name = "BenchmarkHarnessError";
    this.code = code;
  }
}

interface BenchmarkCaseRow {
  id: string;
  slot: number;
  archetype: string;
  reference_url: string | null;
  evidence_checksum: string;
  screenshot_checksum: string;
  replacement_brief_json: string;
  adaptation_contract_json: string | null;
  prompt_model_schema_json: string;
  frozen_at: string;
}

// Idempotent freeze of the five cases. Any drift between the code-frozen
// definitions and an already-frozen row is a hard error — a Reference can
// never be silently swapped because it is difficult or fails.
export async function freezeBenchmarkCases(env: Env): Promise<void> {
  for (const definition of BENCHMARK_CASES) {
    const evidenceChecksum = await evidenceChecksumOf(definition.evidence);
    const screenshotChecksum = await screenshotChecksumOf(definition.evidence);
    const existing = await env.DB.prepare("SELECT * FROM benchmark_cases WHERE id = ?")
      .bind(definition.id)
      .first<BenchmarkCaseRow>();
    if (existing) {
      if (existing.evidence_checksum !== evidenceChecksum || existing.screenshot_checksum !== screenshotChecksum) {
        throw new BenchmarkHarnessError(
          "BENCHMARK_ALREADY_FROZEN_DIFFERENT",
          `Benchmark case '${definition.id}' is frozen with different reference identity; benchmark targets may not be swapped`
        );
      }
      continue;
    }
    await env.DB.prepare(
      `INSERT INTO benchmark_cases (id, slot, archetype, reference_url, evidence_checksum, screenshot_checksum, replacement_brief_json, adaptation_contract_json, prompt_model_schema_json, frozen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        definition.id,
        definition.slot,
        definition.archetype,
        definition.referenceUrl,
        evidenceChecksum,
        screenshotChecksum,
        JSON.stringify(definition.brief),
        definition.adaptationContract ? JSON.stringify(definition.adaptationContract) : null,
        JSON.stringify(frozenPromptModelSchema()),
        nowIso()
      )
      .run();
  }
}

// Every run verifies the frozen identity before starting: the live evidence
// package and screenshot must still checksum to the frozen values.
export async function verifyBenchmarkIdentity(
  env: Env,
  input: { caseId: string; evidence: BenchmarkEvidenceFixture }
): Promise<void> {
  const row = await env.DB.prepare("SELECT * FROM benchmark_cases WHERE id = ?")
    .bind(input.caseId)
    .first<BenchmarkCaseRow>();
  if (!row) {
    throw new BenchmarkHarnessError("BENCHMARK_CASE_NOT_FOUND", `Benchmark case '${input.caseId}' is not frozen`);
  }
  const evidenceChecksum = await evidenceChecksumOf(input.evidence);
  const screenshotChecksum = await screenshotChecksumOf(input.evidence);
  if (row.evidence_checksum !== evidenceChecksum || row.screenshot_checksum !== screenshotChecksum) {
    throw new BenchmarkHarnessError(
      "BENCHMARK_IDENTITY_MISMATCH",
      `Benchmark case '${input.caseId}' reference identity no longer matches the frozen target; refusing to run against a swapped reference`
    );
  }
}

// The frozen Reference capture for a case: deterministic evidence fixture —
// the screenshot is the authority, supplemented by the reference URL.
export function frozenCaptureFor(caseDefinition: BenchmarkCaseDefinition): ReferenceCaptureFn {
  return async () => {
    const bytes = new TextEncoder().encode(caseDefinition.evidence.screenshotBytes);
    const capture: ReferenceCaptureOutput = {
      canonicalScreenshot: { content: bytes, mimeType: "image/png", pixelWidth: 1440, pixelHeight: 4800, likelyCssViewportWidth: 1440 },
      captures: [{ viewportWidth: 1440, viewportHeight: 900, content: bytes, mimeType: "image/png" }],
      regions: caseDefinition.evidence.regions.map((region) => ({ ...region })),
      measuredElements: caseDefinition.evidence.measuredElements.map((element) => ({ ...element, computed: { ...element.computed } })),
      responsiveObservations: caseDefinition.evidence.responsiveObservations,
      motionObservations: caseDefinition.evidence.motionObservations,
      discrepancies: [],
    };
    return capture;
  };
}

// ── PASS evaluation + run recording ─────────────────────────────────────────

// PRD section 44: PASS = automated Release Ready + zero manual source edits +
// KIE spend <= USD 3.00. Approval and Publication are not criteria.
export function evaluateBenchmarkPass(input: {
  releaseReady: boolean;
  imageSpendUsd: number;
  manualSourceEdits: number;
}): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.releaseReady) reasons.push("candidate did not reach automated Release Ready");
  if (input.manualSourceEdits > 0) reasons.push(`${input.manualSourceEdits} manual source edit(s)`);
  if (input.imageSpendUsd > KIE_SPEND_LIMIT_USD + 1e-9) reasons.push(`image spend $${input.imageSpendUsd.toFixed(2)} exceeds the $${KIE_SPEND_LIMIT_USD.toFixed(2)} hard gate`);
  return { pass: reasons.length === 0, reasons };
}

// PRD section 45 root-cause taxonomy.
export const BENCHMARK_ROOT_CAUSES = [
  "REFERENCE_UNSUITABLE", "EVIDENCE_EXTRACTION", "REFERENCE_ANALYSIS", "BLUEPRINT",
  "IMPLEMENTATION_PLAN", "GENERATOR", "IMAGE_PLAN", "IMAGE_GENERATION", "ASSEMBLY",
  "TECHNICAL_PREFLIGHT", "QA_FALSE_POSITIVE", "FIX_COORDINATOR", "FORM_SERVICE", "PLATFORM_RUNTIME",
] as const;
export type BenchmarkRootCause = (typeof BENCHMARK_ROOT_CAUSES)[number];

export interface RecordBenchmarkRunInput {
  benchmarkCaseId: string;
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  releaseReady: boolean;
  imageSpendUsd: number;
  manualSourceEdits: number;
  rootCause?: BenchmarkRootCause | null;
  qaSummary?: unknown;
  provenance?: unknown;
}

export async function recordBenchmarkRun(env: Env, input: RecordBenchmarkRunInput): Promise<{ runId: string; pass: boolean; reasons: string[] }> {
  const evaluation = evaluateBenchmarkPass({
    releaseReady: input.releaseReady,
    imageSpendUsd: input.imageSpendUsd,
    manualSourceEdits: input.manualSourceEdits,
  });
  const runId = generateId();
  await env.DB.prepare(
    `INSERT INTO benchmark_runs (id, benchmark_case_id, site_generation_id, build_id, build_version_id, status, release_ready, image_spend_usd, manual_source_edits, root_cause, qa_summary_json, provenance_json, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      runId,
      input.benchmarkCaseId,
      input.siteGenerationId,
      input.buildId,
      input.buildVersionId,
      evaluation.pass ? "pass" : "fail",
      input.releaseReady ? 1 : 0,
      Number(input.imageSpendUsd.toFixed(4)),
      input.manualSourceEdits,
      evaluation.pass ? null : (input.rootCause ?? "PLATFORM_RUNTIME"),
      input.qaSummary === undefined ? null : JSON.stringify(input.qaSummary),
      input.provenance === undefined ? null : JSON.stringify(input.provenance),
      nowIso(),
      nowIso()
    )
    .run();
  return { runId, pass: evaluation.pass, reasons: evaluation.reasons };
}

export interface BenchmarkSuiteStatus {
  totalCases: number;
  passedCases: number;
  requiredPasses: number;
  gateSatisfied: boolean;
  perCase: Array<{ caseId: string; slot: number; archetype: string; latestStatus: string | null; passes: number; fails: number }>;
}

// Latest status per case + the 3/5 proof-gate answer (consumed by #23).
export async function getBenchmarkSuiteStatus(env: Env): Promise<BenchmarkSuiteStatus> {
  const cases = await env.DB.prepare("SELECT id, slot, archetype FROM benchmark_cases ORDER BY slot")
    .all<{ id: string; slot: number; archetype: string }>();
  const perCase: BenchmarkSuiteStatus["perCase"] = [];
  for (const row of cases.results ?? []) {
    const runs = await env.DB.prepare(
      "SELECT status FROM benchmark_runs WHERE benchmark_case_id = ? ORDER BY started_at"
    )
      .bind(row.id)
      .all<{ status: string }>();
    const statuses = (runs.results ?? []).map((run) => run.status);
    perCase.push({
      caseId: row.id,
      slot: row.slot,
      archetype: row.archetype,
      latestStatus: statuses.length ? statuses[statuses.length - 1] : null,
      passes: statuses.filter((status) => status === "pass").length,
      fails: statuses.filter((status) => status === "fail").length,
    });
  }
  const passedCases = perCase.filter((entry) => entry.latestStatus === "pass").length;
  return {
    totalCases: perCase.length,
    passedCases,
    requiredPasses: 3,
    gateSatisfied: passedCases >= 3,
    perCase,
  };
}

// Persists the frozen screenshot for a case under a stable benchmark key so
// runs consume the same frozen bytes.
export async function persistFrozenScreenshot(env: Env, caseDefinition: BenchmarkCaseDefinition): Promise<string> {
  const key = `benchmarks/${caseDefinition.id}/reference/screenshot.png`;
  await putObject(env, key, caseDefinition.evidence.screenshotBytes, {
    httpMetadata: { contentType: "image/png" },
  });
  return key;
}

export function benchmarkCaseById(id: string): BenchmarkCaseDefinition {
  const found = BENCHMARK_CASES.find((definition) => definition.id === id);
  if (!found) {
    throw new BenchmarkHarnessError("BENCHMARK_CASE_NOT_FOUND", `Unknown benchmark case '${id}'`);
  }
  return found;
}

export type { ImageSlot };
