// V2 QA-A (visual/content) and QA-B (browser/technical) schemas and release
// evaluation (issue #13, PRD sections 28-32.1).
//
// QA-A judges rendered output: visual fidelity >= 90, content quality >= 90,
// P0=0, P1=0, no fabrication, and every hard composition gate passing. A high
// aggregate score can never compensate a failed hard gate — the gate is a
// separate conjunct, not an average input.
//
// QA-B owns browser/runtime/source/DOM/network/accessibility/SEO/form-
// contract verification: technical >= 90, P0=0, P1=0 and all mandatory
// gates.

import { Type, type Static } from "@sinclair/typebox";
import type { Env } from "../env.d";
import { runSchemaValidatedAiStage, type RawAiGenerate } from "./ai-boundary";
import type { GeometryComparison } from "./qa-evidence";

export const QA_A_SCHEMA_VERSION = "qa-a/1";
export const QA_B_SCHEMA_VERSION = "qa-b/1";

export const QA_A_HARD_GATE_IDS = [
  "FIRST_VIEWPORT_MATERIALLY_CORRECT",
  "PAGE_SILHOUETTE_REGION_ORDER",
  "DOMINANT_TEXT_IMAGE_MASS",
  "CRITICAL_SIGNATURE_TRAITS_PRESERVED",
  "MOBILE_PRESERVES_VISUAL_IDENTITY",
  "CRITICAL_IMAGERY_SERVES_ROLE",
] as const;

export const QA_B_MANDATORY_GATE_IDS = [
  "ALL_PAGES_LOAD",
  "INTERNAL_NAVIGATION",
  "MOBILE_MENU",
  "RESPONSIVE_MECHANICS",
  "NO_PAGE_OVERFLOW",
  "KEYBOARD_FOCUS_ACCESSIBILITY",
  "FORM_SERVICE_CONTRACT",
  "TURNSTILE_INTEGRATION",
  "RUNTIME_CONSOLE_NETWORK_CLEAN",
  "IMAGE_MANIFEST_RESOLUTION",
  "NO_PROVIDER_URLS",
  "METADATA_CANONICAL_OG",
  "TRUTHFUL_JSON_LD",
  "CRAWLABILITY",
  "IMPLEMENTATION_CONTRACT_INTEGRITY",
] as const;

const SeveritySchema = Type.Union([Type.Literal("P0"), Type.Literal("P1"), Type.Literal("P2"), Type.Literal("P3")]);
const ScoreSchema = Type.Integer({ minimum: 0, maximum: 100 });

const GateSchema = Type.Object({ id: Type.String({ minLength: 1 }), passed: Type.Boolean() }, { additionalProperties: false });
export type QaGate = Static<typeof GateSchema>;

export const FindingSchema = Type.Object(
  {
    severity: SeveritySchema,
    domain: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.String({ minLength: 1, maxLength: 2000 }),
    evidenceRef: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false }
);
export type QaFinding = Static<typeof FindingSchema>;

export const QaAReportSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    visualScore: ScoreSchema,
    contentScore: ScoreSchema,
    fabrication: Type.Boolean(),
    hardGates: Type.Array(GateSchema, { minItems: 1 }),
    findings: Type.Array(FindingSchema),
  },
  { additionalProperties: false }
);
export type QaAReport = Static<typeof QaAReportSchema>;

export const QaBReportSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    technicalScore: ScoreSchema,
    gates: Type.Array(GateSchema, { minItems: 1 }),
    findings: Type.Array(FindingSchema),
  },
  { additionalProperties: false }
);
export type QaBReport = Static<typeof QaBReportSchema>;

// ── Release evaluation (pure) ───────────────────────────────────────────────

export interface ReleaseGateVerdict {
  releaseReady: boolean;
  reasons: string[];
  blockers: QaFinding[];
  polish: QaFinding[];
}

export function isReleaseBlocker(finding: QaFinding): boolean {
  return finding.severity === "P0" || finding.severity === "P1";
}

// QA-A release condition. Hard-gate failures are separate conjuncts: no
// aggregate score can average them away.
export function evaluateQaARelease(report: QaAReport): ReleaseGateVerdict {
  const reasons: string[] = [];
  if (report.visualScore < 90) reasons.push(`visual fidelity ${report.visualScore} < 90`);
  if (report.contentScore < 90) reasons.push(`content quality ${report.contentScore} < 90`);
  const p0 = report.findings.filter((finding) => finding.severity === "P0");
  const p1 = report.findings.filter((finding) => finding.severity === "P1");
  if (p0.length > 0) reasons.push(`${p0.length} P0 finding(s)`);
  if (p1.length > 0) reasons.push(`${p1.length} P1 finding(s)`);
  if (report.fabrication) reasons.push("fabricated Business Facts detected");
  const failedGates = report.hardGates.filter((gate) => !gate.passed);
  if (failedGates.length > 0) reasons.push(`hard composition gate(s) failed: ${failedGates.map((gate) => gate.id).join(", ")}`);
  return {
    releaseReady: reasons.length === 0,
    reasons,
    blockers: [...p0, ...p1],
    polish: report.findings.filter((finding) => !isReleaseBlocker(finding)),
  };
}

