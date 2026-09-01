import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyOperatorCapability } from "../lib/operator-capability";
import { rollbackPublication, PublicationError } from "../domain/publication";

// Rollback operator route (issue #29). Gates the rollback of one Site to its
// retained Rollback Version with a short-lived capability token minted
// offline with OPERATOR_CAPABILITY_SECRET.
//
// The capability must bind the Site AND the Build Version that is current at
// mint time: if any newer version has been published since the token was
// minted, the token no longer describes the state the operator reviewed and
// is denied as insufficient. Authorization fully precedes the mutating
// service call.

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

export async function rollbackSitePublication(c: Context<{ Bindings: Env }>): Promise<Response> {
  const authorization = c.req.header("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  const capability = await verifyOperatorCapability(c.env, bearer);
  if (!capability) {
    console.warn("rollback operator route: denied — missing, invalid or expired capability");
    return c.json({ error: { code: "CAPABILITY_REQUIRED", message: "A valid, unexpired operator capability token is required" } }, 401);
  }
  if (capability.action !== "rollback") {
    console.warn("rollback operator route: denied — capability action is not rollback");
    return c.json({ error: { code: "CAPABILITY_INSUFFICIENT", message: "This capability does not authorize Rollback" } }, 403);
  }

  const siteId = c.req.param("siteId") as string;
  if (capability.siteId !== siteId) {
    console.warn(`rollback operator route: denied — capability not bound to Site ${siteId}`);
    return c.json({ error: { code: "CAPABILITY_INSUFFICIENT", message: "This capability does not authorize Rollback of this Site" } }, 403);
  }

  // The token must still describe the live state: whatever is current now
  // must be the version the operator saw when the token was minted.
  const state = await c.env.DB.prepare(
    "SELECT current_build_version_id, rollback_build_version_id FROM site_published_state WHERE site_id = ?"
  )
    .bind(siteId)
    .first<{ current_build_version_id: string; rollback_build_version_id: string | null }>();
  if (!state || !state.rollback_build_version_id || capability.fromBuildVersionId !== state.current_build_version_id) {
    console.warn(`rollback operator route: denied — current Published Version no longer matches the capability for Site ${siteId}`);
    return c.json(
      {
        error: {
          code: "CAPABILITY_INSUFFICIENT",
          message: "This capability does not authorize Rollback of this Site's current Published Version (mint a fresh capability after reviewing current state)",
        },
      },
      403
    );
  }

  try {
    const rollback = await rollbackPublication(c.env, {
      siteId,
      // The state flip is conditional on the authorized-from version still
      // being current, closing the authorization-to-mutation race.
      expectedCurrentBuildVersionId: capability.fromBuildVersionId,
    });
    return c.json(rollback);
  } catch (error) {
    if (error instanceof PublicationError) {
      return c.json({ error: { code: error.code, message: error.message } }, ERROR_STATUS[error.code]);
    }
    throw error;
  }
}
