# Cloudflare Website Factory — Deployment & Operations Roadmap

A step-by-step guide to provisioning, configuring, deploying, and operating the CF-native website factory on Cloudflare.

---

## Phase 0: Prerequisites

### 0.1 Accounts & Access

| Service | What You Need | Where to Get It |
|---|---|---|
| Cloudflare | Account with Workers paid plan ($5/mo) | https://dash.cloudflare.com |
| Cloudflare AI Gateway | Gateway endpoint configured | Dashboard → AI → AI Gateway |
| SMTP2Go | Account with verified sender domain | https://www.smtp2go.com |
| Kie.ai | API key for image generation | https://kie.ai |
| AI Model Provider | API key (see below) | See Phase 1 |
| WordPress | Fluent Forms plugin installed | Plugin repo |

### 0.2 CLI Tools

```bash
npm install -g wrangler
wrangler login
```

Verify: `wrangler whoami` returns your account email.

### 0.3 Cloudflare Account ID

```bash
wrangler whoami
```

Copy the Account ID. You will need it in Phase 1.

---

## Phase 1: Cloudflare Infrastructure Provisioning

### 1.1 Create D1 Database

```bash
wrangler d1 create website_factory_v1
```

Output includes `database_id`. Copy it.

### 1.2 Create R2 Bucket

```bash
wrangler r2 bucket create website-factory-assets
```

### 1.3 Configure AI Model Provider (Z.ai)

The factory uses **Zhipu AI (Z.ai)** as its LLM provider via their OpenAI-compatible Coding API.

1. Sign up at https://open.bigmodel.cn (Zhipu AI platform)
2. Navigate to API Keys and create a new key
3. Copy the API key — this is `ZHIPU_API_KEY`
4. Default model: `glm-5-turbo`
5. API base URL: `https://api.z.ai/api/coding/paas/v4`

> **Fallback**: If `ZHIPU_API_KEY` is not set, the system falls back to Cloudflare AI Gateway + OpenAI. To use the fallback, complete step 1.3b below.

#### 1.3b (Optional) Cloudflare AI Gateway Fallback

1. Go to Cloudflare Dashboard → AI → AI Gateway
2. Click "Create Gateway"
3. Name it: `website-factory`
4. Note the Gateway ID from the URL (e.g. `website-factory`)
5. Add a provider (OpenAI, Anthropic, etc.) and configure the API key

### 1.4 Request Worker Deploy API Token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Create Token → Custom Token
3. Permissions:
   - Account → Workers Scripts → Edit
   - Account → Workers KV Storage → Edit (if needed later)
   - Account → Workers R2 Storage → Edit
   - Account → Account Settings → Read
   - Account → Workers Routes → Edit (for custom domains)
4. Copy the token — note this value is only shown once

### 1.5 Configure SMTP2Go

1. Verify a sender domain (e.g. `wazibizwebsites.com`)
2. Add a verified sender address: `notifications@wazibizwebsites.com`
3. Optionally add: `noreply@wazibizwebsites.com`
4. Copy the API key from Settings → API Keys

### 1.6 Get Kie.ai API Key

1. Sign up at https://kie.ai
2. Navigate to API Keys section
3. Create a new key
4. Note: the default model is `z-image`

### 1.7 Generate Webhook Secret

```bash
openssl rand -hex 32
```

Save the output. This is `WEBHOOK_SECRET`.

### 1.8 Generate Approval Secret

```bash
openssl rand -hex 32
```

Save the output. This is `APPROVAL_SECRET`.

---

## Phase 2: Configuration

### 2.1 Update `wrangler.jsonc`

Replace placeholders with real values:

```jsonc
{
  "vars": {
    "CF_ACCOUNT_ID": "<your-account-id>",
    "CF_AI_GATEWAY_ID": "website-factory",
    "PUBLIC_APP_URL": "https://cf-website-factory.wazibiz.workers.dev",
    "KIE_API_URL": "https://api.kie.ai",
    "KIE_MODEL": "z-image",
    "APPROVAL_TIMEOUT_DAYS": "7",
    "MAX_REVISIONS": "3",
    "INTERNAL_NOTIFICATION_EMAIL": "wazibizwebsites@gmail.com",
    "ZHIPU_API_URL": "https://api.z.ai/api/coding/paas/v4",
    "ZHIPU_MODEL": "glm-5-turbo"
  }
}
```

Also update the D1 binding:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "website_factory_v1",
    "database_id": "<database-id-from-step-1.1>"
  }
]
```

### 2.2 Set Worker Secrets

```bash
wrangler secret put ZHIPU_API_KEY
# Paste your Zhipu AI API key from step 1.3

