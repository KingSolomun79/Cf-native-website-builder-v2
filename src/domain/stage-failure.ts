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

import { NonRetryableError } from "cloudflare:workflows";
import { StageExecutionCollisionError } from "./stage-execution";
import { StageArtifactError } from "./stage-artifacts";
import { ImageBudgetExceededError } from "./image-pipeline";
import { AiStageSchemaInvalidError } from "./ai-boundary";
import { SimpleWebsiteBuilderError } from "../simple-design/website-builder";

export type StageFailureClass =
  | "TRANSIENT_RETRYABLE"
  | "DETERMINISTIC_REVIEW_REQUIRED"
  | "TERMINAL_INVARIANT";

// Issue #70 §23: transient platform reset recognition. Cloudflare documents
// that Durable Objects may be reset/shut down by code deployments and runtime
// updates; an in-flight invocation observing such an abort can change its
// verdict on re-execution because everything that matters survived — D1 rows,
// R2 immutable artifacts, the engine's step cache, single-flight claims.
// Structured signal first (a platform `retryable` property when present);
// the exact documented reset message is the isolated compatibility fallback,
// deliberately narrow — never a broad keyword matcher.
export function isTransientPlatformResetError(error: unknown): boolean {
  if (error && typeof error === "object" && (error as { retryable?: unknown }).retryable === true) {
    return true;
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes("Durable Object reset because its code was updated");
}

export function classifyStageFailure(error: unknown): StageFailureClass {
  // Issue #70 §23: platform resets are EXPLICITLY transient — pinned here so
  // the default fall-through below can never be narrowed by a future broad
  // matcher without this contract failing first.
  if (isTransientPlatformResetError(error)) {
    return "TRANSIENT_RETRYABLE";
  }
  // The engine boundary's own wrapper (toWorkflowStepError) marks a failure
  // non-retryable only after this classifier called it deterministic or
  // terminal. When the WRAPPED class survives to another boundary (the
  // pipeline's #70 catch), the wrapper's decision is authoritative: never
  // re-classified as transient.
  if (error instanceof NonRetryableError) {
    return "TERMINAL_INVARIANT";
  }
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
  // (The legacy VisualBlueprintError / SiteGenerationValidationError classes
  // were removed with the legacy design chain; the SIMPLE pipeline's
  // schema-invalid class carries the semantics.) The Website Builder's
  // CRITICAL image coverage and SOURCE_INCOMPLETE / OUTPUT_EXHAUSTED
  // failures belong here too: the six file-sized realization calls ARE the
  // Builder's whole budget — the pipeline handles them in-step; this backstop
  // guarantees no engine retry can ever become a second Builder attempt.
  if (error instanceof AiStageSchemaInvalidError || error instanceof SimpleWebsiteBuilderError) {
    return "DETERMINISTIC_REVIEW_REQUIRED";
  }
  // Everything else — including StageExecutionInProgressError (single-flight
  // yield), ZaiCodingPlanTransportError (the transport already bounded its
  // own attempts; the engine retry is the bounded outer wait),
  // non-terminal ReferenceAnalysisError codes, provider/network/D1 faults,
  // and any unknown error — stays retryable under the repo-owned schedule
  // (#62 §17: never route operational transients to human review).
  return "TRANSIENT_RETRYABLE";
}
