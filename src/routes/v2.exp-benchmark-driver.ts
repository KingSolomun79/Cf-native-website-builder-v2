// EXPERIMENT BRANCH ONLY (experiment/simplified-design-pipeline) — live
// benchmark driver for the operator's experimental runtime. NEVER enabled on
// production: the route 404s unless the EXP_BENCHMARK_DRIVER var is "1"
// (set only in wrangler.exp.jsonc, deployed only to the sandbox Worker).
//
// Purpose: drive the SIMPLE stages in ISOLATION with live provider seams, as
// the benchmark spec requires (Phase 1: frozen Finch blueprint → Website
// Builder; Phase 2: Reference capture → exactly one Design Blueprint, then a
// hard STOP before images/builder/QA). The production pipeline routes above
// remain the only way to run the full pipeline.
//
// Gate: HMAC X-Signature over the raw body with EXP_BENCHMARK_SECRET
// (falling back to WEBHOOK_SECRET) — the same intake-class HMAC gate the
// other operator routes use. No capability minting exists for this route and
// it performs no Approval/Publication/Rollback actions.

import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyWebhookSignature } from "../lib/crypto";
import { callGatewayChat } from "../lib/ai-gateway";
import {
  generalApiCredentialCanary,
  generateStreamingCompletion,
  generateWorkersAiStreaming,
  StreamingTransportExhaustedError,
  type StreamingCompletionOptions,
} from "../lib/ai-streaming";

type CanaryTransport = "zai_general" | "workers_ai";

function canaryStream(env: Env, transport: CanaryTransport | undefined, options: StreamingCompletionOptions) {
  return transport === "workers_ai"
    ? generateWorkersAiStreaming(env, options)
    : generateStreamingCompletion(env, options);
}
import { startSiteGeneration, createInitialBuild, createNextBuildVersion } from "../domain/lifecycle";
import { getEffectiveBusinessFacts } from "../domain/revision";
import { runReferenceIntake, getFrozenReferenceEvidence } from "../domain/reference-intake";
import { putObject } from "../lib/assets";
import { getAcceptedImageMap, type ImageSpendReport, type SlotGenerationOutcome } from "../domain/image-pipeline";
import { runImageGenerationDurable } from "../domain/image-orchestration";
import { KieV2ImageProvider, planKieImageRequest } from "../lib/kie-v2";
import { sha256Hex } from "../lib/crypto";
import { runSimpleBuildPipeline } from "../simple-design/pipeline";
import { buildAssembledCandidate, deployPreview, freezeAssembledCandidate, AssemblyPreflightError } from "../domain/assembly";
import { storeBuildStageArtifactIdempotent, getBuildStageArtifact } from "../domain/stage-artifacts";
import { buildStandardEvidenceBundle } from "../domain/qa-evidence";
import { createProductionQaCapture } from "../domain/qa-capture";
import { runSimpleWebsiteBuilderStage, runSimpleBuilderTransportDiagnostic } from "../simple-design/website-builder";
import { runSimpleDesignBlueprintStage } from "../simple-design/design-blueprint";
import { renderDesignBlueprintMarkdown } from "../simple-design/render-blueprint";
import { renderDesignBlueprintV2Markdown } from "../simple-design/render-blueprint-v2";
import { runDeterministicBundleQa } from "../simple-design/bundle-qa";
import { runSimpleVisualQaStage } from "../simple-design/visual-qa";
import {
  blueprintSlotsToImageSlots,
  blueprintSlotsToPromptRecords,
  blueprintPromptRecordsAny,
  evaluateBlueprintQualityGateAny,
  materializeAcceptedImageDescriptors,
  materializeBlueprintImageSlots,
  materializeBlueprintPromptRecords,
  storedBlueprintToV2,
  DESIGN_BLUEPRINT_NATIVE_JSON_SCHEMA,
  DESIGN_BLUEPRINT_SCHEMA_VERSION,
  evaluateBlueprintQualityGate,
  validateDesignBlueprint,
  type DesignBlueprint,
  type DesignBlueprintV2,
  type SiteBundle,
} from "../simple-design/contracts";
import { parseModelJson } from "../domain/ai-boundary";
import { composeStagePrompt } from "../domain/prompt-contract";
import type { BusinessFacts } from "../domain/lifecycle-schema";

interface DriverFixtureImage {
  slotId: string;
  base64: string;
}

