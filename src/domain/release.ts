// V2 Release Ready assignment (issue #13, PRD sections 28-32.1).
//
// Release Ready is assigned ONLY to the exact Build Version whose QA-A and
// QA-B both passed every mandatory gate with zero P0/P1 Release Blockers.
// Exact findings are stored with evidence and categorized as Release Blockers
// or non-blocking polish. A hard composition-gate failure can never be
// averaged away by a high aggregate score.

import type { Env } from "../env.d";
import { nowIso } from "../lib/crypto";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { storeBuildStageArtifact, storeBuildStageArtifactIdempotent } from "./stage-artifacts";
import {
  evaluateQaARelease,
  evaluateQaBRelease,
  type QaAReport,
  type QaBReport,
  type QaFinding,
} from "./qa-stages";
import type { GeometryComparison } from "./qa-evidence";

export class ReleaseGateError extends Error {
  readonly code: "RELEASE_ALREADY_ASSIGNED" | "QA_NOT_FOR_THIS_VERSION" | "GATES_NOT_PASSED";

  constructor(code: ReleaseGateError["code"], message: string) {
    super(message);
    this.name = "ReleaseGateError";
    this.code = code;
  }
}

export interface AssignReleaseReadyInput {
  buildId: string;
  buildVersionId: string;
  siteGenerationId: string;
  qaA: QaAReport;
  qaB: QaBReport;
  /** Build Version the QA reports were produced for (must match exactly). */
  qaBuildVersionId: string;
  geometryComparison?: GeometryComparison;
  evidenceR2Keys?: string[];
}

export interface ReleaseReadyResult {
  releaseReady: boolean;
  reasons: string[];
  blockers: QaFinding[];
  polish: QaFinding[];
  recordId?: string;
}

export async function assignReleaseReady(
  env: Env,
  input: AssignReleaseReadyInput
): Promise<ReleaseReadyResult> {
  // A retried evaluation after the record was pinned short-circuits
  // immediately: the frozen qa_report artifact cannot be re-stored (fresh LLM
  // verdicts never reproduce its checksum), so check the record first.
  const pinned = await env.DB.prepare(
    "SELECT build_version_id FROM build_release_records WHERE build_version_id = ?"
  )
    .bind(input.buildVersionId)
    .first<{ build_version_id: string }>();
  if (pinned) {
    throw new ReleaseGateError(
      "RELEASE_ALREADY_ASSIGNED",
      `Build Version ${input.buildVersionId} already has a Release Ready record`
    );
  }

  // QA reports must belong to the exact Build Version being evaluated.
  if (input.qaBuildVersionId !== input.buildVersionId) {
    throw new ReleaseGateError(
      "QA_NOT_FOR_THIS_VERSION",
      `QA reports were produced for Build Version ${input.qaBuildVersionId}, not for ${input.buildVersionId}; Release Ready cannot be assigned across versions`
    );
  }

  const existing = await env.DB.prepare(
    "SELECT build_version_id FROM build_release_records WHERE build_version_id = ?"
  )
    .bind(input.buildVersionId)
    .first<{ build_version_id: string }>();
  if (existing) {
    throw new ReleaseGateError(
      "RELEASE_ALREADY_ASSIGNED",
      `Build Version ${input.buildVersionId} already has a Release Ready record`
    );
  }

  const verdictA = evaluateQaARelease(input.qaA);
  const verdictB = evaluateQaBRelease(input.qaB);
  const reasons = [...verdictA.reasons, ...verdictB.reasons];
  const blockers = [...verdictA.blockers, ...verdictB.blockers];
  const polish = [...verdictA.polish, ...verdictB.polish];

  // Persist the combined QA report with exact findings and categorization —
  // pass or fail, the evidence is retained.
  await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "qa_report",
    schemaVersion: "qa-report/1",
    value: {
      schemaVersion: "qa-report/1",
      qaA: input.qaA,
      qaB: input.qaB,
      geometryComparison: input.geometryComparison ?? null,
      releaseBlockers: blockers,
      nonBlockingPolish: polish,
      evidenceR2Keys: input.evidenceR2Keys ?? [],
      verdict: reasons.length === 0 ? "RELEASE_READY" : "NOT_RELEASE_READY",
      reasons,
    },
  });

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "QA",
    toState: "QA",
    stage: "qa",
    detail:
      reasons.length === 0
        ? "QA-A and QA-B passed every mandatory gate with zero P0/P1 Release Blockers"
        : `QA gates not passed: ${reasons.slice(0, 5).join("; ")}`,
  });

  if (reasons.length > 0) {
    // Findings remain actionable for the Fix Coordinator path (issue #14);
    // nothing here is silently degraded to a pass.
    return { releaseReady: false, reasons, blockers, polish };
  }

  const recordId = `release:${input.buildVersionId}`;
  await env.DB.prepare(
    `INSERT INTO build_release_records (
       build_version_id, build_id, qa_a_visual_score, qa_a_content_score, qa_b_technical_score,
       fabrication, hard_gates_json, blockers_json, polish_json, assigned_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      input.buildVersionId,
      input.buildId,
      input.qaA.visualScore,
      input.qaA.contentScore,
      input.qaB.technicalScore,
      input.qaA.fabrication ? 1 : 0,
      JSON.stringify({ qaA: input.qaA.hardGates, qaB: input.qaB.gates }),
      JSON.stringify(blockers),
      JSON.stringify(polish),
      nowIso()
    )
    .run();

  await storeBuildStageArtifact(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "release_record",
    schemaVersion: "release-record/1",
    value: { buildVersionId: input.buildVersionId, buildId: input.buildId, assignedAt: nowIso() },
  });

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "QA",
    toState: "RELEASE_READY",
    stage: "release_ready",
    detail: `Release Ready assigned to exact Build Version (visual ${input.qaA.visualScore}, content ${input.qaA.contentScore}, technical ${input.qaB.technicalScore})`,
  });

  return { releaseReady: true, reasons: [], blockers, polish, recordId };
}

export async function getReleaseRecord(
  env: Env,
  buildVersionId: string
): Promise<{
  buildVersionId: string;
  buildId: string;
  qaAVisualScore: number;
  qaAContentScore: number;
  qaBTechnicalScore: number;
  assignedAt: string;
} | null> {
  const row = await env.DB.prepare("SELECT * FROM build_release_records WHERE build_version_id = ?")
    .bind(buildVersionId)
    .first<{
      build_version_id: string;
      build_id: string;
      qa_a_visual_score: number;
      qa_a_content_score: number;
      qa_b_technical_score: number;
      assigned_at: string;
    }>();
  if (!row) return null;
  return {
    buildVersionId: row.build_version_id,
    buildId: row.build_id,
    qaAVisualScore: row.qa_a_visual_score,
    qaAContentScore: row.qa_a_content_score,
    qaBTechnicalScore: row.qa_b_technical_score,
    assignedAt: row.assigned_at,
  };
}
