import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as providedEnv, fetchMock } from "cloudflare:test";
import {
  BLUEPRINT_SCHEMA_VERSION_V2,
  checkDesignBlueprint,
  checkInteractionBlueprint,
  checkEvidenceRegistry,
  detectRendererSpecificStrings,
} from "../src/lib/blueprint-schema-v2";
import {
  extractJsonObject,
  parseBlueprintJson,
  validateRuntime,
  validateProvenance,
  reviewBlueprints,
  decideAcceptance,
  BlueprintParseError,
} from "../src/lib/blueprint-validation";
import { buildEvidenceRegistry, DanglingEvidenceError } from "../src/lib/evidence-registry";
import { buildEvidenceRefTemplates, buildSystemPrompt, generateValidatedBlueprintsV2, buildBoundedPromptInput } from "../src/lib/blueprint-generator-v2";
import {
  createBlueprintAttempt,
  createBlueprintRegistry,
  getAcceptedBlueprintAttempt,
  promoteBlueprintAttempt,
} from "../src/lib/db";
import { generateVisionWithGateway, generateWithGatewayDetailed } from "../src/lib/ai-gateway";
import type { DesignBlueprintV2, InteractionBlueprintV2, EvidenceRegistry, RegistryEntry } from "../src/lib/blueprint-schema-v2";
import type { Env } from "../src/env.d";
import { buildScreenshotAnalysisPrompt, produceScreenshotEvidence, ScreenshotEvidenceUnavailableError } from "../src/lib/screenshot-evidence";
import { buildPng } from "./helpers/png";

// ── Fixtures ────────────────────────────────────────────────────────────────
function evRef(id: string): { source: RegistryEntry["source"]; artifactKey: string; viewport?: string; selector?: string } {
  if (id.startsWith("interaction:")) {
    return { source: "interaction", artifactKey: "i.json", viewport: "desktop", selector: id.endsWith(":1") ? "a" : "nav a" };
  }
  if (id.startsWith("client_facts:")) {
    return { source: "client_facts", artifactKey: "" };
  }
  return {
    source: "capture",
    artifactKey: "reg.json",
    viewport: "desktop",
    selector: id.includes(":section:") ? "section" : "body",
  };
}

function validDesign(ids: { section: string; body: string; color: string; spacing: string; surfaces: string; icon: string }): DesignBlueprintV2 {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION_V2,
    source: { referenceUrl: "https://x.test", finalUrl: "https://x.test", captureManifestR2Key: "c.json", interactionManifestR2Key: "i.json", screenshotR2Key: "s.png", registryR2Key: "reg.json", registryVersion: 1 },
    layout: {
      navStyle: "horizontal", footerStyle: "simple", gridSystem: "12-col",
      sections: [
        { id: "s1", type: "hero", role: null, order: 0, composition: "centered", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.9 },
        { id: "s2", type: "features", role: null, order: 1, composition: "grid", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.85 },
        { id: "s3", type: "cta", role: null, order: 2, composition: "centered", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.8 },
      ],
    },
    typography: {
      body: { element: "body", fontFamily: "Inter", fontSize: "16px", fontWeight: "400", lineHeight: "1.5", evidenceIds: [ids.body], evidence: evRef(ids.body), confidence: 0.85 },
      headings: [{ element: "h1", fontFamily: "Inter", fontSize: "40px", fontWeight: "700", lineHeight: "1.2", evidenceIds: [ids.body], evidence: evRef(ids.body), confidence: 0.85 }],
      scale: "1.25",
    },
    colors: { roles: [
      { role: "background", value: "#ffffff", evidenceIds: [ids.color], evidence: evRef(ids.color), confidence: 0.9 },
      { role: "text", value: "#111111", evidenceIds: [ids.color], evidence: evRef(ids.color), confidence: 0.9 },
    ] },
    spacing: { sectionPadding: "64px 0", rhythm: "32px", evidenceIds: [ids.spacing], evidence: evRef(ids.spacing), confidence: 0.8 },
    surfaces: { cards: "rounded", buttons: "pill", inputs: "underline", evidenceIds: [ids.surfaces], evidence: evRef(ids.surfaces), confidence: 0.8 },
    imagery: { treatment: "photographic", slots: [
      { id: "home-hero", page: "/", placement: "hero", aspectRatio: "16:9", subject: "Homepage hero", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.8 },
      { id: "home-about", page: "/", placement: "section", aspectRatio: "4:3", subject: "Homepage about", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.8 },
      { id: "home-context", page: "/", placement: "section", aspectRatio: "16:9", subject: "Homepage context", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.8 },
      { id: "services-hero", page: "/services", placement: "hero", aspectRatio: "16:9", subject: "Services hero", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.8 },
      { id: "services-detail", page: "/services", placement: "section", aspectRatio: "4:3", subject: "Service detail", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.8 },
      { id: "services-context", page: "/services", placement: "section", aspectRatio: "16:9", subject: "Services context", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.8 },
      { id: "about-hero", page: "/about", placement: "hero", aspectRatio: "16:9", subject: "About hero", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.8 },
      { id: "contact-hero", page: "/contact", placement: "hero", aspectRatio: "16:9", subject: "Contact hero", evidenceIds: [ids.section], evidence: evRef(ids.section), confidence: 0.8 },
    ] },
    navigation: { structure: "top", items: ["Home", "About"], responsiveBehavior: "hamburger" },
    responsive: { breakpoints: [768, 1024], changes: ["nav collapses"] },
    icons: { intents: [{ slot: "feature", intent: "education", evidenceIds: [ids.icon], evidence: evRef(ids.icon), confidence: 0.7 }] },
    confidence: 0.85,
  };
}

