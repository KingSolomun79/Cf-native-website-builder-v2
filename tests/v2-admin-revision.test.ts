// Operator revision notes + the ONE Generate Revision action + the
// requestNote -> Builder wiring (operator GO 2026-09-12). Notes never start a
// Build individually; Generate Revision combines selected pending notes into
// ONE bounded Revision Request on the EXISTING revision domain; structured
// fact changes ride Fact Updates. The governing requestNote reaches the SAME
// Builder v8/model/path as a bounded HUMAN REVISION INSTRUCTION block.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { AdminRevisionError, addSiteNote, generateRevisionFromNotes, listSiteNotes } from "../src/domain/admin-site-notes";
import { createRevisionBuild } from "../src/domain/revision";
import { startSiteGeneration } from "../src/domain/lifecycle";
import { runBuildPipeline, type BuildPipelineDeps } from "../src/domain/build-pipeline";
import { createSimpleScripts, persistSimpleScreenshot, SIMPLE_SCRIPTS_BUSINESS } from "./helpers/simple-scripts";
import { canonicalStructuredFacts } from "./helpers/canonical-facts";
import type { RawAiGenerate } from "../src/domain/ai-boundary";

const env = providedEnv as unknown as Env;

beforeAll(() => {
  // No admin transport in this suite — notification hooks swallow the failure.
});

async function startReferenceGeneration(screenshotKey: string): Promise<string> {
  await persistSimpleScreenshot(env, screenshotKey);
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: {
        businessName: SIMPLE_SCRIPTS_BUSINESS,
        contactEmail: "ops@rankforge.example",
        businessType: "SEO agency",
        businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
        ...canonicalStructuredFacts(),
      },
      reference: { screenshotR2Key: screenshotKey, url: "https://reference.example.com/" },
    },
  });
  return started.siteGenerationId;
}

interface RecordedCall {
  stage: string;
  prompt: string;
}

function scriptsWithRecorder(recorder: RecordedCall[]): BuildPipelineDeps {
  const scripts = createSimpleScripts();
  const inner = scripts.generate as RawAiGenerate;
  return {
    ...scripts,
    generate: (async (systemPrompt: string, userPrompt: string, attempt: number) => {
      const result = await inner(systemPrompt, userPrompt, attempt);
      recorder.push({ stage: systemPrompt.slice(0, 60), prompt: `${systemPrompt}\n${userPrompt}`.slice(0, 60000) });
      return result;
    }) as RawAiGenerate,
  };
}

