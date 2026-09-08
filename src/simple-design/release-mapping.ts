// SIMPLE → legacy release-gate mapping.
//
// The SIMPLE pipeline owns its OWN visual QA (one multimodal call) and its
// OWN deterministic truth/technical checks (spec sections 38-44). But the
// KEEP-list release machinery — assignReleaseReady, Approval, Publication,
// Rollback — consumes the legacy QaAReport/QaBReport shapes. This module
// translates the SIMPLE qa-package onto those shapes HONESTLY:
//
//   visualScore        ← the SIMPLE visual QA overall score
//   contentScore       ← 95 when zero truth blockers, else fail-closed
//   fabrication        ← zero tolerance: any truth blocker
//   QA-A hard gates    ← each backed by a SIMPLE visual category threshold
//   technicalScore     ← 95 when zero technical blockers, else fail-closed
//   QA-B mandatory gates ← each backed by a named deterministic check
//
// No gate is ever marked passed without the deterministic check that backs
// it. The threshold logic in evaluateQaARelease/evaluateQaBRelease then
// produces exactly the SIMPLE release rule (spec section 54).

import {
  QA_A_HARD_GATE_IDS,
  QA_B_MANDATORY_GATE_IDS,
  type QaAReportAugmented,
  type QaBReport,
  type QaFinding,
} from "../domain/qa-stages";
import {
  SIMPLE_VISUAL_CATEGORY_THRESHOLD,
  type QaPackage,
  type VisualQaScores,
} from "./contracts";

export type TechnicalGateResults = Record<(typeof QA_B_MANDATORY_GATE_IDS)[number], boolean>;

// Each canonical QA-A hard gate is backed by one SIMPLE visual category at
// the release threshold (85). overall >= 90 is enforced by evaluateQaARelease
// through visualScore itself.
function visualHardGates(scores: VisualQaScores): QaAReportAugmented["hardGates"] {
  const categoryPass = (value: number) => value >= SIMPLE_VISUAL_CATEGORY_THRESHOLD;
  return [
    { id: "FIRST_VIEWPORT_MATERIALLY_CORRECT", passed: categoryPass(scores.macroLayout) },
    { id: "PAGE_SILHOUETTE_REGION_ORDER", passed: categoryPass(scores.macroLayout) },
    { id: "DOMINANT_TEXT_IMAGE_MASS", passed: categoryPass(scores.imageTreatment) },
    { id: "CRITICAL_SIGNATURE_TRAITS_PRESERVED", passed: categoryPass(scores.signatureElements) },
    { id: "MOBILE_PRESERVES_VISUAL_IDENTITY", passed: categoryPass(scores.responsive) },
    { id: "CRITICAL_IMAGERY_SERVES_ROLE", passed: categoryPass(scores.imageTreatment) },
  ];
}

export function simplePackageToQaA(pkg: QaPackage): QaAReportAugmented {
  const truthBlocked = pkg.truth.blockerCount > 0;
  const findings: QaFinding[] = [];
  for (const finding of pkg.truth.findings) {
    findings.push({
      severity: "P1",
      domain: "business-truth",
      description: finding.detail.slice(0, 2000),
      evidenceRef: `simple-truth:${finding.id}`,
    });
  }
  if (pkg.visual) {
    if (pkg.visual.scores.overall < 90) {
      findings.push({
        severity: "P1",
        domain: "visual-fidelity",
        description: `Visual QA overall ${pkg.visual.scores.overall} < 90`,
        evidenceRef: "simple-visual-qa:scores.overall",
      });
    }
    for (const [category, value] of Object.entries(pkg.visual.scores)) {
      if (category !== "overall" && value < SIMPLE_VISUAL_CATEGORY_THRESHOLD) {
        findings.push({
          severity: "P1",
          domain: "visual-fidelity",
          description: `Visual category '${category}' ${value} < ${SIMPLE_VISUAL_CATEGORY_THRESHOLD}`,
          evidenceRef: `simple-visual-qa:scores.${category}`,
        });
      }
    }
  }
  return {
    version: "simple-blueprint-v1",
    visualScore: pkg.visual?.scores.overall ?? 0,
    // Content is truth-verified deterministically (zero-tolerance facts lint);
    // there is no separate content-quality model in the SIMPLE pipeline.
    contentScore: truthBlocked ? 0 : 95,
    fabrication: truthBlocked,
    hardGates: visualHardGates(
      pkg.visual?.scores ?? {
        macroLayout: 0, typography: 0, spacingRhythm: 0, surfaceColor: 0,
        imageTreatment: 0, components: 0, signatureElements: 0, responsive: 0,
        overall: 0,
      }
    ),
    findings,
  };
}

export function simplePackageToQaB(pkg: QaPackage, gates: TechnicalGateResults): QaBReport {
  const findings: QaFinding[] = [];
  for (const finding of pkg.technical.findings) {
    findings.push({
      severity: finding.severity === "blocker" ? "P1" : "P2",
      domain: "technical",
      description: finding.detail.slice(0, 2000),
      evidenceRef: `simple-technical:${finding.id}`,
    });
  }
  return {
    version: "simple-blueprint-v1",
    technicalScore: pkg.technical.blockerCount === 0 ? 95 : 0,
    gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: gates[id] ?? false })),
    findings,
  };
}
