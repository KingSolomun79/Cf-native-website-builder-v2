// Business-hours regression (2026-09-12 integration blocker 1): OPEN
// intervals MAY cross midnight. Canonical submissions, public drafts and Fact
// Update merges share ONE rule — both times must be canonical 24-hour HH:MM
// and their chronological order is never compared; storage keeps the exact
// supplied pair.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import { submitClientIntake } from "../src/routes/public-client-intake";
import {
  normalizeBusinessFacts,
  validateOnboardingSubmissionPayload,
  type BusinessHours,
} from "../src/domain/lifecycle-schema";
import { validateIntakeDraftPayload } from "../src/domain/intake-draft";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { createRevisionBuild, getEffectiveBusinessFacts } from "../src/domain/revision";
import { canonicalBusinessHours, canonicalServices } from "./helpers/canonical-facts";

const env = providedEnv as unknown as Env;

beforeAll(() => {
  // Deterministic Turnstile success for the public-intake path.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
});

function hoursWithDay(day: string, value: unknown): BusinessHours {
  const hours = canonicalBusinessHours() as Record<string, unknown>;
  if (value === undefined) delete hours[day];
  else hours[day] = value;
  return hours as unknown as BusinessHours;
}

function factsWithHours(hours: unknown) {
  return {
    businessName: "Overnight Hours Bar",
    contactEmail: "hello@overnighthours.example",
    services: canonicalServices(),
    businessHours: hours,
  };
}

function canonicalPayload(hours: unknown) {
  return {
    buildMode: "ORIGINAL_DESIGN" as const,
    facts: factsWithHours(hours),
    creativeDirection: { direction: "Late-night venue aesthetic" },
  };
}

function draftPayload(hours: unknown) {
  return {
    submitter: { name: "Night Manager", email: "night@overnighthours.example" },
    business: factsWithHours(hours),
  };
}

describe("business hours: overnight intervals are valid (no open<close rule)", () => {
  it.each([
    ["08:00", "17:00"],
    ["18:00", "02:00"],
    ["22:00", "06:00"],
  ])("accepts %s → %s at every validation layer", (open, close) => {
    const hours = hoursWithDay("monday", { status: "OPEN", open, close });

    const canonical = validateOnboardingSubmissionPayload(canonicalPayload(hours));
    expect(canonical.valid).toBe(true);

    const draft = validateIntakeDraftPayload(draftPayload(hours));
    expect(draft.valid).toBe(true);

    // Storage keeps the EXACT supplied canonical pair (no conversion).
    if (canonical.valid) {
      const normalized = normalizeBusinessFacts(canonical.value.facts);
      expect(normalized.businessHours.monday).toEqual({ status: "OPEN", open, close });
    }
  });

  it("rejects malformed HH:MM values on either side of the window", () => {
    for (const bad of ["24:00", "8:00", "08:60", "0800", "08:5"]) {
      const badOpen = validateOnboardingSubmissionPayload(
        canonicalPayload(hoursWithDay("monday", { status: "OPEN", open: bad, close: "02:00" }))
      );
      expect(badOpen.valid).toBe(false);
      const badClose = validateIntakeDraftPayload(
        draftPayload(hoursWithDay("monday", { status: "OPEN", open: "18:00", close: bad }))
      );
      expect(badClose.valid).toBe(false);
    }
  });

  it("requires open AND close on an OPEN day", () => {
    const missingOpen = validateOnboardingSubmissionPayload(
      canonicalPayload(hoursWithDay("monday", { status: "OPEN", close: "02:00" }))
    );
    expect(missingOpen.valid).toBe(false);
    const missingClose = validateIntakeDraftPayload(
      draftPayload(hoursWithDay("monday", { status: "OPEN", open: "18:00" }))
    );
    expect(missingClose.valid).toBe(false);
  });

  it("accepts CLOSED without times", () => {
    const hours = hoursWithDay("monday", { status: "CLOSED" });
    expect(validateOnboardingSubmissionPayload(canonicalPayload(hours)).valid).toBe(true);
    expect(validateIntakeDraftPayload(draftPayload(hours)).valid).toBe(true);
  });

  it("requires all seven days", () => {
    const missingSunday = hoursWithDay("sunday", undefined);
    expect(validateOnboardingSubmissionPayload(canonicalPayload(missingSunday)).valid).toBe(false);
    expect(validateIntakeDraftPayload(draftPayload(missingSunday)).valid).toBe(false);
  });

  it("the public intake stores the exact supplied overnight pair", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post("/api/public/client-intakes", submitClientIntake);
    const runtimeEnv = { ...env, WEBHOOK_SECRET: "test-webhook-secret", TURNSTILE_SECRET_KEY: "test-turnstile-secret" };
    const response = await app.request("https://test.example.com/api/public/client-intakes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "https://wazibiz.ke",
        "CF-Connecting-IP": crypto.randomUUID(),
      },
      body: JSON.stringify({
        ...draftPayload(hoursWithDay("monday", { status: "OPEN", open: "18:00", close: "02:00" })),
        turnstileToken: "valid-token",
      }),
    }, runtimeEnv);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { draftId: string };
    const row = await runtimeEnv.DB.prepare("SELECT payload_json FROM client_intake_drafts WHERE id = ?")
      .bind(body.draftId)
      .first<{ payload_json: string }>();
    const stored = JSON.parse(row!.payload_json) as { business: { businessHours: Record<string, unknown> } };
    expect(stored.business.businessHours.monday).toEqual({ status: "OPEN", open: "18:00", close: "02:00" });
  });

  it("a whole-field Fact Update to overnight hours leaves a valid merged snapshot", async () => {
    const started = await startSiteGeneration(env, { siteId: null, payload: canonicalPayload(canonicalBusinessHours()) });
    const initial = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    const revision = await createRevisionBuild(env, {
      parentBuildId: initial.buildId,
      payload: {
        requestNote: "The kitchen runs until 02:00 — extend Monday.",
        changes: { facts: { businessHours: hoursWithDay("monday", { status: "OPEN", open: "18:00", close: "02:00" }) } },
      },
    });
    expect(revision.effectiveFacts.businessHours.monday).toEqual({ status: "OPEN", open: "18:00", close: "02:00" });
    const effective = await getEffectiveBusinessFacts(env, revision.buildId);
    expect(effective.facts.businessHours.monday).toEqual({ status: "OPEN", open: "18:00", close: "02:00" });
  });
});