interface DriverBody {
  op: "health" | "put-fixture" | "finch-builder" | "builder-diagnostic" | "assemble-stored" | "capture" | "blueprint" | "artifact" | "probe" | "fetch-probe" | "sql-probe" | "general-api-canary" | "stream-canary-text" | "stream-canary-vision" | "schema-canary" | "stage-runs" | "simple-kie" | "simple-kie-validation" | "simple-full-run" | "simple-rerender-qa" | "simple-hardening-run" | "simple-final-run";
  key?: string;
  base64?: string;
  facts?: BusinessFacts;
  blueprint?: DesignBlueprint | DesignBlueprintV2;
  fixtureImages?: DriverFixtureImage[];
  referenceUrl?: string;
  referenceScreenshotKey?: string;
  adaptationContract?: unknown;
  siteGenerationId?: string;
  buildId?: string;
  buildVersionId?: string;
  probeMaxTokens?: number;
  canaryItems?: number;
  canaryThinking?: "low" | "high" | "max";
  canaryTransport?: CanaryTransport;
  stage?: string;
  stream?: boolean;
  candidateDesktopR2Key?: string;
  candidateMobileR2Key?: string;
  cause?: string;
  detail?: string;
  inheritAcceptedImagesFromBuildVersionId?: string;
  resumeBenchmarkVersionId?: string;
  freshVersion?: boolean;
  copyBlueprintFromBuildVersionId?: string;
  inheritAcceptedImagesExceptSlotIds?: string[];
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function latestVersion(env: Env, buildId: string): Promise<{ id: string; versionNumber: number }> {
  const row = await env.DB.prepare(
    "SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1"
  )
    .bind(buildId)
    .first<{ id: string; version_number: number }>();
  if (!row) throw new Error(`Build ${buildId} has no Build Version`);
  return { id: row.id, versionNumber: row.version_number };
}

export async function expBenchmarkDriver(c: Context<{ Bindings: Env }>): Promise<Response> {
  if (c.env.EXP_BENCHMARK_DRIVER !== "1") {
    return c.json({ error: "Not found" }, 404);
  }
  const rawBody = await c.req.text();
  const signature = c.req.header("X-Signature");
  const secret = c.env.EXP_BENCHMARK_SECRET ?? c.env.WEBHOOK_SECRET;
  if (!(await verifyWebhookSignature(secret, rawBody, signature ?? null))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: DriverBody;
  try {
    body = JSON.parse(rawBody) as DriverBody;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  try {
    switch (body.op) {
      case "health":
        return c.json({ ok: true, driver: "exp-benchmark/1" });

      case "put-fixture": {
        if (!body.key || !body.base64) return c.json({ error: "key and base64 required" }, 400);
        const bytes = base64ToBytes(body.base64);
        await putObject(c.env, body.key, bytes.buffer as ArrayBuffer);
        return c.json({ ok: true, key: body.key, size: bytes.byteLength });
      }

      case "artifact": {
        if (!body.key) return c.json({ error: "key required" }, 400);
        const obj = await c.env.SITE_BUCKET.get(body.key);
        if (!obj) return c.json({ error: "Object not found" }, 404);
        return c.json({ ok: true, key: body.key, size: obj.size, base64: bytesToBase64(await obj.arrayBuffer()) });
      }

      case "finch-builder":
        return c.json(await runFinchBuilder(c.env, body));

      case "builder-diagnostic":
        return c.json(await runBuilderDiagnostic(c.env, body));

      case "assemble-stored":
        return c.json(await runAssembleStored(c.env, body));

      case "capture":
        return c.json(await runCapture(c.env, body));

      case "blueprint":
        return c.json(await runBlueprint(c.env, body));

      case "probe":
        return c.json(await runTransportProbe(c.env, body));

      // Preview-routing diagnostic (final benchmark, 2026-09-09): the marker
      // gate inside THIS Worker consistently 404s on a preview workers.dev
      // host that external clients see 200 with the exact candidate marker.
      // Fetch the URL from the Worker's own context and report what it sees
      // (status, cf-ray, colo, body head) — benchmark instrumentation only.
      case "fetch-probe": {
        if (!body.key) return c.json({ error: "key (url) required" }, 400);
        const target = body.key!;
        const response = await fetch(`${target}${target.includes("?") ? "&" : "?"}probe=${Date.now()}`, {
          headers: { "cache-control": "no-cache" },
        });
        const text = await response.text();
        return c.json({
          url: target,
          status: response.status,
          cfRay: response.headers.get("cf-ray"),
          cfColo: (response.headers.get("cf-meta-colo") ?? response.headers.get("cf-ray") ?? "").split("-")[1] ?? null,
          server: response.headers.get("server"),
          bodyHead: text.slice(0, 300),
          hasMarker: text.includes("wazibiz-build-version"),
        });
      }

      // §5 credential check: can the EXISTING ZHIPU_API_KEY call the General
      // API (api.z.ai/api/paas/v4) with model glm-5.3-flash? Returns only
      // auth/model-availability — never the key. Optional thinking level:
      // the General API rejects "disabled" for this model (error 1210).
      case "general-api-canary":
        return c.json(await generalApiCredentialCanary(c.env, body.canaryThinking));

      // §14 Canary A — zero-business long-text streaming diagnostic.
      case "stream-canary-text":
        return c.json(await runStreamCanaryText(c.env, body));

      // §15 Canary B — multimodal streaming with the frozen Morabeza capture.
      case "stream-canary-vision":
        return c.json(await runStreamCanaryVision(c.env, body));

      // §16 schema canary — ONE text-only call with the FINAL design-blueprint
      // response_format=json_schema against a deliberately varied synthetic
      // website. Verifies: stream completes, provider accepts the schema,
      // JSON parses, post-parse validation passes, zero correction calls.
      case "schema-canary":
        return c.json(await runSchemaCanary(c.env, body));

      // Read-only provenance: ai_stage_runs rows for a build — report
      // evidence (attempt counts, outcomes, token usage). No model spend.
      // Optional stage filter; all stages when omitted.
      case "stage-runs":
        return c.json(await runStageRunsQuery(c.env, body));

      // Benchmark forensics: READ-ONLY arbitrary SELECT against the
      // experimental D1 (benchmark driver is HMAC-gated, experiment-only).
      // Anything that is not a single SELECT statement is rejected.
      case "sql-probe": {
        const sql = (body.detail as string | undefined)?.trim() ?? "";
        if (!/^select\b/i.test(sql) || /;/.test(sql.replace(/;+\s*$/, "")) || /\b(insert|update|delete|drop|alter|create|attach|pragma)\b/i.test(sql)) {
          return c.json({ error: "only a single SELECT statement is allowed" }, 400);
        }
        const rows = await c.env.DB.prepare(sql).all();
        return c.json({ sql, rows: rows.results });
      }

      // Phase 3 (§5): the pipeline's EXACT image step in isolation — frozen
      // blueprint slots → durable KIE machinery with a REAL timer sleep (the
      // driver has no Workflow engine to sleep for it). Idempotent: only
      // unresolved slots generate.
      case "simple-kie":
        return c.json(await runSimpleKie(c.env, body));

      // NANO BANANA SUBSTITUTION benchmark (operator GO, 2026-09-09): the
      // six-slot image validation — a FRESH Build Version on the frozen
      // Build (frozen blueprint artifact reused byte-exact, never
      // regenerated, no Builder), then the pipeline's EXACT image step so
      // every slot gets a fresh provider attempt under the substituted
      // image model.
      case "simple-kie-validation":
        return c.json(await runSimpleKieValidation(c.env, body));

      // Phase 3 (§7-23): the FULL sanctioned SIMPLE pipeline via
      // runSimpleBuildPipeline — capture/blueprint/KIE reuse makes this
      // idempotent; it runs builder → assemble → QA → (≤1 repair) → final QA.
      // stream=true returns NDJSON progress + heartbeats so a long run (the
      // pages call alone can stream for many minutes) holds the client
      // connection without triggering client/proxy idle timeouts.
      case "simple-full-run":
        return body.stream ? streamSimpleFullRun(c, body) : c.json(await runSimpleFullRun(c.env, body));

      // Phase 3 evaluation-integrity tooling: re-assemble an ALREADY-STORED
      // pipeline bundle (zero builder/repair/KIE calls), re-capture renders,
      // re-run deterministic QA and the visual-QA judgement. Used when the
      // original evidence capture raced preview propagation and Visual QA
      // judged the workers.dev placeholder instead of the candidate. Never
      // mutates build state; no repair budget is touched.
      case "simple-rerender-qa":
        return c.json(await runSimpleRerenderQa(c.env, body));

      // Final hardening benchmark: fresh Build on the SAME Site Generation
      // (frozen reference capture reuse), the FROZEN blueprint artifact
      // reused byte-exact (never regenerated), then the sanctioned SIMPLE
      // pipeline with fresh KIE under the text-safe photo policy.
      case "simple-hardening-run":
      // Final SIMPLE DECISION benchmark (operator GO, 2026-09-09): identical
      // frozen-input shape, distinct provenance cause. Same handler.
      case "simple-final-run":
        return body.stream ? streamSimpleHardeningRun(c, body) : c.json(await runSimpleHardeningRun(c.env, body));

      default:
        return c.json({ error: "Unknown op" }, 400);
    }
  } catch (error) {
    return c.json({ error: (error as Error).message.slice(0, 500), name: (error as Error).name }, 500);
  }
}

interface Scaffold {
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
}

async function scaffold(
  env: Env,
  facts: BusinessFacts,
  reference: { url?: string; screenshotR2Key?: string; adaptationContract?: unknown }
): Promise<Scaffold> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts,
      reference,
    },
  });
  const build = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  const siteRow = await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?")
    .bind(started.siteGenerationId)
    .first<{ site_id: string }>();
  const version = await latestVersion(env, build.buildId);
  return {
    siteGenerationId: started.siteGenerationId,
    siteId: siteRow!.site_id,
    buildId: build.buildId,
    buildVersionId: version.id,
    buildVersionNumber: version.versionNumber,
  };
}

