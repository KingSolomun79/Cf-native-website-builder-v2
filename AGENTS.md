# Cloudflare Website Factory — Agent Guidelines

## Project Overview

A fully automated, Cloudflare-native pipeline that takes a Fluent Forms webhook from WordPress and produces a deployed, QA-reviewed, human-approved 4-page static website.

## Architecture

- **Orchestration**: Cloudflare Workflows (durable, retryable multi-step jobs)
- **Agent State**: Durable Object (WebsiteAgent)
- **Model Access**: AI Gateway BYOK with cross-provider fallback (all LLM calls through `callGatewayChat`)
- **Database**: Single D1 database
- **Object Storage**: Single R2 bucket, client/version-prefixed
- **Email**: SMTP2Go (internal notifications + contact form delivery)
- **QA**: Browser Run
- **Preview Deploy**: Cloudflare REST API (3-step: assets upload → Worker create → URL retrieve)
- **Production Deploy**: GitHub monorepo push → GitHub Actions → Wrangler → Cloudflare Workers

## Deploy Pipeline

```
Approval received
  → Collect site files from R2 (bundle + images)
  → Push to GitHub monorepo (clients/{slug}/)
    ├── dist/            (HTML, CSS, JS, sitemap, robots)
    ├── worker.js        (contact form handler)
    ├── wrangler.toml    (per-site config)
    └── site-spec.json   (source spec)
  → GitHub Actions triggers on push to clients/**
    → Runs wrangler deploy per client
    → Notifies factory via webhook on completion
  → Factory records production_url, marks production_status: deployed
  → Preview Worker deleted after 30 days
```

## Key Principles

1. The primary path writes structured JSON specs for deterministic rendering. The transitional reference-driven path may generate page-body HTML, which must pass deterministic safety and bundle validation before deployment.
2. All LLM calls go through `src/lib/ai-gateway.ts` — never direct provider calls. Provider fallback chain: Zhipu GLM → OpenRouter (xiaomi/mimo-v2.5) → AI Gateway (GPT-4o).
3. All generated assets are versioned immutably in R2 under `/{client_slug}/versions/v{n}/`.
4. Secrets are Worker secrets set via `wrangler secret put` — never committed.
5. If Fluent Forms supplies an inspiration URL, the webhook queues the workflow immediately; otherwise it places the job in `needs_input` and emails the developer to provide a reference URL or screenshot.
6. The workflow proceeds only after a valid inspiration URL or uploaded screenshot is available, either from intake or the protected input form.
7. The Vision AI strictly requires this developer-provided URL or screenshot; it must NEVER use a default fallback URL (to prevent wasted tokens).
8. The accepted DesignBlueprint and InteractionBlueprint are the only active visual sources of truth. Legacy style selection and style-package fallbacks are prohibited.

## Secrets

Set via `wrangler secret put`:
- `CF_AIG_TOKEN` — AI Gateway token
- `CF_DEPLOY_API_TOKEN` — Cloudflare REST API token
- `SMTP2GO_API_KEY` — SMTP2Go API key
- `KIE_API_KEY` — Kie.ai API key
- `WEBHOOK_SECRET` — Fluent Forms webhook signing secret
- `APPROVAL_SECRET` — For signing approval/revision email tokens
- `GITHUB_TOKEN` — GitHub personal access token (repo scope)
- `GITHUB_WEBHOOK_SECRET` — Shared secret for verifying GitHub webhook callbacks
- `GITHUB_REPO_OWNER` — GitHub org/user owning the sites monorepo
- `GITHUB_REPO_NAME` — Sites monorepo name (e.g., `client-sites`)
- `GITHUB_BRANCH` — Branch to push to (default: `main`)
- `OPENROUTER_API_KEY` — OpenRouter API key (fallback + vision)
- `ZHIPU_API_KEY` — Zhipu AI API key (primary LLM)

### Configurable Vars (wrangler.jsonc)
- `FALLBACK_MODEL` — OpenRouter model for text fallback (default: `xiaomi/mimo-v2.5`)
- `ZHIPU_GATEWAY_PROVIDER` — AI Gateway custom-provider slug for Zhipu (default: `custom-zhipu`)
- `ZHIPU_MODEL` — Zhipu model name (default: `glm-5-turbo`)
- `VISION_MODEL` — OpenRouter vision model (default: `xiaomi/mimo-v2.5`)

### GitHub Repo Secrets (set in GitHub repo Settings > Secrets)
- `CF_DEPLOY_API_TOKEN` — Same Cloudflare API token used by factory
- `CF_ACCOUNT_ID` — Cloudflare account ID
- `GITHUB_WEBHOOK_SECRET` — Same shared secret as factory `GITHUB_WEBHOOK_SECRET`
- `FACTORY_WEBHOOK_URL` — Factory Worker URL for deploy status callbacks

## Status Transitions

```
queued → running → waiting_approval → approved → completed
                              → rejected → rejected
                              → revise_requested (≤3 times) → running → ...
                              → timed_out → timed_out
queued → running → failed_validation → failed_validation
queued → running → needs_input → needs_input
queued → running → failed → failed
```

## Code Style

- No comments unless explicitly requested
- Use Hono for routing
- All env access through typed `Env` interface
- All functions are pure where possible
- Prefer `crypto.subtle` for HMAC operations
