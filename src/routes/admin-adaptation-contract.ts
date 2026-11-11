// One-click default Adaptation Contract (operator GO 2026-11-11).
//
// When a REFERENCE_BOUND generation's Build failed because the inspiration
// site was classified SUPPORTED_WITH_LIMITATIONS and no Adaptation Contract
// was supplied, the pipeline persists a structured marker event
// ([adaptation-features: ...]). This operator route reads that marker,
// constructs the deterministic default contract, and starts a FRESH
// generation on the same Site with the contract injected — the operator
// never hand-writes JSON.

import { Context } from "hono";
import type { Env } from "../env.d";
import { requireCloudflareAccess } from "../domain/admin-access";
import { defaultAdaptationContract } from "../domain/reference-evidence-schema";
import { startSiteGeneration } from "../domain/lifecycle";
import { startInitialBuildWorkflowIdempotent } from "../domain/workflow-start";

interface GenerationRow {
  id: string;
  site_id: string;
  onboarding_submission_id: string;
  build_mode: string;
  sequence_number: number;
}

export class AdaptationAcceptError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AdaptationAcceptError";
  }
}

const FEATURES_MARKER = /\[adaptation-features:\s*([^\]]+)\]/;

export async function acceptDefaultAdaptations(c: Context<{ Bindings: Env }>): Promise<Response> {
  const denied = await requireCloudflareAccess(c.env, c.req.raw);
  if (denied) return denied;

  const siteId = c.req.param("siteId") as string;
  const siteGenerationId = c.req.param("siteGenerationId") as string;

  try {
    const result = await accept(c.env, { siteId, siteGenerationId });
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof AdaptationAcceptError) {
      const status = error.code === "GENERATION_NOT_FOUND" || error.code === "SITE_MISMATCH" ? 404
        : error.code === "ALREADY_ACCEPTED" ? 409
        : 400;
      return c.json({ error: { code: error.code, message: error.message } }, { status });
    }
    throw error;
  }
}

async function accept(env: Env, input: { siteId: string; siteGenerationId: string }) {
  const generation = await env.DB.prepare(
    "SELECT id, site_id, onboarding_submission_id, build_mode FROM site_generations WHERE id = ?"
  )
    .bind(input.siteGenerationId)
    .first<GenerationRow>();
  if (!generation) {
    throw new AdaptationAcceptError("GENERATION_NOT_FOUND", `Site Generation ${input.siteGenerationId} not found`);
  }
  if (generation.site_id !== input.siteId) {
    throw new AdaptationAcceptError("SITE_MISMATCH", `Site Generation ${input.siteGenerationId} does not belong to Site ${input.siteId}`);
  }
  if (generation.build_mode !== "REFERENCE_BOUND") {
    throw new AdaptationAcceptError("NOT_REFERENCE_BOUND", "Default adaptation contracts apply only to REFERENCE_BOUND generations");
  }

  // The marker event carries the detected limitation features.
  const markerEvent = await env.DB.prepare(
    `SELECT e.detail FROM build_workflow_events e
     JOIN builds b ON b.id = e.build_id
     WHERE b.site_generation_id = ? AND e.detail LIKE '%[adaptation-features:%'
     ORDER BY e.created_at DESC, e.id DESC LIMIT 1`
  )
    .bind(input.siteGenerationId)
    .first<{ detail: string }>();
  if (!markerEvent) {
    throw new AdaptationAcceptError(
      "MARKER_NOT_FOUND",
      `No adaptation-required marker found for generation ${input.siteGenerationId} — this route applies only to builds that failed awaiting an Adaptation Contract`
    );
  }
  const features = FEATURES_MARKER.exec(markerEvent.detail)?.[1]?.split(",").map((f) => f.trim()).filter(Boolean) ?? [];
  if (features.length === 0) {
    throw new AdaptationAcceptError("MARKER_INVALID", "The adaptation marker event carried no features");
  }

  // Idempotency guard: one acceptance per failed generation. The marker row's
  // owning build gets a single acceptance note; a second click loses cleanly.
  const acceptance = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM build_workflow_events e
     JOIN builds b ON b.id = e.build_id
     WHERE b.site_generation_id = ? AND e.stage = 'adaptation_contract_accepted'`
  )
    .bind(input.siteGenerationId)
    .first<{ n: number }>();
  if ((acceptance?.n ?? 0) > 0) {
    throw new AdaptationAcceptError("ALREADY_ACCEPTED", "The default adaptation contract was already accepted for this generation — reload the site review");
  }

  const contract = defaultAdaptationContract(features);
  const submission = await env.DB.prepare(
    "SELECT payload_json FROM onboarding_submissions WHERE id = ?"
  )
    .bind(generation.onboarding_submission_id)
    .first<{ payload_json: string }>();
  if (!submission) {
    throw new AdaptationAcceptError("SUBMISSION_NOT_FOUND", "The generation's Onboarding Submission could not be loaded");
  }
  const payload = JSON.parse(submission.payload_json) as { reference?: Record<string, unknown> };
  payload.reference = { ...(payload.reference ?? {}), adaptationContract: contract };

  const started = await startSiteGeneration(env, { siteId: input.siteId, payload });

  await env.DB.prepare(
    `INSERT INTO build_workflow_events (id, build_id, build_version_id, from_state, to_state, stage, detail, created_at)
     SELECT ?, b.id, NULL, 'FAILED', 'FAILED', 'adaptation_contract_accepted', ?, ?
     FROM builds b WHERE b.site_generation_id = ? ORDER BY b.created_at DESC LIMIT 1`
  )
    .bind(
      crypto.randomUUID(),
      `Default Adaptation Contract accepted (${contract.version}; features: ${features.join(", ")}) -> new generation ${started.siteGenerationId}`,
      new Date().toISOString(),
      input.siteGenerationId
    )
    .run();

  const workflowInstanceId = await startInitialBuildWorkflowIdempotent(env.WEBSITE_BUILD_WORKFLOW, started.siteGenerationId);

  return {
    accepted: {
      features,
      contractVersion: contract.version,
    },
    siteGenerationId: started.siteGenerationId,
    sequenceNumber: started.sequenceNumber,
    workflowInstanceId,
  };
}
