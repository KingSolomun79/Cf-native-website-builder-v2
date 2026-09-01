#!/usr/bin/env node
// Offline minting of operator capability tokens (issue #29).
//
// The Worker never mints: Approval and Rollback capabilities are produced
// here, on an operator machine, using OPERATOR_CAPABILITY_SECRET (Worker
// secret — `wrangler secret put OPERATOR_CAPABILITY_SECRET`). The canonical
// signing form must stay byte-identical to src/lib/operator-capability.ts
// (pinned by the known-answer vector in tests/v2-operator-capability.test.ts).
//
// Usage:
//   node scripts/mint-operator-capability.mjs approve \
//     --build-id <id> --build-version-id <id> --artifact-manifest-hash <hash> \
//     [--ttl-minutes 30]
//   node scripts/mint-operator-capability.mjs rollback \
//     --site-id <id> --from-build-version-id <current published version id> \
//     [--ttl-minutes 30]
//
// The secret is read from --secret or $OPERATOR_CAPABILITY_SECRET.

import { createHmac } from "node:crypto";
import { parseArgs } from "node:util";

const MAX_TTL_MINUTES = 60; // must match OPERATOR_CAPABILITY_MAX_TTL_MS

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function canonical(payload) {
  switch (payload.action) {
    case "approve":
      return `v2opcap/1:approve:${payload.buildId}:${payload.buildVersionId}:${payload.artifactManifestHash}:${payload.exp}`;
    case "rollback":
      return `v2opcap/1:rollback:${payload.siteId}:${payload.fromBuildVersionId}:${payload.exp}`;
  }
}

function base64UrlEncode(data) {
  return Buffer.from(data, "utf8").toString("base64url");
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    secret: { type: "string" },
    "build-id": { type: "string" },
    "build-version-id": { type: "string" },
    "artifact-manifest-hash": { type: "string" },
    "site-id": { type: "string" },
    "from-build-version-id": { type: "string" },
    "ttl-minutes": { type: "string", default: "30" },
  },
});

const [action] = positionals;
const secret = values.secret ?? process.env.OPERATOR_CAPABILITY_SECRET;
if (!secret) die("missing secret: pass --secret or set OPERATOR_CAPABILITY_SECRET");

const ttlMinutes = Number(values["ttl-minutes"]);
if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0 || ttlMinutes > MAX_TTL_MINUTES) {
  die(`--ttl-minutes must be between 1 and ${MAX_TTL_MINUTES}`);
}
const exp = Date.now() + ttlMinutes * 60_000;

let payload;
if (action === "approve") {
  const { "build-id": buildId, "build-version-id": buildVersionId, "artifact-manifest-hash": hash } = values;
  if (!buildId || !buildVersionId || !hash) die("approve requires --build-id, --build-version-id and --artifact-manifest-hash");
  payload = { action, buildId, buildVersionId, artifactManifestHash: hash, exp };
} else if (action === "rollback") {
  const { "site-id": siteId, "from-build-version-id": fromBuildVersionId } = values;
  if (!siteId || !fromBuildVersionId) die("rollback requires --site-id and --from-build-version-id");
  payload = { action, siteId, fromBuildVersionId, exp };
} else {
  die(`unknown action '${action ?? ""}' (expected 'approve' or 'rollback')`);
}

const sig = createHmac("sha256", secret).update(canonical(payload)).digest("hex");
const token = base64UrlEncode(JSON.stringify({ ...payload, sig }));
const expiresAt = new Date(exp).toISOString();

console.log(`capability: ${action}`);
console.log(`expires at: ${expiresAt} (TTL ${ttlMinutes}m, ceiling ${MAX_TTL_MINUTES}m)`);
console.log(`token:\n${token}`);