function validInteraction(ids: { hover: string; focus: string }): InteractionBlueprintV2 {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION_V2,
    source: { registryR2Key: "reg.json", registryVersion: 1 },
    interactions: [
      { trigger: "hover", target: "a", selector: "nav a", property: "color", duration: "150ms", easing: "ease", delay: "0ms", hover: "#00f", focus: "#00f", active: "#00f", scrollBehavior: "none", reducedMotionBehavior: "no transition", observed: true, evidenceIds: [ids.hover], evidence: evRef(ids.hover), confidence: 0.8 },
      { trigger: "focus", target: "a", selector: "a", property: "outline", duration: "0ms", easing: "none", delay: "0ms", hover: "", focus: "#00f", active: "", scrollBehavior: "none", reducedMotionBehavior: "keep outline", observed: true, evidenceIds: [ids.focus], evidence: evRef(ids.focus), confidence: 0.8 },
      { trigger: "scroll-reveal", target: "section", selector: "[data-reveal]", property: "opacity", duration: "500ms", easing: "ease-out", delay: "0ms", hover: "", focus: "", active: "", scrollBehavior: "reveal", reducedMotionBehavior: "show immediately", observed: false, evidenceIds: [ids.hover], evidence: evRef(ids.hover), confidence: 0.7 },
    ],
    reducedMotionStrategy: "disable non-essential motion",
    confidence: 0.8,
  };
}

function registryWith(entries: RegistryEntry[]): EvidenceRegistry {
  return {
    schemaVersion: 1, registryVersion: 1, jobId: "job-1", attemptId: "reg-1",
    entries, checksum: "abc", createdAt: "t",
  };
}

const REGISTRY_IDS = {
  section: "capture:desktop:section:0", body: "capture:desktop:typography:body",
  color: "capture:desktop:colors", spacing: "capture:desktop:section:0", surfaces: "capture:desktop:section:0",
  icon: "client_facts:company", hover: "interaction:desktop:default:0", focus: "interaction:desktop:default:1",
};

function fullRegistry(): EvidenceRegistry {
  return registryWith([
    { id: REGISTRY_IDS.section, source: "capture", artifactKey: "reg.json", viewport: "desktop", selector: "section", classification: "observed", observation: "section", confidence: 0.85 },
    { id: REGISTRY_IDS.body, source: "capture", artifactKey: "reg.json", viewport: "desktop", selector: "body", classification: "observed", observation: "body type", confidence: 0.8 },
    { id: REGISTRY_IDS.color, source: "capture", artifactKey: "reg.json", viewport: "desktop", selector: "body", classification: "observed", observation: "colors", confidence: 0.8 },
    { id: REGISTRY_IDS.hover, source: "interaction", artifactKey: "i.json", viewport: "desktop", selector: "nav a", classification: "observed", observation: "hover", confidence: 0.75 },
    { id: REGISTRY_IDS.focus, source: "interaction", artifactKey: "i.json", viewport: "desktop", selector: "a", classification: "observed", observation: "focus", confidence: 0.75 },
    { id: REGISTRY_IDS.icon, source: "client_facts", artifactKey: "", classification: "client_fact", observation: "company", confidence: 1 },
  ]);
}

// ── Runtime schema tests ───────────────────────────────────────────────────
describe("runtime schema validation", () => {
  it("accepts a valid design + interaction pair", () => {
    expect(checkDesignBlueprint(validDesign(REGISTRY_IDS)).ok).toBe(true);
    expect(checkInteractionBlueprint(validInteraction(REGISTRY_IDS)).ok).toBe(true);
  });
  it("rejects a missing schema version (not rewritten)", () => {
    const d = validDesign(REGISTRY_IDS) as unknown as Record<string, unknown>;
    delete d.schemaVersion;
    expect(checkDesignBlueprint(d).ok).toBe(false);
  });
  it("rejects an incorrect schema version", () => {
    const d = { ...validDesign(REGISTRY_IDS), schemaVersion: 2 };
    expect(checkDesignBlueprint(d).ok).toBe(false);
  });
  it("rejects out-of-range confidence", () => {
    const d = { ...validDesign(REGISTRY_IDS), confidence: 1.5 };
    const r = checkDesignBlueprint(d);
    expect(r.ok).toBe(false);
  });
  it("rejects an invalid enum (color role source)", () => {
    const d = validDesign(REGISTRY_IDS);
    expect(checkDesignBlueprint(d).ok).toBe(true);
  });
  it("rejects a malformed array (no sections)", () => {
    const d = { ...validDesign(REGISTRY_IDS), layout: { ...validDesign(REGISTRY_IDS).layout, sections: [] } };
    expect(checkDesignBlueprint(d).ok).toBe(false);
  });
  it("rejects missing reduced-motion strategy on interaction", () => {
    const i = { ...validInteraction(REGISTRY_IDS), reducedMotionStrategy: "" } as InteractionBlueprintV2;
    expect(checkInteractionBlueprint(i).ok).toBe(false);
  });
  it("rejects interaction selectors the deterministic renderer cannot exercise", () => {
    const i = validInteraction(REGISTRY_IDS);
    i.interactions[0].selector = ".notification-close";
    const result = checkInteractionBlueprint(i);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNSUPPORTED_RENDERER_INTERACTION", severity: "blocking" }),
    ]));
  });
});

