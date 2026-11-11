// Exactly-once initial workflow start (incident remediation Step 5,
// operator-approved plan 2026-09-23). The intake conversion commits the
// draft's conversion markers BEFORE creating the workflow, so a workflow
// start failure can no longer duplicate the Site Generation on retry — but a
// retry must also converge instead of double-starting. A DETERMINISTIC
// instance id (`{siteGenerationId}-initial`) makes that convergence exact at
// the platform level: one generation maps to at most one initial workflow
// instance, whatever crashes or retries happen in between.

import type { Workflow } from "@cloudflare/workers-types";

export function initialWorkflowInstanceId(siteGenerationId: string): string {
  return `${siteGenerationId}-initial`;
}

/**
 * Starts (or returns the already-started handle of) the initial Build
 * workflow for one Site Generation. Safe to call any number of times: an
 * existing instance is returned untouched, a lost concurrent race converges
 * on the winner's handle. Throws when no instance exists AND creation fails.
 */
export async function startInitialBuildWorkflowIdempotent(
  binding: Workflow,
  siteGenerationId: string
): Promise<string> {
  const instanceId = initialWorkflowInstanceId(siteGenerationId);
  try {
    await binding.get(instanceId);
    return instanceId;
  } catch {
    // Not started yet (or the lookup itself failed — create surfaces that).
  }
  try {
    await binding.create({ id: instanceId, params: { siteGenerationId } });
  } catch (createError) {
    // Lost a concurrent start race: converge on the winner's instance.
    try {
      await binding.get(instanceId);
    } catch {
      throw createError;
    }
  }
  return instanceId;
}
