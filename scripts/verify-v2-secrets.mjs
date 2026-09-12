#!/usr/bin/env node
// V2 secret-name hygiene check (issue #33; final secret hygiene 2026-09-12).
//
// Verifies — by NAME only, never by value (Worker secrets are write-only;
// `wrangler secret list` returns names) — that a target Worker has exactly
// the required V2 secrets for its profile, no retired integration secrets,
// and nothing unexpected beyond the known optional set. Exit 0 = clean.
//
//   node scripts/verify-v2-secrets.mjs [--worker cf-website-factory-v2] [--profile production]
//   node scripts/verify-v2-secrets.mjs --worker cf-website-factory-sandbox --profile sandbox
//
// Profiles: production (default) and sandbox. The sandbox intentionally runs
// WITHOUT OPERATOR_CAPABILITY_SECRET — its Approval/Publication routes fail
// closed (deny), which is the designed posture for a non-operator runtime.
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
    worker: { type: "string" },
    profile: { type: "string", default: "production" },
  },
});

const worker = values.worker ?? (values.profile === "sandbox" ? "cf-website-factory-sandbox" : "cf-website-factory-v2");

// The ONE LLM credential name on every environment (final secret hygiene
// 2026-09-12): ZAI_CODING_API_KEY. src/lib/zai-coding-plan.ts reads exactly
// this name and fails closed when it is absent — no alias, no fallback.
const REQUIRED_COMMON = [
  "ZAI_CODING_API_KEY",       // Z.AI Coding Plan — the ONE LLM provider credential
  "KIE_API_KEY",              // KIE.ai image generation
  "CF_DEPLOY_API_TOKEN",      // Cloudflare Workers/static-assets deploy API
  "WEBHOOK_SECRET",           // Intake route HMAC (onboarding/build/revision)
];

const PROFILES = {
  production: {
    required: [...REQUIRED_COMMON, "OPERATOR_CAPABILITY_SECRET"], // operator capability HMAC (approve/publish/rollback)
    optional: ["TURNSTILE_SECRET_KEY"], // required only when a Site Configuration sets turnstile_required = 1
  },
  sandbox: {
    // OPERATOR_CAPABILITY_SECRET deliberately absent: every operator release
    // route on the sandbox fails closed (deny-by-default, issue #29).
    required: [...REQUIRED_COMMON],
    optional: ["TURNSTILE_SECRET_KEY", "OPERATOR_CAPABILITY_SECRET"],
  },
};

const profile = PROFILES[values.profile];
if (!profile) die(`unknown profile '${values.profile}' (expected production|sandbox)`);

// Retired integrations that must never exist on a V2 Worker. Each deletion
// was executed only after zero-consumer proof (source + config reachability).
const RETIRED = [
  "SMTP2GO_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
  "APPROVAL_SECRET",
  "CANDIDATE_VALIDATION_SECRET",
  "WAZIBIZ_EMAIL_TRANSPORT_TOKEN",
  "OPENROUTER_API_KEY",
  "ZHIPU_API_KEY",          // legacy Coding Plan credential name — superseded by ZAI_CODING_API_KEY (2026-09-12)
  "CF_AIG_TOKEN",           // Cloudflare AI Gateway auth — retired with the multi-provider seams (2026-09-12)
  "EXP_BENCHMARK_SECRET",   // experiment benchmark driver — retired (2026-09-12)
  "EXP_BENCHMARK_DRIVER",   // experiment benchmark driver switch (var, listed defensively)
];

let names;
try {
  const raw = execFileSync(
    "npx",
    ["wrangler", "secret", "list", "--name", worker],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" }
  );
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    die(`unexpected wrangler output for '${worker}' (no JSON array found)`);
  }
  names = JSON.parse(raw.slice(start, end + 1)).map((entry) => entry.name).sort();
} catch (error) {
  if (error && typeof error === "object" && "message" in error && String(error.message).startsWith("unexpected wrangler")) {
    die(String(error.message));
  }
  die(`could not list secrets for '${worker}': ${String(error.stderr ?? error.message).slice(0, 300)}`);
}

const present = new Set(names);
const problems = [];
const ok = (label) => console.log(`  ok      ${label}`);

console.log(`V2 secret-name hygiene for Worker '${worker}' (profile: ${values.profile}):`);
for (const name of profile.required) {
  if (present.has(name)) ok(name);
  else problems.push(`missing required secret: ${name}`);
}
for (const name of RETIRED) {
  if (present.has(name)) problems.push(`retired secret present: ${name}`);
  else ok(`absent (retired): ${name}`);
}
for (const name of profile.optional) {
  console.log(`  ${present.has(name) ? "present" : "absent "} (optional): ${name}`);
}
const known = new Set([...profile.required, ...profile.optional, ...RETIRED]);
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
