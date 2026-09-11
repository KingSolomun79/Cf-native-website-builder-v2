// ORIGINAL_DESIGN deferred-mode lock (operator decision, 2026-09-10):
// the mode is recognized domain semantics but explicitly NOT ENABLED.
// The legacy generator chain and the 3-of-5 legacy benchmark proof gate were
// removed; this deterministic lock is the whole runtime behavior until the
// future SIMPLE ORIGINAL_DESIGN implementation arrives.
import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { createRevisionBuild, RevisionError } from "../src/domain/revision";
import { OriginalDesignNotEnabledError } from "../src/domain/original-design-lock";
import { CreativeDirectionSchema, parseCreativeDirection } from "../src/domain/creative-direction";
import { Value } from "@sinclair/typebox/value";

function env(): Env {
  return providedEnv as unknown as Env;
}

const ONBOARDING = {
  buildMode: "ORIGINAL_DESIGN",
  facts: { businessName: "Original Mode Co", contactEmail: "hello@original.example" },
};

describe("ORIGINAL_DESIGN deferred-mode lock", () => {
  it("createInitialBuild refuses an ORIGINAL_DESIGN generation with the deterministic NOT-ENABLED error", async () => {
    const generation = await startSiteGeneration(env(), {
      payload: structuredClone(ONBOARDING),
    } as never);
    await expect(
      createInitialBuild(env(), { siteGenerationId: generation.siteGenerationId })
    ).rejects.toBeInstanceOf(OriginalDesignNotEnabledError);
  });

  it("the lock is NOT a silent fallback: the generation keeps its ORIGINAL_DESIGN mode", async () => {
    const generation = await startSiteGeneration(env(), {
      payload: structuredClone(ONBOARDING),
    } as never);
    const row = await env()
      .DB.prepare("SELECT build_mode FROM site_generations WHERE id = ?")
      .bind(generation.siteGenerationId)
      .first<{ build_mode: string }>();
    expect(row?.build_mode).toBe("ORIGINAL_DESIGN");
  });

  it("createRevisionBuild refuses an ORIGINAL_DESIGN lineage with ORIGINAL_DESIGN_NOT_ENABLED", async () => {
    // A lineage that predates the lock: seed the parent Build rows directly so
    // the revision path's own lock branch is exercised independently.
    const generation = await startSiteGeneration(env(), {
      payload: structuredClone(ONBOARDING),
    } as never);
    const buildId = "b-od-lock-probe";
    const buildVersionId = "bv-od-lock-probe";
    await env().DB.batch([
      env()
        .DB.prepare(
          `INSERT INTO builds (id, site_generation_id, kind, parent_build_id, state, workflow_instance_id, created_at, updated_at)
           VALUES (?1, ?2, 'initial', NULL, 'INTAKE_READY', NULL, datetime('now'), datetime('now'))`
        )
        .bind(buildId, generation.siteGenerationId),
      env()
        .DB.prepare(
          `INSERT INTO build_versions (id, build_id, version_number, created_at)
           VALUES (?1, ?2, 1, datetime('now'))`
        )
        .bind(buildVersionId, buildId),
    ]);
    const error = await createRevisionBuild(env(), {
      parentBuildId: buildId,
      payload: { changes: { facts: {} } },
    }).catch((e: unknown) => e as RevisionError);
    expect(error).toBeInstanceOf(RevisionError);
    expect((error as RevisionError).code).toBe("ORIGINAL_DESIGN_NOT_ENABLED");
  });

  it("the error names the deferred state without offering a mode fallback", async () => {
    const generation = await startSiteGeneration(env(), {
      payload: structuredClone(ONBOARDING),
    } as never);
    const error = await createInitialBuild(env(), { siteGenerationId: generation.siteGenerationId }).catch(
      (e: unknown) => e as OriginalDesignNotEnabledError
    );
    expect(error.message).toContain("NOT ENABLED");
    expect(error.message).toContain("REFERENCE_BOUND is the only enabled design path");
  });
});

describe("preserved ORIGINAL_DESIGN input contract (creative direction)", () => {
  it("parses the full product input shape", () => {
    const parsed = parseCreativeDirection({
      direction: "altitude-born clarity with route-line geometry",
      audience: "active travelers 30-55",
      conversionGoal: "tour bookings",
      serviceEnvironment: "highland outdoors",
      inspirationNotes: "non-binding inspiration only",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toContain("route-line");
  });

  it("rejects empty direction and unknown properties; returns null on invalid input", () => {
    expect(parseCreativeDirection({ direction: "" })).toBeNull();
    expect(parseCreativeDirection({ direction: "ok", archetype: "industry-preset-7" })).toBeNull();
    expect(parseCreativeDirection(null)).toBeNull();
    expect(Value.Check(CreativeDirectionSchema, { direction: "ok", inspirationNotes: "x" })).toBe(true);
  });
});
