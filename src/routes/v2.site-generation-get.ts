import { Context } from "hono";
import type { Env } from "../env.d";
import { getSiteGenerationView } from "../domain/lifecycle";

// Observable V2 lifecycle state for one Site Generation (issue #4). Exposes the
// canonical domain chain only — Site Generation, its immutable Onboarding
// Submission, and its Builds/Build Versions with canonical workflow states.

export async function getSiteGeneration(c: Context<{ Bindings: Env }>): Promise<Response> {
  const siteGenerationId = c.req.param("siteGenerationId") as string;
  const view = await getSiteGenerationView(c.env, siteGenerationId);
  if (!view) {
    return c.json({ error: "Site Generation not found" }, 404);
  }
  return c.json(view);
}
