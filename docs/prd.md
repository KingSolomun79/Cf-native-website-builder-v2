# Cloudflare-Native Website Factory — PRD v1.1

**Product**: WaziWebsites Automated Site Factory  
**Owner**: Jo / Morabeza Marketing  
**Stack**: Cloudflare Workers · Workflows · Durable Objects · D1 · R2 · Browser Run · AI Gateway  
**Target volume**: 10–50 sites/month  
**Status**: Pre-implementation. Approved for Milestone 1.

---

## 1. What This Is

A fully automated, Cloudflare-native pipeline that takes a Fluent Forms webhook from WordPress and produces a deployed, QA-reviewed, human-approved 4-page static website — with a structured revision loop and full audit trail.

Not a chatbot. Not a drag-and-drop builder. A deterministic factory with an AI agent at the generation step and a human in the loop at the approval step.

The pipeline shape:

```
Fluent Forms webhook
  → Orchestration Worker (validate, normalize, persist)
  → Workflow (durable, retryable multi-step job)
    → Agent generates structured site spec (JSON)
    → Validator checks spec against schema + business rules
    → Kie.ai generates images (async poll)
    → Deterministic HTML builder renders pages
    → Worker Static Assets deploy (Cloudflare REST API)
    → Browser Run QA (screenshots + structured issues)
    → Internal preview email (SMTP2Go internal sender)
    → Human approval gate (approve / revise / reject)
    → [Revision loop: max 3 rounds]
    → Mark site ready
  → Generated site Worker serves static assets + contact form
  → Contact form → SMTP2Go → client email
```

---

## 2. Hard Constraints (Non-Negotiable)

These are locked decisions. They do not get revisited mid-build.

| Concern | Decision |
|---|---|
| Hosting | Cloudflare Worker with Static Assets (not Workers Sites) |
| Orchestration | Cloudflare Workflows |
| Agent state | Durable Object-based agent |
| Model access | AI Gateway BYOK (all LLM calls go through it) |
| Database | Single D1 database (v1) |
| Object storage | Single R2 bucket, client/version-prefixed |
| Internal notification email | SMTP2Go (dedicated internal sender address) |
| Contact form email | SMTP2Go (client sender address) |
| QA | Browser Run |
| Approval pattern | Workflow approval gate with 7-day timeout |
| Programmatic deploy | Cloudflare REST API from orchestration Worker |
| Max revisions | 3 per site |
| Turnstile on contact form | Required on production sites. Not required during preview. |
| Image provider | Kie.ai (model: `google/nano-banana-edit`), env-configurable |
| One Worker per site | Yes for v1. Cleanup required post-approval (see Section 12). |

---

## 3. Repo Structure

```
cf-website-factory/
  README.md
  AGENTS.md
  wrangler.jsonc
  package.json
  tsconfig.json

  migrations/
    0001_init.sql
    0002_review_revisions.sql
    0003_prompt_versions.sql

  src/
    index.ts                      # Hono router + exports
    env.d.ts                      # Env type
    types.ts                      # Shared types

    lib/
      db.ts                       # D1 helpers
      slug.ts                     # Slug generation
      crypto.ts                   # Signatures, tokens
      validation.ts               # Spec and intake validation
      seo.ts                      # SEO rules + schema generation
      html.ts                     # HTML utilities
      assets.ts                   # R2 helpers
      mail.ts                     # SMTP2Go wrapper (internal + contact)
      ai-gateway.ts               # AI Gateway unified API wrapper
      browser-run.ts              # QA runner
      kie.ts                      # Kie.ai image provider (interface + impl)
      image-provider.ts           # Provider interface (swap without code changes)
      publish.ts                  # Cloudflare REST API deploy (see Section 9)
      prompts.ts                  # Prompt loading + versioning
      style-registry.ts           # Style package loader + alias map
      worker-lifecycle.ts         # Worker cleanup on approval/rejection

    routes/
      webhook.fluentforms.ts
      jobs.get.ts
      jobs.approve.ts
      jobs.reject.ts
      jobs.revise.ts
      preview.ts
      contact.submit.ts
      internal.publish.ts

    workflows/
      site-build-workflow.ts

    agents/
      website-agent.ts
      reviewer-agent.ts

    builders/
      site-spec-builder.ts
      page-builder.ts
      manifest-builder.ts
      worker-assets-builder.ts

    templates/
      base/
        layout.ts
        header.ts
        footer.ts
        sections/
          hero.ts
          services-grid.ts
          about-story.ts
          contact-form.ts
          cta.ts
      styles/
        minimalist-monochrome/
          site-system.md          # Design philosophy + rules (agent input)
          image-system.md         # Image prompt rules (agent input)
          tokens.json             # CSS custom properties
          components.json         # Component class patterns

    qa/
      qa-runner.ts
      checks/
        links.ts
        images.ts
        meta.ts
        layout.ts
        socials.ts
        accessibility.ts

  public-template/
    contact-success.html
    contact-error.html
```

---

## 4. Style Package Format

Every style is a folder under `src/templates/styles/{style-key}/`. A style package has four required files.

### 4.1 `tokens.json`

CSS custom properties injected into `<style>` on every generated page.

```json
{
  "cssVars": {
    "--background": "#FFFFFF",
    "--foreground": "#000000",
    "--muted": "#F5F5F5",
    "--muted-foreground": "#525252",
    "--border": "#000000",
    "--border-light": "#E5E5E5",
    "--font-display": "'Playfair Display', Georgia, serif",
    "--font-body": "'Source Serif 4', Georgia, serif",
    "--font-mono": "'JetBrains Mono', monospace",
    "--radius": "0px"
  },
  "googleFonts": [
    "Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700",
    "Source+Serif+4:wght@400;600",
    "JetBrains+Mono:wght@400"
  ]
}
```

### 4.2 `components.json`

Maps component slots to Tailwind-equivalent class strings used by the HTML builder.