async function storeFixtureImages(
  env: Env,
  ctx: Scaffold,
  fixtureImages: DriverFixtureImage[]
): Promise<Map<string, string>> {
  const accepted = new Map<string, string>();
  for (const [index, image] of fixtureImages.entries()) {
    const key = `fixtures/simple-images/${image.slotId}.webp`;
    const bytes = base64ToBytes(image.base64);
    await putObject(env, key, bytes.buffer as ArrayBuffer);
    const attemptId = `fixture-attempt-${ctx.buildVersionId}-${image.slotId}`;
    await env.DB.prepare(
      `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, r2_key, cost_usd, created_at)
       VALUES (?, ?, ?, ?, 1, 1, 'succeeded', ?, 0, datetime('now'))`
    )
      .bind(attemptId, ctx.buildId, ctx.buildVersionId, image.slotId, key)
      .run();
    await env.DB.prepare(
      `INSERT INTO accepted_images (build_version_id, slot_id, attempt_id, r2_key, accepted_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    )
      .bind(ctx.buildVersionId, image.slotId, attemptId, key)
      .run();
    accepted.set(image.slotId, key);
    void index;
  }
  return accepted;
}

async function runFinchBuilder(env: Env, body: DriverBody) {
  if (!body.facts || !body.blueprint) throw new Error("facts and blueprint required");
  const blueprintV2 = storedBlueprintToV2(body.blueprint);
  const referenceScreenshotKey = body.referenceScreenshotKey ?? "references/simple/exp-finch-ref.png";
  const ctx = await scaffold(env, body.facts, { screenshotR2Key: referenceScreenshotKey });
  const acceptedKeys = await storeFixtureImages(env, ctx, body.fixtureImages ?? []);

  const formServiceEndpoint = `${env.PUBLIC_APP_URL}/api/v2/forms/submit`;
  const siteFormId = `site:${ctx.siteId}`;
  const stageInput = {
    siteGenerationId: ctx.siteGenerationId,
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: ctx.buildVersionNumber,
    blueprint: blueprintV2,
    facts: body.facts,
    acceptedImages: materializeAcceptedImageDescriptors(blueprintV2),
    formServiceEndpoint,
    siteFormId,
    visualInputs: [
      { kind: "full-page", artifact: referenceScreenshotKey, sha256: "exp-fixture", width: 1440, height: 3200 } as const,
    ],
  };
  const built = await runSimpleWebsiteBuilderStage(env, stageInput);
  const result = await assembleAndJudge(env, ctx, built.bundle, { ...body, blueprint: blueprintV2 }, acceptedKeys);
  return { ...result, builderStrategy: built.strategy };
}

// EXPERIMENT DIAGNOSTIC normalization: the live model used production image
// idioms (srcset variants, data-src lazy loading, CSS url(IMG:…)) that the
// KEEP-list assembly (src="IMG:…" only) does not resolve and Technical
// Preflight (any IMG: occurrence) rejects. Recorded as a benchmark finding;
// the sanitizer lets the diagnostic proceed so QUALITY can be measured. The
// pipeline itself is unchanged and would need the operator's decision.
function sanitizeDiagnosticBundle(bundle: SiteBundle): { bundle: SiteBundle; normalizations: string[] } {
  const normalizations: string[] = [];
  const assetPath = (slotId: string) => `assets/images/${slotId}.webp`;
  const cleanPage = (page: string, html: string): string =>
    html
      .replace(/\s(srcset|data-srcset)="([^"]*IMG:[^"]*)"/g, (_m, attr: string) => {
        normalizations.push(`${page}: dropped ${attr} with IMG: reference`);
        return "";
      })
      .replace(/\sdata-src="IMG:([a-zA-Z0-9_-]+)"/g, (_m, slotId: string) => {
        normalizations.push(`${page}: data-src IMG:${slotId} → src`);
        return ` src="IMG:${slotId}"`;
      })
      // Any OTHER attribute carrying an IMG: reference (live finding: the
      // model wires the blueprint's chapter hover-preview as
      // data-preview="IMG:slotId") is pointed straight at the asset path —
      // assembly only resolves src="IMG:…" and Technical Preflight rejects
      // any remaining IMG: occurrence.
      .replace(/([a-zA-Z-]+)="IMG:([a-zA-Z0-9_-]+)"/g, (full, attr: string, slotId: string) => {
        if (attr === "src" || attr === "data-src") return full;
        normalizations.push(`${page}: ${attr}="IMG:${slotId}" → ${assetPath(slotId)}`);
        return `${attr}="${assetPath(slotId)}"`;
      })
      .replace(/url\((['"]?)IMG:([a-zA-Z0-9_-]+)(['"]?)\)/g, (_m, q1: string, slotId: string, q2: string) => {
        normalizations.push(`${page}: css url IMG:${slotId} → asset path`);
        return `url(${q1}${assetPath(slotId)}${q2})`;
      });
  const pages = Object.fromEntries(
    Object.entries(bundle.pages).map(([page, html]) => [page, cleanPage(page, html)])
  ) as SiteBundle["pages"];
  const sharedCss = bundle.sharedCss.replace(/url\((['"]?)IMG:([a-zA-Z0-9_-]+)(['"]?)\)/g, (_m, q1: string, slotId: string, q2: string) => {
    normalizations.push(`site.css: url IMG:${slotId} → asset path`);
    return `url(${q1}${assetPath(slotId)}${q2})`;
  });
  // Live finding (run 3): the model's sharedJs contained ONE genuine syntax
  // error — 'return …(sel););' — which Technical Preflight correctly caught.
  // The diagnostic repairs exactly this defect (counted as an intervention)
  // so interaction quality can render; the pipeline's ONE repair exists for
  // precisely this class of defect.
  const sharedJs = bundle.sharedJs.replace(/\.querySelector\(sel\);\);/g, () => {
    normalizations.push("site.js: repaired q() syntax error ');)' → '); }' (diagnostic intervention)");
    return ".querySelector(sel); }";
  });
  return { bundle: { ...bundle, pages, sharedCss, sharedJs }, normalizations };
}

// EXPERIMENT DIAGNOSTIC ONLY: measures design-transfer quality under a forced
// small-call decomposition (see website-builder.ts). Not a pipeline strategy.
async function runBuilderDiagnostic(env: Env, body: DriverBody) {
  if (!body.facts || !body.blueprint) throw new Error("facts and blueprint required");
  const blueprintV2 = storedBlueprintToV2(body.blueprint);
  const referenceScreenshotKey = body.referenceScreenshotKey ?? "references/simple/exp-finch-ref.png";
  const ctx = await scaffold(env, body.facts, { screenshotR2Key: referenceScreenshotKey });
  const acceptedKeys = await storeFixtureImages(env, ctx, body.fixtureImages ?? []);

  const formServiceEndpoint = `${env.PUBLIC_APP_URL}/api/v2/forms/submit`;
  const siteFormId = `site:${ctx.siteId}`;
  const diagnostic = await runSimpleBuilderTransportDiagnostic(env, {
    siteGenerationId: ctx.siteGenerationId,
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: ctx.buildVersionNumber,
    blueprint: blueprintV2,
    facts: body.facts,
    acceptedImages: materializeAcceptedImageDescriptors(blueprintV2),
    formServiceEndpoint,
    siteFormId,
    visualInputs: [
      { kind: "full-page", artifact: referenceScreenshotKey, sha256: "exp-fixture", width: 1440, height: 3200 } as const,
    ],
  });
  // Persist BEFORE assembly so the (expensive) generated bundle survives a
  // preflight rejection for inspection.
  const { bundle: cleanBundle, normalizations } = sanitizeDiagnosticBundle(diagnostic.bundle);
  await storeBuildStageArtifactIdempotent(env, {
    buildId: ctx.buildId,
    siteGenerationId: ctx.siteGenerationId,
    buildVersionId: ctx.buildVersionId,
    kind: "site_bundle",
    schemaVersion: "site-bundle/1",
    value: cleanBundle,
  });
  try {
    const result = await assembleAndJudge(env, ctx, cleanBundle, { ...body, blueprint: blueprintV2 }, acceptedKeys);
    return { ...result, builderStrategy: "TRANSPORT_DIAGNOSTIC", calls: diagnostic.calls, normalizations };
  } catch (error) {
    if (error instanceof AssemblyPreflightError) {
      return {
        ...ctx,
        builderStrategy: "TRANSPORT_DIAGNOSTIC",
        calls: diagnostic.calls,
        normalizations,
        bundle: cleanBundle,
        preflightBlockers: error.blockers.map((blocker) => ({ id: blocker.id, detail: blocker.detail ?? blocker.id })),
        previewUrl: null,
      };
    }
    throw error;
  }
}

// EXPERIMENT DIAGNOSTIC ONLY: re-assembles an ALREADY-STORED site_bundle
// (from a prior builder-diagnostic run) with the current sanitizer — zero
// model spend. Requires the fixture images of that run to still be accepted
// on the Build Version (accepted_images rows persist).
async function runAssembleStored(env: Env, body: DriverBody) {
  if (!body.siteGenerationId || !body.buildId || !body.facts || !body.blueprint) {
    throw new Error("siteGenerationId, buildId, facts and blueprint required");
  }
  const version = body.buildVersionId ?? (await latestVersion(env, body.buildId)).id;
  const versionNumber = (await latestVersion(env, body.buildId)).versionNumber;
  const stored = await getBuildStageArtifact<SiteBundle>(env, version, "site_bundle");
  if (!stored) throw new Error("no stored site_bundle for that Build Version");
  const generationRow = await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?")
    .bind(body.siteGenerationId)
    .first<{ site_id: string }>();
  if (!generationRow) throw new Error("Site Generation not found");
  const ctx: Scaffold = {
    siteGenerationId: body.siteGenerationId,
    siteId: generationRow.site_id,
    buildId: body.buildId,
    buildVersionId: version,
    buildVersionNumber: versionNumber,
  };
  const acceptedEntries = await getAcceptedImageMap(env, version);
  const acceptedKeys = new Map([...acceptedEntries].map(([slotId, entry]) => [slotId, entry.r2Key] as const));
  const { bundle: cleanBundle, normalizations } = sanitizeDiagnosticBundle(stored.value);
  try {
    const result = await assembleAndJudge(env, ctx, cleanBundle, body, acceptedKeys);
    return { ...result, builderStrategy: "TRANSPORT_DIAGNOSTIC_REASSEMBLE", normalizations };
  } catch (error) {
    if (error instanceof AssemblyPreflightError) {
      return {
        ...ctx,
        builderStrategy: "TRANSPORT_DIAGNOSTIC_REASSEMBLE",
        normalizations,
        bundle: cleanBundle,
        preflightBlockers: error.blockers.map((blocker) => ({ id: blocker.id, detail: blocker.detail ?? blocker.id })),
        previewUrl: null,
      };
    }
    throw error;
  }
}

// KEEP-list deterministic assembly + Technical Preflight + preview + render
// evidence + deterministic truth/technical contract — exactly the pipeline's
// assembleAndPreview/evaluateVersion shape, minus the visual QA call (the
// isolated stage tests judge blueprint adherence by hand).
async function assembleAndJudge(
  env: Env,
  ctx: Scaffold,
  bundle: SiteBundle,
  body: DriverBody,
  acceptedKeys: Map<string, string>,
  opts?: { skipFreeze?: boolean }
) {
  const blueprint = storedBlueprintToV2(body.blueprint!);
  const facts = body.facts!;
  const formServiceEndpoint = `${env.PUBLIC_APP_URL}/api/v2/forms/submit`;
  const siteFormId = `site:${ctx.siteId}`;
  const djStep = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      throw new Error(`[judge.${label}] ${(error as Error).name}: ${(error as Error).message}`);
    }
  };

  // Deterministic assembly + Technical Preflight + preview, exactly as the
  // pipeline does it (KEEP-list path).
  const acceptedEntries = await djStep("accepted-map", () => getAcceptedImageMap(env, ctx.buildVersionId));
  const acceptedImages = new Map([...acceptedEntries].map(([slotId, entry]) => [slotId, entry.r2Key] as const));
  const candidate = await djStep("build-candidate", () => buildAssembledCandidate(env, {
    siteGenerationId: ctx.siteGenerationId,
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: ctx.buildVersionNumber,
    pages: bundle.pages,
    sharedCss: bundle.sharedCss,
    sharedJs: bundle.sharedJs,
    imagePlanSlots: materializeBlueprintImageSlots(blueprint),
    acceptedImages,
    formServiceEndpoint,
    expectedSiteFormId: siteFormId,
  }));
  // Re-render evaluations skip re-freezing: the immutable candidate objects
  // already exist from the original assembly, and reproducing the identical
  // manifest requires no new writes.
  if (!opts?.skipFreeze) {
    await djStep("freeze-candidate", () => freezeAssembledCandidate(env, {
      siteGenerationId: ctx.siteGenerationId,
      buildId: ctx.buildId,
      buildVersionId: ctx.buildVersionId,
      buildVersionNumber: ctx.buildVersionNumber,
      pages: bundle.pages,
      sharedCss: bundle.sharedCss,
      sharedJs: bundle.sharedJs,
      candidate,
      imagePlanSlots: materializeBlueprintImageSlots(blueprint),
      acceptedImages,
      formServiceEndpoint,
      expectedSiteFormId: siteFormId,
    }));
  }
  const preview = await djStep("deploy-preview", () => deployPreview(env, {
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: ctx.buildVersionNumber,
    candidate,
  }));

  // Standard render evidence (real browser captures of the preview) + the
  // deterministic truth/technical contract.
  const evidence = preview.previewUrl
    ? await djStep("qa-evidence", () => buildStandardEvidenceBundle(env, {
        buildId: ctx.buildId,
        buildVersionId: ctx.buildVersionId,
        buildVersionNumber: ctx.buildVersionNumber,
        siteGenerationId: ctx.siteGenerationId,
        capture: createProductionQaCapture(env, preview.previewUrl, { expectedBuildVersionId: ctx.buildVersionId }),
      }))
    : null;
  const qa = runDeterministicBundleQa({
    bundle,
    blueprint,
    facts,
    formServiceEndpoint,
    siteFormId,
    slotIds: new Set(materializeBlueprintImageSlots(blueprint).map((slot) => slot.id)),
    resolvedSlotIds: new Set(acceptedKeys.keys()),
    renderEvidence: evidence
      ? {
          capturesRendered: evidence.bundle.captures.length,
          mobileCaptured: evidence.bundle.captures.some((cap) => cap.viewportWidth === 390),
          failedRequestCount: evidence.bundle.captures.reduce((sum, cap) => sum + cap.failedRequestCount, 0),
        }
      : null,
  });

  return {
    siteGenerationId: ctx.siteGenerationId,
    siteId: ctx.siteId,
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: ctx.buildVersionNumber,
    previewUrl: preview.previewUrl,
    artifactManifestHash: candidate.artifactManifestHash,
    bundle,
    qa: {
      truthFindings: qa.truthFindings,
      technicalFindings: qa.technicalFindings,
      technicalBlockerCount: qa.technicalBlockerCount,
      gates: qa.gates,
    },
    evidenceCaptures:
      evidence?.bundle.captures.map((cap) => ({
        page: cap.page,
        viewportWidth: cap.viewportWidth,
        artifactR2Key: cap.artifactR2Key,
        hasFirstViewport: cap.hasFirstViewport,
      })) ?? [],
    evidenceArtifactR2Key: evidence?.artifactR2Key ?? null,
  };
}

async function runCapture(env: Env, body: DriverBody) {
  if (!body.facts || !body.referenceUrl) throw new Error("facts and referenceUrl required");
  const ctx = await scaffold(env, body.facts, {
    url: body.referenceUrl,
    ...(body.adaptationContract !== undefined ? { adaptationContract: body.adaptationContract } : {}),
  });
  // STOP after capture: production Reference Capture only (stable intake
  // infrastructure). No blueprint, no images, no build.
  await runReferenceIntake(env, {
    siteGenerationId: ctx.siteGenerationId,
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: ctx.buildVersionNumber,
  });
  const frozen = await getFrozenReferenceEvidence(env, ctx.siteGenerationId);
  if (!frozen) throw new Error("frozen evidence missing after intake");
  return {
    siteGenerationId: ctx.siteGenerationId,
    siteId: ctx.siteId,
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: ctx.buildVersionNumber,
    suitability: frozen.suitability,
    suitabilityReasons: frozen.suitabilityReasons,
    sufficiency: frozen.evidenceSufficiency,
    referenceUrl: frozen.evidence.referenceUrl ?? null,
    canonicalScreenshotR2Key: frozen.canonicalScreenshotR2Key,
    visualInputs: frozen.evidence.visualInputs ?? [],
    regions: frozen.evidence.regions ?? null,
    measuredElements: frozen.evidence.measuredElements ?? null,
    motionObservations: frozen.evidence.motionObservations ?? null,
  };
}

async function runBlueprint(env: Env, body: DriverBody) {  if (!body.siteGenerationId || !body.buildId) throw new Error("siteGenerationId and buildId required");
  const frozen = await getFrozenReferenceEvidence(env, body.siteGenerationId);
  if (!frozen) throw new Error("no frozen evidence for Site Generation — run the capture op first");
  if (frozen.suitability === "UNSUPPORTED") throw new Error(`Reference UNSUPPORTED: ${frozen.suitabilityReasons.join("; ")}`);
  const version = await latestVersion(env, body.buildId);
  const generationRow = await env.DB.prepare(
    "SELECT site_id, onboarding_submission_id FROM site_generations WHERE id = ?"
  )
    .bind(body.siteGenerationId)
    .first<{ site_id: string; onboarding_submission_id: string }>();
  if (!generationRow) throw new Error("Site Generation not found");
  const facts = (await getEffectiveBusinessFacts(env, body.buildId)).facts;
  const businessFactsRef = `onboarding-submission:${generationRow.onboarding_submission_id}#fact-snapshot`;

  // Exactly ONE multimodal semantic call (the boundary owns the single
  // allowed schema correction). HARD STOP after this — images, builder, QA
  // and repair are deliberately NOT wired into this op.
  const produced = await runSimpleDesignBlueprintStage(env, {
    siteGenerationId: body.siteGenerationId,
    buildId: body.buildId,
    buildVersionId: version.id,
    buildVersionNumber: version.versionNumber,
    businessFactsRef,
    replacementBusiness: {
      name: facts.businessName,
      ...(facts.businessType ? { type: facts.businessType } : {}),
      ...(facts.businessDescription ? { description: facts.businessDescription } : {}),
    },
    ...(frozen.evidence.referenceUrl ? { referenceUrl: frozen.evidence.referenceUrl } : {}),
    visualInputs: frozen.evidence.visualInputs ?? [],
  });
  const markdown = renderDesignBlueprintV2Markdown(produced.blueprint);
  return {
    siteGenerationId: body.siteGenerationId,
    buildId: body.buildId,
    buildVersionId: version.id,
    blueprint: produced.blueprint,
    markdown,
    artifactR2Key: produced.artifactR2Key,
    factsRef: businessFactsRef,
    siteId: generationRow.site_id,
  };
}

// Transport probe: times a single RAW zhipu-leg completion (no chain, no
// retries) at a requested max_tokens budget, so the operator gets hard
// numbers on the largest completion the provider edge actually lets through.
// Benchmark instrumentation only — the pipeline never calls this.
async function runTransportProbe(env: Env, body: DriverBody): Promise<unknown> {
  const maxTokens = Math.max(256, Math.min(body.probeMaxTokens ?? 4096, 65536));
  const items = Math.ceil(maxTokens / 12);
  const bodyJson = {
    model: env.LLM_MODEL ?? "glm-5.3-flash",
    messages: [
      {
        role: "system",
        content: "You are a JSON generator. Output ONLY valid JSON, no prose, no markdown.",
      },
      {
        role: "user",
        content: `Output a JSON object {"items":[...]} with exactly ${items} items. Each item: {"i":<index>,"name":"fixture item <index>","tags":["a","b","c"],"description":"A descriptive sentence about fixture item <index> for transport calibration."}. Fill every item; do not truncate.`,
      },
    ],
    temperature: 0.7,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
  };
  const started = Date.now();
  try {
    const response = await callGatewayChat(
      env,
      bodyJson as never,
      { client_slug: "exp-benchmark-probe" } as never,
      "zhipu"
    );
    const text = await response.text();
    const durationMs = Date.now() - started;
    let finishReason: string | null = null;
    let usage: unknown = null;
    let contentChars = 0;
    if (response.ok) {
      try {
        const parsed = JSON.parse(text) as {
          choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
          usage?: unknown;
        };
        finishReason = parsed.choices?.[0]?.finish_reason ?? null;
        contentChars = parsed.choices?.[0]?.message?.content?.length ?? 0;
        usage = parsed.usage ?? null;
      } catch {
        finishReason = "unparseable";
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      durationMs,
      maxTokensRequested: maxTokens,
      finishReason,
      contentChars,
      usage,
      errorHead: response.ok ? null : text.slice(0, 300),
    };
  } catch (error) {
    return { ok: false, thrown: (error as Error).message.slice(0, 300), durationMs: Date.now() - started, maxTokensRequested: maxTokens };
  }
}

// §14 Canary A — zero-business long-text streaming diagnostic (no images, no
// business data, no KIE). Requests a structured output whose natural size
// exceeds the old ~8K non-streaming ceiling; verifies the assembled JSON and
// returns the transport metrics the report requires.
async function runStreamCanaryText(env: Env, body: DriverBody) {
  const targetItems = Math.max(120, Math.min(body.canaryItems ?? 360, 1200));
  const startedAt = Date.now();
  try {
    const result = await canaryStream(env, body.canaryTransport, {
      system: "You are a JSON generator. Output ONLY valid JSON, no prose, no markdown.",
      user: `Output a JSON object {"items":[...]} with exactly ${targetItems} items. Each item: {"i":<index>,"name":"calibration item <index>","tags":["alpha","beta","gamma"],"description":"A full descriptive sentence about calibration item <index> for transport throughput measurement, at least twenty words long, mentioning its place in the sequence and its purpose."}. Fill every item completely; do not truncate the array; close all brackets.`,
      maxTokens: 65_536,
      jsonMode: true,
      label: "canary-a-long-text",
    });
    let items = -1;
    let jsonValid = false;
    try {
      const parsed = JSON.parse(result.content) as { items?: unknown[] };
      items = Array.isArray(parsed.items) ? parsed.items.length : -1;
      jsonValid = items === targetItems;
    } catch {
      jsonValid = false;
    }
    return {
      ok: true,
      durationMs: Date.now() - startedAt,
      ttfbMs: result.ttfbMs,
      streamDurationMs: result.durationMs,
      chunks: result.chunks,
      finishReason: result.finishReason,
      usage: result.usage,
      contentChars: result.content.length,
      targetItems,
      itemsAssembled: items,
      jsonValid,
      crossedOld120sBoundary: result.durationMs > 120_000,
      requestId: result.requestId,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof StreamingTransportExhaustedError ? error.message : (error as Error).message.slice(0, 300),
    };
  }
}

// §15 Canary B — the actual Blueprint transport shape: frozen Morabeza
// Reference screenshot + a small diagnostic instruction, expecting a large
// structured JSON completion via the streaming boundary. NOT the real
// blueprint yet.
async function runStreamCanaryVision(env: Env, body: DriverBody) {
  if (!body.key) return { ok: false, error: "key (R2 image key) required" };
  const obj = await env.SITE_BUCKET.get(body.key);
  if (!obj) return { ok: false, error: "image object not found" };
  const imageBytes = await obj.arrayBuffer();
  const base64 = bytesToBase64(imageBytes);
  const startedAt = Date.now();
  try {
    const result = await canaryStream(env, body.canaryTransport, {
      system: "You are a JSON generator. Output ONLY valid JSON, no prose, no markdown.",
      user: `The attached image is a full-page desktop screenshot of a website (a marketing site). Produce a structural diagnostic as JSON: {"page":{"estimatedWidthPx":<number>,"estimatedHeightPx":<number>},"sections":[{"index":<n>,"title":"<best-guess section title>","surface":"dark|pale|photographic","dominantColor":"<hex estimate>","contentDensity":"low|medium|high","roughViewportHeights":<number>,"notes":"<one sentence>"}]} — include AT LEAST 16 section entries covering the whole page from top to bottom, with detailed notes. Do not truncate.`,
      images: [{ base64, mimeType: "image/png" }],
      maxTokens: 65_536,
      jsonMode: true,
      label: "canary-b-multimodal",
    });
    let sections = -1;
    let jsonValid = false;
    try {
      const parsed = JSON.parse(result.content) as { sections?: unknown[] };
      sections = Array.isArray(parsed.sections) ? parsed.sections.length : -1;
      jsonValid = sections >= 16;
    } catch {
      jsonValid = false;
    }
    return {
      ok: true,
      imageBytes: imageBytes.byteLength,
      durationMs: Date.now() - startedAt,
      ttfbMs: result.ttfbMs,
      streamDurationMs: result.durationMs,
      chunks: result.chunks,
      finishReason: result.finishReason,
      usage: result.usage,
      contentChars: result.content.length,
      sectionsAssembled: sections,
      jsonValid,
      crossedOld120sBoundary: result.durationMs > 120_000,
      requestId: result.requestId,
    };
  } catch (error) {
    return {
      ok: false,
      imageBytes: imageBytes.byteLength,
      durationMs: Date.now() - startedAt,
      error: error instanceof StreamingTransportExhaustedError ? error.message : (error as Error).message.slice(0, 300),
    };
  }
}

// §16 schema canary — ONE cheap text-only streamed call carrying the FINAL
// design-blueprint/1 contract as native response_format=json_schema, asked
// for a deliberately varied SYNTHETIC website (no Reference images, no
// business data). Success = stream completes, provider accepts the schema
// dialect, JSON parses, post-parse design-blueprint/1 validation passes,
// deterministic quality gate passes, and correction calls = 0 (the canary
// has no correction path at all — a single raw boundary call).
async function runSchemaCanary(env: Env, body: DriverBody): Promise<unknown> {
  const startedAt = Date.now();
  const composed = composeStagePrompt("simple-design-blueprint");
  try {
    const result = await generateWorkersAiStreaming(env, {
      system: composed.systemPrompt,
      user: `Produce the Design Blueprint for a REPLACEMENT business: an independent specialist bicycle workshop called "Meridian Cycles" — hand-built steel frames, fitting studio, small curated parts counter, repair bookings by enquiry. The Reference design language to translate (you receive no screenshots in this canary — synthesize from this brief): warm utilitarian workshop aesthetic, pale paper ground with deep forest-green ink mass, one burnt-orange accent used sparingly, chunky slab display type over quiet body sans, hairline rules instead of cards, large workshop photography with generous captions, slow calm motion. ${DESIGN_BLUEPRINT_SCHEMA_VERSION} only; businessFactsRef: "onboarding-submission:canary#fact-snapshot".`,
      maxTokens: 16_384,
      jsonSchema: DESIGN_BLUEPRINT_NATIVE_JSON_SCHEMA,
      label: "schema-canary-text",
    });
    const parsed = parseModelJson(result.content);
    if (!parsed.ok) {
      return {
        ok: false,
        phase: "json_parse",
        parseError: parsed.error,
        durationMs: Date.now() - startedAt,
        ttfbMs: result.ttfbMs,
        streamDurationMs: result.durationMs,
        chunks: result.chunks,
        finishReason: result.finishReason,
        usage: result.usage,
        contentChars: result.content.length,
        correctionCalls: 0,
      };
    }
    const validated = validateDesignBlueprint(parsed.value);
    if (!validated.valid) {
      return {
        ok: false,
        phase: "schema_validation",
        schemaErrors: validated.errors,
        schemaVersion: DESIGN_BLUEPRINT_SCHEMA_VERSION,
        durationMs: Date.now() - startedAt,
        ttfbMs: result.ttfbMs,
        streamDurationMs: result.durationMs,
        chunks: result.chunks,
        finishReason: result.finishReason,
        usage: result.usage,
        contentChars: result.content.length,
        correctionCalls: 0,
      };
    }
    const gate = evaluateBlueprintQualityGate(validated.value);
    return {
      ok: gate.passed,
      phase: gate.passed ? "complete" : "quality_gate",
      schemaVersion: DESIGN_BLUEPRINT_SCHEMA_VERSION,
      schemaValid: true,
      gateFailures: gate.failures,
      durationMs: Date.now() - startedAt,
      ttfbMs: result.ttfbMs,
      streamDurationMs: result.durationMs,
      chunks: result.chunks,
      finishReason: result.finishReason,
      usage: result.usage,
      contentChars: result.content.length,
      designDnaCount: validated.value.designDna.length,
      imageSlotCount: validated.value.imagery.imageSlots.length,
      colorRoleCount: validated.value.tokens.colors.length,
      correctionCalls: 0,
    };
  } catch (error) {
    return {
      ok: false,
      phase: "transport",
      durationMs: Date.now() - startedAt,
      error: error instanceof StreamingTransportExhaustedError ? error.message : (error as Error).message.slice(0, 300),
    };
  }
}

async function runStageRunsQuery(env: Env, body: DriverBody): Promise<unknown> {
  if (!body.buildId) throw new Error("buildId required");
  const stage = "simple-design-blueprint";
  const base = "SELECT stage, run_id, attempt, outcome, model, provider, schema_version, token_usage_json, error_summary, created_at FROM ai_stage_runs WHERE build_id = ?1";
  const rows = body.stage
    ? await env.DB.prepare(`${base} AND stage = ?2 ORDER BY created_at ASC, attempt ASC`).bind(body.buildId, body.stage).all()
    : await env.DB.prepare(`${base} ORDER BY created_at ASC, attempt ASC`).bind(body.buildId).all();
  return { buildId: body.buildId, ...(body.stage ? { stage } : { stage: "all" }), runs: rows.results };
}

// Driver-side real timer sleep. In production the Workflow engine maps the
// orchestration's sleep seam to step.sleep; the driver route has no engine,
// and the seam default is instant — which would burn the bounded poll budget
// in seconds and fail every KIE attempt as a domain timeout. Benchmark
// tooling only; the pipeline's own seam wiring is unchanged.
function driverSleep(_name: string, ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Phase 3 §5: EXACTLY the pipeline's image step (src/simple-design/pipeline.ts
// "simple: images") — frozen blueprint is the prompt authority (no LLM prompt
// stage), expandToTarget false, hard budget gates unchanged. Idempotent via
// accepted-image identity + persisted KIE task ids.
async function runSimpleKie(env: Env, body: DriverBody) {
  if (!body.siteGenerationId || !body.buildId) throw new Error("siteGenerationId and buildId required");
  const version = await latestVersion(env, body.buildId);
  const stored = await getBuildStageArtifact<DesignBlueprint | DesignBlueprintV2>(env, version.id, "design_blueprint");
  if (!stored) throw new Error(`no stored design_blueprint for Build Version ${version.id} — run the blueprint stage first`);
  const blueprint = storedBlueprintToV2(stored.value);

  const slots = materializeBlueprintImageSlots(blueprint);
  const acceptedBefore = await getAcceptedImageMap(env, version.id);
  const unresolved = slots.filter((slot) => !acceptedBefore.has(slot.id));

  const startedAt = Date.now();
  let outcomes: SlotGenerationOutcome[] = [];
  let spendReport: ImageSpendReport | null = null;
  if (unresolved.length > 0) {
    const result = await runImageGenerationDurable(
      env,
      {
        siteGenerationId: body.siteGenerationId,
        buildId: body.buildId,
        buildVersionId: version.id,
        buildVersionNumber: version.versionNumber,
        slots: unresolved,
        provider: new KieV2ImageProvider(env),
        expandToTarget: false,
        promptRecords: materializeBlueprintPromptRecords(blueprint),
      },
      { stepDo: async <T>(_name: string, fn: () => Promise<T>) => fn(), sleep: driverSleep }
    );
    outcomes = result.outcomes;
    spendReport = result.report;
  }
  const durationMs = Date.now() - startedAt;

  const acceptedAfter = await getAcceptedImageMap(env, version.id);
  const attempts = await env.DB.prepare(
    "SELECT slot_id, wave, attempt_number, status, provider_task_id, cost_usd FROM image_attempts WHERE build_version_id = ?1 ORDER BY slot_id, attempt_number"
  )
    .bind(version.id)
    .all();
  return {
    buildId: body.buildId,
    buildVersionId: version.id,
    buildVersionNumber: version.versionNumber,
    model: env.KIE_MODEL,
    plannedSlots: slots.map((slot) => slot.id),
    unresolvedSlots: unresolved.map((slot) => slot.id),
    // Per-slot request provenance, recomputed from the SAME pure planner the
    // adapter renders its provider request from — hashes are byte-identical
    // to what the provider received (GO §13 evidence trail).
    slotProvenance: await Promise.all(
      slots.map(async (slot) => {
        const record = materializeBlueprintPromptRecords(blueprint).find((candidate) => candidate.slotId === slot.id)!;
        const plan = planKieImageRequest(
          {
            slotId: slot.id,
            promptText: record.promptText,
            aspectRatio: slot.orientation === "portrait" ? "9:16" : slot.orientation === "square" ? "1:1" : "16:9",
            compositionAspectRatio: slot.compositionAspectRatio,
            generationAspectRatio: slot.generationAspectRatio,
          },
          env.KIE_MODEL
        );
        return {
          slotId: slot.id,
          model: plan.model,
          profile: plan.profile,
          compositionAspectRatio: plan.compositionAspectRatio,
          generationAspectRatio: plan.generationAspectRatio,
          providerAspectRatio: plan.providerAspectRatio,
          mappingReason: plan.mappingReason,
          screenSafeAdaptationApplied: plan.screenSafeAdaptationApplied,
          matchedScreenTerms: plan.matchedScreenTerms,
          blueprintPromptHash: await sha256Hex(plan.blueprintPrompt),
          effectivePromptHash: await sha256Hex(plan.prompt),
        };
      })
    ),
    outcomes,
    spendReport,
    attempts: attempts.results,
    acceptedImages: [...acceptedAfter].map(([slotId, entry]) => ({ slotId, r2Key: entry.r2Key })),
    acceptedCount: acceptedAfter.size,
    durationMs,
  };
}

// NANO BANANA SUBSTITUTION image validation: a fresh Build Version on the
// SAME frozen Build — the frozen blueprint artifact (source buildVersionId)
// reused byte-exact, never regenerated — then the pipeline's exact image
// step. No Builder, no QA, no repair: pure six-slot provider validation
// under the substituted image model.
async function runSimpleKieValidation(env: Env, body: DriverBody) {
  if (!body.siteGenerationId || !body.buildId || !body.buildVersionId) {
    throw new Error("siteGenerationId, buildId and buildVersionId (frozen blueprint source version) required");
  }
  const frozen = await getBuildStageArtifact<DesignBlueprint>(env, body.buildVersionId, "design_blueprint");
  if (!frozen) throw new Error(`no frozen design_blueprint on source version ${body.buildVersionId}`);
  const created = await createNextBuildVersion(env, {
    buildId: body.buildId,
    cause: body.cause ?? "nano_banana_image_validation",
    detail: body.detail ?? "Nano Banana 2 Lite substitution: fresh six-slot KIE validation on the frozen blueprint",
  });
  await storeBuildStageArtifactIdempotent(env, {
    buildId: body.buildId,
    buildVersionId: created.buildVersionId,
    siteGenerationId: body.siteGenerationId,
    kind: "design_blueprint",
    schemaVersion: "design-blueprint/1",
    value: frozen.value,
  });
  const kie = await runSimpleKie(env, { ...body, buildVersionId: created.buildVersionId });
  return {
    sourceFrozenBlueprintVersionId: body.buildVersionId,
    validationVersionId: created.buildVersionId,
    validationVersionNumber: created.buildVersionNumber,
    ...kie,
  };
}

// NDJSON streaming wrapper for the long full-run: response headers return
// immediately, heartbeat ticks keep client/proxy idle timers fed, and the
// final `done` event carries the same payload as the non-streaming op.
function streamSimpleFullRun(c: Context<{ Bindings: Env }>, body: DriverBody): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (payload: unknown) => writer.write(encoder.encode(JSON.stringify(payload) + "\n"));
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    void send({ event: "tick", elapsedMs: Date.now() - startedAt }).catch(() => {});
  }, 15_000);
  void (async () => {
    try {
      await send({ event: "started", at: new Date().toISOString() });
      const result = await runSimpleFullRun(c.env, body);
      await send({ event: "done", elapsedMs: Date.now() - startedAt, result });
    } catch (error) {
      await send({ event: "error", elapsedMs: Date.now() - startedAt, message: (error as Error).message.slice(0, 500), name: (error as Error).name }).catch(() => {});
    } finally {
      clearInterval(heartbeat);
      await writer.close().catch(() => {});
    }
  })();
  return new Response(readable, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

// Evaluation-integrity re-render: the stored pipeline bundle for a Build
// Version is re-assembled (deterministic), the preview re-verified, fresh
// render evidence captured, deterministic QA re-run, and the visual-QA
// judgement executed against the REAL captures. No builder/repair/KIE call.
async function runSimpleRerenderQa(env: Env, body: DriverBody) {
  const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      throw new Error(`[${label}] ${(error as Error).name}: ${(error as Error).message}`);
    }
  };
  if (!body.siteGenerationId || !body.buildId || !body.buildVersionId) {
    throw new Error("siteGenerationId, buildId and buildVersionId required");
  }
  const stored = await step("load-site-bundle", () => getBuildStageArtifact<SiteBundle>(env, body.buildVersionId!, "site_bundle"));
  if (!stored) throw new Error(`no stored site_bundle for Build Version ${body.buildVersionId}`);
  const bpStored = await step("load-blueprint", () => getBuildStageArtifact<DesignBlueprint | DesignBlueprintV2>(env, body.buildVersionId!, "design_blueprint"));
  if (!bpStored) throw new Error(`no stored design_blueprint for Build Version ${body.buildVersionId}`);
  const blueprint = storedBlueprintToV2(bpStored.value);
  const facts = await step("load-facts", async () => (await getEffectiveBusinessFacts(env, body.buildId!)).facts);
  const versionRow = await step("load-version", () =>
    env.DB.prepare("SELECT version_number FROM build_versions WHERE id = ?1")
      .bind(body.buildVersionId!)
      .first<{ version_number: number }>()
  );
  if (!versionRow) throw new Error(`Build Version ${body.buildVersionId} not found`);
  const generationRow = await step("load-generation", () =>
    env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?1")
      .bind(body.siteGenerationId!)
      .first<{ site_id: string }>()
  );
  if (!generationRow) throw new Error("Site Generation not found");
  const ctx: Scaffold = {
    siteGenerationId: body.siteGenerationId,
    siteId: generationRow.site_id,
    buildId: body.buildId,
    buildVersionId: body.buildVersionId,
    buildVersionNumber: versionRow.version_number,
  };
  const acceptedKeys = await step("load-accepted-images", async () => {
    const acceptedEntries = await getAcceptedImageMap(env, body.buildVersionId!);
    return new Map([...acceptedEntries].map(([slotId, entry]) => [slotId, entry.r2Key] as const));
  });

  const judged = await step("assemble-and-judge", () => assembleAndJudge(env, ctx, stored.value, { blueprint, facts } as DriverBody, acceptedKeys, { skipFreeze: true }));

  // The honest visual-QA judgement on the fresh captures (the original
  // Visual QA 1 judged the workers.dev placeholder page). Explicit R2 keys
  // override the evidence captures when the stored evidence PNGs themselves
  // are known-corrupt (immutable keys cannot be replaced).
  const desktop =
    body.candidateDesktopR2Key ??
    judged.evidenceCaptures.find((cap) => cap.page === "home" && cap.viewportWidth === 1440)?.artifactR2Key;
  const mobile =
    body.candidateMobileR2Key ??
    judged.evidenceCaptures.find((cap) => cap.page === "home" && cap.viewportWidth === 390)?.artifactR2Key;
  if (!desktop) throw new Error("re-render produced no home desktop capture");
  const frozen = await step("load-frozen-evidence", () => getFrozenReferenceEvidence(env, body.siteGenerationId!));
  if (!frozen) throw new Error("frozen reference evidence missing");
  const visualQa = await step("visual-qa", () =>
    runSimpleVisualQaStage(env, {
      siteGenerationId: body.siteGenerationId!,
      buildId: body.buildId!,
      buildVersionId: body.buildVersionId!,
      buildVersionNumber: versionRow.version_number,
      blueprint,
      referenceVisualInputs: frozen.evidence.visualInputs ?? [],
      candidateDesktopR2Key: desktop,
      ...(mobile ? { candidateMobileR2Key: mobile } : {}),
    })
  );
  return {
    ...judged,
    siteBundleArtifactR2Key: stored.artifactR2Key,
    candidateDesktopR2Key: desktop,
    ...(mobile ? { candidateMobileR2Key: mobile } : {}),
    visualQa: visualQa.report,
  };
}

// Phase 3 §7-23: the FULL sanctioned SIMPLE pipeline. Capture, blueprint and
// KIE reuse inside the pipeline make repeated invocation idempotent; this run
// executes builder → assemble → QA → (at most ONE repair) → final QA exactly
// as production would, then returns read-only provenance for the report.
async function runSimpleFullRun(env: Env, body: DriverBody) {  if (!body.siteGenerationId) throw new Error("siteGenerationId required");
  // FOUR-PAGE HERO REGRESSION (operator GO, 2026-09-09 §18): freshVersion
  // creates a NEW Build Version carrying NO artifacts — the frozen reference
  // evidence is reused by the pipeline's idempotent intake, but the blueprint
  // stage generates FRESH under the changed contract (hero media) and the
  // image step runs fresh KIE for every slot. The frozen blueprint artifact
  // is never reused in this mode.
  let buildId = body.buildId;
  if (buildId && body.freshVersion) {
    // The pipeline selects the LATEST version of the build — the version
    // created here (carrying no artifacts) is therefore the one it runs.
    const created = await createNextBuildVersion(env, {
      buildId,
      cause: body.cause ?? "four_page_hero_regression",
      detail: body.detail ?? "Four-page hero regression: fresh blueprint (hero-media contract), fresh KIE, fresh build on the frozen reference/facts",
    });
    // Optionally seed the new version with an ALREADY gate-passed
    // fresh-contract blueprint (deterministic re-run of the image/build
    // stages without re-rolling the blueprint generator).
    if (body.copyBlueprintFromBuildVersionId) {
      const sourceBlueprint = await getBuildStageArtifact<DesignBlueprint>(env, body.copyBlueprintFromBuildVersionId, "design_blueprint");
      if (!sourceBlueprint) throw new Error(`no design_blueprint on source version ${body.copyBlueprintFromBuildVersionId}`);
      const gate = evaluateBlueprintQualityGateAny(sourceBlueprint.value);
      if (!gate.passed) throw new Error(`source blueprint fails the hero-media quality gate: ${gate.failures.join("; ")}`);
      await storeBuildStageArtifactIdempotent(env, {
        buildId,
        buildVersionId: created.buildVersionId,
        siteGenerationId: body.siteGenerationId,
        kind: "design_blueprint",
        schemaVersion: "design-blueprint/1",
        value: sourceBlueprint.value,
      });
    }
    // Optionally inherit accepted images EXCEPT the listed slots — a bounded
    // ONE-slot stochastic retry: the excluded slot regenerates fresh through
    // the pipeline's image step (same prompt authority, no semantic edit).
    if (body.copyBlueprintFromBuildVersionId && body.inheritAcceptedImagesExceptSlotIds !== undefined) {
      const excluded = new Set(body.inheritAcceptedImagesExceptSlotIds);
      const rows = await env.DB.prepare(
        "SELECT slot_id, attempt_id, r2_key FROM accepted_images WHERE build_version_id = ?1"
      )
        .bind(body.copyBlueprintFromBuildVersionId)
        .all<{ slot_id: string; attempt_id: string; r2_key: string }>();
      for (const row of rows.results) {
        if (excluded.has(row.slot_id)) continue;
        await env.DB.prepare(
          `INSERT INTO accepted_images (build_version_id, slot_id, attempt_id, r2_key, accepted_at)
           VALUES (?1, ?2, ?3, ?4, datetime('now'))
           ON CONFLICT (build_version_id, slot_id) DO NOTHING`
        )
          .bind(created.buildVersionId, row.slot_id, row.attempt_id, row.r2_key)
          .run();
      }
    }
  }
  const startedAt = Date.now();
  const outcome = await runSimpleBuildPipeline(env, {
    siteGenerationId: body.siteGenerationId,
    buildId,
    deps: { sleep: driverSleep },
  });
  const durationMs = Date.now() - startedAt;

  const versions = await env.DB.prepare(
    "SELECT id, version_number, created_at FROM build_versions WHERE build_id = ?1 ORDER BY version_number"
  )
    .bind(outcome.buildId)
    .all();
  const artifacts = await env.DB.prepare(
    "SELECT build_version_id, kind, subkey, artifact_r2_key, created_at FROM build_stage_artifacts WHERE build_id = ?1 ORDER BY created_at"
  )
    .bind(outcome.buildId)
    .all();
  const stageRuns = await env.DB.prepare(
    "SELECT stage, run_id, attempt, outcome, model, provider, schema_version, token_usage_json, error_summary, created_at FROM ai_stage_runs WHERE build_id = ?1 ORDER BY created_at, attempt"
  )
    .bind(outcome.buildId)
    .all();
  const imageAttempts = await env.DB.prepare(
    "SELECT slot_id, wave, attempt_number, status, provider_task_id, cost_usd FROM image_attempts WHERE build_id = ?1 ORDER BY slot_id, attempt_number"
  )
    .bind(outcome.buildId)
    .all();

  return {
    durationMs,
    outcome,
    versions: versions.results,
    artifacts: artifacts.results,
    stageRuns: stageRuns.results,
    imageAttempts: imageAttempts.results,
  };
}

// NDJSON streaming wrapper (same contract as streamSimpleFullRun) for the
// final hardening benchmark run.
function streamSimpleHardeningRun(c: Context<{ Bindings: Env }>, body: DriverBody): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (payload: unknown) => writer.write(encoder.encode(JSON.stringify(payload) + "\n"));
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    void send({ event: "tick", elapsedMs: Date.now() - startedAt }).catch(() => {});
  }, 15_000);
  void (async () => {
    try {
      await send({ event: "started", at: new Date().toISOString() });
      const result = await runSimpleHardeningRun(c.env, body);
      await send({ event: "done", elapsedMs: Date.now() - startedAt, result });
    } catch (error) {
      await send({ event: "error", elapsedMs: Date.now() - startedAt, message: (error as Error).message.slice(0, 500), name: (error as Error).name }).catch(() => {});
    } finally {
      clearInterval(heartbeat);
      await writer.close().catch(() => {});
    }
  })();
  return new Response(readable, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

// Final hardening benchmark (operator brief, 2026-09-09): a fresh Build
// Version on the SAME frozen Build/Site Generation — the frozen reference
// capture, facts and blueprint artifact all reuse byte-exact (never
// regenerated) — then runSimpleBuildPipeline executes the sanctioned
// pipeline on that version: fresh KIE under the text-safe photo policy,
// streamed builder, assemble, marker-gated capture, QA, and at most ONE
// changed-files repair.
async function runSimpleHardeningRun(env: Env, body: DriverBody) {
  if (!body.siteGenerationId || !body.buildId || !body.buildVersionId) {
    throw new Error("siteGenerationId, buildId and buildVersionId (frozen blueprint source version) required");
  }
  const startedAt = Date.now();
  const frozen = await getBuildStageArtifact<DesignBlueprint>(env, body.buildVersionId, "design_blueprint");
  if (!frozen) throw new Error(`no frozen design_blueprint on source version ${body.buildVersionId}`);
  // Stream-drop resume: reuse THIS benchmark version instead of stacking a
  // fresh one. REFUSED loudly unless it is still the build's latest version —
  // a newer version means a repair already chained past it, and resuming
  // would re-run the builder on the repair version (the disclosed
  // resume-chaining hazard). That state requires an operator decision.
  let created: { buildVersionId: string; buildVersionNumber: number };
  if (body.resumeBenchmarkVersionId) {
    const row = await env.DB.prepare(
      "SELECT id, version_number FROM build_versions WHERE id = ?1 AND build_id = ?2"
    )
      .bind(body.resumeBenchmarkVersionId, body.buildId)
      .first<{ id: string; version_number: number }>();
    if (!row) throw new Error(`resumeBenchmarkVersionId ${body.resumeBenchmarkVersionId} not found on build ${body.buildId}`);
    const latest = await latestVersion(env, body.buildId);
    if (latest.id !== row.id) {
      throw new Error(
        `resume refused: benchmark version ${row.id} (v${row.version_number}) is no longer latest (latest ${latest.id} v${latest.versionNumber}) — a newer version exists; operator decision required`
      );
    }
    created = { buildVersionId: row.id, buildVersionNumber: row.version_number };
  } else {
    created = await createNextBuildVersion(env, {
      buildId: body.buildId,
      cause: body.cause ?? "simple_hardening_benchmark",
      detail: body.detail ??
        "Final hardening benchmark: fresh KIE (text-safe policy) + fresh build on the frozen blueprint/reference/facts",
    });
  }
  await storeBuildStageArtifactIdempotent(env, {
    buildId: body.buildId,
    buildVersionId: created.buildVersionId,
    siteGenerationId: body.siteGenerationId,
    kind: "design_blueprint",
    schemaVersion: "design-blueprint/1",
    value: frozen.value,
  });
  // NANO BANANA SUBSTITUTION (operator GO, 2026-09-09 §18): the final website
  // benchmark runs on EXACTLY the Accepted Images the six-slot validation
  // approved — the validated attempts are inherited onto the benchmark
  // version (idempotent copy of the immutable accepted_images rows), so the
  // pipeline's image step finds no unresolved slots and issues NO fresh KIE
  // calls. No validated image is regenerated or replaced.
  let inheritedAcceptedImages = 0;
  if (body.inheritAcceptedImagesFromBuildVersionId) {
    const inserted = await env.DB.prepare(
      `INSERT INTO accepted_images (build_version_id, slot_id, attempt_id, r2_key, accepted_at)
       SELECT ?1, slot_id, attempt_id, r2_key, datetime('now')
       FROM accepted_images WHERE build_version_id = ?2
       ON CONFLICT (build_version_id, slot_id) DO NOTHING`
    )
      .bind(created.buildVersionId, body.inheritAcceptedImagesFromBuildVersionId)
      .run();
    inheritedAcceptedImages = inserted.meta.changes ?? 0;
  }
  const outcome = await runSimpleBuildPipeline(env, {
    siteGenerationId: body.siteGenerationId,
    buildId: body.buildId,
    deps: { sleep: driverSleep },
  });
  const durationMs = Date.now() - startedAt;
  const versions = await env.DB.prepare(
    "SELECT id, version_number, created_at FROM build_versions WHERE build_id = ?1 ORDER BY version_number"
  )
    .bind(outcome.buildId)
    .all();
  const artifacts = await env.DB.prepare(
    "SELECT build_version_id, kind, subkey, artifact_r2_key, created_at FROM build_stage_artifacts WHERE build_id = ?1 ORDER BY created_at"
  )
    .bind(outcome.buildId)
    .all();
  const stageRuns = await env.DB.prepare(
    "SELECT stage, run_id, attempt, outcome, model, provider, schema_version, token_usage_json, error_summary, created_at FROM ai_stage_runs WHERE build_id = ?1 ORDER BY created_at, attempt"
  )
    .bind(outcome.buildId)
    .all();
  const imageAttempts = await env.DB.prepare(
    "SELECT slot_id, wave, attempt_number, status, provider_task_id, cost_usd, build_version_id FROM image_attempts WHERE build_id = ?1 ORDER BY slot_id, attempt_number"
  )
    .bind(outcome.buildId)
    .all();
  return {
    durationMs,
    sourceFrozenBlueprintVersionId: body.buildVersionId,
    benchmarkVersionId: created.buildVersionId,
    benchmarkVersionNumber: created.buildVersionNumber,
    inheritedAcceptedImages,
    outcome,
    versions: versions.results,
    artifacts: artifacts.results,
    stageRuns: stageRuns.results,
    imageAttempts: imageAttempts.results,
  };
}
