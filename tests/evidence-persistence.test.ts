import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  getCaptureEvidenceForAttempt,
  getCurrentEvidenceAttempt,
  getInteractionEvidenceForAttempt,
  promoteEvidenceAttempt,
  startEvidenceAttempt,
} from "../src/lib/db";
import { runEvidenceAttempt } from "../src/lib/evidence-attempt";
import { loadCurrentCaptureManifest } from "../src/lib/reference-capture-v2";
import { loadCurrentInteractionManifest } from "../src/lib/interaction-capture-v2";
import { createFixtureAdapter } from "./helpers/browser-fixtures";

function getEnv(): Env {
  return providedEnv as unknown as Env;
}

function identity(prefix: string): { jobId: string; clientSlug: string } {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  return { jobId: `${prefix}-${suffix}`, clientSlug: `${prefix}-${suffix}` };
}

describe("R3 evidence persistence with real D1 and R2", () => {
  it("promotes and reloads the exact persisted capture and interaction manifests", async () => {
    const env = getEnv();
    const id = identity("evidence");
    const result = await runEvidenceAttempt(env, {
      ...id,
      siteVersion: 1,
      referenceUrl: "https://fixture.test/home",
      adapter: createFixtureAdapter({
        name: "home",
        httpStatus: 200,
        duplicateButtons: 2,
        hoverChangesColor: true,
        hasAccordion: true,
      }),
      fallbackContext: {
        sectionOrder: ["hero", "services", "contact"],
        navigationStyle: "desktop links and collapsed mobile menu",
        buttonStyle: "filled call-to-action",
        cardStyle: "bordered cards",
        screenshotInteractions: [],
      },
    });

    expect(result.promoted).toBe(true);
    const current = await getCurrentEvidenceAttempt(env.DB, id.jobId, 1);
    expect(current).toMatchObject({
      attemptId: result.attemptId,
      jobId: id.jobId,
      clientSlug: id.clientSlug,
      siteVersion: 1,
      status: "complete",
    });

    expect(await env.SITE_BUCKET.head(result.captureManifestR2Key)).not.toBeNull();
    expect(await env.SITE_BUCKET.head(result.interactionManifestR2Key)).not.toBeNull();

    const capture = await loadCurrentCaptureManifest(env, id.jobId, 1);
    const interaction = await loadCurrentInteractionManifest(env, id.jobId, 1);
    expect(capture?.viewports).toHaveLength(3);
    expect(interaction?.viewports).toHaveLength(6);

    const captureRows = await getCaptureEvidenceForAttempt(env.DB, result.attemptId);
    const interactionRows = await getInteractionEvidenceForAttempt(env.DB, result.attemptId);
    expect(captureRows).toHaveLength(3);
    expect(interactionRows).toHaveLength(6);
  });

  it("keeps per-observation traces immutable and independently readable", async () => {
    const env = getEnv();
    const id = identity("traces");
    const result = await runEvidenceAttempt(env, {
      ...id,
      siteVersion: 1,
      referenceUrl: "https://fixture.test/interactions",
      adapter: createFixtureAdapter({
        name: "interactions",
        httpStatus: 200,
        duplicateButtons: 3,
        hoverChangesColor: true,
      }),
    });
    const manifest = await loadCurrentInteractionManifest(env, id.jobId, 1);
    const observed = manifest?.viewports
      .flatMap((capture) => capture.observations)
      .filter((observation) => observation.classification === "observed") ?? [];
    const traceKeys = observed.map((observation) => observation.traceR2Key).filter((key): key is string => key !== null);
    expect(traceKeys.length).toBeGreaterThan(1);
    expect(new Set(traceKeys).size).toBe(traceKeys.length);
    for (const observation of observed) {
      expect(observation.traceR2Key).not.toBeNull();
      const object = await env.SITE_BUCKET.get(observation.traceR2Key!);
      expect(object).not.toBeNull();
      const trace = await object!.json<{ trigger: string; selector: string; resetVerified: boolean }>();
      expect(trace).toMatchObject({
        trigger: observation.trigger,
        selector: observation.selector,
        resetVerified: true,
      });
    }
    expect(result.promoted).toBe(true);
  });

  it("does not let an older attempt replace a newer current pointer", async () => {
    const env = getEnv();
    const id = identity("ordering");
    const older = crypto.randomUUID();
    const newer = crypto.randomUUID();
    await startEvidenceAttempt(env.DB, {
      id: older,
      job_id: id.jobId,
      client_slug: id.clientSlug,
      site_version: 1,
      started_at: new Date(Date.now() - 1000).toISOString(),
    });
    await startEvidenceAttempt(env.DB, {
      id: newer,
      job_id: id.jobId,
      client_slug: id.clientSlug,
      site_version: 1,
      started_at: new Date().toISOString(),
    });
    await promoteEvidenceAttempt(env.DB, newer, new Date().toISOString());
    await promoteEvidenceAttempt(env.DB, older, new Date(Date.now() + 1000).toISOString());
    expect((await getCurrentEvidenceAttempt(env.DB, id.jobId, 1))?.attemptId).toBe(newer);
  });
});
