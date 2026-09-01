# V1 Fork Audit — Brownfield Inventory

**Status:** COMPLETE (Phase 0)
**Date:** 2026-08-31
**Scope:** Everything inherited from V1 in this fork at commit `090ff50`.
**Companion:** `v2-migration-manifest.md` (classification + sequencing). This file records what exists and how it behaves; the manifest decides what happens to it.

This is a factual inventory, not a plan. Terminology follows `CONTEXT.md`; where V1 concepts have no V2 equivalent (Client, Job, site version), the V1 term is kept deliberately and marked as such.

---

## 1. Runtime shape

- **Worker entry:** `src/index.ts` — Hono app, 15 routes, exported alongside `SiteBuildWorkflow` (Workflows) and `WebsiteAgent` (Durable Object).
- **Workflows:** one class, `src/workflows/site-build-workflow.ts` (`SiteBuildWorkflow`, binding `SITE_BUILD_WORKFLOW`), 1038 lines, owns the entire V1 lifecycle inline.
- **Durable Object:** `src/agents/website-agent.ts` (`WebsiteAgent`, binding `WEBSITE_AGENT`) — stores `jobId`/`siteId`/`currentSpec` in DO storage. **No route or workflow ever invokes it**; it is exported from the entry and bound in `wrangler.jsonc` only.
- **Bindings** (`src/env.d.ts`, `wrangler.jsonc`): `DB` (D1), `SITE_BUCKET` (R2), `WEBSITE_AGENT` (DO), `SITE_BUILD_WORKFLOW` (Workflow), `BROWSER` (Browser Rendering), `IMAGES` (Images), plus AI provider vars (AI Gateway/Zhipu/Openrouter/KIE), deploy vars, GitHub vars, `SMTP2GO_API_KEY`, `WEBHOOK_SECRET`, `APPROVAL_SECRET`, `MAX_REVISIONS`.
- **Tests:** `@cloudflare/vitest-pool-workers`, 24 files / 342 tests, `isolatedStorage: false`, migrations applied once via `tests/setup-migrations.ts` from a generated query list (`tests/_generated-migrations.ts`, written by `vitest.config.ts`). Test worker entry (`tests/worker-entry.ts`) deliberately does **not** import `src/index.ts`; route tests mount individual handlers on a fresh Hono app with a spread of `cloudflare:test` env plus stubs.

## 2. V1 domain model (superseded semantics)

Identity chain: `clients` → `sites` → `jobs` → `site_versions` (+ `revisions`, `approvals`, `deployments`).

- `clients` (`migrations/0001`): the Client Account row — mutable profile (company name, email, address, socials, colours, `website_overall_style`, `mode`), updated in place (`updateClientReferenceSiteUrl`).
- `sites`: one row per client, mutable `status`, `revisions_count`, `current_version_id` pointer, `style_key`/`style_version` (archetype preset columns).
- `jobs`: the V1 lifecycle unit (`job_type` ∈ initial_build/revision/redeploy/qa_only; `status` ∈ queued/running/waiting_approval/approved/rejected/failed/failed_validation/needs_input/timed_out/completed).
- `site_versions`: mutable per-rebuild version rows (`source_type` initial_build/revision, worker name, preview URL, `qa_report_id`, `worker_status`); `sites.current_version_id` points at the latest one. **Version immutability is not enforced anywhere** — rows are updated freely (QA report id, GitHub SHA, worker status).
- `revisions` + `approvals`: one approval row per job with signed token hash; revision rows reference `parent_site_version_id`; the revision loop is bounded by `MAX_REVISIONS`.
- `prompts` + `job_prompt_runs` (`0003`, `0014`): DB-backed prompt registry keyed by `prompt_type` (+ optional `style_key`), `is_active`, `version`; `src/lib/prompts.ts` loads the active row at runtime.
- Reference storage: `reference_assets` (uploaded screenshots), `reference_captures`/`reference_interactions` (early paths), and the Phase 16.R3 append-only set `reference_evidence_attempts` + `reference_capture_evidence_v2` + `reference_interaction_evidence_v2` + `reference_evidence_current` (immutable attempt rows with a single mutable "current" pointer per `(job_id, site_version)`).
- Blueprint storage: `blueprints` (Phase 16.4 upsert-by-`(job_id, kind)`) and the Phase 16.R4 immutable set `blueprint_evidence_registries` + `blueprint_attempts` + `blueprint_accepted` (append-only attempts, conditional promote).
- Output/QA: `page_specs`, `image_assets`, `qa_reports`, `qa_issues`, `quality_gate_attempts`, `provenance_artifacts` (immutable, insert-conflict-checked), `deployments`, `contact_submissions`, `candidate_validation_runs`.

All reference/blueprint/provenance rows are anchored on `(job_id, client_slug, site_version)` — the V1 identity triple.

## 3. V1 pipeline (as implemented in `SiteBuildWorkflow.run`)