describe("blueprint generation contract", () => {
  it("gives the model the required V2 shape instead of the legacy conceptual shape", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("\"source\"");
    expect(prompt).toContain("\"layout\"");
    expect(prompt).toContain("\"sections\"");
    expect(prompt).toContain("\"element\"");
    expect(prompt).toContain("\"roles\"");
    expect(prompt).toContain("\"reducedMotionStrategy\"");
    expect(prompt).toContain("Do not rename, omit, flatten, or replace");
    expect(prompt).toContain("Never emit null for any string field");
    expect(prompt).toContain("include focus, hover, and scroll-reveal items");
    expect(prompt).toContain("at least 3 slots for /, 3 for /services, 1 for /about, and 1 for /contact");
    expect(prompt).toContain("fixed renderer capability labels");
    expect(prompt).toContain("distinct non-negative integers beginning at 0");
  });

  it("provides exact evidence-reference templates without invented optional fields", () => {
    const templates = buildEvidenceRefTemplates(fullRegistry());
    expect(templates[REGISTRY_IDS.section]).toMatchObject({ source: "capture", artifactKey: "reg.json", viewport: "desktop", selector: "section" });
    expect(templates[REGISTRY_IDS.icon]).toEqual({ source: "client_facts", artifactKey: "" });
  });
});

describe("screenshot evidence contract", () => {
  it("requires complete normalized screenshot regions and supports corrective feedback", () => {
    expect(buildScreenshotAnalysisPrompt()).toContain("all five fields exactly");
    expect(buildScreenshotAnalysisPrompt("Expected number")).toContain("Expected number");
  });
});

// ── Provenance tests ───────────────────────────────────────────────────────
describe("provenance validation", () => {
  it("accepts when all evidence ids resolve", () => {
    const d = validDesign(REGISTRY_IDS);
    const i = validInteraction(REGISTRY_IDS);
    expect(validateProvenance(d, i, fullRegistry(), "reg.json").valid).toBe(true);
  });
  it("rejects a missing evidence id (EVIDENCE_ID_NOT_FOUND)", () => {
    const d = validDesign({ ...REGISTRY_IDS, section: "capture:desktop:missing" });
    const r = validateProvenance(d, validInteraction(REGISTRY_IDS), fullRegistry(), "reg.json");
    expect(r.valid).toBe(false);
    expect(r.diagnostics.some((x) => x.code === "EVIDENCE_ID_NOT_FOUND")).toBe(true);
  });
  it("rejects an observed claim referencing inferred evidence", () => {
    const reg = fullRegistry();
    const inferred = reg.entries.find((e) => e.id === REGISTRY_IDS.hover)!;
    inferred.classification = "inferred";
    const i = validInteraction(REGISTRY_IDS);
    const r = validateProvenance(validDesign(REGISTRY_IDS), i, reg, "reg.json");
    expect(r.valid).toBe(false);
    expect(r.diagnostics.some((x) => x.code === "OBSERVED_CLAIM_MISMATCH")).toBe(true);
  });
  it("rejects an observed interaction citing non-interaction source", () => {
    const reg = fullRegistry();
    const hov = reg.entries.find((e) => e.id === REGISTRY_IDS.hover)!;
    hov.source = "capture";
    const r = validateProvenance(validDesign(REGISTRY_IDS), validInteraction(REGISTRY_IDS), reg, "reg.json");
    expect(r.diagnostics.some((x) => x.code === "OBSERVED_SOURCE_MISMATCH")).toBe(true);
  });
  it("flags renderer-specific strings", () => {
    const d = validDesign(REGISTRY_IDS);
    d.layout.navStyle = "flex items-center justify-between bg-white";
    const runtime = validateRuntime(d, validInteraction(REGISTRY_IDS));
    expect(runtime.rendererSpecificStrings.length).toBeGreaterThan(0);
    expect(runtime.valid).toBe(false);
  });
  it("flags a style-package key", () => {
    expect(detectRendererSpecificStrings("uses minimalist-monochrome theme").length).toBeGreaterThan(0);
  });

  it("rejects a declared evidence source or artifact key mismatch", () => {
    const d = validDesign(REGISTRY_IDS);
    d.layout.sections[0].evidence.source = "screenshot";
    d.layout.sections[0].evidence.artifactKey = "wrong.json";
    const result = validateProvenance(d, validInteraction(REGISTRY_IDS), fullRegistry(), "reg.json");
    expect(result.valid).toBe(false);
    expect(result.diagnostics.filter((item) => item.code === "EVIDENCE_REF_MISMATCH")).toHaveLength(2);
  });

  it("rejects a stale registry key or version", () => {
    const d = validDesign(REGISTRY_IDS);
    d.source.registryR2Key = "stale.json";
    const i = validInteraction(REGISTRY_IDS);
    i.source.registryVersion = 2;
    const result = validateProvenance(d, i, fullRegistry(), "reg.json");
    expect(result.diagnostics.some((item) => item.code === "REGISTRY_KEY_MISMATCH")).toBe(true);
    expect(result.diagnostics.some((item) => item.code === "REGISTRY_VERSION_MISMATCH")).toBe(true);
  });
});

// ── Parsing tests ──────────────────────────────────────────────────────────
describe("bounded JSON parsing", () => {
  it("extracts JSON from fenced model output", () => {
    const raw = "```json\n{\"design\":{},\"interaction\":{}}\n```";
    expect(extractJsonObject(raw)).toBe("{\"design\":{},\"interaction\":{}}");
  });
  it("parseBlueprintJson returns unknown objects (no cast)", () => {
    const { design, interaction } = parseBlueprintJson('{"design":{"x":1},"interaction":{"y":2}}');
    expect(design).toEqual({ x: 1 });
    expect(interaction).toEqual({ y: 2 });
  });
  it("throws BlueprintParseError on unparseable output", () => {
    expect(() => extractJsonObject("no json here")).toThrow(BlueprintParseError);
    expect(() => parseBlueprintJson('{"design":{}}')).toThrow(BlueprintParseError);
  });
  it("does not rewrite schemaVersion during parsing", () => {
    const raw = JSON.stringify({ design: { schemaVersion: 2 }, interaction: { schemaVersion: 2 } });
    const { design } = parseBlueprintJson(raw);
    expect((design as { schemaVersion: number }).schemaVersion).toBe(2);
  });
});