```json
{
  "button": {
    "primary": "bg-[var(--foreground)] text-[var(--background)] px-8 py-4 text-sm font-medium uppercase tracking-widest border-none hover:bg-[var(--background)] hover:text-[var(--foreground)] hover:border hover:border-[var(--foreground)] transition-colors duration-100",
    "secondary": "bg-transparent text-[var(--foreground)] border-2 border-[var(--foreground)] px-8 py-4 text-sm uppercase tracking-widest hover:bg-[var(--foreground)] hover:text-[var(--background)] transition-colors duration-100"
  },
  "card": {
    "default": "bg-[var(--background)] border border-[var(--foreground)] p-8",
    "inverted": "bg-[var(--foreground)] text-[var(--background)] p-8"
  },
  "section": {
    "default": "py-24 md:py-32 lg:py-40",
    "inverted": "py-24 md:py-32 lg:py-40 bg-[var(--foreground)] text-[var(--background)]"
  },
  "divider": "border-t-4 border-[var(--foreground)] w-full",
  "hero": {
    "headline": "font-display text-7xl md:text-8xl lg:text-9xl font-black tracking-tighter leading-none",
    "subheadline": "font-display text-2xl md:text-4xl font-normal leading-relaxed"
  },
  "input": {
    "default": "bg-[var(--background)] border-b-2 border-[var(--foreground)] w-full py-3 px-0 placeholder-[var(--muted-foreground)] placeholder-italic focus:border-b-4 focus:outline-none font-body text-lg"
  }
}
```

### 4.3 `site-system.md`

Design rules injected verbatim into the site generation prompt. Written in plain language the agent follows as constraints.

Example excerpt:

```markdown
# Minimalist Monochrome — Site System Rules

You are generating content for a Minimalist Monochrome website.
This is the visual language of high-end fashion editorials and architectural monographs.

## Absolute Rules
- No color except black (#000000) and white (#FFFFFF). Never suggest colors.
- All corners are 0px radius. Never suggest rounded elements.
- Typography is the primary visual element. Headlines must be oversized.
- No shadows. Depth is created through inversion and scale.
- Every section must be separated by a thick horizontal rule (4px black).
- Inverted sections (black bg, white text) are used for Stats and final CTA blocks.

## Typography Rules
- Display headlines: Playfair Display, black weight (900), tracking-tighter
- Body: Source Serif 4, regular weight
- Labels, metadata: JetBrains Mono, uppercase, tracking-widest
- Hero headline must use text-8xl or text-9xl on desktop
- One H1 per page only

## Copy Rules
- Write like an editorial magazine. Confident, spare, never corporate.
- CTAs are short commands: "Enquire Now", "View Our Work", "Begin Here"
- No filler phrases. Every sentence earns its place.
```

### 4.4 `image-system.md`

Image prompt rules injected into the image generation step.

```markdown
# Minimalist Monochrome — Image System Rules

All images must be black and white photography or editorial illustration.

## Required Prompt Elements (always include)
- "black and white photography"
- "high contrast editorial style"
- "minimalist composition"
- "no color, monochrome"
- Style context (e.g. "luxury boutique hotel interior")

## Forbidden Prompt Elements
- Any color reference
- Cheerful, bright, playful
- Stock photography aesthetic
- People smiling directly at camera

## Per-Slot Rules
- hero: Wide establishing shot. Architecture, texture, or dramatic negative space.
- services-grid: Abstract detail or process shot. Hands working, materials close-up.
- about-story: Portrait or team shot. Candid, editorial. Not posed.
- contact-hero: Architectural exterior or interior entrance. Welcoming but austere.
```

### 4.5 Style Registry

```ts
// src/lib/style-registry.ts

const STYLE_KEYS = [
  "minimalist-monochrome",
  "minimalist-modern",
  "editorial-serif",
  "high-contrast-luxury",
] as const;

const STYLE_ALIASES: Record<string, StyleKey> = {
  "Minimalist Monochrome": "minimalist-monochrome",
  "minimalist monochrome": "minimalist-monochrome",
  "Minimalist Modern": "minimalist-modern",
  "Editorial Serif": "editorial-serif",
  "High Contrast Luxury": "high-contrast-luxury",
};

export function resolveStyleKey(input: string): StyleKey | null {
  const normalized = input?.trim();
  if (!normalized) return null;
  if (STYLE_KEYS.includes(normalized as StyleKey)) return normalized as StyleKey;
  return STYLE_ALIASES[normalized] ?? null;
}
```

If `resolveStyleKey` returns null: mark job `needs_input`, notify internal reviewer, stop workflow.

---

## 5. Fluent Forms Webhook Intake

### 5.1 Required Fields

WordPress sends a POST with the following fields. Required fields that are missing or empty cause immediate `400` rejection with a structured error body.

| Field | Required | Notes |
|---|---|---|
| `company_name` | Yes | |
| `client_email` | Yes | Valid email format |
| `website_overall_style` | Yes | Must resolve via style registry |
| `business_type` | No | Null if empty |
| `business_description` | No | |
| `ideal_client_profile` | No | |
| `logo_url` | No | Must be valid URL if present |
| `preferred_colour_1` | No | Stored but not applied (style system controls colors) |
| `preferred_colour_2` | No | Same |
| `mode` | No | `light` or `dark`. Default `light`. |
| `address_line_1` | No | |
| `address_line_2` | No | |
| `city` | No | |
| `county` | No | |
| `zip_code` | No | |
| `country` | No | |
| `facebook_url` | No | Normalized if present |
| `instagram_url` | No | Normalized if present |
| `twitter_url` | No | Normalized if present |
| `linkedin_url` | No | Normalized if present |
| `other_social_url` | No | |
| `extra_information` | No | Free text |

Note on preferred colours: they are stored in D1 for reference but the style system controls all visual tokens. The agent may mention the brand colour in copy context ("your brand's signature palette") but never in CSS.

### 5.2 Webhook Signature Verification

Fluent Forms must be configured with a shared secret. The Worker verifies the `X-WF-Signature` header using HMAC-SHA256 before processing. If absent or invalid: `401`.

### 5.3 Normalization Rules

- Trim all strings
- Convert empty strings to `null`
- Normalize social URLs: ensure `https://` prefix, strip trailing slashes
- Derive `client_slug` from `company_name`: lowercase, strip non-alphanumeric, replace spaces with `-`, deduplicate separators
- If `client_slug` already exists, append short random suffix

### 5.4 Result

Create D1 records:
- `clients` row
- `sites` row (status: `pending`)
- `jobs` row (type: `initial_build`, status: `queued`)

Store raw payload JSON in R2: `/{client_slug}/intake/raw/{job_id}.json`

Fetch and normalize logo: download server-side, convert to `.webp`, store in R2: `/{client_slug}/branding/logo/normalized.webp`

