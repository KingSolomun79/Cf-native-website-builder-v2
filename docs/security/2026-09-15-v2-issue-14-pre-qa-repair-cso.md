# CSO — Issue #14: bounded Automated Repair (pre-QA builder-file repair + one-per-Build budget), 2026-09-15

Scope: the #14 implementation diff against the recorded decision (issue #14
comment, 2026-09-15): a Build has a maximum of ONE automated repair in total,
invocable before QA for an eligible deterministic builder-gate failure with a
mechanically identifiable repair target, or after QA for eligible Release
Blockers. Gates run: `npm test` 48 files / 540 tests passed, `npm run
typecheck` clean, focused suites (simple-pipeline, builder coverage/validation/
realization, final-iteration) green.

## 1. What was audited

- `src/simple-design/website-builder.ts` — `SimpleWebsiteBuilderError` gains
  `repairTarget` (deterministic single-file mapping: per-file gate failures →
  the failed file; invented-structure → site.css; single-page coverage → that
  page; chrome → the single implicated page; multi-page/schema/transport →
  null = not eligible) and `gateFindings` (verbatim gate strings);
  `runSimplePreQaRepairStage` (ONE targeted call with findings injected, five
  frozen files, complete gate re-run: chrome → state-hook adoption → DOM-first
  selector → SiteBundleSchema → CRITICAL coverage → persist);
  `copyBuilderFileArtifacts` (frozen-file inheritance).
- `src/simple-design/pipeline.ts` — builder-step resume branch keyed on the
  frozen `pre_qa_repair_plan` artifact; failure handler (eligible + budget →
  pre-QA repair continuation; otherwise the unchanged FAILED terminal);
  `runPreQaFileRepairAndContinue` (version creation, plan-first inheritance,
  repair step, assemble → QA tail, terminal mapping); durable budget guard at
  the top of the post-QA `runRepairAndFinalQa`; `countBuildVersions` as the
  repair-spent truth (only `createNextBuildVersion` — both repair paths — ever
  adds a version inside a Build).
- `src/domain/stage-artifacts.ts` + `migrations/0038_pre_qa_repair_plan.sql` —
  new artifact kind; table rebuild preserving rows, immutability triggers,
  indexes, with a uniquely-named sentinel index (0036 pattern).
- `tests/helpers/simple-scripts.ts` + pipeline/coverage tests — scripted
  provider seams; the repair success, repair-fails-again (budget consumed,
  FAILED), ineligible multi-page coverage (FAILED, no version), and
  resumed-entry budget-guard scenarios.

## 2. Security scope

No public endpoints, no auth/authz changes, no secrets/config changes, no
browser-facing code, no admin-surface changes. The entire diff executes inside
the `WebsiteBuildWorkflow` pipeline boundary. This is primarily a
cost/liveness bound (the repair ceiling) plus one additional LLM call path.

## 3. Attack-surface summary

- **Model-authored strings:** gate findings (which embed model-authored CSS
  selector tokens, constrained by extraction to `[a-zA-Z_-][\w-]*` — no
  whitespace or prose) now also feed the repair prompt. This is the same
  accepted class as the post-QA repair's QA-package prompt (strictly larger:
  full QA JSON) and the QA findings → event/email propagation, all bounded and
  operator-only downstream. No HTML rendering surface consumes any of it.
- **Writes:** one new immutable artifact kind (plan) and one repaired
  `builder_file/*` per repair — both via the idempotent, immutability-triggered
  artifact store; one new Build Version via the existing guarded
  `createNextBuildVersion`. Image spend: zero (accepted images inherited by
  row copy). LLM spend: exactly ONE extra call per Build, once, budget-capped
  by the existing per-kind completion ceilings.
- **Provider boundary:** the repair call rides the pinned Coding Plan seam /
  injected test seam; schema-versioned run records preserved.

## 4. Findings

None blocking.

1. **Watch item (Low, pre-existing class, one more consumer):** gate findings
   containing model-derived tokens enter a prompt (repair directive). Tokens
   are structurally constrained (`[a-zA-Z_-][\w-]*`), so instruction-shaped
   injection payload is not constructible through the selector vocabulary;
   coverage details embed blueprint slot ids (schema-validated). Same bounds
   as the accepted post-QA repair/QA-package class. No action for #14.
2. **Watch item (Low, narrow engine-retry window, pre-existing pattern):** if
   the engine dies between repair-version creation and the inheritance step, a
   resumed entry re-runs the builder core on the repair version (the frozen
   five per-file artifacts do not exist there yet). The outcome stays bounded
   (six calls, existing gates, USD 3 site image gate) and the durable budget
   guard still forbids a second repair afterwards — identical exposure class
   to the post-QA path's inheritance window. No action.
3. **Verified tightening:** the one-per-Build accounting is now durable and
   cross-stage — `countBuildVersions > 1` blocks the post-QA repair after any
   pre-QA repair, on any resumed entry (regression-tested).

## 5. Severity summary

Critical 0 · High 0 · Medium 0 · Low 2 (watch items, both pre-existing
classes).

## 6. Required remediation

None.

## 7. Watch items

See findings 1–2. Both recorded for the operator; neither blocks #14.

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS.**

## 9. Next best action

Commit #14 as one dedicated commit referencing the issue, record the SHA +
verification evidence (tests, typecheck, CSO verdict, decision link) on the
issue, keep the tree clean, then proceed to #15 per AGENTS.md.
