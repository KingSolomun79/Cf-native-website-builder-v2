// Issue #30 controlled production smoke driver.
//
// Usage:
//   node scripts/issue30-smoke.mjs png <out.png>
//   node scripts/issue30-smoke.mjs submit <screenshotR2Key>   -> starts Site Generation + initial Build
//   node scripts/issue30-smoke.mjs build <siteGenerationId>   -> starts the initial-Build workflow
//   node scripts/issue30-smoke.mjs status <buildId>           -> prints build view
//
// Secrets come from .dev.vars (operator-provided at #27); nothing is logged.

import { writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

const BASE = "https://cf-website-factory-v2.wazibizwebsites.workers.dev";

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
  console.log(response.status, path, text.slice(0, 600));
  return { status: response.status, body: JSON.parse(text) };
}

// ── Minimal valid PNG (structure + CRC complete; passes validateScreenshot) ─
const CRC_TABLE = (() => {
  const table = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function buildPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  // Scanlines: filter byte 0 + alternating color bands so the reference has
  // visible structure rather than a flat field.
  const row = Buffer.alloc(1 + width * 3);
  const raw = Buffer.alloc((1 + width * 3) * height);
  const bands = [
    [26, 26, 26],
    [250, 247, 242],
    [196, 154, 76],
    [240, 240, 240],
  ];
  for (let y = 0; y < height; y++) {
    const band = bands[Math.floor((y / height) * bands.length * 3) % bands.length];
    for (let x = 0; x < width; x++) {
      const shade = (x / width) * 0.25 + 0.75;
      row[1 + x * 3] = Math.round(band[0] * shade);
      row[2 + x * 3] = Math.round(band[1] * shade);
      row[3 + x * 3] = Math.round(band[2] * shade);
    }
    row.copy(raw, y * (1 + width * 3));
  }
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const command = process.argv[2];
const secrets = loadSecrets();

if (command === "png") {
  const out = process.argv[3] ?? "issue30-reference.png";
  const png = buildPng(1440, 3200);
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
} else if (command === "submit") {
  const screenshotR2Key = process.argv[3];
  if (!screenshotR2Key) throw new Error("usage: submit <screenshotR2Key>");
  const submission = await post(
    "/api/v2/onboarding-submissions",
    {
      submission: {
        buildMode: "REFERENCE_BOUND",
        facts: {
          businessName: "WAZIBIZ #30 Smoke Business",
          contactEmail: "ops@wazibizwebsites.example",
          businessType: "design studio (internal verification)",
          businessDescription:
            "Internal WAZIBIZ platform verification business for the issue #30 production release smoke. Not a real client.",
          city: "Nairobi",
          country: "Kenya",
        },
        reference: { screenshotR2Key },
      },
    },
    secrets.WEBHOOK_SECRET
  );
  if (submission.status !== 201) process.exit(1);
  console.log("SITE_GENERATION_ID=" + submission.body.siteGenerationId);
  console.log("SITE_ID=" + submission.body.siteId);
  console.log("BUSINESS_ID=" + submission.body.businessId);
} else if (command === "build") {
  const siteGenerationId = process.argv[3];
  const started = await post(`/api/v2/site-generations/${siteGenerationId}/builds`, {}, secrets.WEBHOOK_SECRET);
  if (started.status !== 202) process.exit(1);
  console.log("WORKFLOW_INSTANCE_ID=" + started.body.workflowInstanceId);
} else if (command === "revision") {
  const parentBuildId = process.argv[3];
  const description = process.argv[4] ?? "Internal WAZIBIZ platform verification business (issue #30 revision for rollback window verification). Not a real client.";
  const result = await post(`/api/v2/builds/${parentBuildId}/revision-requests`, {
    revisionRequest: {
      changes: { facts: { businessDescription: description } },
      requestNote: "Issue #30 second publication for rollback verification",
    },
  }, secrets.WEBHOOK_SECRET);
  if (result.status !== 201) process.exit(1);
  console.log("NEW_BUILD_ID=" + result.body.buildId);
  console.log("NEW_BUILD_VERSION_ID=" + result.body.buildVersionId);
} else if (command === "pipeline") {
  const buildId = process.argv[3];
  const result = await post(`/api/v2/builds/${buildId}/pipeline`, {}, secrets.WEBHOOK_SECRET);
  if (result.status !== 202) process.exit(1);
  console.log("WORKFLOW_INSTANCE_ID=" + result.body.workflowInstanceId);
} else if (command === "status") {
  const buildId = process.argv[3];
  const response = await fetch(`${BASE}/api/v2/builds/${buildId}`);
  const body = await response.json();
  console.log(JSON.stringify({ state: body.build?.state, versions: body.versions?.map((v) => v.versionNumber), lastEvents: body.workflowEvents?.slice(-6) }, null, 2));
} else {
  console.error("unknown command");
  process.exit(1);
}