Return `202` with `{ ok: true, jobId, status: "queued" }`.

---

## 6. Agent Generation Step

### 6.1 Philosophy

The agent does not write HTML. It writes a structured site spec in JSON. The HTML builder renders the spec deterministically. This separation is the most important architectural decision in the system.

The agent is wrong sometimes. The spec validator catches it. The HTML builder cannot be wrong — it follows rules.

### 6.2 System Prompt Inputs

The site generation prompt is composed at runtime from:

1. The agent role definition (from `AGENTS.md`)
2. The normalized client intake payload
3. The style package's `site-system.md` (verbatim)
4. The JSON schema contract (below)
5. Global business rules (no fake testimonials, no invented facts, no external links)

### 6.3 Site Spec JSON Schema

The agent must return this structure and nothing else. No markdown. No prose. No code fences. JSON only.

```json
{
  "site": {
    "companyName": "string",
    "clientEmail": "string",
    "businessType": "string | null",
    "brandSummary": "string (2–4 sentences, editorial tone)",
    "idealClientProfile": "string | null",
    "styleKey": "string (must match registered style key)",
    "mode": "light | dark",
    "logoUrl": "string (R2 normalized URL)",
    "socials": {
      "facebook": "string | null",
      "instagram": "string | null",
      "twitter": "string | null",
      "linkedin": "string | null",
      "other": "string | null"
    }
  },
  "pages": [
    {
      "slug": "/",
      "name": "Home",
      "seoTitle": "string (30–60 chars)",
      "metaDescription": "string (120–160 chars)",
      "h1": "string",
      "sections": [
        {
          "type": "hero | services-grid | about-preview | stats | cta | text-block | image-text",
          "heading": "string | null",
          "subheading": "string | null",
          "body": "string | null",
          "items": "array | null",
          "ctaLabel": "string | null",
          "ctaHref": "string | null",
          "inverted": "boolean"
        }
      ],
      "images": [
        {
          "slot": "hero | services-grid | about-story | contact-hero",
          "aspectRatio": "16:9 | 1:1 | 4:3",
          "prompt": "string",
          "altText": "string",
          "targetPage": "string (slug)",
          "outputFilename": "string (e.g. hero-01.webp)"
        }
      ],
      "internalLinks": ["string (slugs of pages linked from this page)"]
    },
    {
      "slug": "/services",
      "name": "Services",
      "seoTitle": "string",
      "metaDescription": "string",
      "h1": "string",
      "sections": [],
      "images": [],
      "internalLinks": []
    },
    {
      "slug": "/about",
      "name": "About",
      "seoTitle": "string",
      "metaDescription": "string",
      "h1": "string",
      "sections": [],
      "images": [],
      "internalLinks": []
    },
    {
      "slug": "/contact",
      "name": "Contact",
      "seoTitle": "string",
      "metaDescription": "string",
      "h1": "string",
      "sections": [],
      "images": [],
      "internalLinks": [],
      "form": {
        "submitEndpoint": "/api/contact",
        "fields": ["name", "email", "phone", "subject", "message"],
        "successMessage": "string"
      }
    }
  ],
  "seo": {
    "localBusiness": {
      "name": "string",
      "addressLocality": "string | null",
      "addressCountry": "string | null",
      "telephone": "string | null",
      "url": "string (preview URL placeholder)"
    },
    "sameAs": ["array of social URLs"]
  }
}
```

### 6.4 Hard Constraints Enforced by Agent Prompt

- Exactly 4 pages. Exactly these slugs: `/`, `/services`, `/about`, `/contact`
- No invented pages
- No external links except social links
- Every page must have: SEO title, meta description, H1, at least one section
- Every image must have: prompt, alt text, target page, slot name, output filename
- No fake testimonials, reviews, or statistics unless provided by client
- All internal `ctaHref` values must map to one of the 4 valid slugs
- No markdown, no code fences, no prose outside JSON

### 6.5 Model Call via AI Gateway

```ts
// src/lib/ai-gateway.ts

export async function callGatewayChat(
  env: Env,
  body: ChatCompletionRequest,
  meta: GatewayMeta
) {
  const url = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_AI_GATEWAY_ID}/compat/chat/completions`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}`,
      "cf-aig-metadata": JSON.stringify(meta),
    },
    body: JSON.stringify(body),
  });
}

// meta shape
interface GatewayMeta {
  job_id: string;
  site_id: string;
  client_slug: string;
  prompt_type: "site_generation" | "revision_planner" | "qa_reviewer";
  style_key: string;
}
```

All model calls use this wrapper. No direct provider calls anywhere in the codebase.

---

## 7. Spec Validation Step

Before any build work starts, validate the agent output.

### 7.1 Validation Rules

Schema:
- JSON parses without error
- All required fields present and correct types
- Exactly 4 pages with exactly the required slugs

SEO:
- `seoTitle` is 30–60 characters
- `metaDescription` is 120–160 characters
- Each page has a unique title and unique meta description

Content:
- Every page has at least one section
- Every section that has a `ctaHref` maps to a valid internal slug or a valid social URL
- No empty `h1` values
- No empty hero section headings

Images:
- Every image has non-empty `prompt`, `altText`, `slot`, `outputFilename`
- `outputFilename` matches expected pattern (e.g. `hero-01.webp`)

Business:
- `clientEmail` is a valid email
- All social URLs are valid URLs if present
- Style key matches a registered key

### 7.2 On Failure

- Store structured error list in D1 (`job_validation_errors` JSON column on `jobs`)
- Mark job `failed_validation`
- Send internal email with error details
- Do not proceed

---

## 8. Image Generation Step (Kie.ai)

### 8.1 Provider Interface

The image provider is abstracted so the implementation can be swapped without touching the workflow.

```ts
// src/lib/image-provider.ts

export interface ImageTask {
  slot: string;
  page: string;
  aspectRatio: "16:9" | "1:1" | "4:3";
  prompt: string;
  altText: string;
  outputFilename: string;
}

export interface ImageResult {
  slot: string;
  page: string;
  outputFilename: string;
  r2Key: string;
  mimeType: string;
  width: number;
  height: number;
  sourceJobRef: string;
}

export interface ImageProvider {
  createTask(task: ImageTask): Promise<string>; // returns taskId
  pollResult(taskId: string): Promise<{ status: "pending" | "complete" | "failed"; url?: string }>;
}
```

