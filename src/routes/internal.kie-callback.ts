import { Context } from "hono";
import type { Env } from "../env.d";

// KIE provider callback endpoint (infrastructure contract: KIE is told this
// URL when tasks are created). The V2 image pipeline resolves results by
// polling through its provider seam, so this endpoint durably acknowledges
// receipt for observability only — no V1 image_assets bookkeeping remains.

export async function handleKieCallback(c: Context<{ Bindings: Env }>): Promise<Response> {
  let body: { data?: { taskId?: string; state?: string } };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const taskId = body.data?.taskId;
  const state = body.data?.state;
  if (!taskId || !state) {
    return c.json({ error: "Missing taskId or state" }, 400);
  }
  console.info("kie_callback_ack", { taskId, state });
  return c.json({ acknowledged: true, taskId });
}
