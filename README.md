# Cloudflare Website Factory

A fully automated, Cloudflare-native pipeline that turns a WordPress Fluent Forms submission into a deployed, QA-reviewed, 4-page static website — complete with AI-generated content, AI-generated images, and a human approval loop.

## How It Works

```
WordPress Fluent Forms
       │
       ▼
  Webhook POST ──► Factory Worker (Hono)
       │                │
       │                ├── Validate & normalize intake
       │                ├── Create client/site/job in D1
       │                ├── Store raw payload + logo in R2
       │                └── Job enters `needs_input` state (Awaiting URL)
       │
       ▼
  Developer provides Inspiration URL via UI
       │
       ▼
   Site Build Workflow (durable, retryable)
        │
        ├── Phase 1: Reference Evidence & Blueprints
        │   ├── validate persisted reference URL and screenshot
        │   ├── capture live responsive and interaction evidence
        │   ├── derive screenshot evidence
        │   └── generate, validate, and accept design + interaction blueprints
        │
        ├── Phase 2: Deterministic Render & Assets
        │   ├── render HTML/CSS/JS from accepted blueprints
        │   └── generate approved image slots via Kie
        │
        ├── Phase 3: Bundle Validation
        │   ├── validate HTML structure and assets
        │   └── validate factual provenance
        │
        ├── Phase 4: Preview Deploy
        │   ├── deploy preview Worker
        │   └── record immutable version metadata
        │
        ├── Phase 5: Pre-Push Quality Gate
        │   ├── capture desktop, tablet, and mobile pages
        │   ├── exercise interactions and reduced motion
        │   ├── validate accessibility, icons, and provenance
        │   └── persist evidence and queue bounded automated revisions on failure
        │
        ├── Phase 6: Human-in-the-Loop
        │   ├── 6.1 send preview and approval email
        │   ├── 6.2 await human decision (approve / revise / reject)
        │   │
        │   └── Revision loop (up to 3 cycles):
        │       ├── 6.3.{n}a plan revision R{n} (v{n+1})
        │       ├── 6.3.{n}b apply revision to spec
        │       ├── 6.3.{n}c deterministically render revised bundle
        │       ├── 6.3.{n}d validate revised HTML
        │       ├── 6.3.{n}f deploy revised preview
        │       ├── 6.3.{n}g record revised version
        │       ├── 6.3.{n}i re-run pre-push quality gate
        │       ├── 6.3.{n}j persist QA evidence
        │       └── 6.3.{n}k send revised preview email only after a pass
        │
        └── Phase 7: Final Status Resolution
            ├── Approved:
            │   ├── 7.1 push approved site to GitHub for production
            │   ├── 7.2 schedule preview worker cleanup (30-day TTL)
            │   ├── 7.3 finalize build as completed
            │   └── 7.4 send production deployment notification
            └── Rejected:
                ├── 7.1 delete preview worker
                └── 7.2 finalize build as rejected
```

## Architecture

| Component | Service | Binding |
|-----------|---------|---------|
| HTTP Router | Cloudflare Worker (Hono) | — |
| Orchestration | Cloudflare Workflows | `SITE_BUILD_WORKFLOW` |
| Agent State | Durable Object | `WEBSITE_AGENT` |
| Database | D1 | `DB` (`website_factory_v1`) |
| Object Storage | R2 | `SITE_BUCKET` (`website-factory-assets`) |
| LLM Access | AI Gateway with OpenRouter and Zhipu routing | `CF_AIG_TOKEN` |
| Image Generation | Kie.ai | `KIE_API_KEY` |
| Email | SMTP2Go | `SMTP2GO_API_KEY` |
| Production Deploy | GitHub Actions → Wrangler | `GITHUB_TOKEN` |

## Features

