// Phase 16.R4: build a bounded, multi-source evidence registry.
//
// Deterministically assembles an EvidenceRegistry from:
//   - accepted screenshot observations (source: screenshot)
//   - R3 desktop/tablet/mobile capture evidence (source: capture)
//   - R3 responsive differences (source: capture)
//   - R3 default + reduced interaction evidence (source: interaction)
//   - client facts (source: client_facts)
//
// Each entry carries a stable evidence id, source type, artifact key, viewport/
// selector where relevant, classification, observation, and confidence. The
// builder rejects dangling R3 artifact references (a referenced manifest key
// that does not exist) while building the registry. Output is schema-validated
// and persisted immutably before blueprint generation.

import type { Env } from "../env.d";
import type {
  EvidenceRegistry,
  RegistryEntry,
} from "./blueprint-schema-v2";
import {
  EVIDENCE_REGISTRY_VERSION,
  checkEvidenceRegistry,
} from "./blueprint-schema-v2";
import type {
  EvidenceInteractionCapture,
  EvidenceInteractionManifest,
  InteractionCapture,
  InteractionManifest,
  ReferenceCaptureManifest,
} from "../types";
import type { ScreenshotEvidenceArtifact } from "./blueprint-schema-v2";
import { getObject, putObject } from "./assets";
import { createBlueprintRegistry } from "./db";
import { generateId, nowIso } from "./crypto";
import { computeChecksum } from "./reference-input";

export interface RegistryParams {
  jobId: string;
  clientSlug: string;
  siteVersion: number;
  evidenceAttemptId: string | null;
  screenshotArtifact: ScreenshotEvidenceArtifact | null;
  screenshotArtifactR2Key: string | null;
  captureManifest: ReferenceCaptureManifest | null;
  captureManifestR2Key: string | null;
  interactionManifest: EvidenceInteractionManifest | InteractionManifest | null;
  interactionManifestR2Key: string | null;
  clientFacts: ClientFactsForRegistry;
  registryR2Key: string;
}

export interface ClientFactsForRegistry {
  companyName: string;
  businessType: string | null;
  businessDescription: string | null;
  idealClientProfile: string | null;
  mode: "light" | "dark";
}

export interface RegistryBuildResult {
  registry: EvidenceRegistry;
  registryId: string;
  registryR2Key: string;
}

export class DanglingEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DanglingEvidenceError";
  }
}

async function assertArtifactExists(env: Env, key: string | null, label: string): Promise<void> {
  if (!key) return;
  const body = await getObject(env, key);
  if (!body) throw new DanglingEvidenceError(`Referenced ${label} artifact not found at ${key}`);
}

const MAX_PER_CATEGORY = 8;
const OBSERVATION_TEXT_LIMIT = 200;

function truncate(s: string): string {
  return s.length <= OBSERVATION_TEXT_LIMIT ? s : s.slice(0, OBSERVATION_TEXT_LIMIT - 1) + "…";
}

// Deterministically rank: higher confidence first, but keep at least one entry
// from every required source and viewport.
function rankAndBound(entries: RegistryEntry[]): RegistryEntry[] {
  const sorted = [...entries].sort((a, b) => b.confidence - a.confidence);
  const perCategory = new Map<string, RegistryEntry[]>();
  const seenViewports = new Set<string>();
  const out: RegistryEntry[] = [];

  for (const e of sorted) {
    const cat = `${e.source}:${e.viewport ?? "global"}`;
    const arr = perCategory.get(cat) ?? [];
    if (arr.length >= MAX_PER_CATEGORY) continue;
    arr.push(e);
    perCategory.set(cat, arr);
    out.push(e);
    if (e.viewport) seenViewports.add(e.viewport);
  }
  return out;
}

