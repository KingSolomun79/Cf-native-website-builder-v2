# Cloudflare Resource Isolation Runbook — Production vs Sandbox

**Status:** canonical operational guidance (post-rollout hardening, 2026-09-12)
**Applies to:** `cf-website-factory-v2` (production) and `cf-website-factory-sandbox` (sandbox/experimental)
**Enforced by:** `scripts/verify-resource-isolation.mjs` (runs as part of `npm test`)

## The discovered platform behavior

A Cloudflare **Workflow resource name is account-global, not Worker-scoped**.
When Wrangler performs a **full `wrangler deploy`** of a Worker whose config
declares a `workflows: [{ name: N, ... }]` entry, the platform **associates the
Workflow resource named `N` with the Worker being deployed**. Consequences:

1. If two Workers declare the SAME workflow resource name, a deploy of EITHER
   Worker captures the shared Workflow — the other environment's Workflows
   binding silently starts resolving to the deploying Worker's code and
   bindings.
2. `wrangler versions upload` / `wrangler versions deploy` do **NOT** reassign
   Workflow ownership (observed live 2026-09-12: after promoting a new
   production version, workflow instances still executed the sandbox's
   workflow version). Only a FULL `wrangler deploy` reassigns.
3. A captured Workflow keeps executing instances against the **owning Worker's
   bindings** (its D1, its R2, its vars/secrets). During the rollout this
   produced instances failing with `Site Generation … does not exist` because
   production's submission rows lived in production D1 while the instance ran
   sandbox code against sandbox D1.

## The rule

**Every environment MUST use a distinct Workflow resource name.** Worker-level
binding names (`WEBSITE_BUILD_WORKFLOW`) MAY be identical — they are scoped
inside each Worker and carry no cross-environment identity.

| Resource | Production (`wrangler.jsonc`) | Sandbox (`wrangler.exp.jsonc`) |
|---|---|---|
| Worker | `cf-website-factory-v2` | `cf-website-factory-sandbox` |
| D1 database | `9e2597d1-9598-4c50-adcf-764c1b6319da` (`website_factory_v2`) | `81084e55-bd84-4099-ad5b-78b5dab5b63d` (`website_factory_v2_simple_exp`) |
| R2 bucket | `website-factory-v2-assets` | `website-factory-v2-simple-exp-assets` |
| **Workflow resource** | **`website-build-workflow`** (canonical — DO NOT rename) | **`website-build-workflow-sandbox`** |

The production Workflow resource name is pinned to `website-build-workflow` by
the isolation gate: renaming it would orphan every production Build pipeline.

## Operating procedures

### Before ANY deploy

```bash
node scripts/verify-resource-isolation.mjs   # or: npm test (runs it first)
```

If the gate fails, STOP — fix the config before deploying either environment.

### After a sandbox deploy — verify production ownership

A sandbox deploy must never disturb production, but verify anyway (one
command each):

```bash
# Sandbox owns its own workflow now:
CLOUDFLARE_ACCOUNT_ID=c1c0f6b100d55a09ce6a7a3121a19224 \
  npx wrangler workflows describe website-build-workflow-sandbox

# Production still owns the canonical workflow (expected owner:
# cf-website-factory-v2):
CLOUDFLARE_ACCOUNT_ID=c1c0f6b100d55a09ce6a7a3121a19224 \
  npx wrangler workflows describe website-build-workflow
```

If production ownership is ever disturbed DESPITE distinct names: STOP,
capture `wrangler workflows describe` output for both names as evidence, and
recover with a full `wrangler deploy` from the exact committed production SHA
(never `versions deploy` — it does not reassign ownership).

### Recovery: production lost workflow ownership

```bash
git fetch && git checkout <committed-production-sha>   # clean tree, exact SHA
npx wrangler deploy                                     # full deploy reassigns ownership
npx wrangler workflows describe website-build-workflow  # verify owner is cf-website-factory-v2
```

Then re-verify the release identity (`wrangler deployments list`) — a recovery
deploy creates a new Worker version; confirm it is the content-identical
rebuild of the committed SHA and record both identities.

## Incident history

- **2026-09-12 (production rollout):** sandbox and production both declared
  `website-build-workflow`. The sandbox's last full deploy had captured the
  Workflow; production's first pipeline instances executed sandbox code
  against sandbox D1 and failed (`Site Generation … does not exist`).
  `versions deploy` did NOT recover ownership; a full `wrangler deploy` did.
  Permanent fix: distinct workflow resource names + this gate.
