// Operator dashboard pages (operator GO 2026-09-12): server-rendered HTML
// served from THIS Worker (never the public Astro website) behind Cloudflare
// Access on the operator-approved admin hostname. The pages DISPLAY canonical
// V2 state — no duplicate lifecycle state is invented. Approval/Publication
// intentionally have NO buttons here: they remain the canonical
// capability-token routes (Access login is NOT publication authority).
//
// UI overhaul (operator feedback 2026-09-14): dark theme matching the public
// intake form, full-width fields, aligned action rows, and explicit feedback
// for every action (Validate & Generate previously failed SILENTLY — the API
// returns a flat {siteId,…} but the old JS read result.converted.siteId and
// threw before redirecting). NOTE: style/script content is injected with
// dangerouslySetInnerHTML — Hono JSX HTML-escapes plain string children, and
// escaped quotes inside <style> silently kill CSS rules (the original cause
// of the collapsed input widths).

import { Hono, type Context } from "hono";
import type { Env } from "../env.d";
import { requireCloudflareAccess } from "../domain/admin-access";
import { getIntakeDraft, listIntakeDrafts, type IntakeDraft } from "../domain/intake-draft";
import { getAdminSiteReview, type AdminSiteReview } from "../domain/admin-review";

type Bindings = Env;

async function guard(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  return await requireCloudflareAccess(c.env, c.req.raw);
}

const STYLES = `
  :root {
    --bg: #181b20; --panel: #1f242c; --field: #232833; --line: #3a4150;
    --ink: #d0d6de; --ink-strong: #f2f5f9; --muted: #9aa4b2;
    --accent: #a770ef; --accent-2: #fdb99b; --link: #cdb3ff;
    --ok-bg: #14251c; --ok-line: #2e7d4f; --ok-ink: #8ee6b0;
    --err-bg: #33191b; --err-line: #a33a3a; --err-ink: #ffd7d7;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Exo", system-ui, sans-serif; background: var(--bg); color: var(--ink); font-size: 15px; }
  header { border-bottom: 1px solid var(--line); padding: 0.9rem 2rem; display: flex; gap: 1.5rem; align-items: baseline; background: #15181d; }
  header .brand { color: var(--ink-strong); font-weight: 700; font-size: 1.05rem; }
  header a { color: var(--link); text-decoration: none; }
  header a:hover { text-decoration: underline; }
  main { padding: 1.5rem 2rem 3rem; max-width: 1100px; margin: 0 auto; }
  h2 { color: var(--ink-strong); }
  a { color: var(--link); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.65rem 0.75rem; border-bottom: 1px solid var(--line); font-size: 0.92rem; }
  th { font-weight: 600; color: var(--ink-strong); }
  .badge { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 0.12rem 0.75rem; font-size: 0.75rem; background: var(--field); color: var(--ink); }
  .badge.ready { border-color: var(--ok-line); color: var(--ok-ink); }
  .badge.review { border-color: #c98a3d; color: #f0c387; }
  .badge.failed { border-color: var(--err-line); color: var(--err-ink); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1.4rem 1.6rem; margin-bottom: 1.4rem; }
  .card h2 { margin-top: 0; font-size: 1.15rem; }
  .card h3 { color: var(--ink); }
  label { display: block; font-size: 0.85rem; font-weight: 600; margin: 0.9rem 0 0.3rem; color: var(--ink); }
  input, textarea, select { width: 100%; padding: 0.65rem 0.75rem; border: 1px solid var(--line); border-radius: 7px; font: inherit; font-size: 0.95rem; background: var(--field); color: var(--ink-strong); color-scheme: dark; }
  input::placeholder, textarea::placeholder { color: #77808f; }
  input:focus, textarea:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  input:disabled { opacity: 0.45; cursor: not-allowed; }
  textarea { min-height: 7rem; resize: vertical; }
  input[type="file"] { padding: 0.5rem; }
  input[type="checkbox"].note-select { width: auto; accent-color: var(--accent); }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1.2rem; }
  .actions { display: flex; gap: 0.8rem; justify-content: flex-end; align-items: center; margin-top: 1.2rem; }
  .actions .spacer { margin-right: auto; }
  button { font: inherit; font-weight: 600; border: 1px solid transparent; background: linear-gradient(90deg, var(--accent), var(--accent-2)); color: #fff; border-radius: 8px; padding: 0.65rem 1.4rem; cursor: pointer; min-height: 42px; }
  button:hover { filter: brightness(1.08); }
  button:disabled { opacity: 0.5; cursor: not-allowed; filter: none; }
  button.secondary { background: transparent; color: var(--link); border-color: #6f52b8; }
  button.danger { background: transparent; color: #ff9b9b; border-color: var(--err-line); }
  .row { display: grid; grid-template-columns: 2fr 3fr auto; gap: 0.75rem; align-items: center; margin-bottom: 0.6rem; }
  .hours-row { display: grid; grid-template-columns: 8rem 8rem 1fr 1fr; gap: 0.75rem; align-items: center; margin-bottom: 0.5rem; }
  .hours-row strong { color: var(--ink-strong); font-weight: 600; }
  .muted { color: var(--muted); font-size: 0.85rem; }
  .hidden { display: none; }
  .flash { border: 1px solid var(--ok-line); background: var(--ok-bg); color: var(--ok-ink); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.1rem; font-size: 0.92rem; }
  .flash.error { border-color: var(--err-line); background: var(--err-bg); color: var(--err-ink); }
  .chat { display: grid; gap: 0.5rem; }
  .chat .note { border: 1px solid var(--line); border-radius: 7px; padding: 0.6rem 0.8rem; background: var(--field); }
  .chat .note.included { background: #1c2a22; }
  .chat .note .meta { color: var(--muted); font-size: 0.75rem; margin-top: 0.25rem; }
  .note-include { display: flex; gap: 0.4rem; align-items: center; font-size: 0.75rem; color: var(--muted); cursor: pointer; margin-bottom: 0.35rem; }
  ul.revision-help { margin: 0.75rem 0; padding-left: 1.2rem; display: grid; gap: 0.3rem; }
  pre { background: var(--field); border: 1px solid var(--line); padding: 0.75rem; border-radius: 7px; overflow-x: auto; font-size: 0.8rem; }
  @media (max-width: 720px) {
    main { padding: 1rem 1rem 3rem; }
    .grid-2 { grid-template-columns: 1fr; }
    .row { grid-template-columns: 1fr; }
    .hours-row { grid-template-columns: 1fr 1fr; }
  }
`;

