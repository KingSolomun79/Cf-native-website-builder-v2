// V2 immutable Build stage artifact store (issue #8+, PRD section 22).
//
// Persists schema-validated stage outputs (Reference Analysis, Visual
// Blueprint, Implementation Contract, generated pages, ...) exactly once per
// (Build Version, kind, subkey). The R2 write is immutable and the D1 unique
// index makes re-production of the same artifact for the same Build Version
// a hard error: a repair that changes content must create a new Build
// Version.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { getObject, putImmutableObject } from "../lib/assets";
import { buildVersionRoot } from "./artifact-keys";
import type { AiProvenance } from "./ai-boundary";

export type StageArtifactKind =
  | "reference_analysis"
  | "visual_blueprint"
  | "implementation_contract"
  | "generated_page"
  | "generated_shared_source"
  | "image_plan"
  | "assembled_manifest"
  | "candidate_manifest"
  | "qa_evidence_bundle"
  | "qa_report"
  | "release_record"
  | "craft_preflight"
  // Experiment branch only (migrations/0035_v2_simple_design_experiment.sql):
  // SIMPLE design pipeline artifacts. Never produced by the legacy pipeline.
  | "design_blueprint"
  | "site_bundle"
  | "qa_package"
  // Per-file Builder resume artifacts (operator GO 2026-09-11 §20): one
  // immutable validated file per kind (site-css, page-home, ..., site-js).
  | `builder_file/${string}`;

export class StageArtifactError extends Error {
  readonly code: "ARTIFACT_ALREADY_EXISTS" | "BUILD_VERSION_NOT_FOUND" | "REPAIR_ARTIFACT_MISMATCH";

  constructor(code: "ARTIFACT_ALREADY_EXISTS" | "BUILD_VERSION_NOT_FOUND" | "REPAIR_ARTIFACT_MISMATCH", message: string) {
    super(message);
    this.name = "StageArtifactError";
    this.code = code;
  }
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface StoreStageArtifactInput {
  buildId: string;
  buildVersionId: string;
  siteGenerationId: string;
  kind: StageArtifactKind;
  subkey?: string;
  schemaVersion: string;
  value: unknown;
  provenance?: AiProvenance | null;
}

export interface StoredStageArtifact {
  artifactId: string;
  artifactR2Key: string;
  checksum: string;
}

export async function storeBuildStageArtifact(
  env: Env,
  input: StoreStageArtifactInput
): Promise<StoredStageArtifact> {
  const version = await env.DB.prepare(
    "SELECT version_number FROM build_versions WHERE id = ? AND build_id = ?"
  )
    .bind(input.buildVersionId, input.buildId)
    .first<{ version_number: number }>();
  if (!version) {
    throw new StageArtifactError(
      "BUILD_VERSION_NOT_FOUND",
      `Build Version ${input.buildVersionId} does not belong to Build ${input.buildId}`
    );
  }

  const subkey = input.subkey ?? "";
  const json = JSON.stringify(input.value);
  const checksum = await sha256Hex(json);
  const artifactId = generateId();
  const artifactR2Key = `${buildVersionRoot(input.buildId, version.version_number)}/${input.kind}${subkey ? `/${subkey}` : ""}.json`;

  try {
    await env.DB.prepare(
      `INSERT INTO build_stage_artifacts (
         id, build_id, build_version_id, site_generation_id, kind, subkey, schema_version,
         artifact_r2_key, provenance_json, checksum, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        artifactId,
        input.buildId,
        input.buildVersionId,
        input.siteGenerationId,
        input.kind,
        subkey,
        input.schemaVersion,
        artifactR2Key,
        input.provenance ? JSON.stringify(input.provenance) : null,
        checksum,
        nowIso()
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: build_stage_artifacts")) {
      throw new StageArtifactError(
        "ARTIFACT_ALREADY_EXISTS",
        `Artifact '${input.kind}${subkey ? `/${subkey}` : ""}' already exists for Build Version ${input.buildVersionId}; changed content requires a new Build Version`
      );
    }
    throw error;
  }

  await putImmutableObject(env, artifactR2Key, json, {
    httpMetadata: { contentType: "application/json" },
  });

  return { artifactId, artifactR2Key, checksum };
}

// Workflow-retry safety for pipeline-driven artifacts: when the artifact row
// already exists for this Build Version with the IDENTICAL checksum (the
// deterministic re-run reproduced it), the store is an idempotent success.
// Different content still rejects — immutability is not weakened.
export async function storeBuildStageArtifactIdempotent(
  env: Env,
  input: StoreStageArtifactInput
): Promise<StoredStageArtifact> {
  try {
    return await storeBuildStageArtifact(env, input);
  } catch (error) {
    if (error instanceof StageArtifactError && error.code === "ARTIFACT_ALREADY_EXISTS") {
      const checksum = await sha256Hex(JSON.stringify(input.value));
      const row = await env.DB.prepare(
        "SELECT id, artifact_r2_key, checksum FROM build_stage_artifacts WHERE build_version_id = ? AND kind = ? AND subkey = ?"
      )
        .bind(input.buildVersionId, input.kind, input.subkey ?? "")
        .first<{ id: string; artifact_r2_key: string; checksum: string }>();
      if (row && row.checksum === checksum) {
        return { artifactId: row.id, artifactR2Key: row.artifact_r2_key, checksum: row.checksum };
      }
    }
    throw error;
  }
}

export interface StageArtifactRecord<T = unknown> {
  artifactId: string;
  kind: StageArtifactKind;
  subkey: string;
  schemaVersion: string;
  artifactR2Key: string;
  checksum: string;
  provenance: AiProvenance | null;
  createdAt: string;
  value: T;
}

export async function getBuildStageArtifact<T>(
  env: Env,
  buildVersionId: string,
  kind: StageArtifactKind,
  subkey = ""
): Promise<StageArtifactRecord<T> | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM build_stage_artifacts WHERE build_version_id = ? AND kind = ? AND subkey = ?"
  )
    .bind(buildVersionId, kind, subkey)
    .first<{
      id: string;
      kind: StageArtifactKind;
      subkey: string;
      schema_version: string;
      artifact_r2_key: string;
      checksum: string;
      provenance_json: string | null;
      created_at: string;
    }>();
  if (!row) return null;
  const body = await getObject(env, row.artifact_r2_key);
  if (!body) return null;
  return {
    artifactId: row.id,
    kind: row.kind,
    subkey: row.subkey,
    schemaVersion: row.schema_version,
    artifactR2Key: row.artifact_r2_key,
    checksum: row.checksum,
    provenance: row.provenance_json ? (JSON.parse(row.provenance_json) as AiProvenance) : null,
    createdAt: row.created_at,
    value: JSON.parse(await new Response(body).text()) as T,
  };
}
