import { describe, expect, it } from "vitest";
import { captureResponsiveEvidence } from "../src/lib/reference-capture-v2";
import { buildInteractionFallbackContext, captureInteractionEvidence } from "../src/lib/interaction-capture-v2";
import { captureEvidenceAttempt, completeEvidenceAttempt, runEvidenceAttempt } from "../src/lib/evidence-attempt";
import { dedupeAndRank, deriveStatus, fallbackProfile } from "../src/lib/interaction-capture-v2";
import { diffResponsive } from "../src/lib/reference-capture-v2";
import { buildEvidenceId, evidenceIdSelector, assertUnique, SelectorNotUniqueError } from "../src/lib/selector";
import { createFixtureAdapter } from "./helpers/browser-fixtures";
import type { Env } from "../src/env.d";
import type { EvidenceInteraction, EvidenceReferenceCapture, MotionMode } from "../src/types";
import type { ScreenshotEvidenceArtifact } from "../src/lib/blueprint-schema-v2";

// ── In-memory env (R2 map + minimal D1 capturing inserts) ───────────────────
function makeEnv(overrides: { d1InsertShouldFail?: boolean } = {}): Env {
  const r2 = new Map<string, ArrayBuffer>();
  const insertedCapture: unknown[] = [];
  const insertedInteraction: unknown[] = [];
  const attempts: unknown[] = [];
  const current: Map<string, unknown> = new Map();

  const prepare = (sql: string): D1PreparedStatement => {
    const stmt: D1PreparedStatement = {
      bind(..._v: unknown[]) { return stmt; },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        const lower = sql.toLowerCase();
        if (lower.includes("from reference_evidence_attempts") && lower.includes("join")) {
          const cur = current.get("cur") as Record<string, unknown> | undefined;
          if (cur && cur.status === "complete") return cur as unknown as T;
          return null;
        }
        if (lower.includes("from reference_evidence_attempts")) {
          return (attempts[attempts.length - 1] ?? null) as unknown as T;
        }
        return null;
      },
      async all<T = Record<string, unknown>>() { return { results: [] as T[], success: true, meta: {} } as D1Result<T[]>; },
      async run() {
        const lower = sql.toLowerCase();
        if (overrides.d1InsertShouldFail && lower.startsWith("insert into reference_capture_evidence")) {
          throw new Error("D1 insert failed (simulated)");
        }
        if (lower.startsWith("insert into reference_evidence_attempts")) attempts.push({ id: "a", status: "in_progress" });
        if (lower.startsWith("insert into reference_capture_evidence")) insertedCapture.push({});
        if (lower.startsWith("insert into reference_interaction_evidence")) insertedInteraction.push({});
        if (lower.includes("on conflict(job_id, site_version)")) current.set("cur", { status: "complete", attempt_id: "a", client_slug: "client", attemptId: "a", clientSlug: "client" });
        return { success: true, meta: {} } as D1Result;
      },
      async raw() { return []; },
    };
    return stmt;
  };
  const batch = async (stmts: D1PreparedStatement[]) => { for (const s of stmts) await s.run(); return []; };

  const db = { prepare, batch, exec: async () => ({ count: 0, duration: 0 }) } as unknown as D1Database;

  const bucket = {
    async get(key: string) { return r2.has(key) ? { body: r2.get(key)! } : null; },
    async put(key: string, value: ArrayBuffer | ReadableStream | string) {
      const buf = value instanceof ArrayBuffer ? value : typeof value === "string" ? new TextEncoder().encode(value).buffer : await new Response(value).arrayBuffer();
      r2.set(key, buf);
      return { key } as R2Object;
    },
    async delete(key: string) { r2.delete(key); },
  } as unknown as R2Bucket;

  return {
    DB: db,
    SITE_BUCKET: bucket,
    WEBHOOK_SECRET: "s", APPROVAL_SECRET: "s", PUBLIC_APP_URL: "https://t.test",
    SITE_BUILD_WORKFLOW: {} as unknown as Workflow,
    SMTP2GO_API_KEY: "", INTERNAL_NOTIFICATION_EMAIL: "t@t.test",
    CF_ACCOUNT_ID: "", CF_AI_GATEWAY_ID: "", CF_AIG_TOKEN: "", CF_DEPLOY_API_TOKEN: "",
    KIE_API_URL: "", KIE_API_KEY: "", KIE_MODEL: "",
    WEBSITE_AGENT: {} as unknown as DurableObjectNamespace,
    BROWSER: {} as unknown as never,
    GITHUB_TOKEN: "", GITHUB_WEBHOOK_SECRET: "", GITHUB_REPO_OWNER: "", GITHUB_REPO_NAME: "", GITHUB_BRANCH: "main",
    OPENROUTER_API_KEY: "", APPROVAL_TIMEOUT_DAYS: "7", MAX_REVISIONS: "3",
  } as Env;
}