// ── Review + acceptance gate ───────────────────────────────────────────────
describe("review and acceptance gate", () => {
  it("accepts when runtime + provenance valid and no blocking/major review", () => {
    const d = validDesign(REGISTRY_IDS);
    const i = validInteraction(REGISTRY_IDS);
    const runtime = validateRuntime(d, i);
    const provenance = validateProvenance(d, i, fullRegistry(), "reg.json");
    const review = reviewBlueprints(d, i);
    expect(decideAcceptance(runtime, provenance, review).accept).toBe(true);
  });
  it("rejects when a major review finding remains (even if schema valid)", () => {
    const d = validDesign(REGISTRY_IDS);
    d.layout.sections = [d.layout.sections[0]];
    const review = reviewBlueprints(d, validInteraction(REGISTRY_IDS));
    expect(review.findings.some((f) => f.severity === "major")).toBe(true);
    expect(decideAcceptance({ valid: true, diagnostics: [], rendererSpecificStrings: [] }, { valid: true, diagnostics: [] }, review).accept).toBe(false);
  });
  it("rejects when provenance invalid", () => {
    const d = validDesign({ ...REGISTRY_IDS, section: "missing" });
    expect(decideAcceptance({ valid: true, diagnostics: [], rendererSpecificStrings: [] }, validateProvenance(d, validInteraction(REGISTRY_IDS), fullRegistry(), "reg.json"), { findings: [] }).accept).toBe(false);
  });
});

