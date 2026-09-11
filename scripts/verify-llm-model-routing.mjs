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

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
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
const codingPlan = readFileSync(join(ROOT, "src", "lib", "zai-coding-plan.ts"), "utf8");

const positives = [
  // Production runs the Z.AI Coding Plan only (operator GO 2026-09-11). The
  // top-level wrangler.jsonc IS the production deployment artifact.
  [wrangler.includes('"ZAI_CODING_BASE_URL": "https://api.z.ai/api/coding/paas/v4"'), 'wrangler.jsonc must set ZAI_CODING_BASE_URL to the Coding Plan endpoint'],
  [wrangler.includes('"ZAI_CODING_MODEL": "glm-5.3"'), 'wrangler.jsonc must set ZAI_CODING_MODEL="glm-5.3"'],
  [wrangler.includes('"ZAI_MULTIMODAL_MODEL": "glm-5.3-flash"'), 'wrangler.jsonc must set ZAI_MULTIMODAL_MODEL="glm-5.3-flash"'],
  // Retired multi-provider vars must be ABSENT from the production artifact.
  [!wrangler.includes("LLM_MODEL"), "wrangler.jsonc must NOT set LLM_MODEL (retired multi-provider seam var)"],
  [!wrangler.includes("PRIMARY_PROVIDER"), "wrangler.jsonc must NOT set PRIMARY_PROVIDER"],
  [!wrangler.includes("ZHIPU_API_URL"), "wrangler.jsonc must NOT set ZHIPU_API_URL"],
  [!wrangler.includes("ZHIPU_GATEWAY_PROVIDER"), "wrangler.jsonc must NOT set ZHIPU_GATEWAY_PROVIDER"],
  [!wrangler.includes("VISION_PRIMARY_PROVIDER"), "wrangler.jsonc must NOT set VISION_PRIMARY_PROVIDER"],
  [!wrangler.includes("VISION_FALLBACK_PROVIDER"), "wrangler.jsonc must NOT set VISION_FALLBACK_PROVIDER"],
  [!wrangler.includes("DESIGN_PIPELINE_VERSION"), "wrangler.jsonc must NOT set DESIGN_PIPELINE_VERSION (no runtime pipeline selector)"],
  [!wrangler.includes("CF_AI_GATEWAY_ID"), "wrangler.jsonc must NOT set CF_AI_GATEWAY_ID (production LLM has no AI Gateway dependency)"],
  [!wrangler.includes("EXP_BENCHMARK_DRIVER"), "wrangler.jsonc must NOT set EXP_BENCHMARK_DRIVER (experiment-only driver stays unavailable in production)"],
  // No non-Coding-Plan provider surface may appear in the production artifact.
  [!wrangler.includes("gateway.ai.cloudflare.com"), "wrangler.jsonc must NOT reference the Cloudflare AI Gateway endpoint"],
  [!wrangler.includes("api.z.ai/api/paas"), "wrangler.jsonc must NOT reference the Z.AI General API endpoint"],
  [!wrangler.includes("@cf/"), "wrangler.jsonc must NOT reference a Workers AI model"],
  [!/openrouter/i.test(wrangler), "wrangler.jsonc must NOT reference OpenRouter"],
  [!/workers[_ -]?ai/i.test(wrangler), "wrangler.jsonc must NOT reference Workers AI inference"],
  // Image model: canonical Nano Banana 2 Lite only (rollout GO §9) — a
  // production release with the retired z-image model must fail this gate.
  [wrangler.includes('"KIE_MODEL": "nano-banana-2-lite"'), 'wrangler.jsonc must set KIE_MODEL="nano-banana-2-lite"'],
  [!wrangler.includes("z-image"), "wrangler.jsonc must NOT reference the retired z-image image model"],
  // Test-harness config keeps the canonical model for the retained dead-seam
  // fixtures; it is not a deployment artifact.
  [wranglerTest.includes('"LLM_MODEL": "glm-5.3-flash"'), 'wrangler.test.jsonc must set LLM_MODEL="glm-5.3-flash"'],
  [gateway.includes('export const CANONICAL_LLM_MODEL = "glm-5.3-flash"'), "ai-gateway.ts must declare CANONICAL_LLM_MODEL = glm-5.3-flash"],
  [gateway.includes("resolveLlmModel"), "ai-gateway.ts must expose the resolveLlmModel seam"],
  // The ACTIVE production LLM seam is the Coding Plan transport.
  [codingPlan.includes('ZAI_CODING_PLAN_DEFAULT_BASE_URL = "https://api.z.ai/api/coding/paas/v4"'), "zai-coding-plan.ts must default to the Coding Plan endpoint"],
  [codingPlan.includes("env.ZAI_CODING_API_KEY"), "zai-coding-plan.ts must use the canonical ZAI_CODING_API_KEY credential"],
  [!codingPlan.includes("env.ZHIPU_API_URL"), "zai-coding-plan.ts must NOT reference the retired ZHIPU_API_URL var"],
  [codingPlan.includes('env.ZAI_CODING_MODEL || "glm-5.3"'), "zai-coding-plan.ts must resolve the coding model (glm-5.3) from the canonical var"],
  [codingPlan.includes('env.ZAI_MULTIMODAL_MODEL || "glm-5.3-flash"'), "zai-coding-plan.ts must resolve the multimodal model (glm-5.3-flash) from the canonical var"],
];