wrangler secret put CF_AIG_TOKEN
# (Optional fallback) Paste your Cloudflare AI Gateway token

wrangler secret put CF_DEPLOY_API_TOKEN
# Paste your deploy API token from step 1.4

wrangler secret put SMTP2GO_API_KEY
# Paste your SMTP2Go API key from step 1.5

wrangler secret put KIE_API_KEY
# Paste your Kie.ai API key from step 1.6

wrangler secret put WEBHOOK_SECRET
# Paste the secret from step 1.7

wrangler secret put APPROVAL_SECRET
# Paste the secret from step 1.8
```

Verify all secrets are set:

```bash
wrangler secret list
```

Should show 7 secrets (or 6 if using AI Gateway fallback without `ZHIPU_API_KEY`).

---

## Phase 3: Database Migration

### 3.1 Run All Migrations (Remote)

```bash
wrangler d1 execute website_factory_v1 --remote --file=migrations/0001_init.sql
wrangler d1 execute website_factory_v1 --remote --file=migrations/0002_review_revisions.sql
wrangler d1 execute website_factory_v1 --remote --file=migrations/0003_prompt_versions.sql
```

### 3.2 Verify Schema

```bash
wrangler d1 execute website_factory_v1 --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expected tables: `approvals`, `clients`, `contact_submissions`, `image_assets`, `job_prompt_runs`, `jobs`, `page_specs`, `prompts`, `qa_issues`, `qa_reports`, `revisions`, `site_versions`, `sites`

### 3.3 Seed Prompts Table (Optional)

If you want to track prompt versions in D1 rather than using the bundled `.md` files:

```sql
INSERT INTO prompts (id, prompt_type, style_key, version, name, content, is_active, created_at)
VALUES (
  'prompt-site-gen-mm-v1',
  'site_generation',
  'minimalist-monochrome',
  '1.0.0',
  'Minimalist Monochrome Site Generator',
  '<loaded from site-system.md>',
  1,
  '<current-timestamp>'
);
```

---

## Phase 4: Local Development & Testing

### 4.1 Install Dependencies

```bash
npm install
```

### 4.2 Run Local Migrations

```bash
npm run db:migrate:local
```

### 4.3 Start Local Dev Server

```bash
npm run dev
```

This starts a local Wrangler dev server with:
- Hono routes at `http://127.0.0.1:8787`
- Local D1 (persisted in `.wrangler/state/v3/d1/`)
- Local R2 (persisted in `.wrangler/state/v3/r2/`)

### 4.4 Test Webhook Endpoint

```bash
# Generate a test signature
echo -n '{"company_name":"Test Co","client_email":"test@example.com","reference_site_url":"https://example.com","reference_homepage_screenshot":"<upload-id>"}' | openssl dgst -sha256 -hmac "<your-webhook-secret>"

# Send test webhook
curl -X POST http://localhost:8787/api/webhooks/fluentforms \
  -H "Content-Type: application/json" \
  -H "X-WF-Signature: <generated-hex>" \
  -d '{"company_name":"Test Co","client_email":"test@example.com","reference_site_url":"https://example.com","reference_homepage_screenshot":"<upload-id>","business_description":"A test company"}'
```

Expected response: `{"ok":true,"jobId":"<uuid>","status":"queued"}`

### 4.5 Test Job Status

```bash
curl http://localhost:8787/api/jobs/<jobId>
```

### 4.6 Test Approval Flow

After a site reaches `waiting_approval`:

```bash
# Generate approval token (in Node)
node -e "
const crypto = require('crypto');
const payload = JSON.stringify({ jobId: '<jobId>', action: 'approve', exp: Date.now() + 86400000 });
const sig = crypto.createHmac('sha256', '<approval-secret>').update('<jobId>:approve:' + Date.now()).digest('hex');
const token = Buffer.from(JSON.stringify({ ...JSON.parse(payload), sig })).toString('base64url');
console.log(token);
"

# Approve
curl -X POST "http://localhost:8787/api/jobs/<jobId>/approve?token=<token>"
```

### 4.7 Lint & Typecheck

```bash
npm run lint
```

Must pass with zero errors.

---

## Phase 5: Production Deployment

### 5.1 Deploy the Orchestrator Worker

```bash
npm run deploy
```

This deploys `cf-website-factory` to `https://cf-website-factory.wazibiz.workers.dev`.

### 5.2 Verify Deployment

```bash
curl https://cf-website-factory.wazibiz.workers.dev/api/jobs/nonexistent
```

Expected: `{"error":"Job not found"}` (confirms routing works).