describe("operator revision notes and Generate Revision", () => {
  it("notes never start a Build individually", async () => {
    const siteId = "notes-site-only";
    await env.DB.prepare("INSERT INTO businesses (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind("notes-business", "Notes Only Co", new Date().toISOString(), new Date().toISOString())
      .run();
    await env.DB.prepare("INSERT INTO site_identities (id, business_id, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(siteId, "notes-business", new Date().toISOString(), new Date().toISOString())
      .run();

    await addSiteNote(env, siteId, "Reduce the mobile hero title.");
    await addSiteNote(env, siteId, "Contact form needs more separation from the footer.");

    const notes = await listSiteNotes(env, siteId);
    expect(notes).toHaveLength(2);
    expect(notes.every((note) => note.status === "PENDING")).toBe(true);

    // No canonical generation was ever started for the notes-only site —
    // notes alone never start a Build.
    const builds = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM builds b JOIN site_generations g ON g.id = b.site_generation_id WHERE g.site_id = ?"
    )
      .bind(siteId)
      .first<{ n: number }>();
    expect(builds?.n ?? 0).toBe(0);
  });

  it("Generate Revision combines pending notes into ONE Revision Request, applies structured Fact Updates and starts the existing pipeline", async () => {
    const siteGenerationId = await startReferenceGeneration("references/simple/notes-revision.png");
    const siteId = (
      await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?").bind(siteGenerationId).first<{ site_id: string }>()
    )!.site_id;

    await addSiteNote(env, siteId, "Reduce the mobile hero title.");
    await addSiteNote(env, siteId, "Contact form needs more separation from the footer.");

    // The initial Build exists (the generation head a revision derives from).
    const { createInitialBuild } = await import("../src/domain/lifecycle");
    const initial = await createInitialBuild(env, { siteGenerationId });

    const startWorkflow = vi.fn(async () => "w-revision-notes-instance");
    const result = await generateRevisionFromNotes(env, {
      siteId,
      factPatch: { phoneNumber: "+254 700 246 810" },
      startsWorkflow: startWorkflow,
    });

    expect(result.revisionRequestId).toBeTruthy();
    expect(result.buildId).not.toBe(initial!.buildId);
    expect(result.includedNoteIds.length).toBeGreaterThanOrEqual(2);
    expect(startWorkflow).toHaveBeenCalledWith(siteGenerationId, result.buildId);
    expect(result.combinedNote).toContain("Reduce the mobile hero title.");

    // Exactly ONE Revision Request + the new Build is a 'revision' child.
    const request = await env.DB.prepare("SELECT request_note FROM revision_requests WHERE build_id = ?")
      .bind(result.buildId)
      .first<{ request_note: string }>();
    expect(request?.request_note).toContain("Reduce the mobile hero title.");
    const buildRow = await env.DB.prepare("SELECT kind, parent_build_id FROM builds WHERE id = ?")
      .bind(result.buildId)
      .first<{ kind: string; parent_build_id: string }>();
    expect(buildRow?.kind).toBe("revision");
    expect(buildRow?.parent_build_id).toBe(initial!.buildId);

    // Structured fact change became a Fact Update — notes never carry facts.
    expect(result.factUpdateCount).toBe(1);
    const update = await env.DB.prepare("SELECT field, value_json FROM fact_updates WHERE build_id = ?")
      .bind(result.buildId)
      .first<{ field: string; value_json: string }>();
    expect(update?.field).toBe("phoneNumber");
    expect(JSON.parse(update!.value_json)).toBe("+254 700 246 810");

    // Notes marked INCLUDED and linked.
    const notes = await listSiteNotes(env, siteId);
    expect(notes.every((note) => note.status === "INCLUDED")).toBe(true);
  });

  it("Generate Revision refuses when nothing is pending", async () => {
    const siteId = "notes-site-empty";
    await env.DB.prepare("INSERT INTO businesses (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind("notes-business-empty", "Empty Notes Co", new Date().toISOString(), new Date().toISOString())
      .run();
    await env.DB.prepare("INSERT INTO site_identities (id, business_id, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(siteId, "notes-business-empty", new Date().toISOString(), new Date().toISOString())
      .run();
    await expect(
      generateRevisionFromNotes(env, { siteId, startsWorkflow: async () => "w-none" })
    ).rejects.toMatchObject({ code: "NO_PENDING_NOTES" });
  });

  it("wires the governing requestNote into the SAME Builder v8 calls as a bounded HUMAN REVISION INSTRUCTION (initial builds carry none)", async () => {
    const siteGenerationId = await startReferenceGeneration("references/simple/notes-builder.png");

    // Initial build: no revision note.
    const initialCalls: RecordedCall[] = [];
    const initialOutcome = await runBuildPipeline(env, {
      siteGenerationId,
      deps: scriptsWithRecorder(initialCalls),
    });
    expect(initialOutcome.terminal).toBe("RELEASE_READY");
    expect(initialCalls.filter((call) => call.prompt.includes("HUMAN REVISION INSTRUCTION"))).toEqual([]);

    // Revision build from the released lineage head: the note rides the Builder.
    const head = await env.DB.prepare(
      "SELECT id FROM builds WHERE site_generation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1"
    )
      .bind(siteGenerationId)
      .first<{ id: string }>();
    const revision = await createRevisionBuild(env, {
      parentBuildId: head!.id,
      payload: {
        requestNote: "Make the service headings more prominent.",
      },
    });
    const revisionCalls: RecordedCall[] = [];
    const revisionOutcome = await runBuildPipeline(env, {
      siteGenerationId,
      buildId: revision.buildId,
      deps: scriptsWithRecorder(revisionCalls),
    });
    expect(revisionOutcome.terminal).toBe("RELEASE_READY");

    const builderInstructionCalls = revisionCalls.filter(
      (call) =>
        call.prompt.includes("HUMAN REVISION INSTRUCTION") &&
        call.prompt.includes("Make the service headings more prominent.")
    );
    expect(builderInstructionCalls.length).toBeGreaterThanOrEqual(6);
    // The authority rules travel with the instruction.
    expect(builderInstructionCalls[0].prompt).toContain("NOT a Business Fact authority");
    expect(builderInstructionCalls[0].prompt).toContain("cannot change the Build Mode");
    expect(builderInstructionCalls[0].prompt).toContain("Business Facts remain the ONLY factual authority");
  });
});