### 8.2 Kie.ai Implementation

**Configuration** (all env-configurable):

```
KIE_API_URL=https://api.kie.ai
KIE_API_KEY=<secret>
KIE_MODEL=google/nano-banana-edit
KIE_CALLBACK_URL=https://cf-website-factory.example.workers.dev/api/internal/kie-callback
```

**Create task**:

```ts
POST https://api.kie.ai/api/v1/jobs/createTask
Authorization: Bearer <KIE_API_KEY>
Content-Type: application/json

{
  "model": "google/nano-banana-edit",
  "callBackUrl": env.KIE_CALLBACK_URL,
  "input": {
    "prompt": "<assembled prompt from site spec + image-system.md rules>",
    "output_format": "png",
    "image_size": "<mapped from aspectRatio>"
  }
}
```

Response: `{ "code": 200, "msg": "success", "data": { "taskId": "task_google_..." } }`

**Aspect ratio mapping**:

```ts
const RATIO_MAP = {
  "16:9": "16:9",
  "1:1": "1:1",
  "4:3": "4:3",
};
```

**Kie.ai is async.** The Workflow step uses a poll loop with `step.sleep`:

```ts
await step.do("generate images", async () => {
  const taskIds = await createAllImageTasks(env, imageTasks);

  let attempts = 0;
  const MAX_ATTEMPTS = 20;
  const POLL_INTERVAL_MS = 15_000; // 15 seconds

  while (attempts < MAX_ATTEMPTS) {
    const results = await pollAllTasks(env, taskIds);
    const allDone = results.every(r => r.status !== "pending");

    if (allDone) {
      const failed = results.filter(r => r.status === "failed");
      if (failed.length > 0) {
        throw new Error(`Image generation failed for: ${failed.map(f => f.slot).join(", ")}`);
      }
      return await downloadAndStoreImages(env, results, clientSlug, versionId);
    }

    await step.sleep("poll images", POLL_INTERVAL_MS);
    attempts++;
  }

  throw new Error("Image generation timed out after 5 minutes");
});
```

**Prompt assembly**: Kie.ai prompt = image-system.md rules + slot-specific instruction + business type + brand summary. Example assembled prompt for a minimalist-monochrome hero:

```
black and white photography, high contrast editorial style, minimalist composition,
no color monochrome, luxury boutique hotel interior, dramatic negative space,
wide establishing shot, editorial magazine quality, architectural lines
```

**Storage**: Downloaded images go to R2 under `/{client_slug}/versions/v{n}/pages/{page}/images/{filename}`.

### 8.3 Fallback Behavior

If Kie.ai returns `failed` for any slot: mark that image task as failed in D1, continue build with a placeholder SVG (`data:image/svg+xml,...` — a simple black rectangle with alt text). Do not block the entire build. Log the failure. The QA reviewer will flag missing images.

---

## 9. Programmatic Deployment (Cloudflare REST API)

This is the most complex step in the pipeline. Fully specced here before implementation.

### 9.1 Required API Token

Store as Worker secret: `CF_DEPLOY_API_TOKEN`

Required permissions:
- `Workers Scripts:Edit`
- `Workers Assets:Write`
- `Workers Routes:Edit` (optional, for custom domains later)

### 9.2 Worker Naming Convention

```
site-{client_slug}-{site_id_short}
```

Where `site_id_short` is the first 6 characters of the site UUID.

Example: `site-acme-coffee-7f3k2a`

### 9.3 Deploy Flow (3 API calls)

**Step 1: Upload assets to Cloudflare Assets API**

```
POST https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/workers/assets/upload
Authorization: Bearer {CF_DEPLOY_API_TOKEN}
Content-Type: multipart/form-data

Fields:
  - For each file in the bundle: field named by content hash
  - Manifest: JSON mapping file paths to content hashes
```

The bundle at this point includes:
- `index.html`
- `services/index.html`
- `about/index.html`
- `contact/index.html`
- `assets/styles.css`
- `assets/app.js` (minimal: contact form JS only)
- `assets/fonts/` (if self-hosting)
- `sitemap.xml`
- `robots.txt`
- All `.webp` images

Returns: `{ jwt: "<upload_token>" }` — used in Step 2.

**Step 2: Create/update the Worker script**

```
PUT https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/workers/scripts/{worker_name}
Authorization: Bearer {CF_DEPLOY_API_TOKEN}
Content-Type: multipart/form-data

Parts:
  - metadata (application/json):
    {
      "main_module": "worker.js",
      "assets": {
        "jwt": "<upload_token from Step 1>",
        "config": {
          "run_worker_first": ["/api/*"]
        }
      },
      "compatibility_date": "2026-04-22",
      "bindings": []
    }
  - worker.js (application/javascript+module):
    Minimal Worker that handles /api/contact and serves everything else via ASSETS
```

The contact endpoint Worker script:

```ts
// Minimal generated Worker for deployed site
export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }) {
    const url = new URL(request.url);

    if (url.pathname === "/api/contact" && request.method === "POST") {
      // Contact form handler — calls SMTP2Go
      // Site-specific env vars: CLIENT_EMAIL, SMTP2GO_API_KEY, SITE_ID
      return handleContact(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
```

**Step 3: Retrieve the preview URL**

```
GET https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/workers/scripts/{worker_name}
```

Preview URL pattern: `https://{worker_name}.{cf_subdomain}.workers.dev`

Store in D1: `sites.preview_url`, `site_versions.preview_url`.

### 9.4 Error Handling

- If any of the 3 steps fail: retry up to 3 times with exponential backoff (via Workflow step retry config)
- After 3 failures: mark job `failed`, send internal error email, do not continue

### 9.5 Worker Lifecycle Management

**Problem**: At 50 sites/month, you hit the 100 Workers/account default limit in 2 months.

**Solution**: Add `worker_status` to `site_versions` table. After a site is approved and optionally promoted to production, delete the preview Worker via:

```
DELETE https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/workers/scripts/{worker_name}
```

This is handled by `src/lib/worker-lifecycle.ts`, called from the approval route after a configurable delay (default: 30 days after approval).

D1 column: `site_versions.preview_worker_deleted_at TEXT`.

---

## 10. Static HTML Builder

### 10.1 Principle

The builder takes the validated site spec and produces deterministic HTML. It does not call any AI. Given the same spec and the same style package, it always produces the same output.