### 5.3 Verify Webhook Endpoint

```bash
curl -X POST https://cf-website-factory.wazibiz.workers.dev/api/webhooks/fluentforms \
  -H "Content-Type: application/json" \
  -H "X-WF-Signature: invalid" \
  -d '{}'
```

Expected: `{"error":"Invalid signature"}` (401 status).

### 5.4 Note the Production URL

Update `PUBLIC_APP_URL` in `wrangler.jsonc` to the actual production URL if different, then redeploy.

---

## Phase 6: WordPress Integration

### 6.1 Configure Fluent Forms Webhook

1. In WordPress admin, go to Fluent Forms → Settings → Integrations → Webhook
2. Add a new webhook:
   - **Webhook URL**: `https://cf-website-factory.<subdomain>.workers.dev/api/webhooks/fluentforms`
   - **Webhook Secret**: The `WEBHOOK_SECRET` value from step 1.7
   - **Method**: POST
   - **Trigger**: On form submission

### 6.2 Configure Fluent Forms Signature

Fluent Forms sends webhooks without HMAC signatures by default. Two options:

**Option A: Use a Fluent Forms hook** (recommended)

Add to your theme's `functions.php`:

```php
add_action('fluentform_after_submission', function ($entry, $form) {
    $webhook_url = 'https://cf-website-factory.<subdomain>.workers.dev/api/webhooks/fluentforms';
    $secret = '<your-webhook-secret>';

    $payload = json_encode($entry->data);
    $signature = hash_hmac('sha256', $payload, $secret);

    wp_remote_post($webhook_url, [
        'body' => $payload,
        'headers' => [
            'Content-Type' => 'application/json',
            'X-WF-Signature' => $signature,
        ],
        'timeout' => 30,
    ]);
}, 10, 2);
```

**Option B: Disable signature verification temporarily**

Set `WEBHOOK_SECRET` to an empty string and remove the signature check from `src/routes/webhook.fluentforms.ts`. Not recommended for production.

### 6.3 Align Form Fields

The WordPress form must send these fields (field names are case-sensitive):

| Form Field | Maps To |
|---|---|
| `company_name` | Required — Client company name |
| `client_email` | Required — Client email |
| `reference_site_url` | Required — Public HTTP(S) reference site |
| `reference_homepage_screenshot` | Required — Persisted full-page PNG upload ID |
| `business_type` | Optional |
| `business_description` | Optional |
| `ideal_client_profile` | Optional |
| `logo_url` | Optional — URL to client logo |
| `preferred_colour_1` | Optional — Stored, not used in CSS |
| `preferred_colour_2` | Optional — Stored, not used in CSS |
| `mode` | Optional — "light" or "dark" |
| `address_line_1` | Optional |
| `address_line_2` | Optional |
| `city` | Optional |
| `county` | Optional |
| `zip_code` | Optional |
| `country` | Optional |
| `facebook_url` | Optional |
| `instagram_url` | Optional |
| `twitter_url` | Optional |
| `linkedin_url` | Optional |
| `other_social_url` | Optional |
| `extra_information` | Optional |

### 6.4 Test End-to-End

1. Submit the WordPress form
2. Check email at `wazibizwebsites@gmail.com` for the preview notification
3. Click the preview URL
4. Verify all 4 pages render correctly
5. Click Approve
6. Verify the site is marked as completed in D1

---

## Phase 7: Custom Domain (Optional)

### 7.1 Add Custom Domain to Factory Worker

```bash
wrangler domains add factory.wazibizwebsites.com
```

Or via Dashboard: Workers → cf-website-factory → Settings → Domains & Routes → Add Custom Domain.

### 7.2 Update Webhook URL

Update the Fluent Forms webhook URL to use the custom domain.

### 7.3 Update `PUBLIC_APP_URL`

Update the env var and redeploy:

```bash
wrangler secret put PUBLIC_APP_URL
# Enter: https://factory.wazibizwebsites.com
npm run deploy
```

---

## Phase 8: GitHub Production Deploy Pipeline

After a site is approved, its files are pushed to a GitHub monorepo. GitHub Actions then deploys each site to Cloudflare Workers via Wrangler — this is the production deployment, separate from the preview Worker used during QA.

### 8.1 Why GitHub in the Loop?

| Benefit | Explanation |
|---|---|
| Version control | Every production site version is a git commit — full history, diffable, revertable |
| CI/CD audit trail | GitHub Actions run logs show exactly what deployed and when |
| Custom domain management | Wrangler handles custom domains in `wrangler.toml` per client |
| Decoupled deploy | Factory Worker doesn't need to hold deploy state — GitHub Actions owns production |
| Team access | Non-engineers can see deployed sites, roll back, review commits |

