# Codebase Map

Generated: 2026-05-08T08:10:29Z | Files: 79 | Described: 0/79
<!-- gsd:codebase-meta {"generatedAt":"2026-05-08T08:10:29Z","fingerprint":"e5e360e80f51737d36c27da4fab9a315f32d79e3","fileCount":79,"truncated":false} -->

### (root)/
- `_test_webhook.ps1`
- `.dev.vars.example`
- `.gitignore`
- `AGENTS.md`
- `package-lock.json`
- `package.json`
- `README.md`
- `tsconfig.json`
- `wrangler.jsonc`

### .github-repo-template/.github/workflows/
- `.github-repo-template/.github/workflows/deploy-client.yml`

### .github/workflows/
- `.github/workflows/deploy-site.yml`

### docs/
- `docs/prd.md`
- `docs/roadmap.md`

### migrations/
- `migrations/0001_init.sql`
- `migrations/0002_review_revisions.sql`
- `migrations/0003_prompt_versions.sql`
- `migrations/0004_production_deploy.sql`

### public-template/
- `public-template/contact-error.html`
- `public-template/contact-success.html`

### src/
- `src/env.d.ts`
- `src/index.ts`
- `src/md.d.ts`
- `src/types.ts`

### src/agents/
- `src/agents/reviewer-agent.ts`
- `src/agents/website-agent.ts`

### src/builders/
- `src/builders/manifest-builder.ts`
- `src/builders/page-builder.ts`
- `src/builders/site-spec-builder.ts`
- `src/builders/worker-assets-builder.ts`

### src/lib/
- `src/lib/ai-gateway.ts`
- `src/lib/assets.ts`
- `src/lib/browser-run.ts`
- `src/lib/crypto.ts`
- `src/lib/db.ts`
- `src/lib/github.ts`
- `src/lib/html.ts`
- `src/lib/image-provider.ts`
- `src/lib/kie.ts`
- `src/lib/mail.ts`
- `src/lib/prompts.ts`
- `src/lib/publish.ts`
- `src/lib/seo.ts`
- `src/lib/slug.ts`
- `src/lib/style-loader.ts`
- `src/lib/style-registry.ts`
- `src/lib/validation.ts`
- `src/lib/worker-lifecycle.ts`

### src/qa/
- `src/qa/qa-runner.ts`

### src/qa/checks/
- `src/qa/checks/accessibility.ts`
- `src/qa/checks/images.ts`
- `src/qa/checks/layout.ts`
- `src/qa/checks/links.ts`
- `src/qa/checks/meta.ts`
- `src/qa/checks/socials.ts`

### src/routes/
- `src/routes/contact.submit.ts`
- `src/routes/internal.kie-callback.ts`
- `src/routes/jobs.approve.ts`
- `src/routes/jobs.get.ts`
- `src/routes/jobs.reject.ts`
- `src/routes/jobs.revise-form.ts`
- `src/routes/jobs.revise.ts`
- `src/routes/webhook.fluentforms.ts`
- `src/routes/webhook.github.ts`

### src/templates/base/
- `src/templates/base/footer.ts`
- `src/templates/base/header.ts`
- `src/templates/base/layout.ts`

### src/templates/base/sections/
- `src/templates/base/sections/about-story.ts`
- `src/templates/base/sections/contact-form.ts`
- `src/templates/base/sections/cta.ts`
- `src/templates/base/sections/hero.ts`
- `src/templates/base/sections/image-text.ts`
- `src/templates/base/sections/services-grid.ts`
- `src/templates/base/sections/stats.ts`
- `src/templates/base/sections/text-block.ts`

### src/templates/styles/minimalist-monochrome/
- `src/templates/styles/minimalist-monochrome/components.json`
- `src/templates/styles/minimalist-monochrome/image-system.md`
- `src/templates/styles/minimalist-monochrome/site-system.md`
- `src/templates/styles/minimalist-monochrome/tokens.json`

### src/workflows/
- `src/workflows/site-build-workflow.ts`
