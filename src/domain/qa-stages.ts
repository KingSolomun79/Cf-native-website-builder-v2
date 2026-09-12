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
//
// Confirmation seam (issue #38): the confirmation reports re-evaluate a
// repaired Build Version against the PREVIOUS blockers and must distinguish
// an ACTIVE finding (defect still present) from a RESOLVED finding (the
// prior defect verifiably fixed — a resolution record carrying its original
// severity). Resolved findings are never active Release Blockers. Fresh
// QA-A/QA-B report schemas do not allow `status`, so fresh blocker
// semantics are unchanged; absent status fails closed as active.

import { Type, type Static } from "@sinclair/typebox";
import type { Env } from "../env.d";
import { runSchemaValidatedAiStage, type RawAiGenerate } from "./ai-boundary";
import { getObject } from "../lib/assets";

export const QA_A_SCHEMA_VERSION = "qa-a/1";
export const QA_B_SCHEMA_VERSION = "qa-b/1";
// Confirmation reports carry the explicit ACTIVE/RESOLVED finding status, so
// they version separately from the fresh-QA report schemas (issue #38).
export const QA_A_CONFIRMATION_SCHEMA_VERSION = "qa-a-confirmation/2";
export const QA_B_CONFIRMATION_SCHEMA_VERSION = "qa-b-confirmation/2";

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

// Production retest 2026-09-05: a free-string gate id let the model invent
// plausible near-miss gate names, and every attempt died on the enumeration
// integrity check. The stage OUTPUT schemas constrain ids to the canonical
// literals, so the model's output contract enumerates the exact allowed
// values and the schema-repair attempt quotes the violation. The
// enumeration-integrity check below stays as the exactly-once belt.
const QaAGateSchema = Type.Object(
  { id: Type.Union(QA_A_HARD_GATE_IDS.map((id) => Type.Literal(id))), passed: Type.Boolean() },
  { additionalProperties: false }
);
const QaBGateSchema = Type.Object(
  { id: Type.Union(QA_B_MANDATORY_GATE_IDS.map((id) => Type.Literal(id))), passed: Type.Boolean() },
  { additionalProperties: false }
);

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

// Explicit resolution state on CONFIRMATION findings (issue #38). Required:
// confirmation output that cannot say whether a defect is active or resolved
// is schema-invalid and takes the existing repair/fail path — it can never
// silently pass as either state.
export const ConfirmationFindingSchema = Type.Object(
  {
    severity: SeveritySchema,
    domain: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.String({ minLength: 1, maxLength: 2000 }),
    evidenceRef: Type.String({ minLength: 1, maxLength: 500 }),
    status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("RESOLVED")]),
  },
  { additionalProperties: false }
);
export type QaConfirmationFinding = Static<typeof ConfirmationFindingSchema>;

// A finding as the release evaluators see it: fresh findings carry no
// status (absent = ACTIVE — fail closed on ambiguity, issue #38).
export type EvaluableQaFinding = QaFinding & { status?: FindingStatus };
export type FindingStatus = QaConfirmationFinding["status"];

export const QaAReportSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    visualScore: ScoreSchema,
    contentScore: ScoreSchema,
    fabrication: Type.Boolean(),
    hardGates: Type.Array(QaAGateSchema, { minItems: 1 }),
    findings: Type.Array(FindingSchema),
  },
  { additionalProperties: false }
);
export type QaAReport = Static<typeof QaAReportSchema>;

export const QaBReportSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    technicalScore: ScoreSchema,
    gates: Type.Array(QaBGateSchema, { minItems: 1 }),
    findings: Type.Array(FindingSchema),
  },
  { additionalProperties: false }
);
export type QaBReport = Static<typeof QaBReportSchema>;

export const QaAConfirmationReportSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    visualScore: ScoreSchema,
    contentScore: ScoreSchema,
    fabrication: Type.Boolean(),
    hardGates: Type.Array(QaAGateSchema, { minItems: 1 }),
    findings: Type.Array(ConfirmationFindingSchema),
  },
  { additionalProperties: false }
);
export type QaAConfirmationReport = Static<typeof QaAConfirmationReportSchema>;

export const QaBConfirmationReportSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    technicalScore: ScoreSchema,
    gates: Type.Array(QaBGateSchema, { minItems: 1 }),
    findings: Type.Array(ConfirmationFindingSchema),
  },
  { additionalProperties: false }
);
export type QaBConfirmationReport = Static<typeof QaBConfirmationReportSchema>;