function Layout(props: { active: string; children?: unknown }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>Wazibiz Builder — Admin</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo:wght@400;600;700&display=swap" />
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>
        <header>
          <span class="brand">Wazibiz Builder</span>
          <a href="/admin/intakes">Intakes</a>
        </header>
        <main>{props.children as never}</main>
      </body>
    </html>
  );
}

// ── Intake list ──────────────────────────────────────────────────────────────

function displayStatus(status: string, latestBuildState: string | null, published: boolean): { label: string; css: string } {
  if (published) return { label: "Published", css: "ready" };
  switch (status) {
    case "SUBMITTED":
      return { label: "New", css: "" };
    case "IN_REVIEW":
      return { label: "In Review", css: "" };
    case "GENERATION_STARTED":
      if (latestBuildState === "RELEASE_READY") return { label: "Release Ready", css: "ready" };
      if (latestBuildState === "HUMAN_REVIEW_REQUIRED") return { label: "Human Review", css: "review" };
      if (latestBuildState === "FAILED" || latestBuildState === "DEGRADED") return { label: "Failed", css: "failed" };
      return { label: "Generation Started", css: "" };
    default:
      return { label: status, css: "" };
  }
}

async function IntakesPage(c: Context<{ Bindings: Env }>): Promise<Response> {
  const drafts = await listIntakeDrafts(c.env, { limit: 200 });
  // Derive generation progress from canonical V2 state (never duplicated here).
  const rows = [];
  for (const draft of drafts) {
    let latestBuildState: string | null = null;
    let published = false;
    if (draft.convertedSiteGenerationId) {
      const build = await c.env.DB.prepare(
        `SELECT b.state FROM builds b
         WHERE b.site_generation_id = ? ORDER BY b.created_at DESC, b.id DESC LIMIT 1`
      )
        .bind(draft.convertedSiteGenerationId)
        .first<{ state: string }>();
      latestBuildState = build?.state ?? null;
      if (draft.convertedSiteId) {
        const publishedRow = await c.env.DB.prepare(
          "SELECT 1 FROM site_published_state WHERE site_id = ? LIMIT 1"
        )
          .bind(draft.convertedSiteId)
          .first();
        published = Boolean(publishedRow);
      }
    }
    const display = displayStatus(draft.status, latestBuildState, published);
    rows.push(
      <tr>
        <td>
          <a href={`/intakes/${draft.id}`}>{draft.businessName}</a>
        </td>
        <td>
          {draft.submitterName}
          <br />
          <span class="muted">{draft.submitterEmail}</span>
        </td>
        <td>{draft.createdAt.slice(0, 16).replace("T", " ")}</td>
        <td>
          <span class={`badge ${display.css}`}>{display.label}</span>
        </td>
        <td>{draft.convertedBuildMode ?? <span class="muted">—</span>}</td>
      </tr>
    );
  }
  return c.html(
    <Layout active="intakes">
      <div class="card">
        <h2>Client intake drafts</h2>
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Submitter</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Build Mode</th>
            </tr>
          </thead>
          <tbody>{rows as never}</tbody>
        </table>
      </div>
    </Layout>
  );
}

