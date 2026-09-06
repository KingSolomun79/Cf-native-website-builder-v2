// V2 measured repair directives + preservation/regression guard (issue #50).
//
// The production RankForge sequence (74 -> 71 -> 62) showed repair was not
// monotonic in hard-constraint quality: repairs were planned from prose,
// without knowing what already worked, and nothing compared candidate N+1
// against candidate N. This module closes that seam deterministically:
//
//   1. Every Fix Coordinator / Release Blocker Fix prompt carries a MEASURED
//      context (current vs target values per failed constraint), an explicit
//      PRESERVATION SET (currently passing hard constraints) and the allowed
//      mutation scope.
//   2. After repair, the confirmation is compared against the previous
//      version's frozen evaluation: a previously passing hard gate that now
//      fails, or a brand-new ACTIVE P0/P1 domain, is a REPAIR_REGRESSION —
//      the candidate is not promoted, automation escalates.
//   3. Composite scores are deliberately NEVER compared: a score drop with
//      all hard constraints intact is a valid repair (issue #50 section E).
//   4. Old blockers remaining AND new regressions appearing together is a
//      genuine constraint conflict — escalate, never whack-a-mole (section F).

import type { GeometryComparison } from "./qa-evidence";
import type { QaGate, QaFinding, EvaluableQaFinding } from "./qa-stages";
import type { VisualBlueprint } from "./visual-blueprint";
import type { ImplementationContract } from "./implementation-planner";
import type { StoredCraftPreflight } from "./craft-preflight";

// ── Preservation set (issue #50 B) ──────────────────────────────────────────

export interface PreservationConstraint {
  id: string;
  detail: string;
}

/**
 * Deterministic list of hard constraints that currently PASS and must remain
 * intact through the repair. Built from the current version's frozen
 * evaluation — never invented, never guessed.
 */
export function buildPreservationSet(input: {
  qaAHardGates: QaGate[];
  qaBMandatoryGates: QaGate[];
  macroFidelityPassed: boolean | null;
  blueprint: VisualBlueprint;
  contract: ImplementationContract;
}): PreservationConstraint[] {
  const constraints: PreservationConstraint[] = [];
  for (const gate of input.qaAHardGates) {
    if (gate.passed) constraints.push({ id: `HARD_GATE:${gate.id}`, detail: `QA-A hard gate '${gate.id}' currently passes` });
  }
  for (const gate of input.qaBMandatoryGates) {
    if (gate.passed) constraints.push({ id: `MANDATORY_GATE:${gate.id}`, detail: `QA-B mandatory gate '${gate.id}' currently passes` });
  }
  if (input.macroFidelityPassed === true) {
    constraints.push({ id: "REFERENCE_MACRO_FIDELITY", detail: "direct reference fidelity (measured geometry) currently passes" });
  }
  constraints.push({
    id: "REGION_ORDER",
    detail: `canonical homepage topology: ${input.blueprint.homepageRegions.map((region) => region.id).join(" > ")}`,
  });
  for (const binding of input.contract.realization?.regionStyleBinding ?? []) {
    constraints.push({ id: `REALIZATION:${binding.regionId}`, detail: `region '${binding.regionId}' styled through ${binding.cssSelector}` });
  }
  return constraints;
}

// ── Measured directives (issue #50 A) ───────────────────────────────────────

/**
 * Deterministic measured context for repair prompts: per-metric current vs
 * target values with tolerances, the direct-fidelity verdict, and any frozen
 * craft-preflight deltas. Only real measurements appear — absent evidence is
 * omitted, never defaulted.
 */
export function buildMeasuredDirectives(input: {
  geometryComparison: GeometryComparison | null;
  macroFidelityReason: string | null;
  craftPreflight: StoredCraftPreflight | null;
}): string {
  const lines: string[] = [];
  const comparison = input.geometryComparison;
  if (comparison && comparison.status === "MEASURED") {
    lines.push("GEOMETRY (measured reference vs this candidate):");
    for (const metric of comparison.metrics) {
      lines.push(
        `- ${metric.id}: reference ${metric.referenceValue} vs candidate ${metric.candidateValue} (tolerance ${metric.tolerance}, ${metric.withinTolerance ? "within" : "MATERIALLY OFF"})`
      );
    }
  }
  if (input.macroFidelityReason) {
    lines.push(`DIRECT REFERENCE FIDELITY: ${input.macroFidelityReason}`);
  }
  const craft = input.craftPreflight;
  if (craft && craft.findings.length > 0) {
    lines.push("CRAFT PREFLIGHT (frozen measured deltas):");
    for (const finding of craft.findings) {
      lines.push(`- [${finding.checkId}]${finding.regionId ? ` region '${finding.regionId}':` : ""} measured ${finding.measured}; target ${finding.target}`);
    }
  }
  return lines.join("\n");
}

/**
 * The complete repair-context block appended to Fix Coordinator / Release
 * Blocker Fix prompts (issue #50 A/B/C/G).
 */