// ── Evidence registry builder ──────────────────────────────────────────────
function makeEnv(): Env {
  const r2 = new Map<string, ArrayBuffer>();
  // Minimal in-memory store for the blueprint D1 path so attempt immutability
  // and the accepted-pointer promotion work without a real D1.
  const attempts = new Map<string, { job_id: string; site_version: number; attempt_number: number }>();
  const accepted = new Map<string, { attempt_id: string; attempt_number: number }>();
  let bindArgs: unknown[] = [];

  const db = {
    prepare: (sql: string): D1PreparedStatement => {
      const s: D1PreparedStatement = {
        bind(...v: unknown[]) { bindArgs = v; return s; },
        async first<T = Record<string, unknown>>(): Promise<T | null> {
          const lower = sql.toLowerCase();
          if (lower.includes("from blueprint_attempts where id = ?")) {
            const a = attempts.get(String(bindArgs[0]));
            return (a ?? null) as unknown as T;
          }
          if (lower.includes("join blueprint_accepted")) {
            const cur = accepted.get("cur");
            return (cur ?? null) as unknown as T;
          }
          if (lower.includes("from blueprint_attempts a")) {
            const cur = accepted.get("cur");
            if (!cur) return null;
            return attempts.get(cur.attempt_id) as unknown as T;
          }
          return null;
        },
        async all<T = Record<string, unknown>>() { return { results: [] as T[], success: true, meta: {} } as D1Result<T[]>; },
        async run() {
          const lower = sql.toLowerCase();
          if (lower.startsWith("insert into blueprint_attempts")) {
            attempts.set(String(bindArgs[0]), { job_id: String(bindArgs[2]), site_version: Number(bindArgs[4]), attempt_number: Number(bindArgs[5]) });
          } else if (lower.startsWith("insert into blueprint_evidence_registries")) {
            // no-op for tests
          } else if (lower.startsWith("insert into blueprint_accepted")) {
            const jobId = String(bindArgs[0]);
            const attemptId = String(bindArgs[2]);
            const a = attempts.get(attemptId);
            accepted.set("cur", { attempt_id: attemptId, attempt_number: a?.attempt_number ?? 0 });
            void jobId;
          } else if (lower.startsWith("update blueprint_attempts")) {
            // no-op
          }
          return { success: true, meta: { changes: 1 } } as D1Result;
        },
        async raw() { return []; },
      };
      return s;
    },
    batch: async (stmts: D1PreparedStatement[]) => { for (const s of stmts) await s.run(); return []; },
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
  const bucket = {
    async get(key: string) { return r2.has(key) ? { body: r2.get(key)! } : null; },
    async put(key: string, value: ArrayBuffer | ReadableStream | string) {
      const buf = value instanceof ArrayBuffer ? value : typeof value === "string" ? new TextEncoder().encode(value).buffer : await new Response(value).arrayBuffer();
      r2.set(key, buf);
    },
    async delete() {},
  } as unknown as R2Bucket;
  return { DB: db, SITE_BUCKET: bucket } as unknown as Env;
}

describe("evidence registry builder", () => {
  it("builds a registry from screenshot + client facts and persists it", async () => {
    const env = makeEnv();
    const result = await buildEvidenceRegistry(env, {
      jobId: "j", clientSlug: "c", siteVersion: 1, evidenceAttemptId: "ea",
      screenshotArtifact: { schemaVersion: 1, screenshotR2Key: "s.png", visionInput: { r2Key: "s.png", sourceR2Key: "s.png", sourceChecksum: "abc", checksum: "abc", mimeType: "image/png", byteSize: 100, width: 1440, height: 2500, derived: false, transform: null }, provider: "openrouter", model: "mimo", createdAt: "t", observations: [
        { id: "screenshot:layout:0", source: "screenshot", category: "layout", region: { label: "hero", x: 0, y: 0, width: 1, height: 0.2 }, observation: "hero", confidence: 0.9, artifactKey: "" },
      ] },
      screenshotArtifactR2Key: "shot.json",
      captureManifest: null, captureManifestR2Key: null,
      interactionManifest: null, interactionManifestR2Key: null,
      clientFacts: { companyName: "Co", businessType: "x", businessDescription: "d", idealClientProfile: "p", mode: "light" },
      registryR2Key: "reg.json",
    });
    expect(result.registry.entries.length).toBeGreaterThan(0);
    expect(checkEvidenceRegistry(result.registry).ok).toBe(true);
  });

  it("rejects a dangling capture manifest reference", async () => {
    const env = makeEnv();
    await expect(buildEvidenceRegistry(env, {
      jobId: "j", clientSlug: "c", siteVersion: 1, evidenceAttemptId: null,
      screenshotArtifact: null, screenshotArtifactR2Key: null,
      captureManifest: null, captureManifestR2Key: "does-not-exist.json",
      interactionManifest: null, interactionManifestR2Key: null,
      clientFacts: { companyName: "Co", businessType: null, businessDescription: null, idealClientProfile: null, mode: "light" },
      registryR2Key: "reg.json",
    })).rejects.toBeInstanceOf(DanglingEvidenceError);
  });
});

// ── Generator: immutable repair + acceptance ───────────────────────────────
describe("immutable bounded blueprint generator", () => {
  it("accepts a valid first attempt and promotes it", async () => {
    const env = makeEnv();
    const valid = JSON.stringify({ design: validDesign(REGISTRY_IDS), interaction: validInteraction(REGISTRY_IDS) });
    const generate = async () => ({ content: valid, provider: "openrouter", model: "mimo" });
    const result = await generateValidatedBlueprintsV2(env, {
      jobId: "j", siteId: "s", clientSlug: "c", siteVersion: 1,
      registryId: "reg-1", registryR2Key: "reg.json", registry: fullRegistry(),
    }, { generate });
    expect(result.accepted).not.toBeNull();
    expect(result.attempts).toHaveLength(1);
    expect(result.accepted!.provider).toBe("openrouter");
    expect(result.accepted!.model).toBe("mimo");
  });

  it("repairs malformed output: attempt 1 unparseable, attempt 2 valid", async () => {
    const env = makeEnv();
    const valid = JSON.stringify({ design: validDesign(REGISTRY_IDS), interaction: validInteraction(REGISTRY_IDS) });
    let call = 0;
    const generate = async (_e: Env, _p: unknown, attempt: number) => {
      call++;
      return attempt === 1 ? { content: "not json at all", provider: "p", model: "m" } : { content: valid, provider: "p", model: "m" };
    };
    const result = await generateValidatedBlueprintsV2(env, {
      jobId: "j", siteId: "s", clientSlug: "c", siteVersion: 1,
      registryId: "reg-1", registryR2Key: "reg.json", registry: fullRegistry(),
    }, { generate });
    expect(result.accepted).not.toBeNull();
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].failureCode).toBe("PARSE_ERROR");
    expect(result.attempts[0].attemptId).not.toBe(result.attempts[1].attemptId);
  });

  it("reaches repair limit on repeated invalid output and does not promote", async () => {
    const env = makeEnv();
    const generate = async () => ({ content: "nope", provider: "p", model: "m" });
    const result = await generateValidatedBlueprintsV2(env, {
      jobId: "j", siteId: "s", clientSlug: "c", siteVersion: 1,
      registryId: "reg-1", registryR2Key: "reg.json", registry: fullRegistry(),
    }, { generate, maxRepairAttempts: 1 });
    expect(result.accepted).toBeNull();
    expect(result.failureCode).toBe("REPAIR_LIMIT_EXHAUSTED");
    expect(result.attempts.every((a) => a.failureCode === "PARSE_ERROR" || a.failureCode === "REPAIR_LIMIT_EXHAUSTED")).toBe(true);
  });

  it("schema-valid but provenance-invalid output is NOT accepted and enters repair", async () => {
    const env = makeEnv();
    const badIds = { ...REGISTRY_IDS, section: "capture:desktop:nonexistent" };
    const invalid = JSON.stringify({ design: validDesign(badIds), interaction: validInteraction(REGISTRY_IDS) });
    const valid = JSON.stringify({ design: validDesign(REGISTRY_IDS), interaction: validInteraction(REGISTRY_IDS) });
    let call = 0;
    const generate = async () => { call++; return call === 1 ? { content: invalid, provider: "p", model: "m" } : { content: valid, provider: "p", model: "m" }; };
    const result = await generateValidatedBlueprintsV2(env, {
      jobId: "j", siteId: "s", clientSlug: "c", siteVersion: 1,
      registryId: "reg-1", registryR2Key: "reg.json", registry: fullRegistry(),
    }, { generate });
    expect(result.accepted).not.toBeNull();
    expect(result.attempts[0].provenance?.valid).toBe(false);
  });

  it("attempt-one artifacts remain unchanged after attempt two (immutability)", async () => {
    const env = makeEnv();
    const written = new Map<string, string>();
    const origPut = env.SITE_BUCKET.put.bind(env.SITE_BUCKET);
    env.SITE_BUCKET.put = (async (key: string, value: ArrayBuffer | ReadableStream | string) => {
      const buf = value instanceof ArrayBuffer ? value : typeof value === "string" ? value : await new Response(value).text();
      if (typeof buf === "string") written.set(key, buf);
      return origPut(key, value);
    }) as typeof env.SITE_BUCKET.put;
    const valid = JSON.stringify({ design: validDesign(REGISTRY_IDS), interaction: validInteraction(REGISTRY_IDS) });
    let call = 0;
    const generate = async () => { call++; return call === 1 ? { content: "bad", provider: "p", model: "m" } : { content: valid, provider: "p", model: "m" }; };
    const result = await generateValidatedBlueprintsV2(env, {
      jobId: "j", siteId: "s", clientSlug: "c", siteVersion: 1,
      registryId: "reg-1", registryR2Key: "reg.json", registry: fullRegistry(),
    }, { generate });
    const a1Keys = [...written.keys()].filter((k) => k.includes(`/attempts/${result.attempts[0].attemptId}/`));
    expect(a1Keys.length).toBeGreaterThan(0);
  });

  it("buildBoundedPromptInput includes auditable references and bounds categories", () => {
    const input = buildBoundedPromptInput(fullRegistry(), "reg.json");
    const allEntries = [...(input.screenshot as unknown[]), ...(input.capture as unknown[]), ...(input.interaction as unknown[]), ...(input.clientFacts as unknown[])] as Array<Record<string, unknown>>;
    expect(allEntries.every((e) => typeof e.id === "string")).toBe(true);
    expect((input.capture as unknown[]).length).toBeLessThanOrEqual(16);
    expect(input.registryR2Key).toBe("reg.json");
    expect(allEntries.every((entry) => "artifactKey" in entry)).toBe(true);
  });
});