const baseParams = { jobId: "job-1", clientSlug: "client", siteVersion: 1, attemptId: "att-1", referenceUrl: "https://fixture.test/home" };

function screenshotArtifact(): ScreenshotEvidenceArtifact {
  return {
    schemaVersion: 1,
    screenshotR2Key: "client/versions/v1/reference/homepage-screenshot/job/source.png",
    visionInput: { r2Key: "client/versions/v1/reference/homepage-screenshot/job/source.png", sourceR2Key: "client/versions/v1/reference/homepage-screenshot/job/source.png", sourceChecksum: "abc", checksum: "abc", mimeType: "image/png", byteSize: 100, width: 1440, height: 2500, derived: false, transform: null },
    provider: "openrouter",
    model: "vision-test",
    createdAt: "2026-08-13T00:00:00.000Z",
    observations: [
      { id: "screenshot:layout:0", source: "screenshot", category: "layout", region: { label: "hero", x: 0, y: 0, width: 1, height: 0.4 }, observation: "Split hero followed by project sections", confidence: 0.9, artifactKey: "" },
      { id: "screenshot:navigation:0", source: "screenshot", category: "navigation", region: { label: "navigation", x: 0, y: 0, width: 1, height: 0.1 }, observation: "Collapsed hamburger menu on mobile", confidence: 0.9, artifactKey: "" },
      { id: "screenshot:surfaces:0", source: "screenshot", category: "surfaces", region: { label: "cards", x: 0, y: 0.4, width: 1, height: 0.3 }, observation: "Project cards lift on hover", confidence: 0.8, artifactKey: "" },
      { id: "screenshot:interaction:0", source: "screenshot", category: "interaction", region: { label: "accordion", x: 0, y: 0.7, width: 1, height: 0.2 }, observation: "Accordion expands on toggle", confidence: 0.8, artifactKey: "" },
    ],
  };
}

describe("selector uniqueness", () => {
  it("builds viewport-kind-index evidence ids so duplicates differ", () => {
    expect(buildEvidenceId({ viewport: "mobile", kind: "button", index: 0 })).toBe("mobile-button-0");
    expect(buildEvidenceId({ viewport: "mobile", kind: "button", index: 1 })).toBe("mobile-button-1");
  });
  it("evidenceIdSelector produces the data-attr form", () => {
    expect(evidenceIdSelector("mobile-button-0")).toBe('[data-cf-evidence-id="mobile-button-0"]');
  });
  it("assertUnique throws when not exactly one match", async () => {
    await expect(assertUnique(async () => 0, "x")).rejects.toBeInstanceOf(SelectorNotUniqueError);
    await expect(assertUnique(async () => 2, "x")).rejects.toBeInstanceOf(SelectorNotUniqueError);
    await expect(assertUnique(async () => 1, "x")).resolves.toBeUndefined();
  });
});

