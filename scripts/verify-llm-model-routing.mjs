// LLM model-routing hygiene gate (issue #30, Part 4; post-rollout hardening
// edition 2026-09-12).
//
// Node-context source scan proving V2 has EXACTLY ONE LLM provider path: the
// Z.AI Coding Plan (src/lib/zai-coding-plan.ts). The legacy multi-provider
// experiment seams (Cloudflare AI Gateway chain, OpenRouter leg, Z.AI General
// API streaming, Workers AI transport, benchmark driver) were REMOVED — this
// gate fails if any of them ever reappears.
//
// Exclusions:
//   - this script itself;
//   - the model-routing regression suite (sanctioned to discuss legacy
//     names inside negative assertions).

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
const SCAN_FILES = ["wrangler.jsonc", "wrangler.exp.jsonc", "wrangler.test.jsonc"];
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
const wranglerExp = readFileSync(join(ROOT, "wrangler.exp.jsonc"), "utf8");
const wranglerTest = readFileSync(join(ROOT, "wrangler.test.jsonc"), "utf8");
const codingPlanPath = join(ROOT, "src", "lib", "zai-coding-plan.ts");
const codingPlan = readFileSync(codingPlanPath, "utf8");

const positives = [
  // Production runs the Z.AI Coding Plan only (operator GO 2026-09-11). The
  // top-level wrangler.jsonc IS the production deployment artifact.
  [wrangler.includes('"ZAI_CODING_BASE_URL": "https://api.z.ai/api/coding/paas/v4"'), 'wrangler.jsonc must set ZAI_CODING_BASE_URL to the Coding Plan endpoint'],
  [wrangler.includes('"ZAI_CODING_MODEL": "glm-5.3"'), 'wrangler.jsonc must set ZAI_CODING_MODEL="glm-5.3"'],
  [wrangler.includes('"ZAI_MULTIMODAL_MODEL": "glm-5.3-flash"'), 'wrangler.jsonc must set ZAI_MULTIMODAL_MODEL="glm-5.3-flash"'],
  // Retired multi-provider vars must be ABSENT from every deployable artifact.
  [!wrangler.includes("LLM_MODEL"), "wrangler.jsonc must NOT set LLM_MODEL (retired multi-provider seam var)"],
  [!wrangler.includes("PRIMARY_PROVIDER"), "wrangler.jsonc must NOT set PRIMARY_PROVIDER"],
  [!wrangler.includes("ZHIPU_API_URL"), "wrangler.jsonc must NOT set ZHIPU_API_URL"],
  [!wrangler.includes("ZHIPU_GATEWAY_PROVIDER"), "wrangler.jsonc must NOT set ZHIPU_GATEWAY_PROVIDER"],
  [!wrangler.includes("VISION_PRIMARY_PROVIDER"), "wrangler.jsonc must NOT set VISION_PRIMARY_PROVIDER"],
  [!wrangler.includes("VISION_FALLBACK_PROVIDER"), "wrangler.jsonc must NOT set VISION_FALLBACK_PROVIDER"],
  [!wrangler.includes("DESIGN_PIPELINE_VERSION"), "wrangler.jsonc must NOT set DESIGN_PIPELINE_VERSION (no runtime pipeline selector)"],
  [!wrangler.includes("CF_AI_GATEWAY_ID"), "wrangler.jsonc must NOT set CF_AI_GATEWAY_ID (production LLM has no AI Gateway dependency)"],
  [!wrangler.includes("EXP_BENCHMARK_DRIVER"), "wrangler.jsonc must NOT set EXP_BENCHMARK_DRIVER (the benchmark driver is retired)"],
  [!wranglerTest.includes("LLM_MODEL"), "wrangler.test.jsonc must NOT set LLM_MODEL (retired multi-provider seam var)"],
  [!wranglerTest.includes("OPENROUTER_API_KEY"), "wrangler.test.jsonc must NOT set OPENROUTER_API_KEY"],
  [!wranglerTest.includes("CF_AIG_TOKEN"), "wrangler.test.jsonc must NOT set CF_AIG_TOKEN"],
  // The sandbox artifact is Coding-Plan-only too (no experiment transports,
  // no benchmark driver switch).
  [wranglerExp.includes('"ZAI_CODING_BASE_URL": "https://api.z.ai/api/coding/paas/v4"'), "wrangler.exp.jsonc must set ZAI_CODING_BASE_URL to the Coding Plan endpoint"],
  [!wranglerExp.includes("LLM_MODEL"), "wrangler.exp.jsonc must NOT set LLM_MODEL (retired multi-provider seam var)"],
  [!wranglerExp.includes("PRIMARY_PROVIDER"), "wrangler.exp.jsonc must NOT set PRIMARY_PROVIDER"],
  [!wranglerExp.includes("ZHIPU_GATEWAY_PROVIDER"), "wrangler.exp.jsonc must NOT set ZHIPU_GATEWAY_PROVIDER"],
  [!wranglerExp.includes("EXP_BENCHMARK_DRIVER"), "wrangler.exp.jsonc must NOT set EXP_BENCHMARK_DRIVER (the benchmark driver is retired)"],
  [!wranglerExp.includes("CF_AI_GATEWAY_ID"), "wrangler.exp.jsonc must NOT set CF_AI_GATEWAY_ID"],
  [!/gateway\.ai\.cloudflare\.com/.test(wranglerExp), "wrangler.exp.jsonc must NOT reference the Cloudflare AI Gateway endpoint"],
  [!/api\.z\.ai\/api\/paas/.test(wranglerExp), "wrangler.exp.jsonc must NOT reference the Z.AI General API endpoint"],
  [!/"ai"\s*:\s*\{/.test(wranglerExp), "wrangler.exp.jsonc must NOT bind the Workers AI experiment binding"],
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
  // The ACTIVE production LLM seam is the Coding Plan transport.
  [codingPlan.includes('ZAI_CODING_PLAN_DEFAULT_BASE_URL = "https://api.z.ai/api/coding/paas/v4"'), "zai-coding-plan.ts must default to the Coding Plan endpoint"],
  [codingPlan.includes("env.ZAI_CODING_API_KEY"), "zai-coding-plan.ts must use the canonical ZAI_CODING_API_KEY credential"],
  [!codingPlan.includes("env.ZHIPU_API_URL"), "zai-coding-plan.ts must NOT reference the retired ZHIPU_API_URL var"],
  [codingPlan.includes('env.ZAI_CODING_MODEL || "glm-5.3"'), "zai-coding-plan.ts must resolve the coding model (glm-5.3) from the canonical var"],
  [codingPlan.includes('env.ZAI_MULTIMODAL_MODEL || "glm-5.3-flash"'), "zai-coding-plan.ts must resolve the multimodal model (glm-5.3-flash) from the canonical var"],
];

// ── Retirement proof (post-rollout hardening 2026-09-12) ────────────────────
// The legacy provider seams no longer exist as files. Their REAPPEARANCE is a
// routing violation, not merely dead code.
const retiredFiles = [
  join(ROOT, "src", "lib", "ai-gateway.ts"),
  join(ROOT, "src", "lib", "ai-streaming.ts"),
  join(ROOT, "src", "routes", "v2.exp-benchmark-driver.ts"),
  join(ROOT, "scripts", "exp-benchmark-driver.mjs"),
  join(ROOT, "tests", "v2-simple-streaming-transport.test.ts"),
];
for (const file of retiredFiles) {
  if (existsSync(file)) {
    violations.push(`${file.replace(ROOT, "")}: retired provider/driver seam must NOT exist`);
  }
}

// Reachability proof: NOTHING in src may import the retired seams (they are
// deleted; any import could not even typecheck, but this keeps the gate
// independent of typecheck) and no dead vision-gateway reference may remain.
for (const file of [...walk(join(ROOT, "src"))]) {
  const text = readFileSync(file, "utf8");
  if (/from\s+"[^"]*ai-gateway"/.test(text)) {
    violations.push(`${file.replace(ROOT, "")}: imports the retired ai-gateway seam`);
  }
  if (/from\s+"[^"]*ai-streaming"/.test(text)) {
    violations.push(`${file.replace(ROOT, "")}: imports the retired ai-streaming seam`);
  }
  if (/generateVisionWithGateway|createProductionQaVisionGenerate/.test(text)) {
    violations.push(`${file.replace(ROOT, "")}: references the retired vision-gateway path`);
  }
  if (/EXP_BENCHMARK_(DRIVER|SECRET)/.test(text)) {
    violations.push(`${file.replace(ROOT, "")}: references the retired benchmark driver switch`);
  }
}

// The schema stages must keep passing an explicit (Coding Plan) generate
// override — the boundary has no default provider path to fall back to.
for (const stage of ["visual-qa.ts", "design-blueprint.ts", "site-repair.ts"]) {
  const text = readFileSync(join(ROOT, "src", "simple-design", stage), "utf8");
  if (!/const generate: RawAiGenerate =\s*$/m.test(text) || !/input\.generate \?\?/.test(text)) {
    violations.push(`src/simple-design/${stage}: schema stage must pass an explicit (Coding Plan) generate override — there is no default provider path`);
  }
}
// The active seam must remain imported by every normal-generation stage.
for (const importer of [
  join(ROOT, "src", "simple-design", "vision.ts"),
  join(ROOT, "src", "simple-design", "site-repair.ts"),
  join(ROOT, "src", "simple-design", "website-builder.ts"),
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
    "single-provider Z.AI Coding Plan runtime (Coding endpoint, glm-5.3 / glm-5.3-flash, " +
    "Nano Banana 2 Lite), retired provider seams absent from source and every deployable config."
);
