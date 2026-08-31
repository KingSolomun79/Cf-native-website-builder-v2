import type { Env } from "../env.d";

export async function putObject(
  env: Env,
  key: string,
  value: ArrayBuffer | ReadableStream | string,
  options?: R2PutOptions
): Promise<void> {
  await env.SITE_BUCKET.put(key, value, options);
}

export async function putImmutableObject(
  env: Env,
  key: string,
  value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
  options?: Omit<R2PutOptions, "onlyIf">
): Promise<void> {
  const stored = await env.SITE_BUCKET.put(key, value, {
    ...options,
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (!stored) {
    throw new Error(`Immutable R2 artifact already exists: ${key}`);
  }
}

export async function getObject(
  env: Env,
  key: string
): Promise<ReadableStream | null> {
  const obj = await env.SITE_BUCKET.get(key);
  return obj?.body ?? null;
}

export async function getObjectWithMetadata(
  env: Env,
  key: string
): Promise<R2ObjectBody | null> {
  return env.SITE_BUCKET.get(key) ?? null;
}

export async function deleteObject(env: Env, key: string): Promise<void> {
  await env.SITE_BUCKET.delete(key);
}

export function intakePayloadKey(clientSlug: string, jobId: string): string {
  return `${clientSlug}/intake/raw/${jobId}.json`;
}

export function logoOriginalKey(clientSlug: string): string {
  return `${clientSlug}/branding/logo/original`;
}

export function logoNormalizedKey(clientSlug: string): string {
  return `${clientSlug}/branding/logo/normalized.webp`;
}

export function siteSpecKey(clientSlug: string, jobId: string): string {
  return `${clientSlug}/prompts/site-spec/${jobId}.json`;
}

export function versionPrefix(clientSlug: string, version: number): string {
  return `${clientSlug}/versions/v${version}`;
}

export function bundlePrefix(clientSlug: string, version: number): string {
  return `${clientSlug}/versions/v${version}/bundle`;
}

export function pageImageKey(
  clientSlug: string,
  version: number,
  page: string,
  filename: string
): string {
  return `${clientSlug}/versions/v${version}/pages/${page}/images/${filename}`;
}

export function qaAttemptScreenshotKey(
  clientSlug: string,
  version: number,
  attempt: number,
  viewport: string,
  page: string
): string {
  return `${clientSlug}/versions/v${version}/qa/attempts/${attempt}/screenshots/${viewport}/${page}.png`;
}

export function qaReportKey(clientSlug: string, version: number): string {
  return `${clientSlug}/versions/v${version}/qa/reports/qa-report.json`;
}

export function qaInteractionEvidenceKey(clientSlug: string, version: number, attempt: number): string {
  return `${clientSlug}/versions/v${version}/qa/attempts/${attempt}/interactions.json`;
}

export function qaAttemptReportKey(clientSlug: string, version: number, attempt: number): string {
  return `${clientSlug}/versions/v${version}/qa/attempts/${attempt}/report.json`;
}

export function referenceScreenshotKey(
  clientSlug: string,
  version: number,
  jobId: string,
  checksumShort: string
): string {
  return `${clientSlug}/versions/v${version}/reference/homepage-screenshot/${jobId}/${checksumShort}.png`;
}

export function referenceUploadStagingKey(uploadId: string): string {
  return `_staging/reference-uploads/${uploadId}.png`;
}

export function referenceCaptureScreenshotKey(clientSlug: string, version: number, viewport: string): string {
  return `${clientSlug}/versions/v${version}/reference/capture/${viewport}/homepage.png`;
}

export function referenceCaptureJsonKey(clientSlug: string, version: number, viewport: string): string {
  return `${clientSlug}/versions/v${version}/reference/capture/${viewport}/capture.json`;
}

export function referenceCaptureManifestKey(clientSlug: string, version: number): string {
  return `${clientSlug}/versions/v${version}/reference/capture/manifest.json`;
}

export function referenceInteractionsKey(clientSlug: string, version: number, viewport: string): string {
  return `${clientSlug}/versions/v${version}/reference/interaction/${viewport}/interactions.json`;
}

export function referenceInteractionsManifestKey(clientSlug: string, version: number): string {
  return `${clientSlug}/versions/v${version}/reference/interaction/manifest.json`;
}

export function visionAttemptDiagnosticsKey(
  clientSlug: string,
  version: number,
  jobId: string,
  stage: string,
  attemptId: string
): string {
  return `${clientSlug}/versions/v${version}/vision/attempts/${jobId}/${stage}/${attemptId}.json`;
}

export function canonicalScreenshotEvidenceKey(clientSlug: string, version: number, jobId: string): string {
  return `${clientSlug}/versions/v${version}/reference/screenshot-evidence/${jobId}.json`;
}

export function visionInputDerivativeKey(
  clientSlug: string,
  version: number,
  jobId: string,
  checksum: string
): string {
  return `${clientSlug}/versions/v${version}/reference/vision-inputs/${jobId}/${checksum}.webp`;
}

export function candidateValidationArtifactKey(runId: string, name: string): string {
  return `candidate-validation/attempts/${runId}/${name}`;
}

// ── Phase 16.R3: attempt-scoped immutable evidence keys ────────────────────
// Every artifact lives under attempts/{attemptId}/... and is never overwritten.
// {client}/versions/v{n}/reference/attempts/{attemptId}/capture/{viewport}/{file}
// {client}/versions/v{n}/reference/attempts/{attemptId}/interaction/{viewport}/{motionMode}/{file}
export function evidenceCaptureScreenshotKey(
  clientSlug: string,
  version: number,
  attemptId: string,
  viewport: string
): string {
  return `${clientSlug}/versions/v${version}/reference/attempts/${attemptId}/capture/${viewport}/screenshot.png`;
}

export function evidenceCaptureRawKey(
  clientSlug: string,
  version: number,
  attemptId: string,
  viewport: string
): string {
  return `${clientSlug}/versions/v${version}/reference/attempts/${attemptId}/capture/${viewport}/raw.json`;
}

export function evidenceCaptureJsonKey(
  clientSlug: string,
  version: number,
  attemptId: string,
  viewport: string
): string {
  return `${clientSlug}/versions/v${version}/reference/attempts/${attemptId}/capture/${viewport}/capture.json`;
}

export function evidenceCaptureManifestKey(
  clientSlug: string,
  version: number,
  attemptId: string
): string {
  return `${clientSlug}/versions/v${version}/reference/attempts/${attemptId}/capture/manifest.json`;
}

export function evidenceInteractionsKey(
  clientSlug: string,
  version: number,
  attemptId: string,
  viewport: string,
  motionMode: string
): string {
  return `${clientSlug}/versions/v${version}/reference/attempts/${attemptId}/interaction/${viewport}/${motionMode}/interactions.json`;
}

export function evidenceInteractionsRawKey(
  clientSlug: string,
  version: number,
  attemptId: string,
  viewport: string,
  motionMode: string
): string {
  return `${clientSlug}/versions/v${version}/reference/attempts/${attemptId}/interaction/${viewport}/${motionMode}/raw.json`;
}

export function evidenceInteractionsTraceKey(
  clientSlug: string,
  version: number,
  attemptId: string,
  viewport: string,
  motionMode: string
): string {
  return `${clientSlug}/versions/v${version}/reference/attempts/${attemptId}/interaction/${viewport}/${motionMode}/trace.json`;
}

export function evidenceInteractionTraceKey(
  clientSlug: string,
  version: number,
  attemptId: string,
  viewport: string,
  motionMode: string,
  observationId: string
): string {
  return `${clientSlug}/versions/v${version}/reference/attempts/${attemptId}/interaction/${viewport}/${motionMode}/traces/${observationId}.json`;
}

export function evidenceInteractionsManifestKey(
  clientSlug: string,
  version: number,
  attemptId: string
): string {
  return `${clientSlug}/versions/v${version}/reference/attempts/${attemptId}/interaction/manifest.json`;
}

export function designBlueprintKey(clientSlug: string, version: number): string {
  return `${clientSlug}/versions/v${version}/blueprints/design.json`;
}

export function interactionBlueprintKey(clientSlug: string, version: number): string {
  return `${clientSlug}/versions/v${version}/blueprints/interaction.json`;
}

export function blueprintValidationKey(clientSlug: string, version: number): string {
  return `${clientSlug}/versions/v${version}/blueprints/validation.json`;
}

// ── Phase 16.R4: immutable attempt-scoped blueprint R2 keys ────────────────
// {client}/versions/v{n}/blueprints/registries/{registryId}/{file}
// {client}/versions/v{n}/blueprints/attempts/{attemptId}/{file}
// Every artifact lives under its registry/attempt prefix and is never overwritten.
export function blueprintRegistryKey(clientSlug: string, version: number, registryId: string): string {
  return `${clientSlug}/versions/v${version}/blueprints/registries/${registryId}/registry.json`;
}

export function blueprintAttemptDesignKey(clientSlug: string, version: number, attemptId: string): string {
  return `${clientSlug}/versions/v${version}/blueprints/attempts/${attemptId}/design.json`;
}

export function blueprintAttemptInteractionKey(clientSlug: string, version: number, attemptId: string): string {
  return `${clientSlug}/versions/v${version}/blueprints/attempts/${attemptId}/interaction.json`;
}

export function blueprintAttemptValidationKey(clientSlug: string, version: number, attemptId: string): string {
  return `${clientSlug}/versions/v${version}/blueprints/attempts/${attemptId}/validation.json`;
}

export function blueprintAttemptReviewKey(clientSlug: string, version: number, attemptId: string): string {
  return `${clientSlug}/versions/v${version}/blueprints/attempts/${attemptId}/review.json`;
}

export function blueprintAttemptPromptInputKey(clientSlug: string, version: number, attemptId: string): string {
  return `${clientSlug}/versions/v${version}/blueprints/attempts/${attemptId}/prompt-input.json`;
}

export function provenanceArtifactKey(clientSlug: string, version: number, artifactId: string): string {
  return `${clientSlug}/versions/v${version}/provenance/${artifactId}/manifest.json`;
}
