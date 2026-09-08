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
import { startSiteGeneration, createInitialBuild } from "../domain/lifecycle";
import { getEffectiveBusinessFacts } from "../domain/revision";
import { runReferenceIntake, getFrozenReferenceEvidence } from "../domain/reference-intake";
import { putObject } from "../lib/assets";
import { getAcceptedImageMap } from "../domain/image-pipeline";
import { buildAssembledCandidate, deployPreview, freezeAssembledCandidate, AssemblyPreflightError } from "../domain/assembly";
import { storeBuildStageArtifactIdempotent, getBuildStageArtifact } from "../domain/stage-artifacts";
import { buildStandardEvidenceBundle } from "../domain/qa-evidence";
import { createProductionQaCapture } from "../domain/qa-capture";
import { runSimpleWebsiteBuilderStage, runSimpleBuilderTransportDiagnostic } from "../simple-design/website-builder";
import { runSimpleDesignBlueprintStage } from "../simple-design/design-blueprint";
import { renderDesignBlueprintMarkdown } from "../simple-design/render-blueprint";
import { runDeterministicBundleQa } from "../simple-design/bundle-qa";
import { blueprintSlotsToImageSlots, type DesignBlueprint, type SiteBundle } from "../simple-design/contracts";
import type { BusinessFacts } from "../domain/lifecycle-schema";

interface DriverFixtureImage {
  slotId: string;
  base64: string;
}

interface DriverBody {
  op: "health" | "put-fixture" | "finch-builder" | "builder-diagnostic" | "assemble-stored" | "capture" | "blueprint" | "artifact" | "probe";
  key?: string;
  base64?: string;
  facts?: BusinessFacts;
  blueprint?: DesignBlueprint;
  fixtureImages?: DriverFixtureImage[];
  referenceUrl?: string;
  referenceScreenshotKey?: string;
  adaptationContract?: unknown;
  siteGenerationId?: string;
  buildId?: string;
  buildVersionId?: string;
  probeMaxTokens?: number;
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
    blueprint: body.blueprint,
    facts: body.facts,
    acceptedImages: body.blueprint.imagery.imageSlots.map((slot) => ({
      slotId: slot.id,
      altText: slot.altText,
      aspectRatio: slot.aspectRatio,
      page: slot.page,
      ...(slot.section ? { section: slot.section } : {}),
    })),
    formServiceEndpoint,
    siteFormId,
    visualInputs: [
      { kind: "full-page", artifact: referenceScreenshotKey, sha256: "exp-fixture", width: 1440, height: 3200 } as const,
    ],
  };
  const built = await runSimpleWebsiteBuilderStage(env, stageInput);
  const result = await assembleAndJudge(env, ctx, built.bundle, body, acceptedKeys);
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
    blueprint: body.blueprint,
    facts: body.facts,
    acceptedImages: body.blueprint.imagery.imageSlots.map((slot) => ({
      slotId: slot.id,
      altText: slot.altText,
      aspectRatio: slot.aspectRatio,
      page: slot.page,
      ...(slot.section ? { section: slot.section } : {}),
    })),
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
    const result = await assembleAndJudge(env, ctx, cleanBundle, body, acceptedKeys);
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
  acceptedKeys: Map<string, string>
) {
  const blueprint = body.blueprint!;
  const facts = body.facts!;
  const formServiceEndpoint = `${env.PUBLIC_APP_URL}/api/v2/forms/submit`;
  const siteFormId = `site:${ctx.siteId}`;

  // Deterministic assembly + Technical Preflight + preview, exactly as the
  // pipeline does it (KEEP-list path).
  const acceptedEntries = await getAcceptedImageMap(env, ctx.buildVersionId);
  const acceptedImages = new Map([...acceptedEntries].map(([slotId, entry]) => [slotId, entry.r2Key] as const));
  const candidate = await buildAssembledCandidate(env, {
    siteGenerationId: ctx.siteGenerationId,
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: ctx.buildVersionNumber,
    pages: bundle.pages,
    sharedCss: bundle.sharedCss,
    sharedJs: bundle.sharedJs,
    imagePlanSlots: blueprintSlotsToImageSlots(blueprint),
    acceptedImages,
    formServiceEndpoint,
    expectedSiteFormId: siteFormId,
  });
  await freezeAssembledCandidate(env, {
    siteGenerationId: ctx.siteGenerationId,
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: ctx.buildVersionNumber,
    pages: bundle.pages,
    sharedCss: bundle.sharedCss,
    sharedJs: bundle.sharedJs,
    candidate,
    imagePlanSlots: blueprintSlotsToImageSlots(blueprint),
    acceptedImages,
    formServiceEndpoint,
    expectedSiteFormId: siteFormId,
  });
  const preview = await deployPreview(env, {
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: ctx.buildVersionNumber,
    candidate,
  });

  // Standard render evidence (real browser captures of the preview) + the
  // deterministic truth/technical contract.
  const evidence = preview.previewUrl
    ? await buildStandardEvidenceBundle(env, {
        buildId: ctx.buildId,
        buildVersionId: ctx.buildVersionId,
        buildVersionNumber: ctx.buildVersionNumber,
        siteGenerationId: ctx.siteGenerationId,
        capture: createProductionQaCapture(env, preview.previewUrl),
      })
    : null;
  const qa = runDeterministicBundleQa({
    bundle,
    blueprint,
    facts,
    formServiceEndpoint,
    siteFormId,
    slotIds: new Set(blueprint.imagery.imageSlots.map((slot) => slot.id)),
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
  const markdown = renderDesignBlueprintMarkdown(produced.blueprint);
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
