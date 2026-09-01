import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyOperatorCapability } from "../lib/operator-capability";
import { getBuildStageArtifact } from "../domain/stage-artifacts";
import { publishApprovedBuildVersion, PublicationError } from "../domain/publication";

// Publication operator route (issue #31). The single HTTP surface for the
// operational act of making one exact approved Build Version live, gated by a
// short-lived publish capability token minted offline with
// OPERATOR_CAPABILITY_SECRET. Publication has its own action-bound capability:
// an Approval or Rollback capability is structurally insufficient here, and
// this token cannot Approve or Roll back either.
//
// Denial order is fixed: an absent/invalid/expired token is 401, a validly
// signed token that does not bind THIS Build Version at ITS current manifest
// (wrong build, wrong version, wrong action, or manifest drift since minting)
// is 403, and only a sufficient capability reaches the mutating service.
//
// TOCTOU (the #29 Rollback race class): the route authorizes against the
// version's current manifest hash, and publishApprovedBuildVersion re-enforces
// the authorized hash at the mutation boundary (expectedArtifactManifestHash)
// plus the standing approval-hash guard — so a state change between
// verification and Publication cannot authorize one version and mutate
// another. The mutation targets exactly the buildVersionId in the path; no
// newer candidate can be implicitly selected.

const ERROR_STATUS: Record<PublicationError["code"], 404 | 409 | 500> = {
  BUILD_NOT_FOUND: 404,
  NOT_RELEASE_READY: 409,
  NOT_APPROVED: 409,
  ALREADY_APPROVED: 409,
  APPROVAL_HASH_MISMATCH: 409,
  PUBLISH_FAILED: 500,
  NO_ROLLBACK_VERSION: 409,
  ROLLBACK_WINDOW_EXPIRED: 409,
};

export async function createPublication(c: Context<{ Bindings: Env }>): Promise<Response> {
  const authorization = c.req.header("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  const capability = await verifyOperatorCapability(c.env, bearer);
  if (!capability) {
    console.warn("publication operator route: denied — missing, invalid or expired capability");
    return c.json({ error: { code: "CAPABILITY_REQUIRED", message: "A valid, unexpired operator capability token is required" } }, 401);
  }
  if (capability.action !== "publish") {
    console.warn("publication operator route: denied — capability action is not publish");
    return c.json({ error: { code: "CAPABILITY_INSUFFICIENT", message: "This capability does not authorize Publication" } }, 403);
  }

  const buildVersionId = c.req.param("buildVersionId") as string;
  const version = await c.env.DB.prepare(
    `SELECT bv.build_id, bv.version_number, sg.site_id
     FROM build_versions bv
     JOIN builds b ON b.id = bv.build_id
     JOIN site_generations sg ON sg.id = b.site_generation_id
     WHERE bv.id = ?`
  )
    .bind(buildVersionId)
    .first<{ build_id: string; version_number: number; site_id: string }>();
  if (!version) {
    return c.json({ error: { code: "BUILD_VERSION_NOT_FOUND", message: `Build Version ${buildVersionId} does not exist` } }, 404);
  }

  // The capability must bind the exact version AND its current artifact
  // manifest hash; a token minted for any other state — including this
  // version before a manifest change — is insufficient.
  const manifest = await getBuildStageArtifact<{ artifactManifestHash: string }>(
    c.env,
    buildVersionId,
    "assembled_manifest"
  );
  if (
    capability.buildVersionId !== buildVersionId ||
    capability.buildId !== version.build_id ||
    !manifest ||
    capability.artifactManifestHash !== manifest.value.artifactManifestHash
  ) {
    console.warn(`publication operator route: denied — capability does not bind Build Version ${buildVersionId} at its current manifest`);
    return c.json(
      {
        error: {
          code: "CAPABILITY_INSUFFICIENT",
          message: "This capability does not authorize Publication of this Build Version at its current manifest",
        },
      },
      403
    );
  }

  try {
    const publication = await publishApprovedBuildVersion(c.env, {
      siteId: version.site_id,
      buildId: version.build_id,
      buildVersionId,
      buildVersionNumber: version.version_number,
      expectedArtifactManifestHash: capability.artifactManifestHash,
    });
    // 201 for a new publication, 200 for the idempotent re-publish of the
    // exact version that is already the current Published Version.
    return c.json(publication, publication.alreadyPublished ? 200 : 201);
  } catch (error) {
    if (error instanceof PublicationError) {
      return c.json({ error: { code: error.code, message: error.message } }, ERROR_STATUS[error.code]);
    }
    throw error;
  }
}