describe("responsive capture (v2) via fixture adapter", () => {
  it("captures all three viewports with raw + normalized + screenshot evidence", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "home", httpStatus: 200 });
    const result = await captureResponsiveEvidence(env, { ...baseParams, adapter });
    expect(result.captures).toHaveLength(3);
    for (const c of result.captures) {
      expect(c.status).toBe("captured");
      expect(c.screenshotR2Key).toContain(`/attempts/att-1/capture/${c.viewport.name}/screenshot.png`);
      expect(c.rawR2Key).toContain(`/attempts/att-1/capture/${c.viewport.name}/raw.json`);
      expect(c.spacing?.sectionPadding).toBe("64px 0");
    }
    expect(result.manifest.overallStatus).toBe("captured");
  });

  it("classifies HTTP 404 as a failed capture (not success)", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "notfound", httpStatus: 404 });
    const result = await captureResponsiveEvidence(env, { ...baseParams, adapter });
    expect(result.captures.every((c) => c.status === "failed")).toBe(true);
    expect(result.captures[0].failure?.code).toBe("HTTP_4XX");
  });

  it("classifies HTTP 500 as a failed capture", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "servererror", httpStatus: 500 });
    const result = await captureResponsiveEvidence(env, { ...baseParams, adapter });
    expect(result.captures.every((c) => c.status === "failed")).toBe(true);
    expect(result.captures[0].failure?.code).toBe("HTTP_5XX");
  });

  it("records redirect chain + overlay as partial with limitations", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({
      name: "redirect-overlay",
      httpStatus: 200,
      finalUrl: "https://fixture.test/redirect-overlay",
      redirectChain: [{ url: "https://fixture.test/old", status: 301 }],
      consentOverlay: true,
    });
    const result = await captureResponsiveEvidence(env, { ...baseParams, adapter });
    const c = result.captures[0];
    expect(c.diagnostics.redirects).toHaveLength(1);
    expect(c.limitations.some((l) => l.includes("consent"))).toBe(true);
    expect(c.status).toBe("partial");
  });

  it("rejects a redirect to a private final URL", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "rebind", httpStatus: 200, finalUrl: "http://127.0.0.1/admin" });
    const result = await captureResponsiveEvidence(env, { ...baseParams, adapter });
    expect(result.captures[0].status).toBe("failed");
    expect(result.captures[0].failure?.code).toBe("DISALLOWED_REDIRECT");
  });

  it("marks a navigation timeout as failed", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "timeout", httpStatus: 200, timedOut: true });
    const result = await captureResponsiveEvidence(env, { ...baseParams, adapter });
    expect(result.captures[0].failure?.code).toBe("NAVIGATION_TIMEOUT");
  });

  it("diffResponsive surfaces nav/layout/typography changes between viewports", () => {
    const desktop: EvidenceReferenceCapture = {
      attemptId: "a", viewport: { name: "desktop", width: 1440, height: 900 }, referenceUrl: "u", finalUrl: "u",
      diagnostics: { httpStatus: 200, redirects: [], failedResources: [], blockedResources: [], timedOut: false, overlayLimitations: [] },
      status: "captured", failure: null, screenshotR2Key: "k", rawR2Key: "r", title: "t", lang: "en", description: "d", viewportMeta: "m",
      sections: [{ order: 0, tag: "section", role: null, heading: "Hero", text: "x", bounds: { x: 0, y: 0, width: 10, height: 10 }, evidence: { viewport: "desktop", selector: "section", screenshotR2Key: "k" } }],
      typography: [{ element: "body", fontFamily: "a", fontSize: "16px", fontWeight: "400", lineHeight: "1", letterSpacing: "0", textTransform: "none", evidence: { viewport: "desktop", selector: "body", screenshotR2Key: "k" } }],
      colors: { background: null, text: null, accents: [], evidence: { viewport: "desktop", selector: "body", screenshotR2Key: "k" } },
      nav: [{ href: "/", text: "H", external: false, evidence: { viewport: "desktop", selector: "nav a", screenshotR2Key: "k" } }],
      images: [], spacing: null, limitations: [], capturedAt: "t",
    };
    const mobile: EvidenceReferenceCapture = { ...desktop, viewport: { name: "mobile", width: 375, height: 812 }, nav: [], typography: [{ element: "body", fontFamily: "a", fontSize: "14px", fontWeight: "400", lineHeight: "1", letterSpacing: "0", textTransform: "none", evidence: { viewport: "mobile", selector: "body", screenshotR2Key: "k" } }] };
    const diffs = diffResponsive([desktop, mobile]);
    expect(diffs.some((d) => d.kind === "nav")).toBe(true);
    expect(diffs.some((d) => d.kind === "typography")).toBe(true);
  });
});

