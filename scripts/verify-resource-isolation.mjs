// Cloudflare resource-isolation gate (post-rollout hardening, 2026-09-12).
//
// Proven dangerous during the production rollout: a full `wrangler deploy`
// associates the named Workflow resource with the Worker being deployed, so
// production (cf-website-factory-v2) and the sandbox (cf-website-factory-sandbox)
// sharing the workflow resource name `website-build-workflow` let ONE
// environment's deploy capture the OTHER environment's Workflow — production
// instances then executed against sandbox code/bindings. See
// v2-docs/CLOUDFLARE-RESOURCE-ISOLATION-RUNBOOK.md.
//
// This gate parses wrangler.jsonc (production) and wrangler.exp.jsonc
// (sandbox/experimental) and FAILS unless every environment-sensitive
// Cloudflare resource is distinct:
//   Worker name · D1 database id · R2 bucket name · Workflow resource name.
// It also pins the production Workflow resource name to the canonical
// website-build-workflow (renaming it would be a production incident) and
// keeps the retired benchmark-driver switch out of production.
//
// Runs as part of `npm test` (before vitest).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Minimal JSONC reader: strips line comments and block comments WITHOUT
 *  touching comment-like sequences inside string literals (e.g. "https://…"). */
function parseJsonc(text) {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    out += ch;
  }
  return JSON.parse(out);
}

const prod = parseJsonc(readFileSync(join(ROOT, "wrangler.jsonc"), "utf8"));
const exp = parseJsonc(readFileSync(join(ROOT, "wrangler.exp.jsonc"), "utf8"));

const violations = [];
function expect(condition, message) {
  if (!condition) violations.push(message);
}

// ── Positive identity pins ──────────────────────────────────────────────────
// The production Worker and its canonical Workflow resource name are pinned:
// a silent rename of either would be a production incident, not cleanup.
expect(prod.name === "cf-website-factory-v2", `production Worker must be cf-website-factory-v2 (found '${prod.name}')`);
expect(exp.name === "cf-website-factory-sandbox", `sandbox Worker must be cf-website-factory-sandbox (found '${exp.name}')`);
expect(
  prod.workflows?.[0]?.name === "website-build-workflow",
  `production Workflow resource must stay website-build-workflow (found '${prod.workflows?.[0]?.name}')`
);
expect(
  exp.workflows?.[0]?.name === "website-build-workflow-sandbox",
  `sandbox Workflow resource must be website-build-workflow-sandbox (found '${exp.workflows?.[0]?.name}')`
);
// The Worker-level binding name is intentionally identical — it is scoped
// inside each Worker and carries no cross-environment identity.
expect(prod.workflows?.[0]?.binding === "WEBSITE_BUILD_WORKFLOW", "production workflow binding must remain WEBSITE_BUILD_WORKFLOW");
expect(exp.workflows?.[0]?.binding === "WEBSITE_BUILD_WORKFLOW", "sandbox workflow binding must remain WEBSITE_BUILD_WORKFLOW");
expect(prod.workflows?.[0]?.class_name === "WebsiteBuildWorkflow", "production workflow class must remain WebsiteBuildWorkflow");
expect(exp.workflows?.[0]?.class_name === "WebsiteBuildWorkflow", "sandbox workflow class must remain WebsiteBuildWorkflow");

// ── Isolation invariants (the collision class) ──────────────────────────────
expect(prod.name !== exp.name, "Worker names must differ between production and sandbox");
expect(
  prod.d1_databases?.[0]?.database_id !== exp.d1_databases?.[0]?.database_id,
  "D1 database ids must differ between production and sandbox"
);
expect(
  prod.r2_buckets?.[0]?.bucket_name !== exp.r2_buckets?.[0]?.bucket_name,
  "R2 bucket names must differ between production and sandbox"
);
expect(
  prod.workflows?.[0]?.name !== exp.workflows?.[0]?.name,
  `Workflow resource names must differ between production ('${prod.workflows?.[0]?.name}') and sandbox ('${exp.workflows?.[0]?.name}') — a shared name lets one deploy steal the other environment's Workflow`
);

// ── Retired experiment surface must stay out of production ─────────────────
expect(
  !JSON.stringify(prod.vars ?? {}).includes("EXP_BENCHMARK_DRIVER"),
  "production vars must NOT contain EXP_BENCHMARK_DRIVER (benchmark driver retired 2026-09-12)"
);

if (violations.length > 0) {
  console.error("Resource-isolation gate FAILED:");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(
  "Resource-isolation gate passed: production/sandbox Workers, D1 databases, R2 buckets and " +
    "Workflow resource names are all distinct; production Workflow identity and canonical vars pinned."
);
