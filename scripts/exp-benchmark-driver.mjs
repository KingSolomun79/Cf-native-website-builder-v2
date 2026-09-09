#!/usr/bin/env node
// EXPERIMENT BRANCH ONLY — local CLI for the experimental runtime's benchmark
// driver route (src/routes/v2.exp-benchmark-driver.ts). Signs requests with
// EXP_BENCHMARK_SECRET from .dev.vars.exp (gitignored). Benchmark tooling for
// the SIMPLE design pipeline live benchmark; never points at production.
//
// Usage:
//   node scripts/exp-benchmark-driver.mjs health
//   node scripts/exp-benchmark-driver.mjs put-fixture <key> <file>
//   node scripts/exp-benchmark-driver.mjs finch-builder <payload.json> <out.json>
//   node scripts/exp-benchmark-driver.mjs capture <payload.json> <out.json>
//   node scripts/exp-benchmark-driver.mjs blueprint <payload.json> <out.json>
//   node scripts/exp-benchmark-driver.mjs artifact <r2Key> <outFile>

import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.EXP_BASE_URL ?? "https://cf-website-factory-sandbox.wazibizwebsites.workers.dev";

function loadSecret() {
  const vars = {};
  for (const line of readFileSync(new URL("../.dev.vars.exp", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) vars[match[1]] = match[2];
  }
  if (!vars.EXP_BENCHMARK_SECRET) {
    console.error("error: EXP_BENCHMARK_SECRET missing from .dev.vars.exp");
    process.exit(1);
  }
  return vars.EXP_BENCHMARK_SECRET;
}

async function callDriver(body) {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", loadSecret()).update(raw).digest("hex");
  const response = await fetch(`${BASE}/api/v2/exp/benchmark-driver`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Signature": signature },
    body: raw,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 400) };
  }
  return { status: response.status, body: parsed };
}

const [command, arg1, arg2] = process.argv.slice(2);
if (!command) {
  console.error("usage: exp-benchmark-driver.mjs <health|put-fixture|finch-builder|capture|blueprint|artifact> [...]");
  process.exit(1);
}

if (command === "health") {
  const result = await callDriver({ op: "health" });
  console.log(result.status, JSON.stringify(result.body));
} else if (command === "put-fixture") {
  const bytes = readFileSync(arg2);
  const result = await callDriver({ op: "put-fixture", key: arg1, base64: bytes.toString("base64") });
  console.log(result.status, JSON.stringify(result.body));
} else if (command === "artifact") {
  const result = await callDriver({ op: "artifact", key: arg1 });
  if (result.status !== 200) {
    console.log(result.status, JSON.stringify(result.body));
    process.exit(1);
  }
  writeFileSync(arg2, Buffer.from(result.body.base64, "base64"));
  console.log(`saved ${result.body.key} (${result.body.size} bytes) -> ${arg2}`);
} else {
  const payload = JSON.parse(readFileSync(arg1, "utf8"));
  const result = await callDriver(payload);
  console.log("status", result.status);
  writeFileSync(arg2, JSON.stringify(result.body, null, 2));
  const summary = { ...result.body };
  if (summary.bundle) {
    summary.bundle = Object.fromEntries(Object.entries(summary.bundle).map(([k, v]) => [k, typeof v === "string" ? `${v.length} chars` : v]));
  }
  if (summary.blueprint) summary.blueprint = "<see out file>";
  if (summary.markdown) summary.markdown = `${summary.markdown.length} chars`;
  console.log(JSON.stringify(summary, null, 2).slice(0, 3000));
}