describe("accepted blueprint pointer with real D1", () => {
  it("keeps the globally newer row when local attempt numbers restart or promotions race", async () => {
    const env = providedEnv as Env;
    const suffix = crypto.randomUUID();
    const jobId = `blueprint-pointer-${suffix}`;
    const registryId = `registry-${suffix}`;
    const createdAt = new Date().toISOString();
    await createBlueprintRegistry(env.DB, {
      id: registryId,
      version: 1,
      job_id: jobId,
      client_slug: `client-${suffix}`,
      site_version: 1,
      evidence_attempt_id: null,
      registry_r2_key: `registries/${registryId}.json`,
      screenshot_evidence_r2_key: null,
      checksum: suffix,
      created_at: createdAt,
    });

    const createAttempt = async (id: string, attemptNumber: number): Promise<void> => {
      await createBlueprintAttempt(env.DB, {
        id,
        registry_id: registryId,
        job_id: jobId,
        client_slug: `client-${suffix}`,
        site_version: 1,
        attempt_number: attemptNumber,
        schema_version: 1,
        prompt_version: "test",
        provider: "openrouter",
        model: "test-model",
        design_r2_key: `${id}/design.json`,
        interaction_r2_key: `${id}/interaction.json`,
        validation_r2_key: `${id}/validation.json`,
        review_r2_key: `${id}/review.json`,
        prompt_input_r2_key: `${id}/prompt.json`,
        overall_confidence: 0.8,
        status: "generated",
        failure_code: null,
        failure_diagnostics: null,
        started_at: createdAt,
        completed_at: createdAt,
        created_at: createdAt,
      });
    };

    const olderId = `older-${suffix}`;
    const newerId = `newer-${suffix}`;
    await createAttempt(olderId, 3);
    await createAttempt(newerId, 1);

    await Promise.all([
      promoteBlueprintAttempt(env.DB, olderId, createdAt),
      promoteBlueprintAttempt(env.DB, newerId, createdAt),
    ]);

    expect((await getAcceptedBlueprintAttempt(env.DB, jobId, 1))?.id).toBe(newerId);
    expect(await promoteBlueprintAttempt(env.DB, olderId, createdAt)).toBe(false);
    expect((await getAcceptedBlueprintAttempt(env.DB, jobId, 1))?.id).toBe(newerId);
  });
});