### 8.2 Create the GitHub Monorepo

1. Create a new repo on GitHub: `wazibizwebsites/client-sites` (or your preferred org/name)
2. Initialise it with a README:
   ```bash
   mkdir client-sites && cd client-sites
   echo "# Client Sites — Auto-deployed via GitHub Actions" > README.md
   git init && git add . && git commit -m "init"
   gh repo create wazibizwebsites/client-sites --public --source=. --push
   ```
3. The repo structure will be auto-populated by the factory:
   ```
   clients/
     acme-coffee/
       dist/              ← static site files (HTML, CSS, JS, images, sitemap)
       worker.js          ← contact form handler
       wrangler.toml      ← per-site worker config
       site-spec.json     ← source spec for reference
   ```

### 8.3 Create GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Create token with:
   - **Repository access**: Only select the `client-sites` repo
   - **Permissions**: Contents (read & write)
3. Copy the token — this is `GITHUB_TOKEN`

### 8.4 Set Factory Worker Secrets

```bash
wrangler secret put GITHUB_TOKEN
# Paste the PAT from step 8.3

wrangler secret put GITHUB_WEBHOOK_SECRET
# Generate: openssl rand -hex 32

wrangler secret put GITHUB_REPO_OWNER
# e.g., wazibizwebsites

wrangler secret put GITHUB_REPO_NAME
# e.g., client-sites

wrangler secret put GITHUB_BRANCH
# e.g., main
```

### 8.5 Configure GitHub Repo Secrets

In the GitHub repo: Settings → Secrets and variables → Actions → New repository secret

| Secret | Value |
|---|---|
| `CF_DEPLOY_API_TOKEN` | Same token used by the factory Worker |
| `CF_ACCOUNT_ID` | Your Cloudflare account ID |
| `GITHUB_WEBHOOK_SECRET` | Same value as factory's `GITHUB_WEBHOOK_SECRET` |
| `FACTORY_WEBHOOK_URL` | `https://cf-website-factory.<subdomain>.workers.dev` |

### 8.6 Run Database Migration

```bash
wrangler d1 execute website_factory_v1 --remote --file=migrations/0004_production_deploy.sql
```

This adds to `site_versions`:
- `github_commit_sha` — tracks which commit deployed this version
- `github_ref` — branch name
- `production_worker_name` — the production Worker name
- `production_url` — the live production URL
- `production_status` — `pending` → `deploying` → `deployed` / `failed`
- `production_deployed_at` — timestamp

And creates a `deployments` audit table.

### 8.7 Deploy Updated Factory Worker

```bash
npm run deploy
```

This deploys the factory with the new:
- `POST /api/webhooks/github` endpoint (receives deploy status callbacks)
- Updated approval flow (pushes to GitHub on approval)
- GitHub API integration (`src/lib/github.ts`)

### 8.8 How It Works — Step by Step

```
1. Human clicks Approve in email
   ↓
2. Factory approve route:
   - Records approval in D1
   - Schedules preview Worker for deletion (30 days)
   - Collects site files from R2 (HTML, CSS, JS, images, spec)
   - Pushes to GitHub via Git Data API (tree + commit + ref update)
   - Records github_commit_sha on site_versions
   - Sets production_status = 'deploying'
   ↓
3. GitHub Actions triggers on push to clients/**
   - Detects which client slugs changed
   - Runs wrangler deploy per client in parallel
   - Notifies factory webhook on completion
   ↓
4. Factory webhook callback:
   - Verifies HMAC signature
   - Sets production_status = 'deployed' (or 'failed')
   - Records production_worker_name and production_url
   - Creates deployments audit row
```

### 8.9 Custom Domains

To bind a custom domain to a client site, edit the generated `wrangler.toml` in the GitHub repo:

```toml
name = "site-acme-coffee"
main = "worker.js"
compatibility_date = "2026-04-22"

[assets]
directory = "./dist"

[[routes]]
pattern = "acmecoffee.com"
zone_name = "acmecoffee.com"

[[routes]]
pattern = "www.acmecoffee.com"
zone_name = "acmecoffee.com"
```

Then push to main — GitHub Actions will redeploy with the custom domain.

> **Prerequisite**: The client's domain must be pointed to Cloudflare nameservers, and the zone must exist in your Cloudflare account.

### 8.10 Redeploy a Site

To redeploy (e.g., after fixing a custom domain config):