// The deterministic REFERENCE_MACRO_FIDELITY gate (issue #44) is appended
// programmatically AFTER the model's report passes enumeration integrity —
// the model itself must never report it, so it is deliberately absent from
// the schema enum.
export type QaAReportAugmented = Omit<QaAReport, "hardGates"> & {
  hardGates: Array<QaAReport["hardGates"][number] | { id: "REFERENCE_MACRO_FIDELITY"; passed: boolean }>;
};

// ── Release evaluation (pure) ───────────────────────────────────────────────

export interface ReleaseGateVerdict {
  releaseReady: boolean;
  reasons: string[];
  blockers: EvaluableQaFinding[];
  polish: EvaluableQaFinding[];
  /** Confirmation seam only (issue #38): findings structurally re-verified
   *  as fixed on the repaired Build Version. Resolution records — retained
   *  as evidence, never active Release Blockers. */
  resolved: EvaluableQaFinding[];
}

export function isReleaseBlocker(finding: EvaluableQaFinding): boolean {
  // issue #38: severity classifies a defect only while it is ACTIVE. A
  // finding structurally marked RESOLVED is a confirmation record of a
  // fixed prior defect, never an active blocker. Absent status (fresh QA,
  // or ambiguous confirmation output) fails closed as ACTIVE.
  return (finding.severity === "P0" || finding.severity === "P1") && finding.status !== "RESOLVED";
}

// QA-A release condition. Hard-gate failures are separate conjuncts: no
// aggregate score can average them away. Findings marked RESOLVED (possible
// only in confirmation reports) are excluded from the blocker reasons.
export function evaluateQaARelease(report: QaAReport | QaAConfirmationReport | QaAReportAugmented): ReleaseGateVerdict {
  const findings = report.findings as EvaluableQaFinding[];
  const reasons: string[] = [];
  if (report.visualScore < 90) reasons.push(`visual fidelity ${report.visualScore} < 90`);
  if (report.contentScore < 90) reasons.push(`content quality ${report.contentScore} < 90`);
  const active = findings.filter((finding) => finding.status !== "RESOLVED");
  const p0 = active.filter((finding) => finding.severity === "P0");
  const p1 = active.filter((finding) => finding.severity === "P1");
  if (p0.length > 0) reasons.push(`${p0.length} P0 finding(s)`);
  if (p1.length > 0) reasons.push(`${p1.length} P1 finding(s)`);
  // Issue #48: fabrication is not only a release reason — it becomes a
  // tracked P1 business-truth blocker so the repair loop receives it and the
  // confirmation seam must explicitly re-judge it (ACTIVE/RESOLVED). A
  // fabricated customer/partner identity can therefore never silently pass
  // confirmation while every visual defect around it is marked resolved.
  const fabricationBlocker: EvaluableQaFinding = {
    severity: "P1",
    domain: "business-truth",
    description: "Fabricated Business Facts / unsupported trust or identity content detected — unsupported fabricated customer, partner, award or certification identities cannot pass release",
    evidenceRef: "qa-a:business-truth",
  };
  if (report.fabrication) {
    reasons.push("fabricated Business Facts detected");
    p1.push(fabricationBlocker);
  }
  const failedGates = report.hardGates.filter((gate) => !gate.passed);
  if (failedGates.length > 0) reasons.push(`hard composition gate(s) failed: ${failedGates.map((gate) => gate.id).join(", ")}`);
  return {
    releaseReady: reasons.length === 0,
    reasons,
    blockers: [...p0, ...p1],
    polish: active.filter((finding) => !isReleaseBlocker(finding)),
    resolved: findings.filter((finding) => finding.status === "RESOLVED"),
  };
}

export function evaluateQaBRelease(report: QaBReport | QaBConfirmationReport): ReleaseGateVerdict {
  const findings = report.findings as EvaluableQaFinding[];
  const reasons: string[] = [];
  if (report.technicalScore < 90) reasons.push(`technical ${report.technicalScore} < 90`);
  const active = findings.filter((finding) => finding.status !== "RESOLVED");
  const p0 = active.filter((finding) => finding.severity === "P0");
  const p1 = active.filter((finding) => finding.severity === "P1");
  if (p0.length > 0) reasons.push(`${p0.length} P0 finding(s)`);
  if (p1.length > 0) reasons.push(`${p1.length} P1 finding(s)`);
  const failedGates = report.gates.filter((gate) => !gate.passed);
  if (failedGates.length > 0) reasons.push(`mandatory gate(s) failed: ${failedGates.map((gate) => gate.id).join(", ")}`);
  return {
    releaseReady: reasons.length === 0,
    reasons,
    blockers: [...p0, ...p1],
    polish: active.filter((finding) => !isReleaseBlocker(finding)),
    resolved: findings.filter((finding) => finding.status === "RESOLVED"),
  };
}
