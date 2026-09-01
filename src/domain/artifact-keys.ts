// V2 Build artifact key scheme (PRD section 22).
//
// Canonical generated source and evidence for each immutable Build Version:
//   builds/{buildId}/v{versionNumber}/source/...
//   builds/{buildId}/v{versionNumber}/assets/...
//   builds/{buildId}/v{versionNumber}/manifest.json
//   builds/{buildId}/v{versionNumber}/evidence/...
//   builds/{buildId}/v{versionNumber}/ai/{stage}/{runId}.json
//   builds/{buildId}/v{versionNumber}/qa/...
//
// All writers use immutable puts; a key that exists is never overwritten.

export function buildVersionRoot(buildId: string, versionNumber: number): string {
  return `builds/${buildId}/v${versionNumber}`;
}

export function buildVersionSourceKey(buildId: string, versionNumber: number, path: string): string {
  return `${buildVersionRoot(buildId, versionNumber)}/source/${path.replace(/^\/+/, "")}`;
}

export function buildVersionAssetKey(buildId: string, versionNumber: number, path: string): string {
  return `${buildVersionRoot(buildId, versionNumber)}/assets/${path.replace(/^\/+/, "")}`;
}

export function buildVersionManifestKey(buildId: string, versionNumber: number): string {
  return `${buildVersionRoot(buildId, versionNumber)}/manifest.json`;
}

export function buildVersionEvidenceKey(buildId: string, versionNumber: number, path: string): string {
  return `${buildVersionRoot(buildId, versionNumber)}/evidence/${path.replace(/^\/+/, "")}`;
}

export function aiStageArtifactKey(
  buildId: string,
  versionNumber: number,
  stage: string,
  runId: string
): string {
  return `${buildVersionRoot(buildId, versionNumber)}/ai/${stage}/${runId}.json`;
}

export function qaArtifactKey(buildId: string, versionNumber: number, path: string): string {
  return `${buildVersionRoot(buildId, versionNumber)}/qa/${path.replace(/^\/+/, "")}`;
}
