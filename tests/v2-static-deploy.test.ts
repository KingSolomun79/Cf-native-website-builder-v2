import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { deployPreview, type AssembledCandidate } from "../src/domain/assembly";
import { createStaticAssetsWorker } from "../src/lib/publish";

// Security regression tests for the V2 assets-only deploy path (CSO H1).
// The production default preview deployer must ship ONLY static assets: no
// contact-worker script, no SMTP2GO (or any) secret binding, no main module.

const env = {
  ...(providedEnv as unknown as Env),
  CF_ACCOUNT_ID: "test-account",
  CF_DEPLOY_API_TOKEN: "test-deploy-token",
} as Env;

function candidate(hash = "deadbeefdeadbeef"): AssembledCandidate {
  return {
    pages: { home: "<!DOCTYPE html><html><body>ok</body></html>" },
    sharedCss: "body{}",
    sharedJs: "",
    files: new Map([
      ["index.html", new TextEncoder().encode("<!DOCTYPE html><html><body>ok</body></html>")],
      ["site.css", new TextEncoder().encode("body{}")],
    ]),
    artifactManifestHash: hash,
    manifestR2Key: "builds/test/manifest.json",
    routingNotes: [],
  };
}

interface CapturedCall {
  url: string;
  method: string;
  body?: string;
}

function stubCloudflareApi(): { calls: CapturedCall[]; versionPayloads: Array<Record<string, unknown>> } {
  const calls: CapturedCall[] = [];
  const versionPayloads: Array<Record<string, unknown>> = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method, body });

    if (url.includes("/assets-upload-session")) {
      return Response.json({ success: true, result: { jwt: "upload-complete-jwt", buckets: [] } });
    }
    if (url.endsWith("/workers/workers") && method === "POST") {
      return Response.json({ success: true, result: { id: "worker-1" } });
    }
    if (url.includes("/workers/workers/worker-1/versions")) {
      if (body) versionPayloads.push(JSON.parse(body) as Record<string, unknown>);
      return Response.json({ success: true, result: { id: "version-1" } });
    }
    if (url.includes("/deployments")) {
      return Response.json({ success: true });
    }
    if (url.includes("/workers/subdomain")) {
      if (method === "POST") return Response.json({ success: true });
      return Response.json({ success: true, result: { subdomain: "wazibizwebsites" } });
    }
    if (url.includes(".workers.dev/")) {
      return new Response("ok", { status: 200 });
    }
    return Response.json({ success: false, errors: [{ code: 0, message: `unexpected ${method} ${url}` }] });
  });
  vi.stubGlobal("fetch", fetchStub);
  return { calls, versionPayloads };
}

async function newBuildContext(): Promise<{ buildId: string; buildVersionId: string }> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Rift Valley Roasters", contactEmail: "hi@rvr.example" },
      reference: { screenshotR2Key: `references/uploads/deploy-${Math.random().toString(36).slice(2)}.png` },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { buildId: created.buildId, buildVersionId: created.buildVersionId };
}

describe("V2 assets-only deploy path (CSO H1 regression)", () => {
  beforeEach(() => {
    stubCloudflareApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a Worker version with assets only: no modules, no bindings, no secrets", async () => {
    const { versionPayloads } = stubCloudflareApi();
    await createStaticAssetsWorker(env, "b-static-test-v1", "upload-complete-jwt");

    expect(versionPayloads).toHaveLength(1);
    const payload = versionPayloads[0];
    expect(payload.assets).toEqual({ jwt: "upload-complete-jwt", config: {} });
    expect("bindings" in payload).toBe(false);
    expect("modules" in payload).toBe(false);
    expect("main_module" in payload).toBe(false);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("SMTP2GO");
    expect(serialized).not.toContain("secret_text");
    expect(serialized).not.toContain("contact");
  });

  it("default preview deployer ships only static assets and records the exact manifest hash", async () => {
    const { calls, versionPayloads } = stubCloudflareApi();
    const context = await newBuildContext();

    const deployment = await deployPreview(env, {
      buildId: context.buildId,
      buildVersionId: context.buildVersionId,
      buildVersionNumber: 1,
      candidate: candidate(),
    });

    expect(deployment.alreadyActive).toBe(false);
    expect(deployment.previewUrl).toContain(".wazibizwebsites.workers.dev");
    expect(deployment.artifactManifestHash).toBe("deadbeefdeadbeef");

    // One assets-only version was created for the deployed files.
    expect(versionPayloads).toHaveLength(1);
    const serialized = JSON.stringify(versionPayloads[0]);
    expect(serialized).not.toContain("SMTP2GO");
    expect(serialized).not.toContain("contact");
    expect(versionPayloads[0].assets).toEqual({ jwt: "upload-complete-jwt", config: {} });

    // The deployment row pins the exact candidate hash.
    const row = await env.DB.prepare("SELECT * FROM build_deployments WHERE id = ?")
      .bind(deployment.deploymentId)
      .first<{ role: string; status: string; artifact_manifest_hash: string; preview_url: string }>();
    expect(row!.role).toBe("preview");
    expect(row!.status).toBe("active");
    expect(row!.artifact_manifest_hash).toBe("deadbeefdeadbeef");
    expect(row!.preview_url).toBe(deployment.previewUrl);

    // No per-site secret propagation anywhere in the deploy call sequence.
    const allBodies = calls.map((call) => call.body ?? "").join("\n");
    expect(allBodies).not.toContain("SMTP2GO");
    expect(allBodies).not.toContain("secret_text");
  });
});
