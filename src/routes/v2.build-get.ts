import { Context } from "hono";
import type { Env } from "../env.d";
import { getBuildView } from "../domain/lifecycle";

// Observable V2 lifecycle state for one Build (issue #4): canonical state,
// immutable Build Versions and the append-only workflow event history.

export async function getBuild(c: Context<{ Bindings: Env }>): Promise<Response> {
  const buildId = c.req.param("buildId") as string;
  const view = await getBuildView(c.env, buildId);
  if (!view) {
    return c.json({ error: "Build not found" }, 404);
  }
  return c.json(view);
}
