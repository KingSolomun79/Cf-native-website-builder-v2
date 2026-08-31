import { Context } from "hono";
import type { Env } from "../env.d";
import { fetchJob } from "../lib/db";

export async function getJob(c: Context<{ Bindings: Env }>): Promise<Response> {
  const jobId = c.req.param("jobId") as string;
  const job = await fetchJob(c.env.DB, jobId);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json({
    id: job.id,
    siteId: job.site_id,
    clientId: job.client_id,
    jobType: job.job_type,
    status: job.status,
    currentStep: job.current_step,
    errorCode: job.error_code,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  });
}
