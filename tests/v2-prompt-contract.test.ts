import { beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import {
  AiStageSchemaInvalidError,
  parseModelJson,
  runSchemaValidatedAiStage,
  type RawAiGenerate,
} from "../src/domain/ai-boundary";
import {
  DOMAIN_CONTRACT_FILE,
  PROMPT_MANIFEST,
  composeStagePrompt,
  PromptContractError,
} from "../src/domain/prompt-contract";
import { PROMPT_BODY_FILES } from "../src/domain/generated/prompt-bodies";
import { getObject, putImmutableObject } from "../src/lib/assets";

// Primary-seam tests for the canonical prompt/schema/provenance contracts
// (issue #6): manifest-driven prompt identity, domain-contract composition,
// one targeted structural repair, terminal invalid failure and persisted
// provenance.

function runtimeEnv(): Env {
  return providedEnv as unknown as Env;
}

async function newBuildContext(env: Env): Promise<{
  buildId: string;
  siteGenerationId: string;
  buildVersionId: string;
}> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: {
        businessName: "Rift Valley Roasters",
        contactEmail: "hello@riftvalleyroasters.example",
      },
      reference: { screenshotR2Key: "references/uploads/abc.png" },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { buildId: created.buildId, siteGenerationId: started.siteGenerationId, buildVersionId: created.buildVersionId };
}

const SampleSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1 }),
    confidence: Type.Union([Type.Literal("HIGH"), Type.Literal("MEDIUM"), Type.Literal("LOW")]),
    traits: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  { additionalProperties: false }
);
type Sample = Static<typeof SampleSchema>;

function stageOptions(context: { buildId: string; siteGenerationId: string; buildVersionId: string }) {
  return {
    stage: "reference-analyzer" as const,
    schema: SampleSchema,
    schemaVersion: "reference-analysis/1",
    userPrompt: "Analyze the frozen Reference Evidence payload: {...}",
    buildId: context.buildId,
    siteGenerationId: context.siteGenerationId,
    buildVersionId: context.buildVersionId,
    buildVersionNumber: 1,
    inputArtifactIds: ["references/evidence/frozen-1.json"],
  };
}

function generateReturning(responses: string[]): { generate: RawAiGenerate; calls: Array<{ system: string; user: string; attempt: number }> } {
  const calls: Array<{ system: string; user: string; attempt: number }> = [];
  let index = 0;
  return {
    calls,
    generate: async (system, user, attempt) => {
      calls.push({ system, user, attempt });
      const content = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return { content, provider: "test", model: "test-model-x" };
    },
  };
}

const VALID_SAMPLE = JSON.stringify({
  summary: "Editorial asymmetric layout with oversized serif display type.",
  confidence: "HIGH",
  traits: ["oversized serif display", "asymmetric two-column grid"],
});

describe("canonical prompt contract", () => {
  it("derives runtime prompt identity from the manifest, not filename suffixes", () => {
    const composed = composeStagePrompt("reference-analyzer");
    expect(composed.promptId).toBe("reference-analyzer");
    // Manifest version v3 — the retained body filename is 01-reference-analyzer-v2.md.
    expect(composed.promptVersion).toBe("v3");
    expect(composed.promptVersion).not.toContain(PROMPT_MANIFEST["reference-analyzer"].bodyFile.split("-").pop()!.split(".")[0]);
    expect(composed.promptDomainContractVersion).toBe("v1");

    // Every manifest stage resolves and maps to an existing retained body.
    for (const [stage, entry] of Object.entries(PROMPT_MANIFEST)) {
      expect(typeof PROMPT_BODY_FILES[entry.bodyFile]).toBe("string");
      expect(entry.promptId).toBe(stage);
      expect(entry.promptVersion).toMatch(/^v\d+$/);
    }
    expect(() => composeStagePrompt("nope" as never)).toThrow(PromptContractError);
  });

  it("prepends the domain contract to the retained stage body", () => {
    const composed = composeStagePrompt("website-generator");
    const contract = PROMPT_BODY_FILES[DOMAIN_CONTRACT_FILE];
    const body = PROMPT_BODY_FILES[PROMPT_MANIFEST["website-generator"].bodyFile];
    expect(composed.systemPrompt.startsWith(contract.trim().slice(0, 200))).toBe(true);
    expect(composed.systemPrompt).toContain(body.trim().slice(0, 200));
    // The domain contract section comes BEFORE the retained body.
    expect(composed.systemPrompt.indexOf("Prompt Domain Contract")).toBeLessThan(
      composed.systemPrompt.indexOf(body.trim().slice(0, 60))
    );
  });
});