export function buildRepairContext(input: {
  blueprint: VisualBlueprint;
  contract: ImplementationContract;
  qaAHardGates: QaGate[];
  qaBMandatoryGates: QaGate[];
  macroFidelityPassed: boolean | null;
  macroFidelityReason: string | null;
  geometryComparison: GeometryComparison | null;
  craftPreflight: StoredCraftPreflight | null;
  regionCropKeys: string[];
  narrowestScopeOnly?: boolean;
}): string {
  const preservation = buildPreservationSet({
    qaAHardGates: input.qaAHardGates,
    qaBMandatoryGates: input.qaBMandatoryGates,
    macroFidelityPassed: input.macroFidelityPassed,
    blueprint: input.blueprint,
    contract: input.contract,
  });
  const measured = buildMeasuredDirectives({
    geometryComparison: input.geometryComparison,
    macroFidelityReason: input.macroFidelityReason,
    craftPreflight: input.craftPreflight,
  });
  const sections: string[] = [];
  if (measured) {
    sections.push(`MEASURED CONTEXT (frozen, binding — plan against these numbers, not adjectives):\n${measured}`);
  }
  sections.push(
    `PRESERVATION SET (deterministic; these currently-passing hard constraints MUST remain intact):\n${preservation.map((constraint) => `- ${constraint.id}: ${constraint.detail}`).join("\n")}`
  );
  sections.push(
    `MUTATION SCOPE: prefer the narrowest scope that fixes the failed constraint (region -> component -> CSS selectors -> single page). Whole-site regeneration requires a genuinely global defect. Composite scores are NOT a target — protect the hard constraints and the preservation set.${
      input.narrowestScopeOnly ? " This is the final narrow batch: repair ONLY the remaining blockers' realization details." : ""
    }`
  );
  if (input.regionCropKeys.length > 0) {
    sections.push(`REGION CROPS (provenance-bound evidence artifacts):\n${input.regionCropKeys.map((key) => `- ${key}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

// ── Regression guard (issue #50 D/E/F) ──────────────────────────────────────

export interface RepairEvaluationSnapshot {
  /** QA-A hard gates of the version's evaluation (ids + passed). */
  qaAHardGates: QaGate[];
  /** QA-B mandatory gates of the version's evaluation (ids + passed). */
  qaBMandatoryGates: QaGate[];
  /** Active P0/P1 blockers of the version's evaluation. */
  blockers: QaFinding[];
}

export interface RepairRegressionVerdict {
  regression: boolean;
  /** Human-readable regression findings with the exact gate/domain involved. */
  regressions: string[];
  /** True when old blockers remain AND new regressions appeared — a genuine
   *  constraint conflict; escalation, not another repair round (issue #50 F). */
  conflict: boolean;
}

function gateMap(gates: QaGate[]): Map<string, boolean> {
  return new Map(gates.map((gate) => [gate.id, gate.passed]));
}

/**
 * Compares the repaired version's confirmation against the source version's
 * frozen evaluation. Composite scores are deliberately absent from the
 * comparison (issue #50 E): only hard gates and blocker domains count.
 */
export function evaluateRepairRegression(input: {
  previous: RepairEvaluationSnapshot;
  confirmationAHardGates: QaGate[];
  confirmationBMandatoryGates: QaGate[];
  confirmationBlockers: EvaluableQaFinding[];
}): RepairRegressionVerdict {
  const regressions: string[] = [];

  const previousA = gateMap(input.previous.qaAHardGates);
  const confirmationA = gateMap(input.confirmationAHardGates);
  for (const [gateId, previouslyPassed] of previousA) {
    if (previouslyPassed && confirmationA.get(gateId) === false) {
      regressions.push(`previously passing QA-A hard gate '${gateId}' fails on the repaired version`);
    }
  }

  const previousB = gateMap(input.previous.qaBMandatoryGates);
  const confirmationB = gateMap(input.confirmationBMandatoryGates);
  for (const [gateId, previouslyPassed] of previousB) {
    if (previouslyPassed && confirmationB.get(gateId) === false) {
      regressions.push(`previously passing QA-B mandatory gate '${gateId}' fails on the repaired version`);
    }
  }

  // New ACTIVE P0/P1 in a domain the previous version's blockers never
  // touched — the repair introduced a defect elsewhere.
  const previousDomains = new Set(input.previous.blockers.map((blocker) => blocker.domain));
  const newDomainBlockers = input.confirmationBlockers.filter(
    (blocker) => (blocker.severity === "P0" || blocker.severity === "P1") && blocker.status !== "RESOLVED" && !previousDomains.has(blocker.domain)
  );
  for (const blocker of newDomainBlockers) {
    regressions.push(`new ACTIVE ${blocker.severity} in domain '${blocker.domain}' that the previous version's blockers did not cover`);
  }

  const oldBlockersRemain = input.confirmationBlockers.some(
    (blocker) => (blocker.severity === "P0" || blocker.severity === "P1") && blocker.status !== "RESOLVED" && previousDomains.has(blocker.domain)
  );
  const conflict = regressions.length > 0 && oldBlockersRemain;

  return { regression: regressions.length > 0, regressions, conflict };
}
