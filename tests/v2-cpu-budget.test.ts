// Issue #55: explicit workflow CPU budget.
//
// The production experiment on build 91764d47 (2026-09-06) died repeatedly on
// the 30s default CPU limit ("Worker exceeded CPU time limit") inside the
// generation step. Local profiling against that build's real artifacts showed
// the deterministic floor is the vision-input preparation (~0.5s CPU per
// provider call, ~13 calls per invocation — now memoized per invocation),
// while the deterministic assembly-validation path measures ~2ms. The
// deployment therefore carries an explicit limits.cpu_ms with headroom, but
// deliberately below the 300s platform maximum so a runaway invocation still
// fails fast into the #56 reconciliation path instead of hanging.
import { describe, expect, it } from "vitest";
import { WRANGLER_CONFIG, WRANGLER_CONFIG_RAW } from "./_generated-wrangler-config";

const config = WRANGLER_CONFIG as unknown as {
  name: string;
  limits?: { cpu_ms?: number };
  env?: Record<string, Record<string, unknown>>;
};

describe("explicit workflow CPU budget (issue #55)", () => {
  it("configures an explicit cpu_ms on the V2 worker, within the documented envelope", () => {
    expect(config.name).toBe("cf-website-factory-v2");
    const cpuMs = config.limits?.cpu_ms;
    expect(typeof cpuMs).toBe("number");
    expect(Number.isInteger(cpuMs)).toBe(true);
    // Strictly above the platform default that failed production, at or
    // below the platform maximum (300,000 ms).
    expect(cpuMs!).toBeGreaterThan(30_000);
    expect(cpuMs!).toBeLessThanOrEqual(300_000);
  });

  it("declares the budget exactly once — no conflicting environment overrides", () => {
    expect(WRANGLER_CONFIG_RAW.match(/cpu_ms/g)?.length).toBe(1);
    const staging = config.env?.staging as { limits?: unknown } | undefined;
    expect(staging?.limits).toBeUndefined();
  });
});
