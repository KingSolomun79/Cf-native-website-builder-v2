// Shared platform types for the V2 runtime. The V1 product type surface
// (clients, jobs, site versions, intake, blueprints, prompt registry, QA
// reports, contact delivery) was removed with the migration contraction, and
// the legacy provider-chain types (chat completions, gateway metadata, the
// V1 image-provider abstraction) were removed with the retired multi-provider
// seams (post-rollout hardening 2026-09-12). What remains is the browser
// boundary diagnostics contract.

export interface NavDiagnostics {
  initialUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  redirectChain: RedirectEntry[];
  failedResources: FailedResource[];
  blockedResources: BlockedResource[];
  timedOut: boolean;
  overlayLimitations: string[];
}

export interface RedirectEntry {
  url: string;
  status: number | null;
}

export interface FailedResource {
  url: string;
  type: string | null;
  reason: string;
}

export interface BlockedResource {
  url: string;
  reason: string;
}
