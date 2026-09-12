// SIMPLE qa-package/1 assembly + release finalization (spec sections 47-48,
// 54). The package is the ENTIRE input of the ONE repair; the release
// evaluation reuses the KEEP-list gate machinery (assignReleaseReady) through
// the honest mapping in release-mapping.ts.

import type { Env } from "../env.d";
import { assignReleaseReady, ReleaseGateError } from "../domain/release";
import { storeBuildStageArtifactIdempotent } from "../domain/stage-artifacts";
import { evaluateQaARelease, evaluateQaBRelease, type QaFinding } from "../domain/qa-stages";
import {
  QA_PACKAGE_SCHEMA_VERSION,
  type QaPackage,
  type VisualQaReport,
} from "./contracts";
import type { BundleQaResult } from "./bundle-qa";
import { simplePackageToQaA, simplePackageToQaB, type TechnicalGateResults } from "./release-mapping";

export interface SimpleQaPackageInput {
  buildVersionNumber: number;
  visual: VisualQaReport | null;
  deterministic: BundleQaResult;
  /** Null for ORIGINAL_DESIGN — no Reference exists (issue #24). */
  referenceScreenshotKeys: { desktop: string; mobile?: string } | null;
  candidateScreenshotKeys: { desktop: string; mobile?: string };
}

export function buildSimpleQaPackage(input: SimpleQaPackageInput): QaPackage {
  return {
    version: "1",
    buildVersionNumber: input.buildVersionNumber,
    visual: input.visual,
    truth: {
      findings: input.deterministic.truthFindings,
      blockerCount: input.deterministic.truthFindings.length,
    },
    technical: {
      findings: input.deterministic.technicalFindings,
      blockerCount: input.deterministic.technicalBlockerCount,
    },
    releaseReady: false,
    reasons: [],
    referenceScreenshotKeys: input.referenceScreenshotKeys,
    candidateScreenshotKeys: input.candidateScreenshotKeys,
  };
}

export async function storeSimpleQaPackage(
  env: Env,
  ids: { buildId: string; buildVersionId: string; siteGenerationId: string },
  pkg: QaPackage
): Promise<string> {
  const stored = await storeBuildStageArtifactIdempotent(env, {
    buildId: ids.buildId,
    buildVersionId: ids.buildVersionId,
    siteGenerationId: ids.siteGenerationId,
    kind: "qa_package",
    schemaVersion: QA_PACKAGE_SCHEMA_VERSION,
    value: pkg,
  });
  return stored.artifactR2Key;
}

export interface SimpleReleaseResult {
  releaseReady: boolean;
  reasons: string[];
  blockers: QaFinding[];
  polish: QaFinding[];
}

// Evaluates the package through the KEEP-list release gate. `gates` are the
// deterministic technical gate results backing the canonical QA-B ids.
export async function finalizeSimpleRelease(
  env: Env,
  ids: { buildId: string; buildVersionId: string; siteGenerationId: string },
  pkg: QaPackage,
  gates: TechnicalGateResults,
  evidenceR2Keys: string[]
): Promise<SimpleReleaseResult> {
  const qaA = simplePackageToQaA(pkg);
  const qaB = simplePackageToQaB(pkg, gates);
  try {
    const release = await assignReleaseReady(env, {
      buildId: ids.buildId,
      buildVersionId: ids.buildVersionId,
      siteGenerationId: ids.siteGenerationId,
      qaA,
      qaB,
      qaBuildVersionId: ids.buildVersionId,
      evidenceR2Keys,
    });
    return { releaseReady: release.releaseReady, reasons: release.reasons, blockers: release.blockers, polish: release.polish };
  } catch (error) {
    if (error instanceof ReleaseGateError && error.code === "RELEASE_ALREADY_ASSIGNED") {
      return { releaseReady: true, reasons: [], blockers: [], polish: [] };
    }
    throw error;
  }
}

// Pure mirrors of the release verdict for pipeline control flow (no writes).
export function simpleReleaseVerdict(pkg: QaPackage, gates: TechnicalGateResults): { releaseReady: boolean; reasons: string[] } {
  const qaA = simplePackageToQaA(pkg);
  const qaB = simplePackageToQaB(pkg, gates);
  const verdictA = evaluateQaARelease(qaA);
  const verdictB = evaluateQaBRelease(qaB);
  return {
    releaseReady: verdictA.releaseReady && verdictB.releaseReady,
    reasons: [...verdictA.reasons, ...verdictB.reasons],
  };
}
