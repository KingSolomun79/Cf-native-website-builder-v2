// Operator dashboard pages (operator GO 2026-09-12): server-rendered HTML
// served from THIS Worker (never the public Astro website) behind Cloudflare
// Access on the operator-approved admin hostname. The pages DISPLAY canonical
// V2 state — no duplicate lifecycle state is invented. Approval/Publication
// intentionally have NO buttons here: they remain the canonical
// capability-token routes (Access login is NOT publication authority).

import { Hono, type Context } from "hono";
import type { Env } from "../env.d";
import { requireCloudflareAccess } from "../domain/admin-access";
import { getIntakeDraft, listIntakeDrafts, validateIntakeDraftPayload, type IntakeDraft } from "../domain/intake-draft";
import { listAdminNotifications } from "../domain/admin-notifications";
import { getAdminSiteReview, type AdminSiteReview } from "../domain/admin-review";

type Bindings = Env;

async function guard(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  return await requireCloudflareAccess(c.env, c.req.raw);
}

const STYLES = `
  :root { --ink: #1c1a17; --paper: #faf8f4; --line: #e3ded4; --accent: #1f5f5b; --warn: #a3542c; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; background: var(--paper); color: var(--ink); }
  header { border-bottom: 1px solid var(--line); padding: 1rem 2rem; display: flex; gap: 1.5rem; align-items: baseline; }
  header a { color: var(--accent); text-decoration: none; }
  main { padding: 1.5rem 2rem; max-width: 1100px; margin: 0 auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--line); font-size: 0.9rem; }
  th { font-weight: 600; }
  .badge { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 0.1rem 0.7rem; font-size: 0.75rem; background: #fff; }
  .badge.ready { border-color: var(--accent); color: var(--accent); }
  .badge.review { border-color: var(--warn); color: var(--warn); }
  .badge.failed { border-color: #b3261e; color: #b3261e; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
  .card h2 { margin-top: 0; font-size: 1.05rem; }
  label { display: block; font-size: 0.8rem; margin: 0.75rem 0 0.25rem; color: #555; }
  input[type="text"], input[type="email"], input[type="time"], textarea, select { width: 100%; padding: 0.5rem; border: 1px solid var(--line); border-radius: 6px; font: inherit; background: #fff; }
  textarea { min-height: 5rem; }
  button { font: inherit; border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: 6px; padding: 0.5rem 1.1rem; cursor: pointer; margin-top: 0.75rem; }
  button.secondary { background: #fff; color: var(--accent); }
  button.danger { background: #fff; color: #b3261e; border-color: #b3261e; }
  .row { display: grid; grid-template-columns: 2fr 3fr auto; gap: 0.75rem; align-items: start; margin-bottom: 0.5rem; }
  .hours-row { display: grid; grid-template-columns: 7rem 6rem 6rem 7rem; gap: 0.75rem; align-items: center; margin-bottom: 0.4rem; }
  .muted { color: #777; font-size: 0.85rem; }
  .hidden { display: none; }
  .flash { border: 1px solid var(--accent); background: #eef6f5; border-radius: 6px; padding: 0.6rem 0.9rem; margin-bottom: 1rem; }
  .chat { display: grid; gap: 0.5rem; }
  .chat .note { border: 1px solid var(--line); border-radius: 6px; padding: 0.5rem 0.75rem; background: #fff; }
  .chat .note.included { background: #f4f8f4; }
  .chat .note .meta { color: #777; font-size: 0.75rem; }
  pre { background: #f4f1ea; padding: 0.75rem; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; }
`;

