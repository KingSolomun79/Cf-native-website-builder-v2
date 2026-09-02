#!/usr/bin/env node
// V2 production secret-name hygiene check (issue #33).
//
// Verifies — by NAME only, never by value (Worker secrets are write-only;
// `wrangler secret list` returns names) — that a target Worker has exactly
// the required V2 secrets, no retired V1 integration secrets, and nothing
// unexpected beyond the known optional set. Exit 0 = clean, 1 = violations.
//
//   node scripts/verify-v2-secrets.mjs [--worker cf-website-factory-v2]
//
// Requires wrangler authentication with read access to the account.

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    worker: { type: "string", default: "cf-website-factory-v2" },
  },
});

// Required by the V2 runtime (src/env.d.ts + route/domain usage). Each name
// is audited against actual source references — no stale doc names.
const REQUIRED = [
  "ZHIPU_API_KEY",            // Z.ai / Zhipu LLM provider (primary text + vision provider leg)
  "KIE_API_KEY",              // KIE.ai image generation
  "CF_AIG_TOKEN",             // Cloudflare AI Gateway auth (the working fallback leg)
  "CF_DEPLOY_API_TOKEN",      // Cloudflare Workers/static-assets deploy API
  "OPERATOR_CAPABILITY_SECRET", // Operator capability HMAC (approve/publish/rollback)
  "WEBHOOK_SECRET",           // Intake route HMAC (onboarding/build/revision)
];

// Optional: coded paths that activate only when the credential exists.
// OPENROUTER_API_KEY: operator decision 2026-09-02 — ZAI is primary and the
// AI Gateway is the working fallback; provider chains are key-driven, so an
// absent key skips the OpenRouter leg without error. TURNSTILE_SECRET_KEY:
// only required once any Site Configuration sets turnstile_required = 1.
const OPTIONAL = ["OPENROUTER_API_KEY", "TURNSTILE_SECRET_KEY"];

// Retired V1/interim integrations that must never exist on the V2 Worker
// (issue #33; corrected #28 removed the email-router architecture).
const RETIRED = [
  "SMTP2GO_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
  "APPROVAL_SECRET",
  "CANDIDATE_VALIDATION_SECRET",
  "WAZIBIZ_EMAIL_TRANSPORT_TOKEN",
];

let names;
try {
  const raw = execFileSync(
    "npx",
    ["wrangler", "secret", "list", "--name", values.worker],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" }
  );
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    die(`unexpected wrangler output for '${values.worker}' (no JSON array found)`);
  }
  names = JSON.parse(raw.slice(start, end + 1)).map((entry) => entry.name).sort();
} catch (error) {
  if (error && typeof error === "object" && "message" in error && String(error.message).startsWith("unexpected wrangler")) {
    die(String(error.message));
  }
  die(`could not list secrets for '${values.worker}': ${String(error.stderr ?? error.message).slice(0, 300)}`);
}

const present = new Set(names);
const problems = [];
const ok = (label) => console.log(`  ok      ${label}`);

console.log(`V2 secret-name hygiene for Worker '${values.worker}':`);
for (const name of REQUIRED) {
  if (present.has(name)) ok(name);
  else problems.push(`missing required secret: ${name}`);
}
for (const name of RETIRED) {
  if (present.has(name)) problems.push(`retired secret present: ${name}`);
  else ok(`absent (retired): ${name}`);
}
for (const name of OPTIONAL) {
  console.log(`  ${present.has(name) ? "present" : "absent "} (optional): ${name}`);
}
const known = new Set([...REQUIRED, ...OPTIONAL, ...RETIRED]);
for (const name of names) {
  if (!known.has(name)) problems.push(`unexpected secret outside the audited set: ${name}`);
}

if (problems.length > 0) {
  console.error("\nVIOLATIONS:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nclean: exactly the required V2 secret names, no retired names.");
console.log("Note: values are never readable — this checks names/presence only.");
console.log("Note: WAZIBIZ_SENDER_EMAIL is a var (not a secret); verify it via `wrangler versions view`.");
