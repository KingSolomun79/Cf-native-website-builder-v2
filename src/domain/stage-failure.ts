// Explicit stage-failure classification (issue #62 §5).
//
// The controlling question is: CAN REPEATING THE SAME EXECUTION CHANGE THE
// OUTCOME? A Workflow step re-runs against the same immutable Build Version
// inputs, so failures whose verdict is already determined must not consume
// the engine retry budget — the 2026-09-06/07 forensic incidents (raw REST
// evidence) burned 8 engine attempts × compounding delays re-loading the
// same stored repair artifact and re-deriving the same finding.
//
//   TRANSIENT_RETRYABLE          — repeating may genuinely recover (provider
//                                  outage, rate limit, 5xx, platform fault,
//                                  single-flight yield). Uses the Workflow
//                                  retry schedule (issue #61: single-owned).
//   DETERMINISTIC_REVIEW_REQUIRED — the stage's own authorized bounded repair
//                                  is exhausted and the blocker persists; the
//                                  outcome cannot change on re-execution.
//                                  Automation must stop. The DOMAIN outcome is
//                                  decided at the stage by candidate existence
//                                  (#62 §8): a useful inspectable candidate
//                                  escalates to HUMAN_REVIEW_REQUIRED with the
//                                  precise findings; no candidate means Build
//                                  FAILED (#62 §9). These classes are handled
//                                  IN-STEP (terminal result markers, the #60
//                                  blueprint-escalation pattern) wherever a
//                                  stage boundary exists; the engine boundary
//                                  additionally maps them to NonRetryableError
//                                  as a backstop so a stray one can never burn
//                                  the retry budget.
//   TERMINAL_INVARIANT           — platform/domain integrity violated:
//                                  repeating is unsafe or meaningless
//                                  (provenance mismatch, immutable-slot
//                                  collision, hard spend gate). Mapped to
//                                  NonRetryableError at the engine boundary
//                                  (#62 §10 / issue #54 §11).
//
// This module is deliberately a CLASSIFIER, not an error-system rewrite
// (#62 §11): it routes existing domain classes; it does not merge them.

import { StageExecutionCollisionError } from "./stage-execution";
import { StageArtifactError } from "./stage-artifacts";
import { ImageBudgetExceededError } from "./image-pipeline";
import { SiteGenerationValidationError } from "./site-generator";
import { VisualBlueprintError } from "./visual-blueprint";
import { AiStageSchemaInvalidError } from "./ai-boundary";

export type StageFailureClass =
  | "TRANSIENT_RETRYABLE"
  | "DETERMINISTIC_REVIEW_REQUIRED"
  | "TERMINAL_INVARIANT";

export function classifyStageFailure(error: unknown): StageFailureClass {
  // TERMINAL_INVARIANT: integrity/spend violations (#54 §11, #58 gate).
  if (
    error instanceof StageExecutionCollisionError ||
    error instanceof ImageBudgetExceededError ||
    (error instanceof StageArtifactError && error.code === "REPAIR_ARTIFACT_MISMATCH")
  ) {
    return "TERMINAL_INVARIANT";
  }
  // DETERMINISTIC_REVIEW_REQUIRED: the stage's bounded repair is spent and
  // the same immutable inputs deterministically re-produce the blocker.
  // VisualBlueprintError is escalated IN-STEP by issue #60 before the
  // boundary; SiteGenerationValidationError by the #62 pipeline markers.
  if (
    error instanceof SiteGenerationValidationError ||
    error instanceof VisualBlueprintError ||
    error instanceof AiStageSchemaInvalidError
  ) {
    return "DETERMINISTIC_REVIEW_REQUIRED";
  }
  // Everything else — including StageExecutionInProgressError (single-flight
  // yield), VisionGatewayError (the gateway already bounded its own
  // per-provider attempts; the engine retry is the bounded outer wait),
  // non-terminal ReferenceAnalysisError codes, provider/network/D1 faults,
  // and any unknown error — stays retryable under the repo-owned schedule
  // (#62 §17: never route operational transients to human review).
  return "TRANSIENT_RETRYABLE";
}