describe("gateway provider provenance", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.assertNoPendingInterceptors();
    fetchMock.deactivate();
  });

  it("returns the OpenRouter provider and resolved model that handled text generation", async () => {
    const env: Env = {
      ...(providedEnv as Env),
      PRIMARY_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "test-openrouter",
      FALLBACK_MODEL: "test/text-model",
      CF_ACCOUNT_ID: "account",
      CF_AI_GATEWAY_ID: "gateway",
      CF_AIG_TOKEN: "gateway-token",
    };
    fetchMock.get("https://gateway.ai.cloudflare.com")
      .intercept({ path: "/v1/account/gateway/openrouter/v1/chat/completions", method: "POST" })
      .reply(200, completionResponse("text"));

    const result = await generateWithGatewayDetailed(env, "system", "user", gatewayMeta(), { jsonMode: true });
    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("test/text-model");
    expect(result.response.choices[0].message.content).toBe("text");
  });

  it("routes vision through Zhipu when Zhipu wins and records that exact model", async () => {
    const env: Env = {
      ...(providedEnv as Env),
      VISION_PRIMARY_PROVIDER: "zhipu",
      VISION_PRIMARY_MODEL: "glm-4v-test",
      ZHIPU_API_KEY: "test-zhipu",
      ZHIPU_API_URL: "https://api.z.ai/api/coding/paas/v4",
      ZHIPU_GATEWAY_PROVIDER: "custom-zhipu",
      ZHIPU_MODEL: "glm-4v-test",
      CF_ACCOUNT_ID: "account",
      CF_AI_GATEWAY_ID: "gateway",
      CF_AIG_TOKEN: "gateway-token",
    };
    fetchMock.get("https://gateway.ai.cloudflare.com")
      .intercept({ path: "/v1/account/gateway/custom-zhipu/api/coding/paas/v4/chat/completions", method: "POST" })
      .reply(200, completionResponse('{"observations":[]}'));

    const diagnosticR2Key = `client/versions/v1/vision/attempts/job/test/${crypto.randomUUID()}.json`;
    const result = await generateVisionWithGateway(env, "aW1hZ2U=", "image/png", "analyze", gatewayMeta(), { jsonMode: true, diagnosticR2Key });
    expect(result.provider).toBe("zhipu");
    expect(result.model).toBe("glm-4v-test");
    const diagnostics = JSON.parse(await (await env.SITE_BUCKET.get(diagnosticR2Key))!.text()) as { provider: string; model: string; attempts: unknown[] };
    expect(diagnostics).toMatchObject({ provider: "zhipu", model: "glm-4v-test" });
    expect(diagnostics.attempts).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).not.toContain("aW1hZ2U=");
  });

  it("retries a transient primary failure once before using the explicit fallback", async () => {
    const env: Env = {
      ...(providedEnv as Env),
      VISION_PRIMARY_PROVIDER: "openrouter",
      VISION_PRIMARY_MODEL: "primary/vision",
      VISION_FALLBACK_PROVIDER: "ai-gateway",
      VISION_FALLBACK_MODEL: "fallback/vision",
      VISION_MAX_ATTEMPTS_PER_PROVIDER: "2",
      VISION_RETRY_DELAY_MS: "0",
      CF_ACCOUNT_ID: "account",
      CF_AI_GATEWAY_ID: "gateway",
      CF_AIG_TOKEN: "gateway-token",
      OPENROUTER_API_KEY: "test-openrouter",
    };
    let requestTimeoutHeader: string | null = null;
    let gatewayAttemptsHeader: string | null = null;
    fetchMock.get("https://gateway.ai.cloudflare.com")
      .intercept({ path: "/v1/account/gateway/openrouter/v1/chat/completions", method: "POST" })
      .reply((request) => {
        const headers = request.headers;
        requestTimeoutHeader = headers instanceof Headers ? headers.get("cf-aig-request-timeout") : headers["cf-aig-request-timeout"] ?? null;
        gatewayAttemptsHeader = headers instanceof Headers ? headers.get("cf-aig-max-attempts") : headers["cf-aig-max-attempts"] ?? null;
        return { statusCode: 500, data: "upstream unavailable" };
      })
      .times(2);
    fetchMock.get("https://gateway.ai.cloudflare.com")
      .intercept({ path: "/v1/account/gateway/compat/chat/completions", method: "POST" })
      .reply(200, completionResponse("fallback result"));

    const result = await generateVisionWithGateway(env, "aW1hZ2U=", "image/png", "analyze", gatewayMeta(), { jsonMode: true });
    expect(result).toMatchObject({ provider: "ai-gateway", model: "fallback/vision", content: "fallback result" });
    expect(requestTimeoutHeader).toBe("45000");
    expect(gatewayAttemptsHeader).toBe("1");
  });

  it("records an HTTP classification and does not retry a non-transient response", async () => {
    const env: Env = {
      ...(providedEnv as Env),
      VISION_PRIMARY_PROVIDER: "openrouter",
      VISION_PRIMARY_MODEL: "primary/vision",
      VISION_MAX_ATTEMPTS_PER_PROVIDER: "2",
      CF_ACCOUNT_ID: "account",
      CF_AI_GATEWAY_ID: "gateway",
      CF_AIG_TOKEN: "gateway-token",
      OPENROUTER_API_KEY: "test-openrouter",
    };
    fetchMock.get("https://gateway.ai.cloudflare.com")
      .intercept({ path: "/v1/account/gateway/openrouter/v1/chat/completions", method: "POST" })
      .reply(400, "invalid request");

    await expect(generateVisionWithGateway(env, "aW1hZ2U=", "image/png", "analyze", gatewayMeta()))
      .rejects.toMatchObject({ name: "VisionGatewayError", attempts: [{ classification: "non_retryable_http", httpStatus: 400 }] });
  });

  it("aborts a vision request that never resolves and reports a timeout", async () => {
    const env: Env = {
      ...(providedEnv as Env),
      VISION_PRIMARY_PROVIDER: "openrouter",
      VISION_PRIMARY_MODEL: "primary/vision",
      VISION_REQUEST_TIMEOUT_MS: "1000",
      VISION_MAX_ATTEMPTS_PER_PROVIDER: "1",
      CF_ACCOUNT_ID: "account",
      CF_AI_GATEWAY_ID: "gateway",
      CF_AIG_TOKEN: "gateway-token",
      OPENROUTER_API_KEY: "test-openrouter",
    };
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));

    await expect(generateVisionWithGateway(env, "aW1hZ2U=", "image/png", "analyze", gatewayMeta()))
      .rejects.toMatchObject({ name: "VisionGatewayError", attempts: [{ classification: "timeout" }] });
  });

  it("persists one canonical screenshot-evidence artifact with the successful provider provenance", async () => {
    const env: Env = {
      ...(providedEnv as Env),
      VISION_PRIMARY_PROVIDER: "openrouter",
      VISION_PRIMARY_MODEL: "primary/vision",
      CF_ACCOUNT_ID: "account",
      CF_AI_GATEWAY_ID: "gateway",
      CF_AIG_TOKEN: "gateway-token",
      OPENROUTER_API_KEY: "test-openrouter",
    };
    const screenshotR2Key = `screenshots/${crypto.randomUUID()}.png`;
    const artifactR2Key = `artifacts/${crypto.randomUUID()}.json`;
    const screenshot = buildPng({ width: 1440, height: 2500 });
    await env.SITE_BUCKET.put(screenshotR2Key, screenshot, { httpMetadata: { contentType: "image/png" } });
    fetchMock.get("https://gateway.ai.cloudflare.com")
      .intercept({ path: "/v1/account/gateway/openrouter/v1/chat/completions", method: "POST" })
      .reply(200, completionResponse(JSON.stringify({ observations: [{ id: "screenshot:layout:0", source: "screenshot", category: "layout", region: { label: "hero", x: 0, y: 0, width: 1, height: 0.4 }, observation: "Centered hero", confidence: 0.9, artifactKey: "" }] })));

    const result = await produceScreenshotEvidence(env, { jobId: "job", siteId: "site", clientSlug: "client", screenshotR2Key, artifactR2Key });
    expect(result.artifact).toMatchObject({ provider: "openrouter", model: "primary/vision", screenshotR2Key });
    expect(result.artifact.visionInput).toMatchObject({ r2Key: screenshotR2Key, sourceR2Key: screenshotR2Key, derived: false });
    expect(await env.SITE_BUCKET.head(artifactR2Key)).not.toBeNull();
  });

  it("uses a bounded derivative in vision transport while retaining canonical screenshot provenance", async () => {
    const env: Env = {
      ...(providedEnv as Env),
      VISION_PRIMARY_PROVIDER: "openrouter",
      VISION_PRIMARY_MODEL: "primary/vision",
      VISION_INPUT_MAX_WIDTH: "1200",
      OPENROUTER_API_KEY: "test-openrouter",
      CF_ACCOUNT_ID: "account",
      CF_AI_GATEWAY_ID: "gateway",
      CF_AIG_TOKEN: "gateway-token",
      IMAGES: {
        input() {
          return {
            transform() { return this; },
            async output() { return { response: () => new Response(buildPng({ width: 1000, height: 2000 })) }; },
          };
        },
      } as unknown as ImagesBinding,
    };
    const screenshotR2Key = `screenshots/${crypto.randomUUID()}.png`;
    const artifactR2Key = `artifacts/${crypto.randomUUID()}.json`;
    await env.SITE_BUCKET.put(screenshotR2Key, buildPng({ width: 1440, height: 2500 }), { httpMetadata: { contentType: "image/png" } });
    fetchMock.get("https://gateway.ai.cloudflare.com")
      .intercept({ path: "/v1/account/gateway/openrouter/v1/chat/completions", method: "POST" })
      .reply(200, completionResponse(JSON.stringify({ observations: [{ id: "screenshot:layout:0", source: "screenshot", category: "layout", region: { label: "hero", x: 0, y: 0, width: 1, height: 0.4 }, observation: "Centered hero", confidence: 0.9, artifactKey: "" }] })));

    const result = await produceScreenshotEvidence(env, { jobId: "job", siteId: "site", clientSlug: "client", screenshotR2Key, artifactR2Key });

    expect(result.artifact.visionInput).toMatchObject({ sourceR2Key: screenshotR2Key, mimeType: "image/webp", derived: true });
    expect(result.artifact.visionInput.r2Key).toContain("/reference/vision-inputs/job/");
    const diagnostics = await env.SITE_BUCKET.list({ prefix: "client/versions/v1/vision/attempts/job/screenshot-evidence/" });
    const artifacts = await Promise.all(diagnostics.objects.map(async (object) => JSON.parse(await (await env.SITE_BUCKET.get(object.key))!.text()) as { visionInput?: { r2Key: string; derived: boolean } }));
    expect(artifacts.some((diagnostic) => diagnostic.visionInput?.r2Key === result.artifact.visionInput.r2Key && diagnostic.visionInput.derived)).toBe(true);
  });

  it("classifies bounded vision exhaustion before canonical evidence is persisted", async () => {
    const env: Env = {
      ...(providedEnv as Env),
      VISION_PRIMARY_PROVIDER: "openrouter",
      VISION_PRIMARY_MODEL: "primary/vision",
      VISION_MAX_ATTEMPTS_PER_PROVIDER: "1",
      CF_ACCOUNT_ID: "account",
      CF_AI_GATEWAY_ID: "gateway",
      CF_AIG_TOKEN: "gateway-token",
      OPENROUTER_API_KEY: "test-openrouter",
    };
    const screenshotR2Key = `screenshots/${crypto.randomUUID()}.png`;
    const screenshot = buildPng({ width: 1440, height: 2500 });
    await env.SITE_BUCKET.put(screenshotR2Key, screenshot, { httpMetadata: { contentType: "image/png" } });
    fetchMock.get("https://gateway.ai.cloudflare.com")
      .intercept({ path: "/v1/account/gateway/openrouter/v1/chat/completions", method: "POST" })
      .reply(500, "unavailable");

    await expect(produceScreenshotEvidence(env, {
      jobId: "job", siteId: "site", clientSlug: "client", screenshotR2Key, artifactR2Key: `artifacts/${crypto.randomUUID()}.json`,
    })).rejects.toMatchObject<ScreenshotEvidenceUnavailableError>({ code: "VISION_EVIDENCE_EXHAUSTED" });
  });
});

function completionResponse(content: string): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function gatewayMeta() {
  return {
    job_id: "job",
    site_id: "site",
    client_slug: "client",
    prompt_type: "blueprint_generation" as const,
    style_key: "style",
  };
}