describe("schema-validated AI stage boundary", () => {
  const env = runtimeEnv();
  let context: Awaited<ReturnType<typeof newBuildContext>>;

  beforeAll(async () => {
    context = await newBuildContext(env);
  });

  it("accepts valid output on the first attempt and persists provenance + immutable artifact", async () => {
    const { generate, calls } = generateReturning([VALID_SAMPLE]);
    const result = await runSchemaValidatedAiStage<Sample>(env, { ...stageOptions(context), generate });

    expect(result.value.traits).toHaveLength(2);
    expect(result.provenance.promptId).toBe("reference-analyzer");
    expect(result.provenance.promptVersion).toBe("v3");
    expect(result.provenance.promptDomainContractVersion).toBe("v1");
    expect(result.provenance.model).toBe("test-model-x");
    expect(result.provenance.schemaVersion).toBe("reference-analysis/1");
    expect(result.provenance.attempt).toBe(1);
    expect(result.provenance.inputArtifactIds).toEqual(["references/evidence/frozen-1.json"]);
    expect(result.attempts).toEqual([{ attempt: 1, outcome: "valid", errorSummary: null }]);

    // The generated system prompt is the composed contract (not a bare body).
    expect(calls[0].system).toContain("Prompt Domain Contract");

    // D1 provenance row.
    const rows = await env.DB.prepare(
      "SELECT * FROM ai_stage_runs WHERE run_id = ? ORDER BY attempt"
    )
      .bind(result.runId)
      .all<{
        prompt_id: string;
        prompt_version: string;
        prompt_domain_contract_version: string;
        model: string;
        schema_version: string;
        attempt: number;
        outcome: string;
        input_artifact_ids_json: string;
        artifact_r2_key: string;
      }>();
    expect((rows.results ?? []).length).toBe(1);
    const row = rows.results![0];
    expect(row.prompt_id).toBe("reference-analyzer");
    expect(row.prompt_version).toBe("v3");
    expect(row.schema_version).toBe("reference-analysis/1");
    expect(row.outcome).toBe("valid");
    expect(JSON.parse(row.input_artifact_ids_json)).toEqual(["references/evidence/frozen-1.json"]);
    expect(row.artifact_r2_key).toBe(result.artifactR2Key);

    // Immutable R2 artifact carries value + provenance.
    const stored = await env.SITE_BUCKET.get(result.artifactR2Key);
    expect(stored).not.toBeNull();
    const artifact = JSON.parse(await stored!.text()) as { value: Sample; provenance: { promptVersion: string } };
    expect(artifact.value.summary).toContain("Editorial");
    expect(artifact.provenance.promptVersion).toBe("v3");

    // The artifact key is written immutably: a second immutable write refuses.
    await expect(putImmutableObject(env, result.artifactR2Key, "tamper")).rejects.toThrow(
      /already exists/
    );
    const stillOriginal = await env.SITE_BUCKET.get(result.artifactR2Key);
    expect(await stillOriginal!.text()).toContain("Editorial");
  });

  it("accepts output after exactly one targeted structural repair", async () => {
    const invalid = JSON.stringify({ summary: "ok", confidence: "MAYBE", traits: [] });
    const { generate, calls } = generateReturning([invalid, VALID_SAMPLE]);

    const result = await runSchemaValidatedAiStage<Sample>(env, { ...stageOptions(context), generate });

    expect(result.provenance.attempt).toBe(2);
    expect(result.attempts.map((a) => a.outcome)).toEqual(["invalid", "repaired"]);
    expect(result.attempts[0].errorSummary).toContain("confidence");

    // The second call carries explicit corrective feedback.
    expect(calls).toHaveLength(2);
    expect(calls[1].user).toContain("Targeted structural repair");
    expect(calls[1].user).toContain("confidence");
    expect(calls[1].attempt).toBe(2);

    const rows = await env.DB.prepare(
      "SELECT outcome, error_summary FROM ai_stage_runs WHERE run_id = ? ORDER BY attempt"
    )
      .bind(result.runId)
      .all<{ outcome: string; error_summary: string | null }>();
    expect((rows.results ?? []).map((row) => row.outcome)).toEqual(["invalid", "repaired"]);
  });

  it("fails terminally after the single repair attempt and persists no artifact", async () => {
    const invalid = "not json at all {{{";
    const { generate } = generateReturning([invalid, invalid]);

    await expect(
      runSchemaValidatedAiStage<Sample>(env, { ...stageOptions(context), generate })
    ).rejects.toBeInstanceOf(AiStageSchemaInvalidError);

    const rows = await env.DB.prepare(
      "SELECT outcome, artifact_r2_key, error_summary FROM ai_stage_runs WHERE stage = ? ORDER BY created_at DESC, attempt LIMIT 2"
    )
      .bind("reference-analyzer")
      .all<{ outcome: string; artifact_r2_key: string | null; error_summary: string | null }>();
    const latest = rows.results ?? [];
    expect(latest.map((row) => row.outcome)).toEqual(["invalid", "invalid"]);
    expect(latest.every((row) => row.artifact_r2_key === null)).toBe(true);
    expect(latest[0].error_summary).toContain("unparseable");
  });

  it("parses fenced and truncated JSON output deterministically", () => {
    expect(parseModelJson("```json\n{\"a\":1}\n```")).toEqual({ ok: true, value: { a: 1 } });
    expect(parseModelJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    const truncated = parseModelJson('{"summary":"x","confidence":"HIGH","traits":["oversized ser');
    expect(truncated.ok).toBe(true);
    if (truncated.ok) {
      expect((truncated.value as Record<string, unknown>).confidence).toBe("HIGH");
    }
    expect(parseModelJson("garbage").ok).toBe(false);
  });
});