### Automated Site Generation
- **Reference-derived design**: Vision and text models produce validated design and interaction blueprints from the required URL, screenshot, and captured evidence
- **AI-generated images**: Kie.ai produces hero, services, about, and contact images with aspect-ratio control
- **Deterministic rendering**: Accepted blueprints and structured client content render through repository-owned HTML/CSS/JS primitives; models never author production HTML

### 4-Page Static Sites
Every site includes:
- **Home** (`/`) — Hero, services grid, CTA, stats
- **Services** (`/services`) — Services grid, text blocks, image-text sections
- **About** (`/about`) — About story, stats
- **Contact** (`/contact`) — Contact form with SMTP2Go email delivery, CTA

### Quality Assurance
- Pre-preview bundle validation covers structure, missing assets, unsafe markup, and factual provenance
- Browser-backed QA captures all four pages at desktop, tablet, and mobile viewports
- The gate compares hierarchy, typography, colors, spacing, imagery, and responsive containment to the accepted blueprint
- Hover, focus, active, toggle, scroll, transition, and reduced-motion behavior is exercised with before/after/reset evidence
- Findings include severity, selector, evidence, expected result, actual result, and recommended fix
- Critical findings or a score below `VISUAL_QA_MIN_SCORE` enter the bounded revision loop and cannot reach approval or GitHub publication

### Human Approval Loop
- Signed HMAC approval tokens with 7-day expiry
- Email-based approve / reject / revise workflow
- Up to 3 revision cycles per site
- Revision uses LLM to plan targeted changes, then revalidates via QA
- Production deployment runs inside the workflow after approval (GitHub push → GitHub Actions → Wrangler deploy)
- Preview worker auto-scheduled for 30-day cleanup on approval
- Route handlers send workflow events with retry-safe ordering (event first, status second)

### Card Grid Layout
- Service card grids automatically balance across rows for counts 1–9+
- 5 cards: 3-column top row + centered 2-column bottom row
- 7 cards: 4-column top row + centered 3-column bottom row
- Single card centered, 2-column and 4-column grids have constrained max-width

### Preview & Production Deployment
- **Preview**: Deployed to a per-client Worker via Cloudflare REST API using direct asset upload sessions, explicit Worker version creation, and deployment activation
- **Production**: Workflow pushes approved site to GitHub monorepo (`clients/{slug}/`), GitHub Actions runs `wrangler deploy` per client automatically
- Production deployment is tracked end-to-end in the workflow step history (push → commit SHA → deployment record)
- Preview Workers auto-scheduled for deletion after 30 days

### Versioned Asset Storage
- All assets versioned immutably in R2 under `{client_slug}/versions/v{n}/`
- Bundle files, images, QA reports, and manifests each get dedicated paths
- D1 tracks R2 keys for every asset and page spec

### SEO
- Per-page canonical URLs, Open Graph tags, structured data (JSON-LD)
- Auto-generated `sitemap.xml` and `robots.txt`
- LocalBusiness, Organization, and WebSite schema.org types

### Reference Design System
- The accepted DesignBlueprint and InteractionBlueprint are the only active visual sources of truth
- Blueprint tokens are sanitized and compiled into repository-owned CSS primitives
- Relevant Lucide icons are selected semantically and emitted as accessible inline SVG without a client runtime
- Deprecated style selection, style packages, and model-authored HTML paths have been removed

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers |
| Framework | Hono |
| Language | TypeScript |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 |
| Orchestration | Cloudflare Workflows |
| Stateful Agents | Cloudflare Durable Objects |
| AI Gateway | Cloudflare AI Gateway (BYOK) |
| LLM Provider | OpenRouter or Zhipu through AI Gateway (configurable) |
| Image Generation | Kie.ai (z-image) |
| Email Delivery | SMTP2Go |
| CI/CD | GitHub Actions |
| Deployment | Wrangler CLI |

## Project Structure

