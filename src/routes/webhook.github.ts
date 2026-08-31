import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyGithubWebhook, nowIso, generateId } from "../lib/crypto";

export async function handleGithubDeployCallback(c: Context<{ Bindings: Env }>): Promise<Response> {
  const signature = c.req.header("X-Hub-Signature-256");
  if (!signature) {
    return c.json({ error: "Missing signature" }, 401);
  }

  const body = await c.req.raw.text();
  const isValid = await verifyGithubWebhook(c.env, body, signature);
  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const action = payload.action as string | undefined;

  if (action === "completed") {
    const workflowRun = payload.workflow_run as Record<string, unknown> | undefined;
    if (!workflowRun) {
      return c.json({ error: "Missing workflow_run" }, 400);
    }

    const conclusion = workflowRun.conclusion as string | null;
    const headSha = workflowRun.head_sha as string | undefined;
    const runId = workflowRun.id as number;
    const runUrl = workflowRun.html_url as string | undefined;

    if (!headSha) {
      return c.json({ error: "Missing head_sha" }, 400);
    }

    const version = await c.env.DB.prepare(
      "SELECT id, site_id, production_status FROM site_versions WHERE github_commit_sha = ?"
    ).bind(headSha).first<{ id: string; site_id: string; production_status: string }>();

    if (!version) {
      return c.json({ error: "No version found for commit" }, 404);
    }

    const newStatus = conclusion === "success" ? "deployed" : "failed";

    await c.env.DB.prepare(
      "UPDATE site_versions SET production_status = ?, production_deployed_at = ? WHERE id = ?"
    ).bind(newStatus, nowIso(), version.id).run();

    const siteRow = await c.env.DB.prepare(
      "SELECT client_id FROM sites WHERE id = ?"
    ).bind(version.site_id).first<{ client_id: string }>();

    let workerName = "unknown";
    if (siteRow) {
      const clientRow = await c.env.DB.prepare(
        "SELECT slug FROM clients WHERE id = ?"
      ).bind(siteRow.client_id).first<{ slug: string }>();
      if (clientRow) {
        workerName = `site-${clientRow.slug}`;
      }
    }

    await c.env.DB.prepare(
      "UPDATE site_versions SET production_worker_name = ? WHERE id = ?"
    ).bind(workerName, version.id).run();

    if (conclusion === "success") {
      const productionUrl = await getProductionUrl(c.env, workerName);
      await c.env.DB.prepare(
        "UPDATE sites SET production_url = ? WHERE id = ?"
      ).bind(productionUrl, version.site_id).run();
      await c.env.DB.prepare(
        "UPDATE site_versions SET production_url = ? WHERE id = ?"
      ).bind(productionUrl, version.id).run();
    }

    await c.env.DB.prepare(
      `INSERT INTO deployments (id, site_id, site_version_id, environment, worker_name, trigger_source, status, github_run_id, github_run_url, started_at, completed_at)
       VALUES (?, ?, ?, 'production', ?, 'github_actions', ?, ?, ?, ?, ?)`
    ).bind(
      generateId(),
      version.site_id,
      version.id,
      workerName,
      conclusion === "success" ? "success" : "failed",
      String(runId),
      runUrl ?? null,
      nowIso(),
      nowIso()
    ).run();
  }

  return c.json({ ok: true });
}

async function getProductionUrl(env: Env, workerName: string): Promise<string> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${workerName}`,
    { headers: { Authorization: `Bearer ${env.CF_DEPLOY_API_TOKEN}` } }
  );

  if (!response.ok) {
    return `https://${workerName}.workers.dev`;
  }

  const data = (await response.json()) as {
    success: boolean;
    result?: { workers_dev?: { subdomain: string } };
  };

  if (!data.success || !data.result?.workers_dev?.subdomain) {
    return `https://${workerName}.workers.dev`;
  }

  return `https://${workerName}.${data.result.workers_dev.subdomain}.workers.dev`;
}