// ── Intake editor ────────────────────────────────────────────────────────────

const EDITOR_JS = (apiPath: string) => `
const API = '${apiPath}';
function flash(message, isError) {
  var el = document.getElementById('flash');
  el.textContent = message;
  el.style.display = 'block';
  el.className = isError ? 'flash error' : 'flash';
}
function extractError(result, fallback) {
  if (!result || !result.error) return fallback;
  if (typeof result.error === 'string') return result.error;
  return result.error.message || result.error.code || fallback;
}
function serviceRow(name, description) {
  const div = document.createElement('div');
  div.className = 'row service-row';
  div.innerHTML = '<input type="text" class="service-name" placeholder="Service name" value="' + (name || '') + '">' +
    '<input type="text" class="service-description" placeholder="Description (optional)" value="' + (description || '') + '">' +
    '<button type="button" class="danger" onclick="this.parentElement.remove()">Remove</button>';
  return div;
}
function addService(name, description) { document.getElementById('services').appendChild(serviceRow(name, description)); }
function hoursRow(day, entry) {
  const open = entry && entry.status === 'OPEN';
  const div = document.createElement('div');
  div.className = 'hours-row';
  div.innerHTML = '<strong>' + day.charAt(0).toUpperCase() + day.slice(1) + '</strong>' +
    '<select class="hours-status" onchange="hoursStatusChanged(this)"><option value="OPEN"' + (open ? ' selected' : '') + '>Open</option><option value="CLOSED"' + (!open ? ' selected' : '') + '>Closed</option></select>' +
    '<input type="time" class="hours-open" value="' + (open ? entry.open : '09:00') + '"' + (open ? '' : ' disabled') + '>' +
    '<input type="time" class="hours-close" value="' + (open ? entry.close : '17:00') + '"' + (open ? '' : ' disabled') + '>';
  return div;
}
function hoursStatusChanged(select) {
  const row = select.parentElement;
  row.querySelector('.hours-open').disabled = select.value !== 'OPEN';
  row.querySelector('.hours-close').disabled = select.value !== 'OPEN';
}
function collectPayload() {
  const services = Array.from(document.querySelectorAll('.service-row')).map(function (row) {
    const name = row.querySelector('.service-name').value.trim();
    const description = row.querySelector('.service-description').value.trim();
    return description ? { name: name, description: description } : { name: name };
  }).filter(function (s) { return s.name; });
  const businessHours = {};
  document.querySelectorAll('.hours-row').forEach(function (row) {
    const day = row.querySelector('strong').textContent.toLowerCase();
    if (row.querySelector('.hours-status').value === 'OPEN') {
      businessHours[day] = { status: 'OPEN', open: row.querySelector('.hours-open').value, close: row.querySelector('.hours-close').value };
    } else {
      businessHours[day] = { status: 'CLOSED' };
    }
  });
  const socialsRaw = document.getElementById('socials').value.trim();
  var socials = null;
  if (socialsRaw) {
    try { socials = JSON.parse(socialsRaw); } catch (e) {
      flash('Socials is not valid JSON — fix or clear it before saving.', true);
      return null;
    }
  }
  var payload = {
    submitter: { name: document.getElementById('submitter-name').value, email: document.getElementById('submitter-email').value },
    business: {
      businessName: document.getElementById('business-name').value,
      contactEmail: document.getElementById('contact-email').value,
      businessType: document.getElementById('business-type').value,
      businessDescription: document.getElementById('business-description').value,
      idealClientProfile: document.getElementById('ideal-client').value,
      addressLine1: document.getElementById('address').value,
      city: document.getElementById('city').value,
      country: document.getElementById('country').value,
      phoneNumber: document.getElementById('phone').value,
      whatsappNumber: document.getElementById('whatsapp').value,
      extraInformation: document.getElementById('extra-info').value,
      services: services,
      businessHours: businessHours
    },
    designPreferences: {
      direction: document.getElementById('pref-direction').value,
      audience: document.getElementById('pref-audience').value,
      conversionGoal: document.getElementById('pref-goal').value,
      preferredPalette: document.getElementById('pref-palette').value,
      visualStyle: document.getElementById('pref-style').value,
      tone: document.getElementById('pref-tone').value,
      avoidances: document.getElementById('pref-avoid').value,
      inspirationNotes: document.getElementById('pref-inspiration').value
    }
  };
  if (socials) { payload.business.socials = socials; }
  var logo = document.getElementById('logo-url').value.trim(); if (logo) payload.business.logoUrl = logo;
  var diff = document.getElementById('differentiator').value.trim(); if (diff) payload.business.competitiveDifferentiator = diff;
  var refUrl = document.getElementById('reference-url').value.trim(); payload.referenceUrl = refUrl || null;
  return payload;
}
async function saveDraft(markInReview) {
  const body = collectPayload();
  if (!body) return;
  body.markInReview = markInReview;
  body.adminNotes = document.getElementById('admin-notes').value;
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  flash('Saving draft…', false);
  try {
    const response = await fetch(API, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(function () { return null; });
    if (!response.ok) { flash('Save failed: ' + extractError(result, 'HTTP ' + response.status), true); return; }
    flash('Draft saved. Reloading…', false);
    setTimeout(function () { location.reload(); }, 500);
  } catch (e) {
    flash('Save failed: ' + e.message, true);
  } finally {
    btn.disabled = false;
  }
}
async function generate() {
  const btn = document.getElementById('generate-btn');
  const buildMode = document.getElementById('build-mode').value;
  if (!buildMode) {
    flash('Choose a Build Mode first — ORIGINAL_DESIGN or REFERENCE_BOUND. Nothing was started.', true);
    return;
  }
  const body = { buildMode: buildMode };
  if (buildMode === 'ORIGINAL_DESIGN') {
    body.creativeDirection = {
      direction: document.getElementById('cd-direction').value,
      audience: document.getElementById('cd-audience').value,
      conversionGoal: document.getElementById('cd-goal').value,
      serviceEnvironment: document.getElementById('cd-environment').value,
      preferredPalette: document.getElementById('cd-palette').value,
      visualStyle: document.getElementById('cd-style').value,
      tone: document.getElementById('cd-tone').value,
      avoidances: document.getElementById('cd-avoid').value,
      inspirationNotes: document.getElementById('cd-inspiration').value
    };
    for (const key in body.creativeDirection) { if (!body.creativeDirection[key]) delete body.creativeDirection[key]; }
    if (!body.creativeDirection.direction) { flash("Creative direction needs at least the 'direction' field. Nothing was started.", true); return; }
  } else {
    if (document.getElementById('reference-url').value.trim()) body.referenceUrl = document.getElementById('reference-url').value.trim();
  }
  btn.disabled = true;
  btn.textContent = 'Validating & starting generation…';
  flash('Validating the draft and starting generation — this page will redirect to the site review when ready…', false);
  try {
    const response = await fetch(API + '/validate-and-generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(function () { return null; });
    if (!response.ok) {
      flash('Generate failed — nothing was lost, the draft is unchanged. Reason: ' + extractError(result, 'HTTP ' + response.status), true);
      return;
    }
    // The API returns the conversion FLAT: { siteId, siteGenerationId, …, alreadyConverted }.
    const siteId = result && (result.siteId || (result.converted && result.converted.siteId));
    if (!siteId) {
      flash('The generation request succeeded but the response had no site id — check the Intakes list for this draft before retrying.', true);
      return;
    }
    flash((result.alreadyConverted ? 'Draft was already converted — opening the existing generation…' : 'Generation started — opening the site review page…'), false);
    window.location.href = '/sites/' + siteId;
  } catch (e) {
    flash('Generate failed: ' + e.message + ' — check the Intakes list before retrying (the action is idempotent).', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Validate & Generate';
  }
}
function modeChanged() {
  const mode = document.getElementById('build-mode').value;
  document.getElementById('od-panel').classList.toggle('hidden', mode !== 'ORIGINAL_DESIGN');
  document.getElementById('rb-panel').classList.toggle('hidden', mode !== 'REFERENCE_BOUND');
  document.getElementById('generate-btn').disabled = !mode;
}
async function uploadScreenshot() {
  const input = document.getElementById('screenshot-input');
  if (!input.files || !input.files[0]) { flash('Choose a PNG/JPEG screenshot first.', true); return; }
  const file = input.files[0];
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  flash('Uploading screenshot…', false);
  try {
    const response = await fetch(API + '/reference-screenshot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: file.name, contentBase64: btoa(binary) }) });
    const result = await response.json().catch(function () { return null; });
    if (!response.ok) { flash('Upload failed: ' + extractError(result, 'HTTP ' + response.status), true); return; }
    flash('Screenshot stored: ' + result.referenceScreenshotR2Key, false);
  } catch (e) {
    flash('Upload failed: ' + e.message, true);
  }
}
`;