1. `reference_guard` — assert uploaded screenshot persisted in R2 (`reference-guard.ts`).
2. Evidence capture — `evidence-attempt.ts` coordinates `reference-capture-v2.ts` (responsive DOM/computed-style capture through the typed `browser-adapter.ts`, unique selectors from `selector.ts`, viewports from `viewports.ts`) and `interaction-capture-v2.ts` (exercised hover/focus/toggle/scroll observations with reduced-motion pairs); attempt rows immutable, one "current" pointer.
3. `screenshot-evidence.ts` — vision-model extraction over the frozen screenshot via `ai-gateway.ts`, persisted as an immutable artifact with provider/model provenance; `vision-input.ts` validates/downscales image inputs.
4. Blueprint — `evidence-registry.ts` assembles a bounded registry; `blueprint-generator-v2.ts` + `blueprint-schema-v2.ts` (TypeBox schema-as-code) + `blueprint-validation.ts` run bounded attempts through the AI Gateway and promote one accepted `(design, interaction)` pair.
5. Render — `render/site-renderer.ts` deterministically renders a four-page bundle from the blueprint pair + intake content (`render/content.ts`, `render/primitives/*`, `render/icons/*`), with `provenance.ts` claim manifests validated pre/post render.
6. Images — `kie.ts` creates KIE tasks, polls, persists to R2 (`image-provider.ts` interface). No budget gate, no waves, no slot model.
7. Bundle + validation — R2 upload with manifest (`assets.ts`), `bundle-validation.ts` structural checks, provenance verification.
8. Preview deploy — `publish.ts` uploads assets and creates a per-site Worker via the CF API (injecting a per-site contact worker built by `builders/contact-worker-builder.ts`).
9. QA — `browser-run.ts` + `qa/checks/*` + `visual-quality-gate.ts` (vision-scored quality gate with attempt reports); reports persisted to D1/R2.
10. Human loop — SMTP2Go email (`mail.ts`) with approve/revise/reject signed-token links (`jobs.approve/reject/revise*` routes); optional revision loop (`agents/reviewer-agent.ts` plans, spec mutated in place, re-render, re-QA) up to `MAX_REVISIONS`.
11. Publication — `github.ts` pushes the approved bundle to a client-sites repo; GitHub Actions deploys (`webhook.github.ts` records status); preview worker deletion scheduled after 30 days (`worker-lifecycle.ts`).

## 4. Intake and contact surfaces

- **Intake:** `POST /api/webhooks/fluentforms` (`webhook.fluentforms.ts`, 380 lines) — Fluent Forms field names (`company_name`, `client_email`, `website_overall_style`, …), HMAC `X-WF-Signature` via `verifyWebhookSignature`. Missing reference input parks a job in `needs_input`, served by `jobs.input*` HTML form routes. Normalization in `validation.ts` (`NormalizedIntake`), optional `approvedSourceFacts`.
- **Contact:** per-site generated contact worker posts back to `POST /api/contact` (`contact.submit.ts`) → `contact_submissions` table → SMTP2Go delivery to the client's own email (`mail.ts`), templates in `public-template/`. Recipient derives from the client row; browser-supplied email is used as reply-to.

## 5. Configuration and repo plumbing

- `wrangler.jsonc` points at V1 D1 database `website_factory_v1` (id `370051b4-…`) and R2 bucket `website-factory-assets`; observability logs on, traces off.
- `.github/workflows/ci.yml` — `npm test`, `npm run typecheck`, `wrangler deploy --dry-run`. `deploy-site.yml` deploys the platform worker on push to main.
- `.github-repo-template/.github/workflows/deploy-client.yml` — the GitHub Actions template pushed into the client-sites repo (V1 publication transport).
- `scripts/create-candidate-validation-token.mjs` — mints capability tokens for the internal candidate-validation harness.
- Root docs: `docs/prd.md` and `docs/roadmap.md` are already quarantined tombstones pointing at `v2-docs/`; `docs/candidate-validation.md` documents the internal harness. `.gsd/` holds agent tooling state; `.bg-shell/manifest.json` is shell tooling metadata.

## 6. Tests (grouped by what they pin down)

- **Evidence/capture infrastructure:** `reference-capture`, `reference-evidence`, `interaction-capture`, `browser-adapter-spy`, `browser-lifecycle`, `reference-input`, `reference-intake`, `reference-persistence`, `reference-guard`, `reference-routes`, `evidence-persistence`, `vision-input`.
- **Blueprint machinery:** `blueprint`, `blueprint-v2`, `blueprint-renderer`, `icon-registry`.
- **Quality/output:** `bundle-security`, `qa-accessibility`, `qa-images`, `visual-quality-gate`, `preview-readiness`, `candidate-validation`, `revision-apply`, `provenance`, `contact-worker-builder`.
- Helpers: `helpers/blueprint-fixtures.ts`, `helpers/browser-fixtures.ts`, `helpers/png.ts`; `setup-migrations.ts`; `worker-entry.ts`.

## 7. Notable hazards found during audit

1. **`WebsiteAgent` DO is dead code** — bound, exported, never called; it also embodies exactly the mutable-current-spec pattern V2 forbids.
2. **V1 "versions" are mutable rows** — `site_versions` is updated in place throughout the workflow (QA id, GitHub SHA, worker status), so none of V1's artifacts are immutable candidate states in the V2 sense.
3. **The renderer is the forbidden template** — `render/primitives` + `icon-registry` implement a fixed universal section architecture keyed to blueprint evidence, i.e. the "universal WAZIBIZ layout template" V2 explicitly rejects.
4. **Prompt authority is a DB table** with `is_active` flags and optional style-key rows — directly at odds with manifest-driven prompt composition.
5. **`blueprint-generator.ts`/`blueprint-schema.ts` (Phase 16.4) are a dead older path** — already superseded inside V1 by the R4 `-v2` files; only `blueprints` table + tests keep them alive.
6. **Per-site contact workers carry delivery logic into generated assets** — the exact inversion of the central Form Service contract.
7. **Revision loop mutates the spec in place and reuses the same preview Worker** — no new immutable candidate per human intent.
8. **`contact_submissions` + SMTP2Go send from the platform worker synchronously in the request path** — no Accepted Submission / bounded retry separation.