// Reachability proof (rollout GO §11): normal production generation must
// route to zai-coding-plan.ts and must NOT be able to reach the retired
// provider seams. ai-gateway.ts / ai-streaming.ts remain temporarily as
// dead/gated code; this gate proves they stay that way.
for (const file of [...walk(join(ROOT, "src"))]) {
  const name = file.split(/[\\/]/).pop();
  if (name === "zai-coding-plan.ts" || name === "env.d.ts") continue;
  const text = readFileSync(file, "utf8");
  // ai-streaming.ts itself belongs to the retained dead cluster; its import
  // of the gateway module is intra-cluster and dies with the same cleanup.
  if (/from\s+"\.\.\/lib\/ai-streaming"|from\s+"\.\/ai-streaming"/.test(text) && !["v2.exp-benchmark-driver.ts", "ai-streaming.ts"].includes(name)) {
    violations.push(`${file.replace(ROOT, "")}: imports ai-streaming outside the gated experiment driver`);
  }
  if (/from\s+"\.\.\/lib\/ai-gateway"|from\s+"\.\/ai-gateway"/.test(text) && !["ai-boundary.ts", "qa-stages.ts", "v2.exp-benchmark-driver.ts", "ai-streaming.ts"].includes(name)) {
    violations.push(`${file.replace(ROOT, "")}: imports the retired ai-gateway seam from an unexpected module`);
  }
  if (/generateVisionWithGateway|createProductionQaVisionGenerate/.test(text) && name !== "ai-gateway.ts" && name !== "qa-stages.ts") {
    violations.push(`${file.replace(ROOT, "")}: references the dead vision-gateway path outside its retired home`);
  }
}
for (const stage of ["visual-qa.ts", "design-blueprint.ts", "site-repair.ts"]) {
  const text = readFileSync(join(ROOT, "src", "simple-design", stage), "utf8");
  if (!/const generate: RawAiGenerate =\s*$/m.test(text) || !/input\.generate \?\?/.test(text)) {
    violations.push(`src/simple-design/${stage}: schema stage must pass an explicit (Coding Plan) generate override — the gateway default must stay unreachable`);
  }
}
// The active seam must remain imported by every normal-generation stage.
for (const importer of [
  join(ROOT, "src", "simple-design", "vision.ts"),
  join(ROOT, "src", "simple-design", "site-repair.ts"),
  join(ROOT, "src", "simple-design", "website-builder.ts"),
  join(ROOT, "src", "routes", "v2.exp-benchmark-driver.ts"),
]) {
  if (!existsSync(importer) || !readFileSync(importer, "utf8").includes("zai-coding-plan")) {
    violations.push(`${importer.replace(ROOT, "")}: expected to import the active zai-coding-plan seam`);
  }
}

const failedPositives = positives.filter(([ok]) => !ok).map(([, message]) => message);

if (violations.length > 0 || failedPositives.length > 0) {
  console.error("LLM model-routing hygiene gate FAILED:");
  for (const violation of violations) console.error(`  ${violation}`);
  for (const message of failedPositives) console.error(`  ${message}`);
  process.exit(1);
}

console.log(
  `LLM model-routing hygiene gate passed: ${files.length} file(s) scanned, ` +
    "Z.AI Coding Plan-only production config (Coding endpoint, glm-5.3 / glm-5.3-flash, " +
    "Nano Banana 2 Lite), retired provider vars absent, dead seams unreachable from generation."
);