function textField(id: string, label: string, value: string, type = "text") {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input type={type} id={id} value={value} />
    </div>
  );
}

async function IntakeEditorPage(c: Context<{ Bindings: Env }>, draft: IntakeDraft): Promise<Response> {
  const business = draft.payload.business;
  const prefs = draft.payload.designPreferences ?? {};
  const converted = Boolean(draft.convertedSiteGenerationId);
  const hours = business.businessHours;
  const hoursRows = Object.entries(hours).map(([day, entry]) => (
    <div class="hours-row">
      <strong>{day.charAt(0).toUpperCase() + day.slice(1)}</strong>
      <select class="hours-status" onchange="hoursStatusChanged(this)">
        <option value="OPEN" selected={entry.status === "OPEN"}>Open</option>
        <option value="CLOSED" selected={entry.status !== "OPEN"}>Closed</option>
      </select>
      <input type="time" class="hours-open" value={entry.status === "OPEN" ? entry.open : "09:00"} disabled={entry.status !== "OPEN"} />
      <input type="time" class="hours-close" value={entry.status === "OPEN" ? entry.close : "17:00"} disabled={entry.status !== "OPEN"} />
    </div>
  ));
  return c.html(
    <Layout active="intakes">
      <div id="flash" class="flash" style={{ display: "none" }} aria-live="polite" />
      {converted ? (
        <div class="card">
          <h2>
            {draft.businessName} — converted ({draft.convertedBuildMode})
          </h2>
          <p class="muted">
            This draft is immutable after Validate &amp; Generate. Later factual changes are Fact Updates inside a Revision
            Request on the site page.
          </p>
          <div class="actions">
            <span class="muted" style={{ "margin-right": "auto" }}>
              Status: {draft.status}
            </span>
            <a class="badge ready" href={`/sites/${draft.convertedSiteId}`}>
              Open site review
            </a>
          </div>
        </div>
      ) : (
        <>
          <div class="card">
            <h2>{draft.businessName}</h2>
            <p class="muted">
              Status: {draft.status} · Submitted {draft.createdAt.slice(0, 16).replace("T", " ")}
            </p>
            <div id="services-editor">
              <label>Services (minimum 3 — content authority for the generated site)</label>
              <div id="services">
                {business.services.map((service) => (
                  <div class="row service-row">
                    <input type="text" class="service-name" value={service.name} />
                    <input type="text" class="service-description" value={service.description ?? ""} />
                    <button type="button" class="danger" onclick="this.parentElement.remove()">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <div class="actions">
                <button type="button" class="secondary" onclick="addService()">
                  Add Service
                </button>
              </div>
            </div>
          </div>
          <div class="card">
            <h2>Business brief</h2>
            <div class="grid-2">
              {textField("business-name", "Business name", business.businessName)}
              {textField("contact-email", "Public contact email", business.contactEmail, "email")}
              {textField("business-type", "Business type", business.businessType ?? "")}
              {textField("ideal-client", "Ideal client profile", business.idealClientProfile ?? "")}
              {textField("address", "Address line", business.addressLine1 ?? "")}
              {textField("city", "City", business.city ?? "")}
              {textField("country", "Country", business.country ?? "")}
              {textField("phone", "Phone", business.phoneNumber ?? "", "tel")}
              {textField("whatsapp", "WhatsApp", business.whatsappNumber ?? "", "tel")}
              {textField("logo-url", "Logo URL (optional)", business.logoUrl ?? "", "url")}
            </div>
            <label for="business-description">Business description</label>
            <textarea id="business-description">{business.businessDescription ?? ""}</textarea>
            <label for="differentiator">Competitive differentiator (optional)</label>
            <textarea id="differentiator">{business.competitiveDifferentiator ?? ""}</textarea>
            <label for="extra-info">Extra information</label>
            <textarea id="extra-info">{business.extraInformation ?? ""}</textarea>
            <label for="socials">Socials (JSON, optional)</label>
            <textarea id="socials" style={{ "min-height": "4.5rem" }}>{business.socials ? JSON.stringify(business.socials) : ""}</textarea>
            <label>Business hours</label>
            <div id="hours">{hoursRows as never}</div>
          </div>
          <div class="card">
            <h2>Client design preferences (CLIENT NOTES)</h2>
            <p class="muted">
              These are the client's wishes. They enter the canonical submission ONLY if you generate as ORIGINAL_DESIGN;
              for REFERENCE_BOUND they remain notes here.
            </p>
            <label for="pref-direction">Direction</label>
            <textarea id="pref-direction">{prefs.direction ?? ""}</textarea>
            <div class="grid-2">
              {textField("pref-audience", "Audience", prefs.audience ?? "")}
              {textField("pref-goal", "Conversion goal", prefs.conversionGoal ?? "")}
              {textField("pref-palette", "Preferred palette", prefs.preferredPalette ?? "")}
              {textField("pref-style", "Visual style", prefs.visualStyle ?? "")}
              {textField("pref-tone", "Tone", prefs.tone ?? "")}
              {textField("pref-avoid", "Avoidances", prefs.avoidances ?? "")}
            </div>
            <label for="pref-inspiration">Inspiration notes</label>
            <textarea id="pref-inspiration" style={{ "min-height": "4.5rem" }}>{prefs.inspirationNotes ?? ""}</textarea>
          </div>
          <div class="card">
            <h2>Admin notes (private)</h2>
            <textarea id="admin-notes">{draft.adminNotes ?? ""}</textarea>
            <p class="muted">Submitter: {draft.submitterName} &lt;{draft.submitterEmail}&gt; — private intake contact, never a public Business Fact.</p>
            <div class="actions">
              <button type="button" id="save-btn" class="secondary" onclick="saveDraft(true)">
                Save (mark In Review)
              </button>
            </div>
          </div>
          <div class="card">
            <h2>Validate &amp; Generate</h2>
            <p class="muted">This is the ONLY action that starts generation. It is idempotent — a draft generates once.</p>
            <label for="build-mode">Build Mode (admin decision)</label>
            <select id="build-mode" onchange="modeChanged()">
              <option value="">Choose…</option>
              <option value="ORIGINAL_DESIGN">ORIGINAL_DESIGN (no reference; client notes become creative direction)</option>
              <option value="REFERENCE_BOUND">REFERENCE_BOUND (reference URL / screenshot is the design origin)</option>
            </select>
            <div id="od-panel" class="hidden">
              <label for="cd-direction">Creative direction (required — at minimum the direction)</label>
              <textarea id="cd-direction">{prefs.direction ?? ""}</textarea>
              <div class="grid-2">
                {textField("cd-audience", "Audience", prefs.audience ?? "")}
                {textField("cd-goal", "Conversion goal", prefs.conversionGoal ?? "")}
                {textField("cd-environment", "Service environment", prefs.serviceEnvironment ?? "")}
                {textField("cd-palette", "Preferred palette", prefs.preferredPalette ?? "")}
                {textField("cd-style", "Visual style", prefs.visualStyle ?? "")}
                {textField("cd-tone", "Tone", prefs.tone ?? "")}
                {textField("cd-avoid", "Avoidances", prefs.avoidances ?? "")}
                {textField("cd-inspiration", "Inspiration notes", prefs.inspirationNotes ?? "")}
              </div>
            </div>
            <div id="rb-panel" class="hidden">
              {textField("reference-url", "Reference URL", draft.payload.referenceUrl ?? "", "url")}
              <label for="screenshot-input">Reference screenshot (PNG/JPEG, max 9 MB)</label>
              <input type="file" id="screenshot-input" accept="image/png,image/jpeg" />
              <div class="actions">
                <button type="button" class="secondary" onclick="uploadScreenshot()">
                  Upload screenshot
                </button>
              </div>
              {draft.payload.referenceScreenshotR2Key ? <p class="muted">Stored: {draft.payload.referenceScreenshotR2Key}</p> : null}
              <p class="muted">Client design preferences stay visible above as CLIENT NOTES — they never enter a REFERENCE_BOUND submission.</p>
            </div>
            <div class="actions">
              <span class="muted spacer">The Generate button unlocks once a Build Mode is chosen.</span>
              <button type="button" id="generate-btn" onclick="generate()" disabled>
                Validate &amp; Generate
              </button>
            </div>
          </div>
        </>
      )}
      <script dangerouslySetInnerHTML={{ __html: EDITOR_JS(`/api/admin/intake-drafts/${draft.id}`) }} />
    </Layout>
  );
}

// ── Site review page ─────────────────────────────────────────────────────────

const SITE_JS = (apiPath: string) => `
const API = '${apiPath}';
function flash(message, isError) {
  var el = document.getElementById('flash');
  el.textContent = message;
  el.style.display = 'block';
  el.className = isError ? 'flash error' : 'flash';
}
async function addNote() {
  const note = document.getElementById('new-note').value.trim();
  if (!note) { flash('Write the note first.', true); return; }
  try {
    const response = await fetch(API + '/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: note }) });
    const result = await response.json().catch(function () { return null; });
    if (!response.ok) { flash('Note failed: ' + ((result && result.error && (result.error.message || result.error.code)) || response.status), true); return; }
    location.reload();
  } catch (e) { flash('Note failed: ' + e.message, true); }
}
async function generateRevision() {
  const noteIds = Array.from(document.querySelectorAll('input.note-select:checked')).map(function (el) { return el.value; });
  const factPatch = {};
  var phone = document.getElementById('fp-phone').value.trim(); if (phone) factPatch.phoneNumber = phone;
  var email = document.getElementById('fp-email').value.trim(); if (email) factPatch.contactEmail = email;
  var whatsapp = document.getElementById('fp-whatsapp').value.trim(); if (whatsapp) factPatch.whatsappNumber = whatsapp;
  var diff = document.getElementById('fp-diff').value.trim(); if (diff) factPatch.competitiveDifferentiator = diff;
  var raw = document.getElementById('fp-json').value.trim(); if (raw) { try { Object.assign(factPatch, JSON.parse(raw)); } catch (e) { flash('Fact JSON is invalid: ' + e.message, true); return; } }
  if (!noteIds.length && !Object.keys(factPatch).length) { flash('Select at least one pending note or enter a fact change — nothing to revise.', true); return; }
  const btn = document.getElementById('revision-btn');
  btn.disabled = true;
  flash('Creating the Revision Request and starting ONE revision build…', false);
  try {
    const response = await fetch(API + '/generate-revision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ noteIds: noteIds, factPatch: factPatch }) });
    const result = await response.json().catch(function () { return null; });
    if (!response.ok) { flash('Generate Revision failed: ' + ((result && result.error && (result.error.message || result.error.code)) || response.status), true); return; }
    flash('Revision Request created — one new Build started (' + (result.buildId || '').slice(0, 8) + '). Reloading…', false);
    setTimeout(function () { location.reload(); }, 800);
  } catch (e) {
    flash('Generate Revision failed: ' + e.message, true);
  } finally {
    btn.disabled = false;
  }
}
`;

async function SiteReviewPage(c: Context<{ Bindings: Env }>, review: AdminSiteReview): Promise<Response> {
  const noteItems = review.notes.map((note) => (
    <div class={`note ${note.status === "INCLUDED" ? "included" : ""}`}>
      {note.status === "PENDING" ? (
        <label class="note-include">
          <input type="checkbox" class="note-select" value={note.id} /> include in next revision (Step 2)
        </label>
      ) : null}
      <div>{note.note}</div>
      <div class="meta">
        {note.createdAt.slice(0, 16).replace("T", " ")} · {note.status}
        {note.includedInRevisionRequestId ? ` · ${note.includedInRevisionRequestId.slice(0, 8)}` : ""}
      </div>
    </div>
  ));
  return c.html(
    <Layout active="sites">
      <div id="flash" class="flash" style={{ display: "none" }} aria-live="polite" />
      <div class="card">
        <h2>{review.businessName}</h2>
        <p>
          <span class="muted">Site:</span> {review.siteId}{" "}
          {review.latestPreviewUrl ? (
            <>
              · <a href={review.latestPreviewUrl} target="_blank" rel="noreferrer">
                Open Preview
              </a>
            </>
          ) : null}
        </p>
        {review.generations.map((generation) => (
          <div>
            <h3 class="muted">
              Generation {generation.sequenceNumber} — {generation.buildMode}
            </h3>
            {generation.builds.map((build) => (
              <div class="card">
                <strong>Build {build.buildId.slice(0, 8)}</strong> ({build.kind}) —{" "}
                <span class={`badge ${build.state === "RELEASE_READY" ? "ready" : build.state === "HUMAN_REVIEW_REQUIRED" ? "review" : build.state === "FAILED" || build.state === "DEGRADED" ? "failed" : ""}`}>{build.state}</span>
                <div class="muted">
                  Versions: {build.versions.map((version) => `v${version.versionNumber}`).join(", ")}
                  {build.repairUsed ? " · repair used" : ""}
                  {build.scoreSummary ? ` · ${build.scoreSummary}` : ""}
                </div>
                {build.previewUrl ? (
                  <div>
                    <a href={build.previewUrl} target="_blank" rel="noreferrer">
                      Open Preview (new tab)
                    </a>{" "}
                    · <span class="muted">preview URL: {build.previewUrl}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div class="card">
        <h2>Revision notes</h2>
        <p class="muted">
          <strong>Step 1 — collect instructions.</strong> Write what should change (presentation or content intent) and
          press Add note. The note is stored as PENDING and changes nothing on its own — notes never start a build
          individually. Nothing is sent to the builder until you press Generate Revision below.
        </p>
        <div class="chat">{noteItems as never}</div>
        <label for="new-note">New note</label>
        <textarea id="new-note" placeholder='e.g. "Reduce the mobile hero title."' />
        <div class="actions">
          <span class="muted spacer">Adding a note is safe — it only saves it for later.</span>
          <button type="button" class="secondary" onclick="addNote()">
            Add note
          </button>
        </div>
      </div>
      <div class="card">
        <h2>Generate Revision</h2>
        <p class="muted">
          <strong>Step 2 — turn collected instructions into ONE revision.</strong> Tick the checkbox on each PENDING note
          above that should be included, optionally enter new fact values below, then press the button. This combines
          everything into a single bounded Revision Request and starts exactly ONE revision build.
        </p>
        <ul class="muted revision-help">
          <li>Ticked notes become the builder's single revision instruction (change intent — they never override facts).</li>
          <li>Fact fields are whole-field replacements: the value you type becomes the site's new value. Leave a field blank to leave that fact unchanged.</li>
          <li>Other fact changes (services, hours, …) go through the FactPatch JSON — advanced, whole-field.</li>
          <li>With nothing ticked and no fact filled in, the button is blocked on purpose.</li>
        </ul>
        <p class="muted">{`${review.notes.filter((n) => n.status === "PENDING").length} pending note(s) waiting.`}</p>
        <div class="grid-2">
          {textField("fp-phone", "Phone — new value (blank = unchanged)", "", "tel")}
          {textField("fp-email", "Contact email — new value (blank = unchanged)", "", "email")}
          {textField("fp-whatsapp", "WhatsApp — new value (blank = unchanged)", "", "tel")}
          {textField("fp-diff", "Competitive differentiator — new value (blank = unchanged)", "")}
        </div>
        <label for="fp-json">Additional FactPatch JSON (whole-field; advanced)</label>
        <textarea id="fp-json" placeholder='{"services": [ { "name": "…" }, { "name": "…" }, { "name": "…" } ]}' />
        <div class="actions">
          <button type="button" id="revision-btn" onclick="generateRevision()">
            Generate Revision
          </button>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: SITE_JS(`/api/admin/sites/${review.siteId}`) }} />
    </Layout>
  );
}

export function registerAdminPageRoutes(app: Hono<{ Bindings: Env }>): void {
  // The admin hostname IS the dashboard (operator request 2026-09-15): the
  // /admin prefix was redundant on admin-builder.wazibiz.ke. Pages live at
  // the root; every /admin/* legacy path redirects so old bookmarks and
  // already-sent email links keep working. Every route stays behind the same
  // Cloudflare Access guard — / on the public workers.dev host fails closed.
  app.get("/", (c) => c.redirect("/intakes"));
  app.get("/intakes", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    return await IntakesPage(c);
  });
  app.get("/intakes/:draftId", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const draft = await getIntakeDraft(c.env, c.req.param("draftId") as string);
    if (!draft) return c.html(<Layout active="intakes">
      <div class="card">Draft not found.</div>
    </Layout> as never, 404);
    return await IntakeEditorPage(c, draft);
  });
  app.get("/sites/:siteId", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const review = await getAdminSiteReview(c.env, c.req.param("siteId") as string);
    if (!review) return c.html(<Layout active="sites">
      <div class="card">Site not found.</div>
    </Layout> as never, 404);
    return await SiteReviewPage(c, review);
  });

  // Legacy /admin/* paths → short equivalents (bookmarks + emailed links).
  app.get("/admin", (c) => c.redirect("/intakes", 302));
  app.get("/admin/", (c) => c.redirect("/intakes", 302));
  app.get("/admin/intakes", (c) => c.redirect("/intakes", 302));
  app.get("/admin/intakes/:draftId", (c) => c.redirect(`/intakes/${c.req.param("draftId")}`, 302));
  app.get("/admin/sites/:siteId", (c) => c.redirect(`/sites/${c.req.param("siteId")}`, 302));
}