The builder uses section renderers — TypeScript functions that take a section object and return an HTML string.

### 10.2 Section Renderers

```ts
// src/builders/page-builder.ts

type SectionRenderer = (section: Section, tokens: StyleTokens) => string;

const SECTION_RENDERERS: Record<string, SectionRenderer> = {
  hero: renderHero,
  "services-grid": renderServicesGrid,
  "about-preview": renderAboutPreview,
  stats: renderStats,
  cta: renderCta,
  "text-block": renderTextBlock,
  "image-text": renderImageText,
};
```

Each renderer:
- Reads CSS vars from `tokens.json`
- Reads class patterns from `components.json`
- Never invents layout decisions — all layout is encoded in the style package
- Applies image slots by filename (images are referenced by their deterministic `outputFilename`)

### 10.3 Per-Page Output

Each page produces:
- Full HTML document with `<!DOCTYPE html>`, `<head>`, `<body>`
- `<head>` includes: charset, viewport, title, meta description, canonical, OG tags, OG image, Google Fonts link, inline `<style>` with CSS vars, schema.org JSON-LD
- `<body>` includes: skip-link, `<header>` with nav, page sections, `<footer>`, minimal `<script>` if needed

### 10.4 Shared Assets

- `assets/styles.css`: CSS reset, CSS vars from tokens, utility classes mirroring components.json patterns, responsive rules
- `assets/app.js`: Contact form submission only (fetch to `/api/contact`, success/error state handling). No framework.

### 10.5 SEO Outputs

Every build produces:
- `sitemap.xml` with all 4 pages + `<lastmod>` set to build date
- `robots.txt` with `Sitemap:` reference
- Schema.org `LocalBusiness` JSON-LD on Home and Contact pages
- Schema.org `Organization` JSON-LD on all pages
- Schema.org `WebSite` JSON-LD with `sameAs` social links on Home

---

## 11. Browser Run QA Step

### 11.1 Scope

The Browser Run reviewer acts as a senior UI/UX and technical QA engineer. It visits all 4 pages at 3 viewports and produces a structured report.

### 11.2 Viewports

- Desktop: 1440 x 900
- Tablet: 1024 x 1366
- Mobile: 390 x 844

### 11.3 Checks

| Category | Checks |
|---|---|
| Links | All nav links resolve (no 404). All footer links resolve. Internal hrefs map to valid pages. |
| Social | All social icon/button hrefs match the client's social URLs from the spec. |
| Images | All `<img>` tags load (no broken assets). All non-decorative images have non-empty `alt`. No 404s on image URLs. |
| SEO | `<title>` and `<meta name="description">` exist on all pages. `<link rel="canonical">` exists. One H1 per page. |
| Overflow | No element where `scrollWidth > clientWidth + 2`. No element where `scrollHeight > clientHeight + 2` (except intended scroll containers). |
| Layout | No clipped button text. No card overflow. Logo present in header on all pages. Correct mode (light/dark) applied. |
| Form | Contact form renders. Required fields present. Submit endpoint is `/api/contact`. |
| Accessibility | All interactive elements have accessible labels. Skip link present. No missing `<html lang>`. |
| Console | No console errors above threshold. No failed network requests above threshold. |

### 11.4 DOM Overflow Check

```ts
const overflowNodes = await page.evaluate(() => {
  return [...document.querySelectorAll("*")]
    .filter(el => el.scrollWidth > el.clientWidth + 2)
    .slice(0, 50)
    .map(el => ({
      tag: el.tagName,
      className: el.className,
      text: (el.textContent || "").trim().slice(0, 120),
    }));
});
```

### 11.5 QA Report Output Schema

```json
{
  "verdict": "pass | pass_with_minor_issues | needs_revision | failed",
  "summary": "string (2–4 sentence human-readable summary)",
  "checks": {
    "links": "pass | fail",
    "socials": "pass | fail",
    "images": "pass | fail",
    "seo_meta": "pass | fail",
    "overflow": "pass | fail",
    "form_render": "pass | fail",
    "accessibility": "pass | fail"
  },
  "issues": [
    {
      "severity": "critical | major | minor",
      "category": "links | images | seo | overflow | social | form | accessibility | layout",
      "page": "/services",
      "selector": ".service-card:nth-child(3)",
      "issue": "CTA text wraps outside container on mobile viewport (390px)",
      "recommendedFix": "Reduce button label length or card padding on mobile"
    }
  ],
  "screenshots": {
    "desktop": { "home": "r2_key", "services": "r2_key", "about": "r2_key", "contact": "r2_key" },
    "mobile": { "home": "r2_key", "services": "r2_key", "about": "r2_key", "contact": "r2_key" }
  }
}
```

### 11.6 Verdict Rules

- `pass`: Zero issues
- `pass_with_minor_issues`: Only minor severity issues
- `needs_revision`: At least one major issue
- `failed`: At least one critical issue OR build is unservable

### 11.7 QA Failure Handling

If Browser Run itself times out or throws: mark QA step as `failed`, log the error, send internal email with error, do not block workflow - allow manual QA override via internal dashboard.

---

## 12. Internal Notification Email (SMTP2Go)

After deploy + QA, send to `wazibizwebsites@gmail.com`.

**Use SMTP2Go for all email in v1.** Not Cloudflare Email Service. Cloudflare Email Service requires domain verification setup that adds friction. SMTP2Go is already in the stack for contact form delivery - use it for internal notifications too with a different `from` address.

Internal sender: `notifications@wazibizwebsites.com` (or whichever SMTP2Go sender you verify)  
Contact form sender: `noreply@{client-domain}.com` (or a shared sending address)

### 12.1 Email Content

Subject: `[WaziWebsites] Preview ready — {Company Name}`

Body (HTML email):
- Preview URL (linked)
- QA verdict badge (pass / needs_revision / failed)
- Critical issues count
- Top 3 issues if any (severity, page, description)
- Desktop homepage screenshot (inline if size allows, linked otherwise)
- Mobile homepage screenshot
- Three action links (signed tokens, 7-day expiry):
  - Approve: `POST /api/jobs/{jobId}/approve?token={signed_token}`
  - Request revision: Links to a simple HTML form at `/api/jobs/{jobId}/revise-form?token={signed_token}`
  - Reject: `POST /api/jobs/{jobId}/reject?token={signed_token}`

Signed tokens use HMAC-SHA256 with `APPROVAL_SECRET` Worker secret. Token payload: `{ jobId, action, exp }`.