```
src/
├── agents/
│   ├── website-agent.ts          # Durable Object for agent state
│   └── reviewer-agent.ts         # Revision planning via LLM
├── builders/
│   └── worker-assets-builder.ts  # Shared contact form JavaScript
├── lib/
│   ├── ai-gateway.ts             # Unified LLM access through AI Gateway
│   ├── assets.ts                 # R2 read/write helpers + key generators
│   ├── browser-run.ts            # Combined static and browser-backed QA runner
│   ├── bundle-validation.ts      # Pre-deploy HTML bundle validation
│   ├── crypto.ts                 # HMAC signing, token generation
│   ├── db.ts                     # All D1 queries
│   ├── github.ts                 # Git Data API (blobs, trees, commits)
│   ├── html.ts                   # HTML head builder
│   ├── image-provider.ts         # Image provider interface
│   ├── kie.ts                    # Kie.ai image generation + R2 storage
│   ├── mail.ts                   # SMTP2Go email sending
│   ├── prompts.ts                # System/user prompt templates
│   ├── publish.ts                # CF REST API: asset upload session, Worker version/deploy/delete
│   ├── seo.ts                    # Sitemap, robots.txt, JSON-LD generators
│   ├── slug.ts                   # URL-safe slug generation
│   ├── visual-quality-gate.ts    # Pre-push viewport and interaction gate
│   ├── validation.ts             # Intake validation + spec validation
│   └── worker-lifecycle.ts       # Preview Worker auto-cleanup
├── render/
│   ├── blueprint-tokens.ts       # Validated blueprint-to-CSS token compiler
│   ├── blueprint-interactions.ts # Interaction and reduced-motion compiler
│   ├── content.ts                # Client-fact-backed structured content
│   ├── primitive-styles.ts       # Repository-owned CSS primitives
│   └── site-renderer.ts          # Deterministic four-page renderer
├── qa/
│   └── checks/                   # Individual QA checks
│       ├── accessibility.ts
│       ├── images.ts
│       ├── layout.ts
│       ├── links.ts
│       ├── meta.ts
│       └── socials.ts
├── routes/
│   ├── webhook.fluentforms.ts    # WordPress form webhook handler
│   ├── webhook.github.ts         # GitHub Actions deploy callback
│   ├── jobs.get.ts               # Get job status
│   ├── jobs.approve.ts           # Approve site (triggers GitHub push)
│   ├── jobs.reject.ts            # Reject site
│   ├── jobs.revise.ts            # Request revision
│   ├── jobs.revise-form.ts       # Revision form HTML
│   ├── contact.submit.ts         # Contact form submission
│   ├── internal.deploy-smoke.ts  # Protected preview deploy smoke test
│   └── internal.kie-callback.ts  # Kie.ai async callback
├── workflows/
│   └── site-build-workflow.ts    # Main durable workflow
├── index.ts                      # Hono app + exports
├── env.d.ts                      # Env type definitions
└── types.ts                      # All TypeScript interfaces
```

## Database Schema

The schema evolves through 15 ordered migrations. Core and evidence tables include:

