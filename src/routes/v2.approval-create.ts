import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyOperatorCapability } from "../lib/operator-capability";
import { getBuildStageArtifact } from "../domain/stage-artifacts";
import { approveBuildVersion, PublicationError } from "../domain/publication";

// Approval operator route (issue #29). The single HTTP surface for human
// Approval of one exact Release Ready Build Version, gated by a short-lived
// capability token minted offline with OPERATOR_CAPABILITY_SECRET.
//
// Denial order is fixed: an absent/invalid/expired token is 401, a validly
// signed token that does not bind THIS Build Version (wrong build, wrong
// version, or a manifest hash that no longer matches) is 403, and only a
// sufficient capability reaches the mutating service — so no state can change
// without authorization passing first.

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

export async function createApproval(c: Context<{ Bindings: Env }>): Promise<Response> {
  const authorization = c.req.header("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  const capability = await verifyOperatorCapability(c.env, bearer);
  if (!capability) {
    console.warn("approval operator route: denied — missing, invalid or expired capability");
    return c.json({ error: { code: "CAPABILITY_REQUIRED", message: "A valid, unexpired operator capability token is required" } }, 401);
  }
  if (capability.action !== "approve") {
    console.warn("approval operator route: denied — capability action is not approve");
    return c.json({ error: { code: "CAPABILITY_INSUFFICIENT", message: "This capability does not authorize Approval" } }, 403);
  }

  const buildVersionId = c.req.param("buildVersionId") as string;
  const version = await c.env.DB.prepare("SELECT build_id FROM build_versions WHERE id = ?")
    .bind(buildVersionId)
    .first<{ build_id: string }>();
  if (!version) {
    return c.json({ error: { code: "BUILD_VERSION_NOT_FOUND", message: `Build Version ${buildVersionId} does not exist` } }, 404);
  }

  // The capability must bind the exact version AND its current artifact
  // manifest hash; a token minted for any other state is insufficient.
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
    console.warn(`approval operator route: denied — capability does not bind Build Version ${buildVersionId} at its current manifest`);
    return c.json(
      {
        error: {
          code: "CAPABILITY_INSUFFICIENT",
          message: "This capability does not authorize Approval of this Build Version at its current manifest",
        },
      },
      403
    );
  }

  const raw = await c.req.text();
  let body: { approvedBy?: unknown; approvalNote?: unknown } = {};
  if (raw) {
    try {
      body = JSON.parse(raw) as { approvedBy?: unknown; approvalNote?: unknown };
    } catch {
      return c.json({ error: { code: "INVALID_JSON", message: "Request body must be JSON when provided" } }, 400);
    }
  }
  const approvedBy = typeof body.approvedBy === "string" ? body.approvedBy : undefined;
  const approvalNote = typeof body.approvalNote === "string" ? body.approvalNote : undefined;
  if ((approvedBy !== undefined && approvedBy.length > 200) || (approvalNote !== undefined && approvalNote.length > 500)) {
    return c.json({ error: { code: "INVALID_METADATA", message: "approvedBy must be at most 200 characters and approvalNote at most 500" } }, 400);
  }

  try {
    const approval = await approveBuildVersion(c.env, {
      buildId: version.build_id,
      buildVersionId,
      approvedBy,
      approvalNote,
    });
    return c.json(approval, 201);
  } catch (error) {
    if (error instanceof PublicationError) {
      return c.json({ error: { code: error.code, message: error.message } }, ERROR_STATUS[error.code]);
    }
    throw error;
  }
}