function Layout(props: { active: string; children?: unknown }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>Wazibiz Builder — Admin</title>
        <style>{STYLES}</style>
      </head>
      <body>
        <header>
          <strong>Wazibiz Builder</strong>
          <a href="/admin/intakes">Intakes</a>
          <a href="/admin/notifications">Notifications</a>
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
    case "REJECTED":
      return { label: "Rejected", css: "failed" };
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
          <a href={`/admin/intakes/${draft.id}`}>{draft.businessName}</a>
        </td>
        <td>
          {draft.submitterName}
          <br />
          <span class="muted">{draft.submitterEmail}</span>
        </td>
        <td>{draft.createdAt.slice(0, 16).replace("T", " ")}</td>
        <td>
          <span class={`badge ${display.css}`}>{display.label}</span>
          {draft.status === "REJECTED" && draft.rejectionReason ? (
            <div class="muted">{draft.rejectionReason}</div>
          ) : null}
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
  if (socialsRaw) { try { payload.business.socials = JSON.parse(socialsRaw); } catch (e) {} }
  var logo = document.getElementById('logo-url').value.trim(); if (logo) payload.business.logoUrl = logo;
  var diff = document.getElementById('differentiator').value.trim(); if (diff) payload.business.competitiveDifferentiator = diff;
  var refUrl = document.getElementById('reference-url').value.trim(); payload.referenceUrl = refUrl || null;
  return payload;
}
function flash(message, isError) {
  var el = document.getElementById('flash');
  el.textContent = message;
  el.style.display = 'block';
  el.style.borderColor = isError ? '#b3261e' : '';
  el.style.background = isError ? '#fbeae9' : '';
}
async function saveDraft(markInReview) {
  try {
    const body = collectPayload();
    body.markInReview = markInReview;
    body.adminNotes = document.getElementById('admin-notes').value;
    const response = await fetch(API, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { flash('Save failed: ' + (result.error && (result.error.message || result.error) || response.status), true); return; }
    flash('Draft saved.');
    setTimeout(function () { location.reload(); }, 400);
  } catch (e) { flash('Save failed: ' + e.message, true); }
}
async function generate() {
  const buildMode = document.getElementById('build-mode').value;
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
    if (!body.creativeDirection.direction) { flash("Creative direction needs at least the 'direction' field.", true); return; }
  } else {
    if (document.getElementById('reference-url').value.trim()) body.referenceUrl = document.getElementById('reference-url').value.trim();
  }
  const response = await fetch(API + '/validate-and-generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok && response.status !== 200) { flash('Generate failed: ' + (result.error && (result.error.message || result.error) || response.status), true); return; }
  if (result.alreadyConverted) { flash('Draft was already converted — opening the existing generation.'); }
  window.location.href = '/admin/sites/' + result.converted.siteId;
}
function modeChanged() {
  const mode = document.getElementById('build-mode').value;
  document.getElementById('od-panel').classList.toggle('hidden', mode !== 'ORIGINAL_DESIGN');
  document.getElementById('rb-panel').classList.toggle('hidden', mode !== 'REFERENCE_BOUND');
}
async function uploadScreenshot() {
  const input = document.getElementById('screenshot-input');
  if (!input.files || !input.files[0]) { flash('Choose a PNG/JPEG screenshot first.', true); return; }
  const file = input.files[0];
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const response = await fetch(API + '/reference-screenshot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: file.name, contentBase64: btoa(binary) }) });
  const result = await response.json();
  if (!response.ok) { flash('Upload failed: ' + (result.error && (result.error.message || result.error) || response.status), true); return; }
  flash('Screenshot stored: ' + result.referenceScreenshotR2Key);
}
`;

function textField(id: string, label: string, value: string, type = "text") {
  return (
    <div>
      <label for={id}>{label}</label>
      <input type={type} id={id} value={value} />
    </div>
  );
}

async function IntakeEditorPage(c: Context<{ Bindings: Env }>, draft: IntakeDraft): Promise<Response> {
  // A REJECTED attempt whose stored body is not a valid draft payload cannot
  // drive the structured editor — render the diagnostic view instead so the
  // operator can still read the raw submission and its rejection reason.
  if (draft.status === "REJECTED" && !validateIntakeDraftPayload(draft.payload).valid) {
    return RejectedIntakeDiagnosticPage(c, draft);
  }
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
      <div id="flash" class="flash" style={{ display: "none" }} />
      {converted ? (
        <div class="card">
          <h2>
            {draft.businessName} — converted ({draft.convertedBuildMode})
          </h2>
          <p class="muted">
            This draft is immutable after Validate &amp; Generate. Later factual changes are Fact Updates inside a Revision
            Request on the site page.
          </p>
          <a class="badge ready" href={`/admin/sites/${draft.convertedSiteId}`}>
            Open site review
          </a>
        </div>
      ) : (
        <>
          {draft.status === "REJECTED" ? (
            <div class="card">
              <h2>Rejected submission — rescue path</h2>
              <p>
                Rejection reason: <strong>{draft.rejectionReason ?? "unknown"}</strong>
              </p>
              <p class="muted">
                This public submission was rejected before acceptance ({draft.rejectionReason === "TURNSTILE_FAILED"
                  ? "Turnstile verification failed"
                  : draft.rejectionReason === "RATE_LIMITED"
                    ? "the source had exhausted its submission budget for the hour"
                    : "schema validation failed"}
                ). The client's data below is intact. Review it, correct anything, then Save (mark In Review) and Validate &amp;
                Generate as usual — the rejection no longer blocks anything.
              </p>
            </div>
          ) : null}
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
              <button type="button" class="secondary" onclick="addService()">
                Add Service
              </button>
            </div>
          </div>
          <div class="card">
            <h2>Business brief</h2>
            {textField("business-name", "Business name", business.businessName)}
            {textField("contact-email", "Public contact email", business.contactEmail)}
            {textField("business-type", "Business type", business.businessType ?? "")}
            <label for="business-description">Business description</label>
            <textarea id="business-description">{business.businessDescription ?? ""}</textarea>
            {textField("ideal-client", "Ideal client profile", business.idealClientProfile ?? "")}
            {textField("address", "Address line", business.addressLine1 ?? "")}
            {textField("city", "City", business.city ?? "")}
            {textField("country", "Country", business.country ?? "")}
            {textField("phone", "Phone", business.phoneNumber ?? "")}
            {textField("whatsapp", "WhatsApp", business.whatsappNumber ?? "")}
            {textField("logo-url", "Logo URL (optional)", business.logoUrl ?? "")}
            {textField("socials", "Socials (JSON, optional)", business.socials ? JSON.stringify(business.socials) : "")}
            <label for="differentiator">Competitive differentiator (optional)</label>
            <textarea id="differentiator">{business.competitiveDifferentiator ?? ""}</textarea>
            <label for="extra-info">Extra information</label>
            <textarea id="extra-info">{business.extraInformation ?? ""}</textarea>
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
            {textField("pref-audience", "Audience", prefs.audience ?? "")}
            {textField("pref-goal", "Conversion goal", prefs.conversionGoal ?? "")}
            {textField("pref-palette", "Preferred palette", prefs.preferredPalette ?? "")}
            {textField("pref-style", "Visual style", prefs.visualStyle ?? "")}
            {textField("pref-tone", "Tone", prefs.tone ?? "")}
            {textField("pref-avoid", "Avoidances", prefs.avoidances ?? "")}
            {textField("pref-inspiration", "Inspiration notes", prefs.inspirationNotes ?? "")}
          </div>
          <div class="card">
            <h2>Admin notes (private)</h2>
            <textarea id="admin-notes">{draft.adminNotes ?? ""}</textarea>
            <p class="muted">Submitter: {draft.submitterName} &lt;{draft.submitterEmail}&gt; — private intake contact, never a public Business Fact.</p>
            <button type="button" class="secondary" onclick="saveDraft(true)">
              Save (mark In Review)
            </button>
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
              {textField("cd-audience", "Audience", prefs.audience ?? "")}
              {textField("cd-goal", "Conversion goal", prefs.conversionGoal ?? "")}
              {textField("cd-environment", "Service environment", prefs.serviceEnvironment ?? "")}
              {textField("cd-palette", "Preferred palette", prefs.preferredPalette ?? "")}
              {textField("cd-style", "Visual style", prefs.visualStyle ?? "")}
              {textField("cd-tone", "Tone", prefs.tone ?? "")}
              {textField("cd-avoid", "Avoidances", prefs.avoidances ?? "")}
              {textField("cd-inspiration", "Inspiration notes", prefs.inspirationNotes ?? "")}
            </div>
            <div id="rb-panel" class="hidden">
              {textField("reference-url", "Reference URL", draft.payload.referenceUrl ?? "")}
              <label for="screenshot-input">Reference screenshot (PNG/JPEG, max 9 MB)</label>
              <input type="file" id="screenshot-input" accept="image/png,image/jpeg" />
              <button type="button" class="secondary" onclick="uploadScreenshot()">
                Upload screenshot
              </button>
              {draft.payload.referenceScreenshotR2Key ? <p class="muted">Stored: {draft.payload.referenceScreenshotR2Key}</p> : null}
              <p class="muted">Client design preferences stay visible above as CLIENT NOTES — they never enter a REFERENCE_BOUND submission.</p>
            </div>
            <button type="button" onclick="generate()">
              Validate &amp; Generate
            </button>
          </div>
        </>
      )}
      <script dangerouslySetInnerHTML={{ __html: EDITOR_JS(`/api/admin/intake-drafts/${draft.id}`) }} />
    </Layout>
  );
}

/**
 * Read-only diagnostic view for a REJECTED intake attempt whose stored body is
 * not a valid draft payload (so the structured editor cannot render it). The
 * raw submission and the rejection reason stay operator-visible — the incident
 * this page exists for is a real client's brief being invisibly lost.
 */
async function RejectedIntakeDiagnosticPage(c: Context<{ Bindings: Env }>, draft: IntakeDraft): Promise<Response> {
  const validation = validateIntakeDraftPayload(draft.payload);
  const issues = validation.valid ? [] : validation.issues;
  return c.html(
    <Layout active="intakes">
      <div class="card">
        <h2>{draft.businessName} — rejected submission (malformed body)</h2>
        <p>
          Rejection reason: <strong>{draft.rejectionReason ?? "unknown"}</strong>
        </p>
        <p class="muted">
          Submitted {draft.createdAt.slice(0, 16).replace("T", " ")} · Submitter {draft.submitterName} &lt;
          {draft.submitterEmail}&gt; (private intake contact). The stored body did not pass draft schema validation, so the
          structured editor is unavailable — the raw submission is below for manual recovery. Rejected attempts can never
          start a Site Generation.
        </p>
        {issues.length > 0 ? (
          <ul>
            {issues.map((issue) => (
              <li class="muted">
                {issue.path} — {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
        <pre>{JSON.stringify(draft.payload, null, 2)}</pre>
      </div>
    </Layout>
  );
}

// ── Notifications ledger ─────────────────────────────────────────────────────

function notificationBadge(status: string): { label: string; css: string } {
  switch (status) {
    case "SENT":
      return { label: "Sent", css: "ready" };
    case "PERMANENT_FAILED":
      return { label: "Failed", css: "failed" };
    case "SENDING":
      return { label: "Sending", css: "review" };
    default:
      return { label: "Pending", css: "" };
  }
}

async function NotificationsPage(c: Context<{ Bindings: Env }>): Promise<Response> {
  const notifications = await listAdminNotifications(c.env, { limit: 200 });
  const failed = notifications.filter((notification) => notification.status === "PERMANENT_FAILED").length;
  const rows = notifications.map((notification) => {
    const badge = notificationBadge(notification.status);
    return (
      <tr>
        <td>{notification.createdAt.slice(0, 16).replace("T", " ")}</td>
        <td>{notification.kind}</td>
        <td>
          <span class={`badge ${badge.css}`}>{badge.label}</span>
          {notification.attempts > 1 ? <div class="muted">{notification.attempts} attempts</div> : null}
        </td>
        <td>{notification.subject}</td>
        <td>
          {notification.lastError ? <div class="muted">{notification.lastError}</div> : null}
          {notification.status === "PENDING" && notification.nextAttemptAfter ? (
            <div class="muted">retry after {notification.nextAttemptAfter.slice(0, 16).replace("T", " ")}</div>
          ) : null}
        </td>
      </tr>
    );
  });
  return c.html(
    <Layout active="notifications">
      <div class="card">
        <h2>Admin notification ledger</h2>
        <p class="muted">
          Every operator email (new brief, ready, human review, generation failed) is recorded here with its delivery
          outcome — a missing email means a failure row on this page, never a missing ledger entry.
          {failed > 0 ? (
            <>
              {" "}
              <strong>{failed} PERMANENT_FAILED — delivery will not retry; diagnose the transport before relying on email.</strong>
            </>
          ) : null}
        </p>
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Subject</th>
              <th>Last error / retry</th>
            </tr>
          </thead>
          <tbody>{rows as never}</tbody>
        </table>
      </div>
    </Layout>
  );
}

// ── Site review page ─────────────────────────────────────────────────────────

const SITE_JS = (apiPath: string) => `
const API = '${apiPath}';
async function addNote() {
  const note = document.getElementById('new-note').value.trim();
  if (!note) return;
  const response = await fetch(API + '/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: note }) });
  if (!response.ok) { const r = await response.json(); alert('Note failed: ' + (r.error && r.error.message || response.status)); return; }
  location.reload();
}
async function generateRevision() {
  const noteIds = Array.from(document.querySelectorAll('input.note-select:checked')).map(function (el) { return el.value; });
  const factPatch = {};
  var phone = document.getElementById('fp-phone').value.trim(); if (phone) factPatch.phoneNumber = phone;
  var email = document.getElementById('fp-email').value.trim(); if (email) factPatch.contactEmail = email;
  var whatsapp = document.getElementById('fp-whatsapp').value.trim(); if (whatsapp) factPatch.whatsappNumber = whatsapp;
  var diff = document.getElementById('fp-diff').value.trim(); if (diff) factPatch.competitiveDifferentiator = diff;
  var raw = document.getElementById('fp-json').value.trim(); if (raw) { try { Object.assign(factPatch, JSON.parse(raw)); } catch (e) { alert('Fact JSON is invalid: ' + e.message); return; } }
  const response = await fetch(API + '/generate-revision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ noteIds: noteIds, factPatch: factPatch }) });
  const result = await response.json();
  if (!response.ok) { alert('Generate Revision failed: ' + (result.error && result.error.message || response.status)); return; }
  alert('Revision Request created — one new Build started (' + result.buildId.slice(0, 8) + ').');
  location.reload();
}
`;

async function SiteReviewPage(c: Context<{ Bindings: Env }>, review: AdminSiteReview): Promise<Response> {
  const noteItems = review.notes.map((note) => (
    <div class={`note ${note.status === "INCLUDED" ? "included" : ""}`}>
      {note.status === "PENDING" ? <input type="checkbox" class="note-select" value={note.id} /> : null} {note.note}
      <div class="meta">
        {note.createdAt.slice(0, 16).replace("T", " ")} · {note.status}
        {note.includedInRevisionRequestId ? ` · ${note.includedInRevisionRequestId.slice(0, 8)}` : ""}
      </div>
    </div>
  ));
  return c.html(
    <Layout active="sites">
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
        {review.siteAddress ? (
          <p>
            <span class="muted">Site Address:</span>{" "}
            {review.published ? (
              <a href={review.siteAddress.url} target="_blank" rel="noreferrer">
                {review.siteAddress.url}
              </a>
            ) : (
              <>
                {review.siteAddress.url} <span class="badge review">Not published</span>
              </>
            )}
          </p>
        ) : null}
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
                {build.terminalReason ? (
                  <p style={{ margin: "0.5rem 0 0" }}>
                    <span class="muted">Why: </span>
                    {build.terminalReason}
                  </p>
                ) : null}
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
          Operator instructions — NOT an AI chat agent. Notes never start a build individually; select pending notes and
          press Generate Revision to combine them into ONE bounded Revision Request on the existing pipeline.
        </p>
        <div class="chat">{noteItems as never}</div>
        <label for="new-note">New note</label>
        <textarea id="new-note" placeholder='e.g. "Reduce the mobile hero title."' />
        <button type="button" class="secondary" onclick="addNote()">
          Add note
        </button>
      </div>
      <div class="card">
        <h2>Generate Revision</h2>
        <p class="muted">Selected pending notes become the request note. Factual changes come from the structured fields (Fact Updates) — never from the notes themselves.</p>
        {textField("fp-phone", "Phone change", "")}
        {textField("fp-email", "Contact email change", "")}
        {textField("fp-whatsapp", "WhatsApp change", "")}
        {textField("fp-diff", "Competitive differentiator change", "")}
        <label for="fp-json">Additional FactPatch JSON (whole-field; advanced)</label>
        <textarea id="fp-json" placeholder='{"services": [ { "name": "…" }, { "name": "…" }, { "name": "…" } ]}' />
        <button type="button" onclick="generateRevision()">
          Generate Revision
        </button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: SITE_JS(`/api/admin/sites/${review.siteId}`) }} />
    </Layout>
  );
}

export function registerAdminPageRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/admin", (c) => c.redirect("/admin/intakes"));
  app.get("/admin/", (c) => c.redirect("/admin/intakes"));
  app.get("/admin/intakes", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    return await IntakesPage(c);
  });
  app.get("/admin/notifications", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    return await NotificationsPage(c);
  });
  app.get("/admin/intakes/:draftId", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const draft = await getIntakeDraft(c.env, c.req.param("draftId") as string);
    if (!draft) return c.html(<Layout active="intakes">
      <div class="card">Draft not found.</div>
    </Layout> as never, 404);
    return await IntakeEditorPage(c, draft);
  });
  app.get("/admin/sites/:siteId", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const review = await getAdminSiteReview(c.env, c.req.param("siteId") as string);
    if (!review) return c.html(<Layout active="sites">
      <div class="card">Site not found.</div>
    </Layout> as never, 404);
    return await SiteReviewPage(c, review);
  });
}