---

## 13. Human-in-the-Loop Approval Gate

### 13.1 Workflow Approval Gate

The Workflow pauses after sending the preview email and waits for an external signal.

```ts
const approval = await step.waitForEvent("human-approval", {
  timeout: "7 days",
});
```

On timeout: auto-reject. Mark job `timed_out`. Send internal email. Do not auto-approve.

### 13.2 Approval Actions

**Approve** (`POST /api/jobs/{jobId}/approve`):
- Verify signed token
- Write `approvals` row: `status: approved`
- Resume Workflow with `{ status: "approved" }`
- Mark job `completed`, site `approved`
- Trigger Worker lifecycle: schedule preview Worker deletion in 30 days

**Reject** (`POST /api/jobs/{jobId}/reject`):
- Verify signed token
- Write `approvals` row: `status: rejected`
- Resume Workflow with `{ status: "rejected" }`
- Mark job `rejected`, site `rejected`
- Delete preview Worker immediately

**Request Revision** (`POST /api/jobs/{jobId}/revise`):
- Body: `{ prompt: string, reviewerEmail?: string }`
- Check revision count: if `revisions_count >= 3`, return `409` with "Maximum revisions reached. Approve or reject."
- Write `revisions` row, increment `sites.revisions_count`
- Resume Workflow with `{ status: "revise_requested", prompt }`

### 13.3 Revision HTML Form

Simple server-rendered HTML form at `/api/jobs/{jobId}/revise-form?token={signed_token}`.  
No framework. Black and white. Textarea for prompt. Submit button. Server-side form post.

---

## 14. Revision Loop

### 14.1 Max Revisions

Add `revisions_count INTEGER NOT NULL DEFAULT 0` to `sites` table. Enforced in the revise route before resuming the Workflow.

### 14.2 Revision Planner Agent Prompt Contract

The revision planner turns a human prompt into a machine-executable change plan.

**Inputs**:
- Current site spec (full JSON)
- Current QA report (full JSON)
- Human revision prompt (raw string)
- Style package `site-system.md`
- Immutable constraints list

**Output** (JSON only):

```json
{
  "summary": "string (what will change and why)",
  "changes": [
    {
      "type": "content | layout | image | seo | nav | section",
      "page": "/services",
      "target": "sections[1].heading",
      "instruction": "Replace with: 'What We Build'",
      "reason": "Client requested stronger, shorter heading"
    }
  ],
  "affectedPages": ["/services"],
  "requiresImageRegeneration": false,
  "requiresFullQa": true,
  "specDiff": {
    "path": "pages[1].sections[1].heading",
    "before": "Our Service Offering",
    "after": "What We Build"
  }
}
```

The `specDiff` array is the canonical record of what changed. Stored in D1 (`revisions.revision_plan_json`).

### 14.3 Selective Rebuild

Only rebuild affected pages. If `requiresImageRegeneration` is false, reuse existing R2 images. Create a new `site_versions` record. Redeploy. Rerun QA. Re-send preview email. Pause again.

### 14.4 Revision Loop in Workflow

```ts
// Revision loop — max 3 rounds enforced in the revise route, not here
while (approval.status === "revise_requested") {
  const revision = await step.do("plan revision", () =>
    createRevisionPlan(env, jobId, approval.prompt)
  );

  const newBundle = await step.do("apply revision", () =>
    rebuildFromRevision(env, context, revision)
  );

  const redeploy = await step.do("redeploy", () =>
    publishPreview(env, context, newBundle)
  );

  const qa = await step.do("rerun qa", () =>
    runQaReview(env, redeploy.previewUrl, context)
  );

  await step.do("send revised preview email", () =>
    sendPreviewEmail(env, context, redeploy.previewUrl, qa)
  );

  approval = await step.waitForEvent("human-approval", { timeout: "7 days" });
}
```

---

## 15. Contact Form (Generated Site)

### 15.1 Flow

1. Visitor submits contact form on `/contact`
2. `app.js` POSTs JSON to `/api/contact` (no full page reload)
3. Site Worker validates: all required fields present, email format valid, message not empty
4. No Turnstile on preview. Turnstile required on production promotion (v1.1).
5. Create `contact_submissions` row in D1 (site-specific D1 binding)
6. Call SMTP2Go send API
7. Update `smtp2go_status` in D1
8. Return `{ ok: true, message: "Your message has been sent." }` or error JSON

### 15.2 SMTP2Go Call

```ts
POST https://api.smtp2go.com/v3/email/send
{
  "api_key": env.SMTP2GO_API_KEY,
  "to": [env.CLIENT_EMAIL],
  "sender": "noreply@wazibizwebsites.com",
  "subject": "New enquiry from {company_name} website",
  "html_body": "<p>Name: {name}</p><p>Email: {email}</p>..."
}
```

SMTP2Go API key is stored as a Worker secret. Never exposed to the browser.

---

## 16. D1 Schema

