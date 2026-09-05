// REFERENCE_BOUND production smoke driver — parameterized (issue-agnostic).
//
// Usage:
//   node scripts/smoke-site.mjs <fixture.json> submit   -> Onboarding Submission + Site Generation
//   node scripts/smoke-site.mjs <fixture.json> build <genId>   -> starts the initial-Build workflow
//   node scripts/smoke-site.mjs <fixture.json> status <buildId> -> prints build state + recent events
//   node scripts/smoke-site.mjs <fixture.json> view <buildId>   -> prints full build JSON
//
// The fixture carries the fictional business facts, the Reference input
// (url and/or screenshotR2Key) and an optional adaptationContract — pure
// JSON, no comments. Fixtures live in scripts/fixtures/. Secrets come from
// .dev.vars (WEBHOOK_SECRET only); nothing is logged.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.SMOKE_BASE_URL ?? "https://cf-website-factory-v2.wazibizwebsites.workers.dev";

function loadSecrets() {
  const vars = {};
  for (const line of readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

async function post(path, body, secret) {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Signature": signature },
    body: raw,
  });
  const text = await response.text();
  console.log(response.status, path, text.slice(0, 800));
  return { status: response.status, body: JSON.parse(text) };
}

const [fixturePath, command, arg] = process.argv.slice(2);
if (!fixturePath || !command) {
  console.error("usage: node scripts/smoke-site.mjs <fixture.json> <submit|build|status|view> [id]");
  process.exit(1);
}
const fixture = JSON.parse(readFileSync(new URL(fixturePath, import.meta.url), "utf8"));
// extraInformation is a single string on the wire; fixtures may carry an
// array for readability — join it here.
const rawFacts = fixture.submission.facts ?? {};
if (Array.isArray(rawFacts.extraInformation)) {
  fixture.submission.facts = { ...rawFacts, extraInformation: rawFacts.extraInformation.join("\n") };
}
const secrets = loadSecrets();

if (command === "submit") {
  const result = await post("/api/v2/onboarding-submissions", { submission: fixture.submission }, secrets.WEBHOOK_SECRET);
  if (result.status !== 201) process.exit(1);
  console.log("BUSINESS_ID=" + result.body.businessId);
  console.log("SITE_ID=" + result.body.siteId);
  console.log("ONBOARDING_SUBMISSION_ID=" + result.body.onboardingSubmissionId);
  console.log("SITE_GENERATION_ID=" + result.body.siteGenerationId);
  console.log("BUILD_MODE=" + result.body.buildMode);
} else if (command === "build") {
  const siteGenerationId = arg;
  const started = await post(`/api/v2/site-generations/${siteGenerationId}/builds`, {}, secrets.WEBHOOK_SECRET);
  if (started.status !== 202) process.exit(1);
  console.log("WORKFLOW_INSTANCE_ID=" + started.body.workflowInstanceId);
} else if (command === "status") {
  const response = await fetch(`${BASE}/api/v2/builds/${arg}`);
  const body = await response.json();
  console.log(JSON.stringify(
    {
      state: body.build?.state,
      versions: body.versions?.map((v) => v.versionNumber),
      lastEvents: body.workflowEvents?.slice(-8),
    },
    null,
    2
  ));
} else if (command === "view") {
  const response = await fetch(`${BASE}/api/v2/builds/${arg}`);
  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
} else {
  console.error("unknown command");
  process.exit(1);
}