```bash
# Option A: Empty commit to trigger GitHub Actions
cd client-sites
git commit --allow-empty -m "redeploy: acme-coffee"
git push

# Option B: Manual wrangler deploy
cd client-sites/clients/acme-coffee
npx wrangler deploy
```

### 8.11 Rollback a Production Site

```bash
cd client-sites
git log --oneline -- clients/acme-coffee/
# Find the commit before the bad deploy
git revert <commit-sha>
git push
```

GitHub Actions will redeploy the previous version.

### 8.12 Troubleshooting

**GitHub push fails with 401**:
- Check `GITHUB_TOKEN` is set and not expired
- Verify the PAT has `Contents: read & write` on the repo

**GitHub Actions doesn't trigger**:
- Verify the push landed on the correct branch (`GITHUB_BRANCH`)
- Check the workflow file exists at `.github/workflows/deploy-site.yml` in the repo
- GitHub Actions must be enabled in repo Settings → Actions → General

**Deploy status webhook fails**:
- Verify `GITHUB_WEBHOOK_SECRET` matches between factory and GitHub repo secrets
- Verify `FACTORY_WEBHOOK_URL` is reachable (not blocked by firewall)

**Production Worker missing secrets**:
- After GitHub Actions deploys, the Worker needs `SMTP2GO_API_KEY` and `CLIENT_EMAIL` for the contact form
- Add a post-deploy step or use the Cloudflare API to set secrets after deploy

---

## Phase 9: Generated Site Worker Secrets

Each deployed site Worker needs its own secrets for the contact form. After a site is deployed, set secrets on the generated Worker:

```bash
wrangler secret put --name "<worker-name>" SMTP2GO_API_KEY
# Paste the same SMTP2Go API key

wrangler secret put --name "<worker-name>" CLIENT_EMAIL
# Enter the client's email address
```

### 9.1 Automate Secret Provisioning

The `createWorker` function in `src/lib/publish.ts` declares `secret_text` bindings. After Worker creation via the REST API, use a follow-up call to set secrets:

```
PUT https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/workers/scripts/{worker_name}/secrets
Authorization: Bearer {CF_DEPLOY_API_TOKEN}

{
  "name": "SMTP2GO_API_KEY",
  "text": "<smtp2go-api-key>",
  "type": "secret_text"
}
```

This should be added to the deploy flow in `src/lib/publish.ts` as a fourth step.

---

## Phase 10: Worker Lifecycle Management

### 10.1 The Worker Limit Problem

At 50 sites/month, you hit the default 100 Workers/account limit in 2 months.

Current mitigation:
- Preview Workers are scheduled for deletion 30 days after approval (`src/lib/worker-lifecycle.ts`)
- Rejected sites delete their Worker immediately

### 10.2 Request a Worker Limit Increase

1. Contact Cloudflare support or your account manager
2. Request increase to 500+ Workers
3. This is the primary scaling mechanism

### 10.3 Set Up Scheduled Cleanup

The `cleanupExpiredWorkers` function exists but needs a trigger. Options:

**Option A: Cron Trigger** (add to `wrangler.jsonc`)

```jsonc
"triggers": {
  "crons": ["0 3 * * *"]
}
```

Then add a cron handler to `src/index.ts`:

```typescript
export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    if (event.cron === "0 3 * * *") {
      const { cleanupExpiredWorkers } = await import("./lib/worker-lifecycle");
      const deleted = await cleanupExpiredWorkers(env);
      console.log(`Cleaned up ${deleted} expired workers`);
    }
  }
};
```

**Option B: External cron** (e.g., cron-job.org hitting a cleanup endpoint)

Add a route:

```typescript
app.post("/api/internal/cleanup", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader !== `Bearer ${c.env.WEBHOOK_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const deleted = await cleanupExpiredWorkers(c.env);
  return c.json({ ok: true, deleted });
});
```

---

## Phase 11: Monitoring & Observability

### 11.1 Cloudflare Dashboard Monitoring

- **Workers Analytics**: Dashboard → Workers → cf-website-factory → Metrics
- **D1 Queries**: Dashboard → D1 → website_factory_v1 → Console
- **R2 Usage**: Dashboard → R2 → website-factory-assets → Metrics
- **Workflows**: Dashboard → Workers → Workflows (view running/completed instances)

### 11.2 Key Metrics to Watch

| Metric | Where | Alert Threshold |
|---|---|---|
| Worker invocations/min | Workers Analytics | > 100 (unexpected spike) |
| Worker errors | Workers Analytics | > 5% error rate |
| D1 read latency | D1 Metrics | > 100ms p95 |
| R2 storage growth | R2 Metrics | > 10GB/month (estimate for 50 sites) |
| Workflow duration | Workflows | > 10 min (stuck) |
| Failed jobs | D1 query | > 3/day |
| QA failure rate | D1 query | > 20% |

### 11.3 Useful D1 Queries

**Failed jobs in last 24h:**
```sql
SELECT id, job_type, status, error_code, error_message, created_at
FROM jobs
WHERE status IN ('failed', 'failed_validation')
  AND created_at > datetime('now', '-1 day')