describe("interaction capture (v2) via fixture adapter", () => {
  it("marks static discovery as detected, exercised hover as observed with before/after + trace", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "home", httpStatus: 200, duplicateButtons: 1, hoverChangesColor: true });
    const result = await captureInteractionEvidence(env, { ...baseParams, adapter });
    const defaultDesktop = result.captures.find((c) => c.viewport.name === "desktop" && c.motionMode === "default")!;
    const observed = defaultDesktop.observations.filter((o) => o.classification === "observed");
    expect(observed.length).toBeGreaterThan(0);
    const hoverObs = observed.find((o) => o.trigger === "hover");
    expect(hoverObs).toBeTruthy();
    expect(Object.keys(hoverObs!.after).length).toBeGreaterThan(0);
    expect(hoverObs!.traceR2Key).toContain("/traces/");
    expect(hoverObs!.resetOutcome).toBe("verified");
  });

  it("never marks observed without an executed action + recorded result", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "home", httpStatus: 200, duplicateButtons: 1, hoverChangesColor: false });
    const result = await captureInteractionEvidence(env, { ...baseParams, adapter });
    for (const c of result.captures) {
      for (const o of c.observations) {
        if (o.classification === "observed") {
          expect(Object.keys(o.after).length > 0 || ["toggle", "sticky", "scroll-reveal"].includes(o.trigger)).toBe(true);
          expect(o.traceR2Key).not.toBeNull();
        }
      }
    }
  });

  it("gives duplicate buttons independent evidence ids and records", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "home", httpStatus: 200, duplicateButtons: 3, hoverChangesColor: true });
    const result = await captureInteractionEvidence(env, { ...baseParams, adapter });
    const ids = new Set(result.captures.flatMap((c) => c.observations.map((o) => o.evidenceId)));
    expect(ids.size).toBeGreaterThan(1);
  });

  it("exercises accordion/menu toggle open-close", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "home", httpStatus: 200, hasAccordion: true, hasMobileMenu: true, duplicateButtons: 0 });
    await captureInteractionEvidence(env, { ...baseParams, adapter });
    const toggles = adapter.ledger.filter((e) => e.kind === "toggleAccordionOrMenu");
    expect(toggles.length).toBeGreaterThan(0);
  });

  it("records an active-state sample via pressPointerDown", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "home", httpStatus: 200, duplicateButtons: 1, hoverChangesColor: true });
    await captureInteractionEvidence(env, { ...baseParams, adapter });
    expect(adapter.ledger.some((e) => e.kind === "pressPointerDown")).toBe(true);
  });

  it("never clicks a toggle that would navigate externally", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "unsafe", httpStatus: 200, duplicateButtons: 0, hasExternalToggle: true });
    const result = await captureInteractionEvidence(env, { ...baseParams, adapter });
    expect(adapter.ledger.some((entry) => entry.kind === "toggleAccordionOrMenu")).toBe(false);
    expect(result.captures.flatMap((capture) => capture.observations).some(
      (observation) => observation.trigger === "toggle" && observation.classification === "skipped"
    )).toBe(true);
  });

  it("captures default AND reduced-motion variants and compares them", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "home", httpStatus: 200, duplicateButtons: 1, hoverChangesColor: true, reducedMotionRemovesMotion: true });
    const result = await captureInteractionEvidence(env, { ...baseParams, adapter });
    const vps = result.captures.filter((c) => c.viewport.name === "desktop");
    expect(vps.some((c) => c.motionMode === "default")).toBe(true);
    expect(vps.some((c) => c.motionMode === "reduced")).toBe(true);
    const defaultObs = vps.find((c) => c.motionMode === "default")!.observations.find((o) => o.classification === "observed");
    const cmp = defaultObs?.reducedMotionComparison;
    expect(cmp).toBeTruthy();
    expect(cmp!.outcome).toBe("removed");
    expect(cmp!.defaultDurationMs).toBe(150);
    expect(cmp!.reducedDurationMs).toBe(0);
  });

  it("exercises sticky and scroll-reveal behavior with recorded state changes", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({
      name: "motion",
      httpStatus: 200,
      duplicateButtons: 0,
      hasStickyHeader: true,
      hasReveal: true,
      hasSectionTransition: true,
    });
    const result = await captureInteractionEvidence(env, { ...baseParams, adapter });
    const observations = result.captures.flatMap((capture) => capture.observations);
    expect(observations.some((observation) => observation.trigger === "sticky" && observation.classification === "observed")).toBe(true);
    expect(observations.some((observation) => observation.trigger === "scroll-reveal" && observation.classification === "observed")).toBe(true);
    expect(observations.some((observation) => observation.trigger === "section-transition" && observation.classification === "observed")).toBe(true);
  });

  it("derives fallback behavior from screenshot component context", () => {
    const profile = fallbackProfile({ name: "desktop", width: 1440, height: 900 }, "default", {
      sectionOrder: ["hero", "projects"],
      navigationStyle: null,
      buttonStyle: null,
      cardStyle: "bordered project cards",
      screenshotInteractions: [{ element: "card", type: "hover", description: "card lifts on hover" }],
    });
    expect(profile.some((observation) => observation.target === "article")).toBe(true);
    expect(profile.some((observation) => observation.trigger === "section-transition")).toBe(true);
    expect(profile.some((observation) => observation.target === "button" && observation.trigger === "hover")).toBe(true);
    expect(profile.some((observation) => observation.trigger === "scroll-reveal")).toBe(true);
  });

  it("produces a non-empty inferred fallback for an inaccessible reference", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "inaccessible", httpStatus: 200, inaccessible: true, duplicateButtons: 1 });
    const result = await captureInteractionEvidence(env, { ...baseParams, adapter });
    expect(result.captures.length).toBeGreaterThan(0);
    for (const c of result.captures) {
      expect(c.observations.length).toBeGreaterThan(0);
      expect(c.observations.every((o) => o.classification === "inferred")).toBe(true);
      expect(c.fallbackReason).not.toBeNull();
    }
  });

  it("uses persisted screenshot evidence for an inaccessible reference fallback", async () => {
    const env = makeEnv();
    const artifact = screenshotArtifact();
    const result = await captureInteractionEvidence(env, {
      ...baseParams,
      adapter: createFixtureAdapter({ name: "inaccessible", httpStatus: 200, inaccessible: true }),
      fallbackContext: buildInteractionFallbackContext(artifact),
    });
    const observations = result.captures.flatMap((capture) => capture.observations);
    expect(observations.some((observation) => observation.trigger === "toggle")).toBe(true);
    expect(observations.every((observation) => observation.classification === "inferred")).toBe(true);
    expect(observations.every((observation) => observation.evidence.screenshotR2Key === artifact.screenshotR2Key)).toBe(true);
  });

  it("classification helper: deriveStatus + dedupeAndRank", () => {
    const observed = { id: "1", evidenceId: "e1", trigger: "hover", target: "a", selector: "s", viewport: "desktop", motionMode: "default" as MotionMode, role: null, classification: "observed" as const, changedProperties: ["color"], before: {}, after: { color: "x" }, duration: null, easing: null, delay: null, motionSafe: true, relevance: 3, traceR2Key: "t", screenshotR2Key: null, reducedMotionComparison: null, resetOutcome: "verified" as const, evidence: { viewport: "desktop", selector: "s", screenshotR2Key: null } };
    expect(deriveStatus([observed as EvidenceInteraction])).toBe("captured");
    expect(deriveStatus([])).toBe("failed");
    const deduped = dedupeAndRank([observed, { ...observed, id: "2", classification: "detected" }]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].classification).toBe("observed");
  });

  it("fallbackProfile is non-empty, inferred, no decorative motion", () => {
    const profile = fallbackProfile({ name: "mobile", width: 375, height: 812 }, "default");
    expect(profile.length).toBeGreaterThan(0);
    expect(profile.every((o) => o.classification === "inferred")).toBe(true);
    expect(profile.every((o) => !/loop|spin|marquee/i.test(o.easing ?? ""))).toBe(true);
  });
});