```sql
-- migrations/0001_init.sql

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  county TEXT,
  zip_code TEXT,
  country TEXT,
  business_type TEXT,
  business_description TEXT,
  ideal_client_profile TEXT,
  logo_url TEXT,
  preferred_colour_1 TEXT,
  preferred_colour_2 TEXT,
  mode TEXT CHECK (mode IN ('light','dark')) DEFAULT 'light',
  website_overall_style TEXT NOT NULL,
  facebook_url TEXT,
  instagram_url TEXT,
  twitter_url TEXT,
  linkedin_url TEXT,
  other_social_url TEXT,
  extra_information TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  current_version_id TEXT,
  status TEXT NOT NULL,
  revisions_count INTEGER NOT NULL DEFAULT 0,
  preview_url TEXT,
  production_url TEXT,
  style_key TEXT NOT NULL,
  style_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE site_versions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  version_number INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('initial_build','revision')),
  source_job_id TEXT,
  build_manifest_r2_key TEXT,
  static_bundle_r2_prefix TEXT,
  deployed_worker_name TEXT,
  preview_url TEXT,
  qa_report_id TEXT,
  preview_worker_deleted_at TEXT,
  worker_status TEXT NOT NULL DEFAULT 'active' CHECK (worker_status IN ('active','scheduled_delete','deleted')),
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  job_type TEXT NOT NULL CHECK (job_type IN ('initial_build','revision','redeploy','qa_only')),
  status TEXT NOT NULL CHECK (status IN (
    'queued','running','waiting_approval','approved',
    'rejected','failed','failed_validation','needs_input',
    'timed_out','completed'
  )),
  current_step TEXT,
  error_code TEXT,
  error_message TEXT,
  job_validation_errors TEXT,  -- JSON array of validation errors
  workflow_instance_id TEXT,
  agent_session_id TEXT,
  raw_payload_r2_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  prompt_type TEXT NOT NULL CHECK (prompt_type IN (
    'site_generation','image_generation','revision_planner','qa_reviewer'
  )),
  style_key TEXT,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE job_prompt_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  prompt_id TEXT NOT NULL REFERENCES prompts(id),
  model_provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  ai_gateway_request_id TEXT,
  input_summary TEXT,
  output_summary TEXT,
  token_in INTEGER,
  token_out INTEGER,
  cost_estimate REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE page_specs (
  id TEXT PRIMARY KEY,
  site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  page_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  seo_title TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  h1 TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  html_r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE image_assets (
  id TEXT PRIMARY KEY,
  site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  page_name TEXT NOT NULL,
  slot_name TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  source_provider TEXT NOT NULL DEFAULT 'kie.ai',
  source_job_ref TEXT,
  r2_key TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','failed','placeholder')),
  created_at TEXT NOT NULL
);

CREATE TABLE qa_reports (
  id TEXT PRIMARY KEY,
  site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  status TEXT NOT NULL CHECK (status IN ('pass','pass_with_minor_issues','needs_revision','failed','error')),
  summary TEXT NOT NULL,
  report_json TEXT NOT NULL,
  desktop_screenshot_r2_key TEXT,
  mobile_screenshot_r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE qa_issues (
  id TEXT PRIMARY KEY,
  qa_report_id TEXT NOT NULL REFERENCES qa_reports(id),
  severity TEXT NOT NULL CHECK (severity IN ('critical','major','minor')),
  category TEXT NOT NULL CHECK (category IN ('links','images','seo','overflow','social','form','accessibility','layout')),
  page_slug TEXT,
  selector TEXT,
  issue_text TEXT NOT NULL,
  screenshot_r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revise_requested','timed_out')),
  signed_token_hash TEXT,
  requested_at TEXT NOT NULL,
  responded_at TEXT,
  responder_email TEXT,
  response_note TEXT
);

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  parent_site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  requested_by_email TEXT,
  revision_prompt TEXT NOT NULL,
  revision_plan_json TEXT,
  revision_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','applied','failed')),
  created_at TEXT NOT NULL
);

CREATE TABLE contact_submissions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  site_version_id TEXT,
  submitted_at TEXT NOT NULL,
  page_slug TEXT NOT NULL DEFAULT '/contact',
  sender_name TEXT,
  sender_email TEXT,
  sender_phone TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  smtp2go_status TEXT,
  smtp2go_response_json TEXT
);

-- Indexes
CREATE INDEX idx_jobs_site_status ON jobs(site_id, status);
CREATE INDEX idx_sites_client_id ON sites(client_id);
CREATE INDEX idx_versions_site_id ON site_versions(site_id, version_number);
CREATE INDEX idx_pages_version_slug ON page_specs(site_version_id, slug);
CREATE INDEX idx_qa_report_version ON qa_reports(site_version_id);
CREATE INDEX idx_revisions_site ON revisions(site_id, created_at);
CREATE INDEX idx_image_assets_version ON image_assets(site_version_id, status);
CREATE INDEX idx_approvals_job ON approvals(job_id, status);
```

---

## 17. R2 Bucket Design

Bucket name: `website-factory-assets`

R2 is flat. These are key prefixes, not folders.

```
/{client_slug}/
  intake/
    raw/{job_id}.json

  branding/
    logo/
      original.{ext}
      normalized.webp

  prompts/
    site-spec/{job_id}.json
    revisions/{revision_id}.json

  versions/
    v{n}/
      bundle/
        index.html
        services/index.html
        about/index.html
        contact/index.html
        assets/styles.css
        assets/app.js
      pages/
        home/
          images/hero-01.webp
          images/section-01.webp
        services/
          images/hero-01.webp
          images/card-01.webp
        about/
          images/hero-01.webp
        contact/
          images/hero-01.webp
      seo/
        sitemap.xml
        robots.txt
        meta.json
      qa/
        desktop/home.png
        desktop/services.png
        desktop/about.png
        desktop/contact.png
        mobile/home.png
        mobile/services.png
        mobile/about.png
        mobile/contact.png
        reports/qa-report.json
      deploy/
        manifest.json
        cf-api-response.json
```

### R2 Rules

- Every generated file versioned under `/versions/v{n}/`. Never overwrite previous versions.
- Latest version pointer lives in D1 (`sites.current_version_id`), not in a mutable R2 path.
- `STANDARD` storage class for all active bundles in v1.

---

## 18. `wrangler.jsonc`

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "cf-website-factory",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-22",

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "website_factory_v1",
      "database_id": "REPLACE_WITH_D1_ID"
    }
  ],

  "r2_buckets": [
    {
      "binding": "SITE_BUCKET",
      "bucket_name": "website-factory-assets"
    }
  ],

  "durable_objects": {
    "bindings": [
      {
        "name": "WEBSITE_AGENT",
        "class_name": "WebsiteAgent"
      }
    ]
  },

  "workflows": [
    {
      "name": "site-build-workflow",
      "binding": "SITE_BUILD_WORKFLOW",
      "class_name": "SiteBuildWorkflow"
    }
  ],

  "vars": {
    "CF_ACCOUNT_ID": "REPLACE_ME",
    "CF_AI_GATEWAY_ID": "website-factory",
    "PUBLIC_APP_URL": "https://cf-website-factory.example.workers.dev",
    "KIE_API_URL": "https://api.kie.ai",
    "KIE_MODEL": "google/nano-banana-edit",
    "APPROVAL_TIMEOUT_DAYS": "7",
    "MAX_REVISIONS": "3",
    "INTERNAL_NOTIFICATION_EMAIL": "wazibizwebsites@gmail.com"
  }
}
```

Secrets (set via `wrangler secret put`, never in `wrangler.jsonc`):
- `CF_AIG_TOKEN` — AI Gateway token
- `CF_DEPLOY_API_TOKEN` — Cloudflare REST API token for Worker deploy
- `SMTP2GO_API_KEY` — SMTP2Go API key
- `KIE_API_KEY` — Kie.ai API key
- `WEBHOOK_SECRET` — Fluent Forms webhook signing secret
- `APPROVAL_SECRET` — For signing approval/revision email tokens

---

## 19. Main Router (`src/index.ts`)

```ts
import { Hono } from "hono";
import { handleFluentFormsWebhook } from "./routes/webhook.fluentforms";
import { getJob } from "./routes/jobs.get";
import { approveJob } from "./routes/jobs.approve";
import { rejectJob } from "./routes/jobs.reject";
import { reviseJob } from "./routes/jobs.revise";
import { showReviseForm } from "./routes/jobs.revise-form";
import { submitContact } from "./routes/contact.submit";
import { handleKieCallback } from "./routes/internal.kie-callback";