export async function buildEvidenceRegistry(env: Env, params: RegistryParams): Promise<RegistryBuildResult> {
  // Reject dangling R3 artifact references.
  await assertArtifactExists(env, params.captureManifestR2Key, "capture manifest");
  await assertArtifactExists(env, params.interactionManifestR2Key, "interaction manifest");

  const entries: RegistryEntry[] = [];

  // Screenshot observations.
  if (params.screenshotArtifact) {
    params.screenshotArtifact.observations.forEach((o) => {
      entries.push({
        id: o.id,
        source: "screenshot",
        artifactKey: params.screenshotArtifactR2Key ?? "",
        screenshotRegion: o.region,
        classification: "observed",
        observation: truncate(o.observation),
        confidence: o.confidence,
      });
    });
  }

  // Capture evidence: sections, typography, colors, nav, spacing per viewport.
  if (params.captureManifest) {
    for (const vp of params.captureManifest.viewports) {
      const vname = vp.viewport.name;
      vp.sections.slice(0, 6).forEach((s) => {
        entries.push({
          id: `capture:${vname}:section:${s.order}`,
          source: "capture",
          artifactKey: params.captureManifestR2Key ?? "",
          viewport: vname,
          selector: s.evidence.selector,
          classification: "observed",
          observation: truncate(`${s.tag} section: ${s.heading ?? s.text ?? ""}`),
          confidence: 0.85,
        });
      });
      const bodyType = vp.typography.find((t) => t.element === "body");
      if (bodyType) {
        entries.push({
          id: `capture:${vname}:typography:body`,
          source: "capture",
          artifactKey: params.captureManifestR2Key ?? "",
          viewport: vname,
          selector: bodyType.evidence.selector,
          classification: "observed",
          observation: truncate(`Body type: ${bodyType.fontFamily ?? "?"} ${bodyType.fontSize ?? ""} / ${bodyType.lineHeight ?? ""}`),
          confidence: 0.8,
        });
      }
      entries.push({
        id: `capture:${vname}:colors`,
        source: "capture",
        artifactKey: params.captureManifestR2Key ?? "",
        viewport: vname,
        selector: "body",
        classification: "observed",
        observation: truncate(`Background ${vp.colors.background ?? "?"}; text ${vp.colors.text ?? "?"}; accents ${(vp.colors.accents ?? []).slice(0, 3).join(", ")}`),
        confidence: 0.8,
      });
      entries.push({
        id: `capture:${vname}:nav`,
        source: "capture",
        artifactKey: params.captureManifestR2Key ?? "",
        viewport: vname,
        selector: "nav a",
        classification: "observed",
        observation: truncate(`Nav items: ${vp.nav.slice(0, 6).map((n) => n.text ?? n.href).join(", ")}`),
        confidence: 0.75,
      });
    }
    // Responsive differences.
    params.captureManifest.responsiveDiffs.slice(0, 6).forEach((d, i) => {
      entries.push({
        id: `capture:responsive:${i}`,
        source: "capture",
        artifactKey: params.captureManifestR2Key ?? "",
        viewport: `${d.fromViewport}->${d.toViewport}`,
        classification: "observed",
        observation: truncate(`${d.kind}: ${d.description}`),
        confidence: 0.7,
      });
    });
  }

  // Interaction evidence: default + reduced, observed/detected/inferred.
  if (params.interactionManifest) {
    const vps = params.interactionManifest.viewports;
    vps.slice(0, 6).forEach((vp, i) => {
      const motionMode = "motionMode" in vp ? vp.motionMode : "default";
      const vname = vp.viewport.name;
      const classification = classifyInteractionViewport(vp);
      entries.push({
        id: `interaction:${vname}:${motionMode}:${i}`,
        source: "interaction",
        artifactKey: params.interactionManifestR2Key ?? "",
        viewport: vname,
        classification,
        observation: truncate(`${vp.observations.length} interaction(s) on ${vname} (${motionMode})`),
        confidence: classification === "observed" ? 0.75 : 0.5,
      });
    });
  }

  // Client facts.
  const cf = params.clientFacts;
  entries.push({
    id: "client_facts:company",
    source: "client_facts",
    artifactKey: "",
    classification: "client_fact",
    observation: truncate(`${cf.companyName}: ${cf.businessDescription ?? cf.businessType ?? ""}`),
    confidence: 1,
  });
  if (cf.idealClientProfile) {
    entries.push({
      id: "client_facts:ideal_client",
      source: "client_facts",
      artifactKey: "",
      classification: "client_fact",
      observation: truncate(`Ideal client: ${cf.idealClientProfile}`),
      confidence: 1,
    });
  }

  const bounded = rankAndBound(entries);
  const registryId = generateId();
  const checksum = await checksumJson({ entries: bounded, jobId: params.jobId, version: EVIDENCE_REGISTRY_VERSION });
  const registry: EvidenceRegistry = {
    schemaVersion: EVIDENCE_REGISTRY_VERSION,
    registryVersion: EVIDENCE_REGISTRY_VERSION,
    jobId: params.jobId,
    attemptId: registryId,
    evidenceAttemptId: params.evidenceAttemptId ?? undefined,
    entries: bounded,
    checksum,
    createdAt: nowIso(),
  };

  const check = checkEvidenceRegistry(registry);
  if (!check.ok) {
    throw new Error(`Evidence registry failed schema validation: ${check.diagnostics.map((d) => d.message).join("; ")}`);
  }

  await putObject(env, params.registryR2Key, JSON.stringify(registry, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  await createBlueprintRegistry(env.DB, {
    id: registryId,
    version: EVIDENCE_REGISTRY_VERSION,
    job_id: params.jobId,
    client_slug: params.clientSlug,
    site_version: params.siteVersion,
    evidence_attempt_id: params.evidenceAttemptId,
    registry_r2_key: params.registryR2Key,
    screenshot_evidence_r2_key: params.screenshotArtifactR2Key,
    checksum,
    created_at: registry.createdAt,
  });

  return { registry, registryId, registryR2Key: params.registryR2Key };
}

function classifyInteractionViewport(
  viewport: EvidenceInteractionCapture | InteractionCapture
): RegistryEntry["classification"] {
  if (!("motionMode" in viewport)) {
    return viewport.observations.some((observation) => observation.observed) ? "observed" : "inferred";
  }
  return dominantClassification(viewport.observations.map((observation) => observation.classification));
}

function dominantClassification(observations: string[]): RegistryEntry["classification"] {
  const order: RegistryEntry["classification"][] = ["observed", "detected", "inferred"];
  for (const cls of order) {
    if (observations.includes(cls)) return cls;
  }
  return "inferred";
}

async function checksumJson(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  return computeChecksum(encoded.buffer as ArrayBuffer);
}

// Load a persisted registry (for provenance validation during blueprint review).
export async function loadEvidenceRegistry(env: Env, registryR2Key: string): Promise<EvidenceRegistry | null> {
  const body = await getObject(env, registryR2Key);
  if (!body) return null;
  return new Response(body).json() as Promise<EvidenceRegistry>;
}