export function evaluateQaBRelease(report: QaBReport): ReleaseGateVerdict {
  const reasons: string[] = [];
  if (report.technicalScore < 90) reasons.push(`technical ${report.technicalScore} < 90`);
  const p0 = report.findings.filter((finding) => finding.severity === "P0");
  const p1 = report.findings.filter((finding) => finding.severity === "P1");
  if (p0.length > 0) reasons.push(`${p0.length} P0 finding(s)`);
  if (p1.length > 0) reasons.push(`${p1.length} P1 finding(s)`);
  const failedGates = report.gates.filter((gate) => !gate.passed);
  if (failedGates.length > 0) reasons.push(`mandatory gate(s) failed: ${failedGates.map((gate) => gate.id).join(", ")}`);
  return {
    releaseReady: reasons.length === 0,
    reasons,
    blockers: [...p0, ...p1],
    polish: report.findings.filter((finding) => !isReleaseBlocker(finding)),
  };
}

// ── AI stages ───────────────────────────────────────────────────────────────

export function buildQaAUserPrompt(input: {
  businessName: string;
  geometryComparison: GeometryComparison;
  evidenceSummary: string;
  signatureTraitIds: string[];
  canonicalRegions: Array<{ order: number; id: string; purpose: string }>;
  firstViewportRegionIds: string[];
  adaptationContractQaExceptions: string[];
}): string {
  return `Evaluate this Release Candidate against the Reference and the Visual Blueprint. Judge rendered visual fidelity and content quality, verify every hard composition gate, and list exact findings with severity (P0/P1/P2/P3) and evidence references. Treat declared Adaptation Contract QA exceptions as intentional; a high score may never compensate a failed hard gate.

CANONICAL REGION AUTHORITY (issue #37 semantics): the CANONICAL BLUEPRINT REGION TOPOLOGY below is the binding comparison target for PAGE_SILHOUETTE_REGION_ORDER and FIRST_VIEWPORT_MATERIALLY_CORRECT — judge the generated canonical region sequence, identity and first-viewport composition against THIS topology. The raw Reference Evidence segmentation is observational; raw evidence measurements remain the authority for measured fidelity (proportions, mass, viewport ratios) but never define a second region topology the generated page must match. Harmless internal wrappers inside one canonical region are not region-order violations; a missing, renamed, reordered or substituted canonical region is.

BUSINESS: ${input.businessName}
SIGNATURE TRAITS THAT MUST BE PRESERVED: ${JSON.stringify(input.signatureTraitIds)}
CANONICAL BLUEPRINT REGION TOPOLOGY (ordered, binding): ${JSON.stringify(input.canonicalRegions)}
BLUEPRINT FIRST-VIEWPORT REGION IDS (ordered prefix, binding): ${JSON.stringify(input.firstViewportRegionIds)}
GEOMETRY COMPARATOR EVIDENCE (structural, not pixels): ${JSON.stringify(input.geometryComparison.metrics)}
EVIDENCE SUMMARY: ${input.evidenceSummary}
ADAPTATION CONTRACT QA EXCEPTIONS: ${JSON.stringify(input.adaptationContractQaExceptions)}`;
}

export async function runQaAStage(
  env: Env,
  input: {
    buildId: string;
    siteGenerationId: string;
    buildVersionId: string;
    buildVersionNumber: number;
    context: Parameters<typeof buildQaAUserPrompt>[0];
    evidenceR2Key: string;
    generate?: RawAiGenerate;
  }
): Promise<{ report: QaAReport; provenance: import("./ai-boundary").AiProvenance }> {
  const run = await runSchemaValidatedAiStage<QaAReport>(env, {
    stage: "qa-a-visual-content",
    schema: QaAReportSchema,
    schemaVersion: QA_A_SCHEMA_VERSION,
    userPrompt: buildQaAUserPrompt(input.context),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [input.evidenceR2Key],
    temperature: 0.2,
    generate: input.generate,
  });
  return { report: run.value, provenance: run.provenance };
}

export function buildQaBUserPrompt(input: {
  formServiceEndpoint: string;
  evidenceSummary: string;
  preflightPassed: boolean;
  imageManifestSummary: string;
}): string {
  return `Perform the browser/technical review of this Release Candidate Preview. Verify all four pages load, internal navigation, mobile menu, responsive mechanics, overflow, keyboard/focus accessibility, the central Form Service contract (${input.formServiceEndpoint}), runtime/console/network cleanliness, image manifest resolution with no temporary provider URLs, metadata/canonical/OG, truthful JSON-LD, crawlability and Implementation Contract integrity. Technical Preflight already ${input.preflightPassed ? "passed" : "FAILED"}. List exact findings with severity and evidence references.

EVIDENCE SUMMARY: ${input.evidenceSummary}
IMAGE MANIFEST: ${input.imageManifestSummary}`;
}

export async function runQaBStage(
  env: Env,
  input: {
    buildId: string;
    siteGenerationId: string;
    buildVersionId: string;
    buildVersionNumber: number;
    context: Parameters<typeof buildQaBUserPrompt>[0];
    evidenceR2Key: string;
    generate?: RawAiGenerate;
  }
): Promise<{ report: QaBReport; provenance: import("./ai-boundary").AiProvenance }> {
  const run = await runSchemaValidatedAiStage<QaBReport>(env, {
    stage: "qa-b-browser-technical",
    schema: QaBReportSchema,
    schemaVersion: QA_B_SCHEMA_VERSION,
    userPrompt: buildQaBUserPrompt(input.context),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [input.evidenceR2Key],
    temperature: 0.2,
    generate: input.generate,
  });
  return { report: run.value, provenance: run.provenance };
}
