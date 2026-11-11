// cf-site-gateway-v2 entry point (issue #48): deliberately small.
//
// Bindings (wrangler.gateway.jsonc): SELECT-only D1 (the canonical V2
// database), SITES_BASE_DOMAIN, PUBLISHED_ORIGIN_SUFFIX. No R2, no KIE,
// no Z.AI, no email, no workflows, no secrets beyond platform defaults.
//
// Activation in production is deliberately manual and LAST (issue #48
// deployment order): the wildcard DNS record and the Worker Route
// *.wazibiz.co.ke/* are applied only after the zone audit — this deploy
// never auto-attaches them.

import type { Env } from "../env.d";
import { handleSiteGatewayRequest } from "./gateway";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleSiteGatewayRequest(env, request);
  },
};