ORDER BY created_at DESC;
```

**Jobs stuck in running:**
```sql
SELECT id, current_step, created_at, updated_at
FROM jobs
WHERE status = 'running'
  AND updated_at < datetime('now', '-30 minutes');
```

**Worker count by status:**
```sql
SELECT worker_status, COUNT(*)
FROM site_versions
GROUP BY worker_status;
```

**Average workflow duration:**
```sql
SELECT job_type,
  AVG((julianday(updated_at) - julianday(created_at)) * 24 * 60) as avg_minutes
FROM jobs
WHERE status = 'completed'
GROUP BY job_type;
```

### 11.4 Log Draining (Optional)

Add a `tail` handler in `wrangler.jsonc`:

```jsonc
"triggers_tail": [
  {
    "service": "cf-website-factory"
  }
]
```

Then use `wrangler tail` to watch logs in real time, or send to a log aggregator.

---

## Phase 12: Cost Estimation

### 12.1 Per-Site Costs

| Resource | Per-Site Cost | Notes |
|---|---|---|
| D1 reads/writes | ~$0.001 | Negligible |
| R2 storage | ~$0.015/mo | ~10MB per site with images |
| R2 Class A ops | ~$0.004 | Write during build |
| R2 Class B ops | ~$0.0004 | Read during QA |
| Worker invocation | ~$0.0002 | Contact form only |
| Zhipu AI (site gen) | ~$0.005-0.01 | GLM-5-turbo, ~4k tokens |
| Zhipu AI (revision) | ~$0.005-0.01 | Per revision round |
| Kie.ai images (z-image) | ~$0.04-0.10 | ~4-8 images per site |
| SMTP2Go | ~$0.001 | 1-2 emails per site |
| **Total per site** | **~$0.06-0.25** | |

### 12.2 Monthly at 50 Sites

| Item | Cost |
|---|---|
| Workers plan | $5.00 |
| D1 | $0.75 (included in plan) |
| R2 (500MB) | ~$0.75 |
| Zhipu AI (50 sites + revisions) | ~$1-3 (GLM-5-turbo, much cheaper than OpenAI) |
| Kie.ai z-image (400 images) | ~$5-20 |
| SMTP2Go | ~$0.50 |
| **Total** | **~$13-30/mo** |

---

## Phase 13: Scaling Considerations

### 13.1 Worker Limit

- Default: 100 Workers per account
- Each approved site creates a Worker
- With 30-day cleanup: ~50 active Workers at steady state (50/mo × 30 days)
- **Action**: Request limit increase to 500 before launch

### 13.2 D1 Row Limits

- D1 free tier: 5GB storage, 5M rows read/day, 100k rows written/day
- Each site creates ~20 rows across all tables
- At 50 sites/month: ~1000 rows/month (well within limits)

### 13.3 R2 Storage

- Each site: ~5-15MB (HTML + CSS + JS + images)
- At 50 sites/month with 30-day retention: ~750MB-1.5GB
- With version history: grows linearly
- **Action**: Monitor and prune old versions if needed

### 13.4 AI Model Rate Limits

- Zhipu AI GLM-5-turbo: ~50-100 RPM depending on plan
- Each site generation: 1 call (with up to 3 retries on failure)
- Each revision: 2 calls (planner + rebuild)
- At 50 sites + 50 revisions: ~150 calls/day (safe within limits)
- If rate-limited, increase your Zhipu AI plan tier
- Kie.ai z-image: ~20 requests per 10 seconds per account

---

## Phase 14: Rollback & Recovery

### 14.1 Rollback Factory Worker

```bash
git log --oneline -5
# Find the commit before the breaking change
git checkout <commit-hash>

