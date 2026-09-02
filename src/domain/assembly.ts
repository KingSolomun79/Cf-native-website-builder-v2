// V2 Build Version assembly and Preview deployment (issue #12, PRD sections
// 5, 22, 25, 32.3).
//
// Assembly produces one immutable Build Version candidate: pages with image
// placeholders resolved to bundled Accepted Images (asset routing first — a
// slot without its own acceptance may reuse an Accepted Image of the same
// Blueprint role), a hashed artifact manifest, and project-controlled assets.
// Preview then deploys THAT EXACT candidate without regeneration; the
// deployment records the artifact manifest hash so the served bytes are
// traceable to the immutable version. Superseding a candidate creates a new
// Build Version, never a mutation.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { getObject, putImmutableObject, putImmutableObjectTolerant } from "../lib/assets";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { storeBuildStageArtifact, storeBuildStageArtifactIdempotent } from "./stage-artifacts";
import { buildVersionAssetKey, buildVersionManifestKey, buildVersionSourceKey } from "./artifact-keys";
import { runTechnicalPreflight } from "./technical-preflight";
import type { PreflightCheck } from "./technical-preflight";
import type { ImageSlot } from "./site-generator";

export interface AssemblyInput {
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  siteGenerationId: string;
  pages: Record<string, string>;
  sharedCss: string;
  sharedJs: string;
  imagePlanSlots: ImageSlot[];
  /** slotId -> project-controlled R2 key of the Accepted Image. */
  acceptedImages: Map<string, string>;
  formServiceEndpoint: string;
  expectedSiteFormId: string;
}

export interface AssembledCandidate {
  pages: Record<string, string>;
  sharedCss: string;
  sharedJs: string;
  /** Public path -> bytes for everything the candidate ships. */
  files: Map<string, Uint8Array>;
  artifactManifestHash: string;
  manifestR2Key: string;
  routingNotes: string[];
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class AssemblyPreflightError extends Error {
  constructor(readonly blockers: PreflightCheck[]) {
    super(`Technical Preflight rejected the candidate: ${blockers.map((blocker) => `${blocker.id} (${blocker.detail})`).join("; ")}`);
    this.name = "AssemblyPreflightError";
  }
}

export async function assembleBuildVersionCandidate(
  env: Env,
  input: AssemblyInput
): Promise<AssembledCandidate> {
  const routingNotes: string[] = [];
  const roleBySlot = new Map(input.imagePlanSlots.map((slot) => [slot.id, slot.blueprintRole]));
  const acceptedByRole = new Map<string, string>();
  for (const [slotId, r2Key] of input.acceptedImages) {
    const role = roleBySlot.get(slotId);
    if (role && !acceptedByRole.has(role)) acceptedByRole.set(role, r2Key);
  }

  // Resolve placeholders: own Accepted Image first, then asset routing to an
  // Accepted Image of the same Blueprint role.
  const publicPathBySlot = new Map<string, string>();
  for (const slot of input.imagePlanSlots) {
    const own = input.acceptedImages.get(slot.id);
    if (own) {
      publicPathBySlot.set(slot.id, `assets/images/${slot.id}.webp`);
      continue;
    }
    const routed = acceptedByRole.get(slot.blueprintRole);
    if (routed) {
      publicPathBySlot.set(slot.id, `assets/images/${slot.id}.webp`);
      routingNotes.push(`slot '${slot.id}' routed to the Accepted Image of role '${slot.blueprintRole}' (asset-routing before regeneration)`);
    }
    // No route: placeholder stays and Technical Preflight rejects it.
  }

  const pages: Record<string, string> = {};
  for (const [pageId, html] of Object.entries(input.pages)) {
    pages[pageId] = html.replace(/src="IMG:([a-zA-Z0-9_-]+)"/g, (full, slotId: string) =>
      publicPathBySlot.has(slotId) ? `src="assets/images/${slotId}.webp"` : full
    );
  }

  const files = new Map<string, Uint8Array>();
  const pageFiles: Record<string, string> = { home: "index.html", about: "about.html", services: "services.html", contact: "contact.html" };
  const encoder = new TextEncoder();
  for (const [pageId, html] of Object.entries(pages)) {
    files.set(pageFiles[pageId] ?? `${pageId}.html`, encoder.encode(html));
  }
  files.set("site.css", encoder.encode(input.sharedCss));
  files.set("site.js", encoder.encode(input.sharedJs));
  for (const [slotId, publicPath] of publicPathBySlot) {
    const r2Key = input.acceptedImages.get(slotId) ?? acceptedByRole.get(roleBySlot.get(slotId)!)!;
    const body = await getObject(env, r2Key);
    if (!body) continue;
    files.set(publicPath, new Uint8Array(await new Response(body).arrayBuffer()));
  }

  // Preflight BEFORE any release-facing persistence of the candidate.
  const preflight = runTechnicalPreflight(
    { pages, sharedCss: input.sharedCss, sharedJs: input.sharedJs },
    {
      formServiceEndpoint: input.formServiceEndpoint,
      expectedSiteFormId: input.expectedSiteFormId,
      criticalSlotIds: input.imagePlanSlots.filter((slot) => slot.priority === "CRITICAL").map((slot) => slot.id),
    }
  );

  const manifestEntries: Array<{ path: string; sha256: string; bytes: number }> = [];
  for (const [path, bytes] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    manifestEntries.push({ path, sha256: await sha256Hex(bytes), bytes: bytes.byteLength });
  }
  const artifactManifestHash = await sha256Hex(JSON.stringify(manifestEntries));
  const manifestR2Key = buildVersionManifestKey(input.buildId, input.buildVersionNumber);
  const manifestJson = JSON.stringify(
    { schemaVersion: "build-manifest/1", buildId: input.buildId, buildVersionId: input.buildVersionId, versionNumber: input.buildVersionNumber, artifactManifestHash, files: manifestEntries, routingNotes },
    null,
    2
  );

  if (!preflight.passed) {
    // Persist the rejected manifest for diagnosis, then stop: no Preview,
    // no QA, nothing ships.
    await putImmutableObject(env, manifestR2Key, manifestJson, { httpMetadata: { contentType: "application/json" } });
    throw new AssemblyPreflightError(preflight.blockers);
  }

  // Freeze the passing candidate under the canonical artifact scheme
  // (tolerant re-freeze: a retried workflow step finds its own writes).
  for (const [path, bytes] of files) {
    await putImmutableObjectTolerant(env, buildVersionSourceKey(input.buildId, input.buildVersionNumber, path), bytes);
  }
  for (const [slotId, publicPath] of publicPathBySlot) {
    const r2Key = input.acceptedImages.get(slotId) ?? acceptedByRole.get(roleBySlot.get(slotId)!)!;
    const body = await getObject(env, r2Key);
    if (!body) continue;
    await putImmutableObjectTolerant(env, buildVersionAssetKey(input.buildId, input.buildVersionNumber, `images/${slotId}.webp`), new Uint8Array(await new Response(body).arrayBuffer()));
  }
  await putImmutableObjectTolerant(env, manifestR2Key, manifestJson, { httpMetadata: { contentType: "application/json" } });
  await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "assembled_manifest",
    schemaVersion: "build-manifest/1",
    value: JSON.parse(manifestJson),
  });

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId,
    fromState: "ASSET_PERSISTENCE", toState: "ASSEMBLY", stage: "assembly",
    detail: `Immutable candidate assembled (manifest ${artifactManifestHash.slice(0, 12)}, ${files.size} files, ${routingNotes.length} routing fix(es))`,
  });
  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId,
    fromState: "ASSEMBLY", toState: "TECHNICAL_PREFLIGHT", stage: "technical_preflight",
    detail: `Technical Preflight passed (${preflight.checks.filter((item) => item.passed).length} checks)`,
  });

  return { pages, sharedCss: input.sharedCss, sharedJs: input.sharedJs, files, artifactManifestHash, manifestR2Key, routingNotes };
}

