#!/usr/bin/env node
// Controlled smoke probe for the WAZIBIZ Form Service email transport
// (issue #28). Submits one browser-contract JSON payload exactly like a
// generated Site would and reads back the delivery ledger from D1.
//
//   node scripts/form-service-smoke.mjs submit \
//     --url https://cf-website-factory-staging.wazibizwebsites.workers.dev \
//     --site site_stg_smoke_1 --origin https://cf-website-factory-staging.wazibizwebsites.workers.dev
//
//   node scripts/form-service-smoke.mjs ledger --database website_factory_staging
//   node scripts/form-service-smoke.mjs ledger --database website_factory_staging --submission-id <id>
//
// The probe never touches credentials: it speaks only to the public submit
// route (Bearer transport tokens live in Worker secrets on the Form Service
// and the email router, never on the client).

import { execFileSync } from "node:child_process";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

async function submit() {
  const base = arg("url");
  const site = arg("site");
  const origin = arg("origin");
  if (!base || !site || !origin) {
    console.error("submit requires --url --site --origin");
    process.exit(2);
  }
  const payload = {
    siteFormId: `site:${site}`,
    name: arg("name", "WAZIBIZ Platform Smoke"),
    email: arg("email", "smoke@wazibizwebsites.example"),
    message: arg("message", "Controlled transport smoke probe (issue #28). No visitor action expected."),
    subject: arg("subject", "Form Service transport smoke"),
  };
  const response = await fetch(`${base.replace(/\/$/, "")}/api/v2/forms/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  console.log(`HTTP ${response.status}`);
  console.log(body);
  try {
    const parsed = JSON.parse(body);
    if (parsed.submissionId) console.log(`\nsubmissionId: ${parsed.submissionId}`);
  } catch {
    /* non-JSON body; already printed */
  }
}

function ledger() {
  const database = arg("database");
  if (!database) {
    console.error("ledger requires --database");
    process.exit(2);
  }
  const submissionId = arg("submission-id");
  const sql = submissionId
    ? `SELECT fs.id AS submission_id, fs.accepted_at, fs.visitor_email, ed.attempt_number, ed.status, ed.destination, ed.sender_identity, ed.reply_to, ed.error_class, ed.error_detail, ed.scheduled_retry_at FROM form_submissions fs LEFT JOIN email_deliveries ed ON ed.form_submission_id = fs.id WHERE fs.id = '${submissionId}' ORDER BY ed.attempt_number`
    : `SELECT fs.id AS submission_id, fs.accepted_at, fs.visitor_email, ed.attempt_number, ed.status, ed.destination, ed.sender_identity, ed.reply_to, ed.error_class, ed.error_detail, ed.scheduled_retry_at FROM form_submissions fs LEFT JOIN email_deliveries ed ON ed.form_submission_id = fs.id ORDER BY fs.accepted_at DESC, ed.attempt_number LIMIT 20`;
  const raw = execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", database, "--remote", "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  const marker = raw.indexOf("[");
  const rows = marker === -1 ? [] : JSON.parse(raw.slice(marker))[0]?.results ?? [];
  console.table(rows);
}

const mode = process.argv[2];
if (mode === "submit") await submit();
else if (mode === "ledger") ledger();
else {
  console.error("usage: form-service-smoke.mjs <submit|ledger> [options]");
  process.exit(2);
}
