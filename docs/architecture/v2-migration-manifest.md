# V2 Migration Manifest — Classification, Sequencing, Removal Gates

**Status:** AUTHORITATIVE for the V1→V2 migration (Phase 0)
**Date:** 2026-08-31
**Inputs:** `CONTEXT.md`, `v2-docs/IMPLEMENTATION-PRD.md`, `v2-docs/FINAL-DECISION-RECORD.md`, `docs/architecture/v1-fork-audit.md`.
**Issue:** #3 (parent #2).

Categories (per AGENTS.md / PRD §46 Phase 0):

| Category | Meaning |
|---|---|
| **KEEP** | Reusable platform infrastructure; no V1 product semantics. |
| **KEEP+RENAME** | Keep the capability under its canonical V2 name/anchor. |
| **EXTEND** | Keep and grow into a V2 stage; re-anchor identity/ids. |
| **REFACTOR** | Keep the core mechanics; strip V1 product decisions embedded in it. |
| **REPLACE** | Superseded V1 product logic; V2 re-implements the concern. |
| **DELETE BEFORE V2 RELEASE** | Must not exist in the final V2 release. |

Replacement work is sequenced by the issue plan (#4–#26); this manifest is the authority for *what may be reused* and *what must disappear*. Where a REPLACED V1 module stays in the tree while its V2 counterpart lands, it exists only as migration residue, never as product fallback.

---

## 1. Classification — platform infrastructure (reusable)

| Module(s) | Category | Disposition |
|---|---|---|
| `src/index.ts` (Hono bootstrap, error handler) | **KEEP** | Route table is refactored in place as V2 routes land; bootstrap pattern stays. |
| `wrangler.jsonc`, `wrangler.test.jsonc`, `tsconfig.json`, `package.json` scripts, `.github/workflows/ci.yml` | **KEEP** | CI gates (`npm test`, `npm run typecheck`, dry-run) stay. Bindings/vars expand during phases, contract at removal (§4). |
| `src/lib/assets.ts` (R2 get/put, immutable put, key helpers) | **KEEP+EXTEND** | Add the V2 artifact scheme `builds/{buildId}/v{version}/…` (PRD §22) alongside legacy keys; legacy key helpers die with their consumers. |
| `src/lib/crypto.ts` (HMAC, timing-safe compare, signed tokens, capability tokens, id/time helpers) | **KEEP** | Approval token shape gains `build_version` + `artifact_manifest_hash` (issue #15). |
| `src/lib/html.ts`, `src/lib/seo.ts` (sitemap), `src/lib/slug.ts` | **KEEP** | `slug.ts` remains a naming utility; it stops identifying a Client in V2 (used for worker naming/uniqueness only). |
| `src/lib/ai-gateway.ts` (multi-provider chat/vision, truncated-JSON repair, immutable prompt/response artifacts) | **KEEP+EXTEND** | Stage-level model configuration per PRD §21; provenance hooks grow (`AiProvenance`). |
| `src/lib/kie.ts`, `src/lib/image-provider.ts`, `src/routes/internal.kie-callback.ts` | **KEEP+EXTEND** | KIE client/auth/task/callback infra survives; slot/wave/budget orchestration is new work in issue #10. |
| `src/lib/browser-adapter.ts`, `src/lib/browser-lifecycle.ts`, `src/lib/selector.ts`, `src/lib/viewports.ts` | **KEEP** | Typed no-`evaluate(string)` browser boundary is exactly the deterministic-capture seam V2 needs; viewports already cover the 1440/768/390 evidence widths (PRD §26). |
| `src/lib/reference-capture-v2.ts`, `src/lib/interaction-capture-v2.ts`, `src/lib/evidence-attempt.ts`, `src/lib/evidence-registry.ts`, `src/lib/screenshot-evidence.ts`, `src/lib/vision-input.ts` | **EXTEND** | Core of the V2 Reference Evidence stage (issue #7): re-anchor from `(job_id, client_slug, site_version)` to Site Generation/Build ids and the versioned `ReferenceEvidence` schema (PRD §11). Attempt-append + single-current-pointer pattern is retained. |
| `src/lib/reference-input.ts` (screenshot/url validation), `src/lib/reference-guard.ts`, `src/lib/reference-persist.ts`, `src/routes/reference.upload.ts` | **EXTEND** | Become the Reference intake / evidence-freeze gate (issue #7). Guard re-anchors to V2 ids. |
| `src/lib/provenance.ts` + `provenance_artifacts` | **KEEP+EXTEND** | Claim/source model maps onto Business Fact provenance (Supported Facts vs Derived Content). Moves to a versioned runtime schema; insert-conflict immutability stays. |
| `src/lib/publish.ts` (CF API worker upload/create/preview/delete), `src/lib/worker-lifecycle.ts` | **REFACTOR** | Deploy mechanics survive as Deployment plumbing (issues #12, #15, #16); strip per-site contact-worker injection and re-point from "latest bundle" to an exact Build Version artifact manifest. |
| `src/lib/github.ts`, `src/routes/webhook.github.ts`, `.github-repo-template/…/deploy-client.yml` | **REFACTOR** | Retained as one publication transport, restricted to publishing the exact approved Build Version without regeneration (issue #15). Contact-worker coupling removed. |
| `src/lib/candidate-validation.ts`, `src/routes/internal.deploy-smoke.ts`, `scripts/create-candidate-validation-token.mjs` | **KEEP+RENAME** | Internal, capability-token-gated, idempotent diagnostic harness; re-anchor to Build Version ids. Stays disabled by default; not a release gate. |
| `src/lib/bundle-validation.ts`, `src/qa/checks/*` (links, meta, layout, images, accessibility, socials) | **REFACTOR** | Deterministic checks feed Technical Preflight (issue #12) and the deterministic share of QA-B (issue #13); verdict taxonomy is replaced by Release Blockers/gates. |
| `tests/helpers/*`, `tests/setup-migrations.ts`, `tests/worker-entry.ts`, vitest config | **KEEP+EXTEND** | Test harness pattern (per-route Hono apps + spread env) is the V2 primary-seam test pattern. |
| Wrangler observability config | **KEEP** | Extended with Build-centric fields (`siteId`, `siteGenerationId`, `buildId`, `buildVersion`, stage, attempt — PRD §42). |

## 2. Classification — superseded V1 product logic

| V1 concept | Module(s) / schema | Category | V2 replacement |
|---|---|---|---|
| **Client Account/User semantics** (mutable client profile, client slug identity) | `clients` table, `ClientRow`, client CRUD in `src/lib/db.ts`, `NormalizedIntake.clientEmail` as account stand-in | **DELETE BEFORE V2 RELEASE** | Business + immutable Onboarding Submission (issue #4). No Client Account/User/Profile anywhere. |
| **V1 job lifecycle** (`jobs`, JobType/JobStatus, `jobs.*` routes, `getJob`/`updateJobStatus`) | `migrations/0001`, `src/routes/jobs.*.ts`, `src/lib/db.ts` job fns | **REPLACE** | Site Generation → Build → Build Version state machine (issues #4, #12–#15). |
| **Old approval/revision states** (waiting_approval/approved/rejected/revise_requested/timed_out; `approvals`, `revisions`, `MAX_REVISIONS`, in-workflow revision loop, `reviewer-agent` revision planner, revise-form HTML) | `migrations/0002`, `src/routes/jobs.approve/reject/revise/revise-form.ts`, `src/agents/reviewer-agent.ts`, workflow revision loop | **REPLACE** | Revision Request → new Build + Fact Update (issue #5); Release Ready → Approval → Publication separation (issue #15). |
| **Mutable site versions** (`site_versions`, `current_version_id`, in-place updates) | `migrations/0001`/`0004`, `createSiteVersion` & friends | **REPLACE** | Immutable Build Version + Deployment + lightweight Build Record (issues #4, #12, #15, #16). |
| **Fluent-Forms-specific intake** | `src/routes/webhook.fluentforms.ts`, `src/lib/validation.ts`, `FluentFormsPayload`, `jobs.input*` HTML-input routes | **REPLACE** | V2 Onboarding Submission endpoint (HMAC pattern from `verifyWebhookSignature` is retained); Business Fact normalization becomes a schema-validated stage. |
| **SMTP2Go / per-site contact delivery** | `src/lib/mail.ts`, `contact_submissions`, `src/routes/contact.submit.ts`, `src/builders/contact-worker-builder.ts`, `src/builders/worker-assets-builder.ts`, `public-template/contact-*.html`, `SMTP2GO_API_KEY` | **REPLACE** → **DELETE BEFORE V2 RELEASE** | Central WAZIBIZ Form Service: Accepted Submission, Form Destination/Sender Identity as Site Configuration, Cloudflare-native Email Delivery (issue #11). No per-site mail worker may ship in generated Sites. |
| **DB prompt registry** | `prompts` + `job_prompt_runs` tables, `src/lib/prompts.ts`, `blueprint-schema.ts` prompt constants | **REPLACE** → **DELETE BEFORE V2 RELEASE** | Canonical prompt composition `00-domain-contract-v1.md + retained stage body` driven by `v2-docs/prompts/PROMPT-MANIFEST.md` (issue #6). |
| **Legacy blueprint path (Phase 16.4)** | `src/lib/blueprint-generator.ts`, `src/lib/blueprint-schema.ts`, `blueprints` table kind rows, `tests/blueprint.test.ts` | **DELETE BEFORE V2 RELEASE** | Dead even inside V1; superseded by the R4 `-v2` files and then by the V2 Visual Blueprint/Implementation Contract stages (issue #8). |
| **V1 blueprint machinery (R4)** | `src/lib/blueprint-generator-v2.ts`, `src/lib/blueprint-schema-v2.ts`, `src/lib/blueprint-validation.ts` | **REFACTOR** | Mechanics (TypeBox schema-as-code, bounded attempts, accepted-pointer) survive; artifact is re-specified as the binding Visual Blueprint + separate Implementation Contract, re-anchored to Build ids (issue #8). |
| **Deterministic universal renderer** | `src/render/*` (site-renderer, primitives, icons, tokens, content, sanitize) + `tests/blueprint-renderer.test.ts`, `tests/icon-registry.test.ts` | **REPLACE** → **DELETE BEFORE V2 RELEASE** | Incremental model-driven generation under fixed Blueprint + Implementation Contract (issue #9). This is the "universal template" V2 forbids (PRD §5, FDR #43). `src/lib/html.ts` escape helpers survive independently. |
| **`WebsiteAgent` Durable Object** | `src/agents/website-agent.ts`, `WEBSITE_AGENT` binding + DO migration in `wrangler.jsonc` | **DELETE BEFORE V2 RELEASE** | Dead code today; embodies mutable-current-spec anti-pattern. Removed with the DO migration in the contract phase. |
| **Style presets / archetypes as selectors** | `StyleKey`, `website_overall_style`, `sites.style_key/style_version`, prompt style-key rows | **DELETE BEFORE V2 RELEASE** | Design Archetype is non-binding vocabulary only (PRD §7). |
| **V1 QA/quality-gate verdicts** | `src/lib/browser-run.ts`, `src/lib/visual-quality-gate.ts`, `src/qa/qa-runner.ts`, `qa_reports`/`qa_issues`/`quality_gate_attempts` | **REFACTOR** | Evidence collection and deterministic checks survive into Technical Preflight/QA-B; scoring/verdicts re-specified as QA-A/QA-B with hard gates and Release Blocker taxonomy (issues #12–#13). |
| **V1 workflow class** | `src/workflows/site-build-workflow.ts` | **REPLACE** | Primary `WebsiteBuildWorkflow` owns V2 lifecycle orchestration (issues #4 ff.). V1 class deleted at contract phase. |
| **`src/types.ts` monolith** | mixed infra + V1 product types | **REFACTOR** | V2 domain types land in their own canonical-named modules (issue #4); legacy interfaces remain only until their consumers are deleted, then the file contracts. |
| Quarantined legacy docs | `docs/prd.md`, `docs/roadmap.md` (tombstones), `docs/candidate-validation.md` | **KEEP** (tombstones) | Removed in the Phase 11 doc sweep only if still referenced nowhere; they already defer to `v2-docs/`. |

**Rule of precedence restated:** if any retained file above carries embedded V1 semantics (client slug identity, mutable version rows, style presets, presentation-only form rules), those semantics are migration work, not authority (AGENTS.md).

## 3. Expand–contract sequencing

Constraint: `main` must stay CI-green after every landed change, and V1 remains the only end-to-end path until the V2 pipeline is complete. Therefore no wide change lands atomically; each follows **expand → switch → contract**:

### 3.1 D1 schema

1. **Expand** (issues #4–#16): every phase adds *new* migration files only (V2 tables `businesses`, `onboarding_submissions`, `site_generations`, `builds`, `build_versions`, … alongside the 29 V1 tables). Applied migrations are never edited. V2 rows are written by V2 services; V1 tables keep serving V1.
2. **Switch:** each V2 stage becomes the only writer for its concern as its issue lands; cross-stage reads move to V2 tables per phase. No V1 table is dual-written — V1 data is not migrated (this fork's V1 database is not a production dataset to preserve; V1 remains preserved in the V1 repo).
3. **Contract** (issue #25, single removal release): drop migration removing V1 tables (`clients`, `sites` V1 columns, `jobs`, `site_versions`, `page_specs`, `image_assets`, `qa_reports`, `qa_issues`, `quality_gate_attempts`, `revisions`, `approvals`, `deployments` V1 shape, `prompts`, `job_prompt_runs`, `contact_submissions`, `blueprints`, legacy `reference_*` shapes after re-anchoring) plus their indexes/triggers.

### 3.2 Worker routes

1. **Expand:** V2 routes mount under `/api/v2/*` in `src/index.ts` next to V1 routes.
2. **Switch:** per phase, new work enters only through V2 routes; V1 routes serve solely the bounded in-flight migration window, never as product fallback.
3. **Contract:** delete all V1 routes (`/api/webhooks/fluentforms`, `/api/jobs/*`, `/api/contact`, `/api/reference/upload` in its V1 shape) in the removal release.

### 3.3 Workflow orchestration

1. **Expand:** `WebsiteBuildWorkflow` (new class, own binding) lands with the lifecycle backbone (issue #4) and grows stage by stage.
2. **Switch:** when the REFERENCE_BOUND pipeline is complete end-to-end (issue #23 proof gate), V2 is the only path started by routes.
3. **Contract:** delete `SiteBuildWorkflow` + its binding.

### 3.4 Types and prompts

1. **Expand:** V2 canonical-named domain modules land beside `src/types.ts`; prompt composition helper (manifest-driven) lands beside `src/lib/prompts.ts`.
2. **Switch:** new code imports only V2 modules; runtime prompts resolve only through the manifest composer.
3. **Contract:** delete `src/lib/prompts.ts`, the `prompts`/`job_prompt_runs` tables, and every V1-only type with its consumers.

### 3.5 Bindings and secrets

1. **Expand:** add bindings/vars each phase needs (e.g. Form Service bindings in #11).
2. **Contract:** remove `SMTP2GO_API_KEY`, `WEBSITE_AGENT` (+ its DO migration tag), `MAX_REVISIONS`, `APPROVAL_*` V1-only vars, and any V1-only provider vars in the removal release. Secrets never live in generated assets (AGENTS.md).

### 3.6 Tests

1. **Expand:** each issue adds primary-seam tests for its V2 surface (lifecycle, schemas, routes, services).
2. **Contract:** tests of deleted modules are deleted with them; `vitest.config.ts` include list is pruned in the same commit as the deletion (never before).

**Atomicity exception:** narrow deletions whose consumers are already gone (e.g. dead `WebsiteAgent`) may land in a single commit once nothing references them.

## 4. Removal gates — required before V2 release

The final V2 release (acceptance per PRD §47) requires **all** of the following, verified in one audit pass (issue #26), after which **no production V1 fallback may remain**:

1. **V1 generator path deleted** — `src/render/*`, `WebsiteAgent` DO (+ binding + DO migration), `reviewer-agent`, `contact-worker-builder`, `worker-assets-builder`, `public-template/` gone.
2. **No production route invokes V1** — route table audit of `src/index.ts` shows only V2 routes; `fluentforms` webhook, `jobs.*`, V1 `contact` and V1 `reference` routes removed.
3. **V1 workflow deleted** — `SiteBuildWorkflow` and its binding gone; `WebsiteBuildWorkflow` is the single orchestrator.
4. **Prompt registry gone** — `prompts`/`job_prompt_runs` tables dropped; `src/lib/prompts.ts` deleted; every runtime prompt composed from `PROMPT-MANIFEST.md` + domain contract.
5. **Mail/contact V1 gone** — SMTP2Go client, `contact_submissions`, per-site contact delivery removed; central Form Service operational with Accepted Submission semantics and bounded retry.
6. **Schema contracted** — V1 tables dropped via final contract migration; no V1 identity triple (`job_id`/`client_slug`/`site_version`) remains in any table.
7. **No V1/V2 switches** — no feature flags, env toggles or runtime branches selecting V1 behavior.
8. **Dead artifacts pruned** — superseded schemas/types/tests/routes/docs removed; `vitest.config.ts` include list matches the surviving suite.
9. **Gates green after removal** — `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run` all pass on the contracted tree, and the release acceptance checklist (PRD §47) is satisfied.

Any V1 code still present after acceptance is a release blocker by definition.
