// LLM model-routing hygiene gate (issue #30, Part 4).
//
// Node-context source scan proving no executable production routing retains a
// legacy LLM model or a retired per-provider model variable. Legacy names may
// appear only in historical evidence/migration docs — never in src/ runtime
// routing or in deployable wrangler configurations.
//
// Exclusions:
//   - this script itself;
//   - ai-gateway.ts's CANONICAL_LLM_MODEL declaration (the one allowed
//     literal, which the positive assertions below re-verify).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const FORBIDDEN = [
  "glm-4v",
  "glm-5-turbo",
  "glm-5.2",
  "glm-5\"",
  "glm-5'",
  "glm-5`",
  "xiaomi/mimo",
  "openai/gpt-4o",
  "ZHIPU_MODEL",
  "FALLBACK_MODEL",
  "VISION_MODEL",
  "VISION_PRIMARY_MODEL",
  "VISION_FALLBACK_MODEL",
];

const SCAN_DIRS = ["src", "scripts", "tests"];
const SCAN_FILES = ["wrangler.jsonc", "wrangler.test.jsonc"];
// The model-routing regression suite is the one sanctioned fixture that may
// name legacy models (always inside negative assertions).
const EXCLUDED_FILES = new Set(["verify-llm-model-routing.mjs", "v2-llm-model-routing.test.ts"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|mjs|jsonc|json)$/.test(entry)) yield full;
  }
}

const violations = [];
const files = [
  ...SCAN_DIRS.flatMap((dir) => [...walk(join(ROOT, dir))]),
  ...SCAN_FILES.map((file) => join(ROOT, file)),
];

for (const file of files) {
  if (EXCLUDED_FILES.has(file.split(/[\\/]/).pop())) continue;
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const needle of FORBIDDEN) {
      if (line.includes(needle)) {
        violations.push(`${file.replace(ROOT, "")}:${index + 1}: contains '${needle}'`);
      }
    }
  });
}

// Positive assertions: the canonical configuration actually exists.
const wrangler = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
const wranglerTest = readFileSync(join(ROOT, "wrangler.test.jsonc"), "utf8");
const gateway = readFileSync(join(ROOT, "src", "lib", "ai-gateway.ts"), "utf8");

const positives = [
  [wrangler.includes('"LLM_MODEL": "glm-5.3-flash"'), 'wrangler.jsonc must set LLM_MODEL="glm-5.3-flash"'],
  [wranglerTest.includes('"LLM_MODEL": "glm-5.3-flash"'), 'wrangler.test.jsonc must set LLM_MODEL="glm-5.3-flash"'],
  [gateway.includes('export const CANONICAL_LLM_MODEL = "glm-5.3-flash"'), "ai-gateway.ts must declare CANONICAL_LLM_MODEL = glm-5.3-flash"],
  [gateway.includes("resolveLlmModel"), "ai-gateway.ts must expose the resolveLlmModel seam"],
];

const failedPositives = positives.filter(([ok]) => !ok).map(([, message]) => message);

if (violations.length > 0 || failedPositives.length > 0) {
  console.error("LLM model-routing hygiene gate FAILED:");
  for (const violation of violations) console.error(`  ${violation}`);
  for (const message of failedPositives) console.error(`  ${message}`);
  process.exit(1);
}

console.log(
  `LLM model-routing hygiene gate passed: ${files.length} file(s) scanned, ` +
    "no legacy model routing, canonical glm-5.3-flash configured."
);