const app = new Hono<{ Bindings: Env }>();

// Webhook intake
app.post("/api/webhooks/fluentforms", handleFluentFormsWebhook);

// Job management (all require signed token or internal auth)
app.get("/api/jobs/:jobId", getJob);
app.post("/api/jobs/:jobId/approve", approveJob);
app.post("/api/jobs/:jobId/reject", rejectJob);
app.post("/api/jobs/:jobId/revise", reviseJob);
app.get("/api/jobs/:jobId/revise-form", showReviseForm);

// Internal callbacks
app.post("/api/internal/kie-callback", handleKieCallback);

// Contact form (lives on generated site Workers, not here)
// Included for local dev / testing
app.post("/api/contact", submitContact);

export default app;
export { SiteBuildWorkflow } from "./workflows/site-build-workflow";
export { WebsiteAgent } from "./agents/website-agent";
```

---

## 20. Security

| Concern | Mitigation |
|---|---|
| Webhook spoofing | HMAC-SHA256 signature verification on all Fluent Forms webhooks |
| Approval link tampering | Signed tokens (HMAC-SHA256, 7-day expiry, single-use) |
| Contact form spam | Turnstile required on production sites (deferred to v1.1 during preview phase) |
| SMTP2Go key exposure | Worker secret, never browser-accessible |
| AI Gateway key exposure | Worker secret |
| Kie.ai key exposure | Worker secret |
| Deploy API token exposure | Worker secret, minimum required permissions |
| XSS via client input | All user-provided text sanitized before insertion into HTML (HTML entity encoding) |
| Logo URL injection | Logo fetched server-side, stored in R2, never inline-referenced from original URL |
| Approval endpoint abuse | Signed token + rate limit (5 requests per token per minute) |
| Internal endpoints | No public exposure. Approval/revise routes verify signed token before any action. |

---

## 21. Status Transitions

```
queued
  → running
  → waiting_approval
    → approved → completed
    → rejected → rejected
    → revise_requested (≤3 times)
      → running
      → waiting_approval
      → ... (loop)
    → timed_out → timed_out

queued
  → running
  → failed_validation → failed_validation

queued
  → running
  → needs_input → needs_input

queued
  → running
  → failed → failed
```

---

## 22. Milestone Sequence

### Milestone 1 — Intake + State
- Webhook handler with signature verification
- Input normalization + slug derivation
- D1 schema migration (0001_init.sql)
- R2 raw payload storage
- Style registry + alias resolution
- AI Gateway wrapper (`callGatewayChat`)
- Internal SMTP2Go wrapper

### Milestone 2 — Generation + Validation
- Site generation agent prompt (with minimalist-monochrome style package complete)
- Spec schema validation
- `site-system.md` and `image-system.md` for minimalist-monochrome written and tested
- `tokens.json` and `components.json` for minimalist-monochrome complete
- Spec stored in R2 + D1

### Milestone 3 — Image Generation
- Kie.ai provider implementation (create task + async poll loop)
- Image prompt assembly from spec + image-system.md
- Downloaded images stored in R2
- Placeholder fallback for failed slots

### Milestone 4 — HTML Builder + Deploy
- Section renderers for all section types
- Full page HTML builder (head, body, footer, schema.org)
- Shared CSS + JS asset generation
- sitemap.xml + robots.txt
- Cloudflare REST API deploy (3-step: upload assets → create Worker → retrieve URL)
- Worker lifecycle management (D1 tracking + scheduled delete)

### Milestone 5 — QA + Approval Loop
- Browser Run QA runner (all checks)
- Structured QA report (D1 + R2)
- Internal preview email via SMTP2Go
- Signed approval/revise/reject tokens
- Approval gate in Workflow
- Revision planner agent + selective rebuild
- Revision form (server-rendered HTML)
- Max revisions enforcement

### Milestone 6 — Contact Form + Production Polish
- Contact form handler on generated site Workers
- SMTP2Go contact delivery
- D1 contact submission logging
- Rate limiting on contact endpoint
- End-to-end integration test (full pipeline, single site)

---

## 23. Default Decisions Locked for v1

| Decision | Choice |
|---|---|
| Hosting | Cloudflare Worker with Static Assets |
| Orchestration | Cloudflare Workflows |
| Agent state | Durable Object |
| Model access | AI Gateway BYOK |
| Database | Single D1 |
| Object storage | Single R2 bucket |
| All email | SMTP2Go (internal + contact) |
| QA | Browser Run |
| Approval pattern | Workflow approval gate, 7-day timeout, auto-reject on expiry |
| Deploy mechanism | Cloudflare REST API (3-step: assets upload → Worker create → URL retrieve) |
| Versioning | Immutable R2 versions + D1 pointer |
| Max revisions | 3 |
| Worker cleanup | Scheduled 30 days after approval |
| Turnstile | Required on production, not preview |
| Image provider | Kie.ai (`google/nano-banana-edit`), env-configurable |

---

## 24. What Success Looks Like

A completed v1 pipeline takes a Fluent Forms submission and, without manual intervention, produces a deployed 4-page website that:

- Passes Browser Run QA with no critical issues
- Has correct SEO metadata on all 4 pages
- Loads all images without broken assets
- Renders correctly at desktop, tablet, and mobile
- Has a working contact form that delivers to the client's email
- Has a full revision history in D1
- Has a complete asset lineage in R2
- Can be approved, revised, or rejected via signed email links

The internal reviewer at `wazibizwebsites@gmail.com` should be able to approve a site entirely via email — no dashboard required in v1.