| Table | Purpose |
|-------|---------|
| `clients` | Client business details, social links, style preferences |
| `sites` | Per-client site record with version tracking |
| `site_versions` | Immutable version snapshots with R2 keys and Worker names |
| `jobs` | Build job lifecycle (queued → running → completed/failed) |
| `prompts` | Versioned prompt templates per style and type |
| `job_prompt_runs` | LLM call audit log (model, tokens, cost) |
| `page_specs` | Per-page SEO metadata and spec JSON |
| `image_assets` | Image generation results with R2 keys and dimensions |
| `qa_reports` | QA verdict and full report JSON |
| `qa_issues` | Individual QA findings with severity and selectors |
| `approvals` | Signed approval token tracking |
| `revisions` | Revision requests with plans and status |
| `contact_submissions` | Contact form submission audit log |
| `deployments` | Production deployment tracking with GitHub run IDs |
| `reference_evidence_attempts` | Append-only responsive and interaction capture attempts |
| `blueprint_attempts` / `blueprint_accepted` | Blueprint generation history and immutable accepted pointer |
| `provenance_artifacts` | Versioned factual source and claim manifests |
| `quality_gate_attempts` | Versioned visual-gate scores and evidence pointers |

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/webhooks/fluentforms` | Receive site request from WordPress |
| `POST` | `/api/webhooks/github` | GitHub Actions deploy status callback |
| `GET` | `/api/jobs/:jobId` | Get job status and details |
| `POST` | `/api/jobs/:jobId/approve` | Approve site (sends workflow event, production deploy in workflow) |
| `POST` | `/api/jobs/:jobId/reject` | Reject site (sends workflow event, cleanup in workflow) |
| `POST` | `/api/jobs/:jobId/revise` | Request revision (signed token + prompt) |
| `GET` | `/api/jobs/:jobId/revise-form` | HTML revision form |
| `POST` | `/api/contact` | Contact form submission (SMTP2Go) |
| `POST` | `/api/internal/deploy-smoke` | Protected smoke test for preview deployment flow |
| `POST` | `/api/internal/kie-callback` | Kie.ai image generation callback |

## Secrets

Set via `wrangler secret put`:

| Secret | Purpose |
|--------|---------|
| `CF_AIG_TOKEN` | AI Gateway token |
| `OPENROUTER_API_KEY` | OpenRouter provider key routed through AI Gateway |
| `ZHIPU_API_KEY` | Zhipu provider key routed through the configured AI Gateway custom provider |
| `CF_DEPLOY_API_TOKEN` | Cloudflare REST API token for Worker deployment |
| `SMTP2GO_API_KEY` | SMTP2Go email API key |
| `KIE_API_KEY` | Kie.ai image generation API key |
| `WEBHOOK_SECRET` | Fluent Forms webhook signing secret |
| `APPROVAL_SECRET` | HMAC key for approval token signing |
| `GITHUB_TOKEN` | GitHub PAT with org/repo write access (for monorepo push) |

## Current Workflow Guardrails

- A valid reference URL and full-page homepage screenshot are required before generation
- Accepted design and interaction blueprints are persisted before deterministic rendering
- Bundle safety and factual provenance validation run before preview deployment
- Every preview version receives browser-backed visual and interaction validation at three viewports
- Failed gates may revise only within `MAX_REVISIONS`; exhaustion ends in `failed_validation`
- Human approval is requested only for a gate-passing version
- The only GitHub push occurs after approval

## GitHub Actions (Client Sites Repo)

The `deploy-client.yml` workflow in the `wazibiz-client-sites` monorepo:

1. Triggers on push to `clients/**`
2. Detects which client folders changed
3. Deploys each client site via `wrangler deploy` in parallel
4. Sets per-Worker secrets (`CLIENT_EMAIL`, `SMTP2GO_API_KEY`)

**Required repo secrets**: `CF_DEPLOY_API_TOKEN`, `CF_ACCOUNT_ID`, `SMTP2GO_API_KEY`

## Local Development

```bash
npm install
cp .dev.vars.example .dev.vars
# Fill in your secrets in .dev.vars
npm run db:migrate:local
npm run dev
```

## Deploy

```bash
npm run db:migrate:remote   # First time only
npm run deploy
```

## Notes

- Preview deployment uses Cloudflare's asset upload session flow and explicit Worker version/deployment APIs
- Workflow step history is phase-numbered (1.x through 7.x) with revision context labels (e.g., `6.3.1a plan revision R1 (v2)`)
- The `sendWorkflowEvent` function uses `Workflow.get(id).sendEvent()` — the correct Cloudflare Workflows API for delivering events to running instances
- Route handlers send workflow events BEFORE updating job status to prevent stuck jobs on event delivery failure
- If GitHub push fails with `401 Bad credentials`, verify that `GITHUB_TOKEN` is valid for the `Wazibiz-Webdesign-Kenya` organization repo and SSO-authorized if required
