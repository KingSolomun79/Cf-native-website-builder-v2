# Candidate validation harness

`POST /api/internal/candidate-validation` is an operator-only harness for the candidate Worker. It writes immutable evidence to R2 and a matching audit row to D1 for normal screenshot handling, oversize derivatives, corrupt input rejection, and a timed-out primary vision provider followed by fallback.

It is absent until the candidate configuration sets `CANDIDATE_VALIDATION_ENABLED` to `true`. Do not add that variable to `wrangler.jsonc`. Set the variable in the uncommitted candidate configuration and set `CANDIDATE_VALIDATION_SECRET` only on the candidate Worker:

```powershell
pnpm exec wrangler secret put CANDIDATE_VALIDATION_SECRET --config wrangler.candidate.jsonc
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.candidate.jsonc
```

Create a one-time capability locally. The default lifetime is five minutes and the maximum is fifteen minutes:

```powershell
$env:CANDIDATE_VALIDATION_SECRET = "the-candidate-secret"
$token = node scripts/create-candidate-validation-token.mjs
```

Run the harness once:

```powershell
Invoke-RestMethod -Method Post -Uri "https://cf-website-factory-pr28-validation.wazibizwebsites.workers.dev/api/internal/candidate-validation" -Headers @{ Authorization = "Bearer $token" }
```

The response includes the run ID and immutable report key. The same capability cannot be used twice. Query `candidate_validation_runs` in the candidate D1 database with the run ID and retrieve `report_r2_key` from `website-factory-assets` to inspect the full evidence.