// ── Preview deployment ──────────────────────────────────────────────────────

export interface PreviewDeployer {
  (input: { workerName: string; files: Map<string, Uint8Array> }): Promise<{ previewUrl: string }>;
}

export interface DeployPreviewInput {
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  candidate: AssembledCandidate;
  deployer?: PreviewDeployer;
}

export interface PreviewDeployment {
  deploymentId: string;
  workerName: string;
  previewUrl: string;
  artifactManifestHash: string;
  alreadyActive: boolean;
}

// Deploys the exact preflight-passing Build Version as the Preview used for
// QA and human review — no regeneration between preflight and deploy.
export async function deployPreview(env: Env, input: DeployPreviewInput): Promise<PreviewDeployment> {
  const existing = await env.DB.prepare(
    "SELECT * FROM build_deployments WHERE build_version_id = ? AND role = 'preview' AND status = 'active'"
  )
    .bind(input.buildVersionId)
    .first<{ id: string; worker_name: string; preview_url: string; artifact_manifest_hash: string }>();
  if (existing && existing.artifact_manifest_hash === input.candidate.artifactManifestHash) {
    // Idempotent: the exact candidate is already serving as Preview.
    return {
      deploymentId: existing.id,
      workerName: existing.worker_name,
      previewUrl: existing.preview_url,
      artifactManifestHash: existing.artifact_manifest_hash,
      alreadyActive: true,
    };
  }

  const workerName = `b-${input.buildId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}-v${input.buildVersionNumber}`;
  const deployer: PreviewDeployer =
    input.deployer ??
    (async ({ workerName: name, files }) => {
      // Production default: the V2 assets-only deploy path. The preview
      // Worker serves the exact uploaded static assets with no script, no
      // per-site mail logic and no secret bindings (PRD section 35).
      const { uploadAssets, createStaticAssetsWorker, getWorkerPreviewUrl } = await import("../lib/publish");
      const upload = new Map<string, string | ArrayBuffer>();
      for (const [path, bytes] of files) upload.set(path, bytes.slice().buffer);
      const uploadJwt = await uploadAssets(env, name, upload);
      await createStaticAssetsWorker(env, name, uploadJwt);
      return { previewUrl: await getWorkerPreviewUrl(env, name) };
    });

  const deployed = await deployer({ workerName, files: input.candidate.files });
  const deploymentId = generateId();
  const now = nowIso();

  await env.DB.prepare(
    `INSERT INTO build_deployments (id, build_id, build_version_id, role, worker_name, preview_url, artifact_manifest_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, 'preview', ?, ?, ?, 'active', ?, ?)`
  )
    .bind(deploymentId, input.buildId, input.buildVersionId, workerName, deployed.previewUrl, input.candidate.artifactManifestHash, now, now)
    .run();

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId,
    fromState: "TECHNICAL_PREFLIGHT", toState: "PREVIEW", stage: "preview",
    detail: `Preview deployed exact candidate ${input.candidate.artifactManifestHash.slice(0, 12)} at ${deployed.previewUrl}`,
  });

  // Older Preview Deployments of this Build no longer hold the candidate
  // role; the retention lifecycle (issue #16) disposes of them.
  const { markSupersededPreviews } = await import("./retention");
  await markSupersededPreviews(env, { buildId: input.buildId, activeBuildVersionId: input.buildVersionId });

  return {
    deploymentId,
    workerName,
    previewUrl: deployed.previewUrl,
    artifactManifestHash: input.candidate.artifactManifestHash,
    alreadyActive: false,
  };
}