describe("shared evidence attempt coordinator", () => {
  it("keeps the same attempt across live capture and screenshot-grounded interaction fallback", async () => {
    const env = makeEnv();
    const artifact = screenshotArtifact();
    const captureAttempt = await captureEvidenceAttempt(env, {
      ...baseParams,
      adapter: createFixtureAdapter({ name: "inaccessible", httpStatus: 200, inaccessible: true }),
    });
    const result = await completeEvidenceAttempt(env, {
      ...baseParams,
      adapter: createFixtureAdapter({ name: "inaccessible", httpStatus: 200, inaccessible: true }),
      fallbackContext: buildInteractionFallbackContext(artifact),
    }, captureAttempt);
    expect(result.attemptId).toBe(captureAttempt.attemptId);
    expect(result.promoted).toBe(true);
  });

  it("promotes a successful attempt and flips the current pointer", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "home", httpStatus: 200, duplicateButtons: 1, hoverChangesColor: true });
    const result = await runEvidenceAttempt(env, { ...baseParams, referenceUrl: "https://fixture.test/home", adapter });
    expect(result.promoted).toBe(true);
    expect(result.captureManifestR2Key).toContain("/attempts/");
    expect(result.interactionManifestR2Key).toContain("/attempts/");
  });

  it("an inaccessible URL still promotes a non-empty inferred fallback (page-relevant)", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "inaccessible", httpStatus: 200, inaccessible: true, duplicateButtons: 1 });
    const result = await runEvidenceAttempt(env, { ...baseParams, referenceUrl: "https://fixture.test/home", adapter });
    // Inaccessible references produce a non-empty inferred fallback (Issue #18);
    // the attempt is promoted with inferred evidence, never an empty result.
    expect(result.promoted).toBe(true);
    expect(result.captureManifestR2Key).toBeTruthy();
    expect(result.interactionManifestR2Key).toBeTruthy();
  });

  it("a browser launch failure still yields a non-empty inferred fallback attempt", async () => {
    const env = makeEnv();
    const launchFailAdapter = {
      ledger: [],
      pagesOpened: 0, pagesClosed: 0, sessionsClosed: 0,
      async launch() { throw new Error("browser unavailable"); },
    };
    const result = await runEvidenceAttempt(env, { ...baseParams, referenceUrl: "https://fixture.test/home", adapter: launchFailAdapter as never });
    // Launch failure -> inferred fallback (non-empty, page-relevant); promotable.
    expect(result.promoted).toBe(true);
  });

  it("closes all opened pages + the session even on success", async () => {
    const env = makeEnv();
    const adapter = createFixtureAdapter({ name: "home", httpStatus: 200, duplicateButtons: 1, hoverChangesColor: true });
    await runEvidenceAttempt(env, { ...baseParams, referenceUrl: "https://fixture.test/home", adapter });
    expect(adapter.pagesOpened).toBeGreaterThan(0);
    expect(adapter.pagesClosed).toBe(adapter.pagesOpened);
    expect(adapter.sessionsClosed).toBe(1);
  });

  it("closes pages + session when persistence fails (injected D1 failure)", async () => {
    const env = makeEnv({ d1InsertShouldFail: true });
    const adapter = createFixtureAdapter({ name: "home", httpStatus: 200, duplicateButtons: 1, hoverChangesColor: true });
    const result = await runEvidenceAttempt(env, { ...baseParams, referenceUrl: "https://fixture.test/home", adapter });
    expect(result.promoted).toBe(false);
    expect(adapter.pagesClosed).toBe(adapter.pagesOpened);
    expect(adapter.sessionsClosed).toBe(1);
  });

  it("retry creates a new attempt; prior attempt evidence is retained (immutability)", async () => {
    const env = makeEnv();
    const adapterA = createFixtureAdapter({ name: "home", httpStatus: 200, duplicateButtons: 1, hoverChangesColor: true });
    const adapterB = createFixtureAdapter({ name: "home", httpStatus: 200, duplicateButtons: 1, hoverChangesColor: true });
    const first = await runEvidenceAttempt(env, { ...baseParams, attemptId: "att-A", referenceUrl: "https://fixture.test/home", adapter: adapterA });
    const second = await runEvidenceAttempt(env, { ...baseParams, attemptId: "att-B", referenceUrl: "https://fixture.test/home", adapter: adapterB });
    expect(first.promoted && second.promoted).toBe(true);
    expect(first.attemptId).not.toBe(second.attemptId);
    // Manifest keys are distinct (per-attempt), so prior attempt R2 objects are not overwritten.
    expect(first.captureManifestR2Key).not.toBe(second.captureManifestR2Key);
  });
});