npm run deploy
```

### 14.2 Rollback a Generated Site

Each site version is immutable in R2. To rollback:

1. Query D1 for previous version:
   ```sql
   SELECT id, version_number, deployed_worker_name, preview_url
   FROM site_versions
   WHERE site_id = '<site-id>'
   ORDER BY version_number DESC;
   ```
2. Re-deploy the previous version's bundle from R2
3. Update `sites.current_version_id` to the previous version

### 14.3 Disaster Recovery

- **D1**: Cloudflare provides 7-day point-in-time recovery
- **R2**: Versioned paths in R2 provide immutable history
- **Worker code**: Git repository is the source of truth

---

## Phase 15: Security Checklist

- [ ] All secrets set via `wrangler secret put` (never in code)
- [ ] `ZHIPU_API_KEY` set for Z.ai LLM calls
- [ ] `WEBHOOK_SECRET` shared only with WordPress
- [ ] `APPROVAL_SECRET` not shared with anyone
- [ ] `CF_DEPLOY_API_TOKEN` has minimum required permissions
- [ ] `CF_AIG_TOKEN` is scoped to AI Gateway only (only needed if not using Z.ai)
- [ ] `GITHUB_TOKEN` has repo-scoped Contents read & write only
- [ ] `GITHUB_WEBHOOK_SECRET` matches between factory and GitHub repo
- [ ] Webhook endpoint validates HMAC-SHA256 signature
- [ ] Approval tokens expire after 7 days
- [ ] Contact form will require Turnstile on production (v1.1)
- [ ] All user-generated HTML is entity-escaped
- [ ] Logo URLs fetched server-side, never proxied
- [ ] No secrets in `wrangler.jsonc` vars (only non-sensitive config)

---

## Phase 16: Reference-Driven Generation Quality Milestone

### 16.1 Outcome

Replace style-package-led generation with a reference-driven workflow that uses a required live reference URL and required full-page homepage screenshot to produce a design blueprint before rendering. A generated site must pass visual, interaction, accessibility, and factual-provenance checks before any production GitHub push.

This milestone supersedes the style-package assumptions in the current PRD. Phase 16.8 removed the deprecated packages and all active initial-build and revision imports.

**Implementation status:** Phase 16.8 implemented. Preview QA now captures desktop, tablet, and mobile evidence, exercises interaction and reduced-motion behavior, applies a configurable score threshold, blocks failed versions before approval, and leaves the production GitHub push exclusively after human approval.

### 16.2 Decisions Locked for This Milestone

| Area | Decision |
|---|---|
| Reference inputs | Every job requires a reference site URL and a full-page homepage screenshot. Both are stored immutably with the job and site version. |
| Design source of truth | A structured `DesignBlueprint` derived from the supplied references replaces style packages. |
| Motion source of truth | Capture transitions, hover states, microanimations, and section motion from the live URL in an `InteractionBlueprint`. |
| Reference URL fallback | If the live URL cannot be visited, infer restrained, context-appropriate interactions from the screenshot, page structure, and component semantics. |
| Icons | Use a small, approved Lucide catalog. Icons only need to be relevant to the card, feature, service, or section; exact reference-site icon matching is not required. |
| Icon rendering | Resolve icons at build time and emit inline SVG. Do not add a client-side icon runtime or CDN dependency. |
| Component guidance | Use shadcn/ui as inspiration for component anatomy, accessibility, focus behavior, state definitions, spacing, and interaction patterns. Do not adopt its React/Tailwind runtime stack. |
| HTML in Canvas | Excluded from the architecture and milestone. |
| Factual content | Every generated factual claim must have traceable provenance from client input or an approved source. Unsupported claims must be omitted or clearly qualified. |
| Quality gate | Visual validation of the deployed preview is mandatory before the GitHub production push. |
| Deferred work | Performance optimization and broad regression-test infrastructure are outside this milestone. |

### 16.3 Delivery Sequence

#### Step 1 — Reference Intake Contract

- Make `reference_site_url` and `reference_homepage_screenshot` required webhook inputs.
- Validate URL format, screenshot type, dimensions, and successful R2 persistence before generation begins.
- Store immutable reference metadata and asset lineage against the job and site version.
- Fail with `needs_input` when either required reference is missing or unusable.

#### Step 2 — Live Reference and Motion Capture

- Use Browser Run to inspect the live reference at desktop, tablet, and mobile widths.
- Record layout structure, typography, colors, spacing, imagery, navigation behavior, hover/focus states, transitions, scroll reveals, and other microinteractions.
- Store capture results and evidence in R2 so blueprint decisions can be audited.
- When the live URL is inaccessible, record the failure reason and produce a conservative fallback interaction profile rather than a motionless page.

#### Step 3 — Design and Interaction Blueprints

- Generate a validated `DesignBlueprint` covering layout hierarchy, section composition, typography, color roles, spacing, surfaces, imagery, buttons, cards, responsive behavior, and icon usage.
- Generate a validated `InteractionBlueprint` covering trigger, target, property, duration, easing, delay, hover/focus/active behavior, scroll behavior, and reduced-motion fallback.
- Keep the blueprint semantic and renderer-independent; the agent continues to produce structured JSON rather than HTML.
- Add a blueprint review step that rejects incomplete, internally inconsistent, or weakly evidenced design decisions.

#### Step 4 — Renderer Migration and Component Primitives

- Update the deterministic HTML/CSS/JS builder to consume the new blueprints instead of style-package tokens and component files.
- Build a small internal primitive set for navigation, buttons, cards, accordions, forms, media, calls to action, and section layouts.
- Use shadcn/ui patterns as guidance for accessible structure and component states without introducing React, Tailwind, or shadcn runtime dependencies.
- Add a build-time Lucide icon registry with an allowlist and simple semantic mappings such as education, health, community, location, contact, security, and growth.
- Keep icon selection restrained, normally one relevant icon per card or key item, and do not insert icons into sections that do not benefit from them.
- Preserve custom logos and distinctive brand artwork as supplied assets rather than approximating them with Lucide icons.

#### Step 5 — Factual Provenance

- Attach a source reference to each factual content block in the generated spec.
- Distinguish client-provided facts, facts retrieved from approved sources, and non-factual marketing language.
- Reject invented statistics, dates, testimonials, certifications, addresses, program details, and organizational claims.
- Include provenance results in the QA report and revision prompt so corrections remain traceable.

#### Step 6 — Visual and Interaction Quality Gate

- Deploy the generated bundle to a preview Worker before production publication.
- Capture generated pages at the same target viewports used for reference analysis.
- Compare section order, visual hierarchy, typography, color relationships, spacing rhythm, image treatment, responsive behavior, and overall composition against the design blueprint and supplied screenshot.
- Exercise navigation, buttons, cards, forms, hover/focus states, transitions, scroll effects, and reduced-motion behavior.
- Validate that Lucide icons are relevant, consistent, accessible, and not overused. Exact similarity to reference-site icons is not scored.
- Produce structured issues with severity, evidence, selector or region, expected result, and recommended correction.
- Block the GitHub push on critical issues or a visual-quality score below the configured threshold.
- Run a bounded generate → preview → validate → revise loop before escalating to human approval.

#### Step 7 — Workflow Reorder and Legacy Cleanup

- Reorder the workflow so GitHub publication occurs only after blueprint validation, preview deployment, visual and interaction QA, automated revision, and human approval.
- Version reference captures, blueprints, generated bundles, screenshots, and QA reports together in R2.
- Remove style registry selection from webhook normalization and generation prompts.
- Keep all render and revision paths on the accepted blueprint renderer; `src/templates/styles/**` is removed.
- Keep deprecated style selection, style-package loaders, and model-authored HTML generators deleted from active code.

### 16.4 Target Workflow

```text
Required reference URL + required homepage screenshot + client facts
  → validate and persist reference inputs
  → capture live layout, responsive behavior, and motion
  → generate DesignBlueprint + InteractionBlueprint
  → validate blueprint and factual provenance
  → render deterministic HTML/CSS/JS with optional semantic Lucide icons
  → deploy preview Worker
  → visual, interaction, accessibility, and provenance QA
  → bounded automated revision loop
  → human approval
  → GitHub production push
  → GitHub Actions production deployment
```

### 16.5 Milestone Exit Criteria

- Style-package selection is absent from the active generation workflow.
- Every accepted job contains a persisted reference URL and full-page homepage screenshot.
- Every generated version stores validated design and interaction blueprints.
- Live-reference motion is captured when the URL is available; a documented fallback profile is used when it is not.
- Generated sites include relevant transitions, hover/focus behavior, and microanimations with reduced-motion support.
- Lucide icons are selected semantically, rendered without a runtime dependency, and pass accessibility checks.
- All factual claims pass provenance validation.
- Preview screenshots and interaction results are stored with the QA report.
- A failing visual-quality gate cannot reach the GitHub push step.
- At least one end-to-end reference-driven site completes the full preview, revision, approval, and production-push workflow.

---

## Phase 17: Future Enhancements (Post-Milestone)

| Feature | PRD Section | Priority |
|---|---|---|
| Turnstile on contact form | Section 15.4 | High |
| Automated secret provisioning on production Workers | Phase 9.1 | High |
| Internal dashboard for job management | — | Medium |
| Performance optimization and budgets | — | Deferred |
| Broad visual regression suite | — | Deferred |
| Prompt version management UI | Section 6.2 | Low |
| Image CDN for generated site assets | Section 17 | Low |
| Multi-region deployment | — | Low |
