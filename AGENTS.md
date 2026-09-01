# WAZIBIZ Website Builder V2 — Agent Guidelines

This repository is a brownfield V2 fork. Existing V1 code may remain temporarily for infrastructure reuse, but V1 product semantics are not authoritative.

## Mandatory reading order

Before coding, read:

1. `CONTEXT.md` — canonical domain language and semantics.
2. GitHub parent spec issue `#2` — implementation scope and testing decisions.
3. The currently assigned GitHub implementation issue — exact ticket scope and acceptance criteria.
4. `v2-docs/IMPLEMENTATION-PRD.md` — normative V2 implementation specification.
5. `v2-docs/CAPABILITY-ENVELOPE.md` + `v2-docs/capability-envelope.json`.
6. `v2-docs/FINAL-DECISION-RECORD.md`.
7. `v2-docs/prompts/PROMPT-MANIFEST.md` and `v2-docs/prompts/00-domain-contract-v1.md`.

If existing code, tests, migrations, root docs or retained prompt bodies conflict with those sources, treat the conflicting V1 behavior as migration work, not as V2 authority.

# Mandatory execution protocol — all implementation issues

Issues `#3` through `#13` have already been implemented. Before beginning `#14`, finish the outstanding `/morabeza-cso` review for that tranche, resolve any blocking findings, run the required verification gates, commit all remaining `#3`–`#13` work, and leave the working tree clean.

The earlier per-issue commit rule was not consistently followed for `#3`–`#13`. **Do not rewrite Git history solely to simulate per-issue commits retroactively.** The strict rule below is mandatory from `#14` onward.

For the remaining implementation work, execute these GitHub issues **strictly sequentially** in this exact order:

1. `#14` — Implement bounded Automated Repair
2. `#15` — Implement Approval, Publication and Rollback
3. `#16` — Enforce Deployment and artifact retention lifecycle
4. `#17` — Create and freeze the five-site REFERENCE_BOUND benchmark harness
5. `#18` — Validate Benchmark Site 1 end-to-end
6. `#19` — Validate Benchmark Site 2 end-to-end
7. `#20` — Validate Benchmark Site 3 end-to-end
8. `#21` — Validate Benchmark Site 4 end-to-end
9. `#22` — Validate Benchmark Site 5 end-to-end
10. `#23` — Enforce the REFERENCE_BOUND proof gate
11. `#24` — Implement ORIGINAL_DESIGN Site Generation
12. `#25` — Contract away superseded V1 product architecture
13. `#26` — Run final V2 integration and release verification

This order is an explicit project instruction and **overrides every opportunity to parallelize these tickets**, including the benchmark tickets.

# Non-negotiable per-issue completion gate

For every issue from `#14` through `#26`, the following sequence is mandatory:

```text
implement current issue
-> satisfy every acceptance criterion
-> run focused tests
-> npm test
-> npm run typecheck
-> run /morabeza-cso
-> resolve all blocking /morabeza-cso findings
-> re-run affected tests/typecheck as necessary
-> commit the complete issue
-> record commit SHA + verification evidence
-> confirm clean working tree
-> only then begin the next issue
```

**No passing `/morabeza-cso` + no dedicated issue commit = issue not complete = next issue forbidden.**

## `/morabeza-cso` gate

`/morabeza-cso` is mandatory for **every remaining issue `#14` through `#26`**, not merely at milestones.

- Run `/morabeza-cso` only after the issue implementation and normal tests/typecheck are complete enough for final review.
- Treat any blocking/security/correctness finding from `/morabeza-cso` as part of the current issue.
- Fix those findings before committing the issue.
- If CSO-driven fixes change behavior, re-run the relevant focused tests plus `npm test` and `npm run typecheck` before committing.
- Do not defer a valid CSO finding to the next issue unless the finding is explicitly out of scope under parent `#2` and the current issue; document that exception rather than silently ignoring it.
- Record `/morabeza-cso` completion and the disposition of findings in the issue/PR verification note.
- Do not start the next issue while the current issue still has unresolved CSO findings.

## Hard per-issue commit gate

Every issue from `#14` through `#26` **must have its own completed Git commit before the next issue may even be started**.

- One issue must be completed and committed before another issue is fetched for implementation.
- The commit must contain the complete accepted implementation for that issue, including fixes required by `/morabeza-cso`.
- The commit message must reference the GitHub issue number, preferably in the form `... (#14)` or equivalent.
- Record the final commit SHA in the issue or associated PR/verification note.
- Do not carry uncommitted changes from one issue into the next.
- Do not combine implementations for two or more GitHub issues into one commit.
- Do not use a checkpoint/WIP commit for incomplete acceptance criteria merely to unlock the next issue.
- If a post-commit correction is required before starting the next issue, it still belongs to the current issue; commit that correction and record the final relevant SHA(s) before advancing.
- The working tree must be clean at every issue boundary.

## Sequential-work guardrails

- Work on **one GitHub issue only at a time**.
- Do not start, partially implement, scaffold, pre-factor specifically for, investigate implementation details for, or otherwise advance a later issue while the current issue is open in the execution sequence.
- Do not skip ahead because a later ticket appears independent or because the current one is difficult.
- Do not run benchmark issues `#18`–`#22` in parallel. For this execution run they are intentionally sequential: `#18 -> #19 -> #20 -> #21 -> #22`.
- If the current issue is blocked, ambiguous, or reveals a conflict with the authoritative V2 specification, resolve or report that problem **within the current issue**. Do not switch to another ticket to stay busy.
- Parent `#2` and the authoritative repository documents provide constraints and context; they do not authorize unrelated work from later tickets.
- Necessary supporting refactors are allowed only when they directly enable the current issue and keep the repository green.
- Do not use a supporting refactor as a vehicle to implement future-ticket behavior early.
- Keep diffs attributable to the current issue.

## Definition of complete before moving to the next issue

The agent may move from issue `N` to the next mandated issue only when **all** of the following are true:

1. Every acceptance criterion in the current GitHub issue is satisfied, or explicitly demonstrated as not applicable by the issue/spec itself.
2. Tests covering changed externally observable behavior are added or updated at the highest practical existing test seam.
3. Focused tests for the changed area pass.
4. `npm test` passes.
5. `npm run typecheck` passes.
6. `/morabeza-cso` has been run for the current issue.
7. Every blocking `/morabeza-cso` finding has been resolved or explicitly documented as out of scope under the authoritative spec.
8. Tests/typecheck affected by CSO fixes have been re-run and pass.
9. No known P0/P1 regression introduced by the issue remains unresolved.
10. The implementation matches `CONTEXT.md`, parent `#2`, the implementation PRD, capability envelope and relevant prompt contracts.
11. No hidden fallback, skipped test, TODO, commented-out alternative or temporary compatibility path silently defers a required acceptance criterion to a later ticket unless the current issue explicitly requires an expand–contract overlap.
12. **All work for the current issue has been committed in a dedicated issue commit.**
13. The commit message references the current issue number.
14. The issue/PR verification note records tests, typecheck, `/morabeza-cso` status, important behavior verified, intentionally retained brownfield items, and the final commit SHA.
15. The working tree is clean.
16. Only then may the next issue be fetched for implementation and started.

A ticket being "mostly done", "coded", "tests passing", or "awaiting CSO/commit" is **not complete**.

## Per-ticket working method

For each issue `#14` through `#26`:

1. Fetch and read only the current issue in full.
2. Re-read the relevant authoritative V2 documents and domain definitions.
3. Inspect existing implementation and tests that cover the affected behavior.
4. Prefer "make the change easy, then make the easy change" when a small enabling refactor is required.
5. Where practical, update/add the externally observable test first and observe the expected failure.
6. Implement the narrowest complete vertical slice satisfying the current issue.
7. Run focused tests while developing.
8. Run full `npm test` and `npm run typecheck`.
9. Re-check every acceptance criterion against the actual implementation.
10. Run `/morabeza-cso` for this issue.
11. Resolve all valid blocking CSO findings and re-run affected verification gates.
12. Commit all work for this issue with the issue number in the commit message.
13. Record the final commit SHA and verification/CSO evidence on the issue or associated PR.
14. Confirm the working tree is clean.
15. Only then fetch and begin the next issue in the sequence.

Do not batch several issue implementations into one speculative change or one combined commit.

## Scope and change-control guardrails

- Do not reopen settled domain decisions while implementing tickets. If code conflicts with the model, migrate the code.
- Do not invent new product concepts, states, modes, persistence entities or user-facing features absent from `CONTEXT.md`/parent `#2` merely because they simplify implementation.
- Do not weaken an acceptance criterion to fit existing V1 architecture.
- Do not silently change the capability envelope.
- Do not change Reference fidelity thresholds, image budget, QA gates, repair ceilings, Approval/Publication semantics or form-security rules without an explicit new project decision.
- Do not turn temporary V1 compatibility into permanent V2 architecture.
- Do not preserve superseded product paths once their current ticket explicitly replaces them, except where the migration manifest requires an expand–contract overlap.
- Do not perform opportunistic unrelated cleanup.
- Do not edit frozen benchmark targets, substitute easier benchmarks or manually repair generated benchmark source to obtain a PASS.
- Do not relax benchmark gates after failures. Preserve failure evidence and diagnose the implementation.

## Testing guardrails

The preferred primary seam is the existing Cloudflare Worker / `WebsiteBuildWorkflow` boundary in the Cloudflare Vitest environment. Assert observable behavior through workflow outcomes, route responses, D1 state, R2 artifacts/manifests and immutable Build Version identity rather than private helper implementation details.

Use narrower contract tests where the primary seam cannot reliably exercise an external/provider boundary, including runtime schemas, KIE budget behavior, browser evidence normalization, Form Service delivery adapters, publication idempotency and prompt composition.

- Never disable, skip or relax a failing test merely to make an issue pass unless the test encodes superseded V1 semantics and the current issue explicitly replaces that behavior.
- When replacing a stale V1 test, add the V2 behavior assertion in the same issue.
- Keep CI/test fixtures deterministic where possible; external AI/image/browser providers should be stubbed/faked for ordinary automated tests.
- Do not use benchmark PASS as a substitute for unit/contract/primary-seam coverage.
- Do not treat `/morabeza-cso` as a replacement for tests or typecheck. It is an additional mandatory gate.

## Canonical V2 domain rules

- No Client Account or Client User domain.
- A Business has one stable Site identity.
- Every new Site Generation begins from one fresh immutable Onboarding Submission.
- Changing Reference or Build Mode starts a new Site Generation.
- Human changes that preserve Reference/Build Mode use Revision Request -> new Build.
- Business Fact changes use Fact Update; historical Onboarding Submissions remain immutable.
- Human new intent creates a new Build.
- Bounded Automated Repair creates a new immutable Build Version inside the same Build.
- Automated Repair cannot change Business Facts, Reference, Build Mode or Visual Blueprint.
- Blueprint-root defects emit `BLUEPRINT_REVIEW_REQUIRED` -> `HUMAN_REVIEW_REQUIRED`.

## Release lifecycle

```text
Build Version
  -> Release Candidate
  -> Release Ready
  -> Approval
  -> Publication
  -> Published Version
```

Approval and Publication are separate. Publication deploys the exact approved Build Version without regeneration. Operational publication failure may be retried under the same Approval while that Build Version is unchanged.

Retain the immediately previous Published Version temporarily as Rollback Version. Rollback restores that exact version without a new Build/Approval and does not implicitly revert Site Configuration.

## Generated Site contract

- Exactly Home, About, Services, Contact for initial V2.
- Static/framework-light semantic HTML + CSS + minimal JS.
- Prefer shared `site.css` + `site.js`.
- No universal WAZIBIZ layout template.
- Reference-specific grids/overlaps/clipping/topology remain possible.
- React/Tailwind/GSAP are not default generated-site dependencies.

## REFERENCE_BOUND pipeline

```text
Onboarding Submission
-> Business Fact normalization
-> Reference Suitability
-> Reference Evidence
-> Reference Analysis
-> Visual Blueprint
-> Implementation Contract
-> incremental Site generation
-> Image Plan / Image Slots
-> KIE waves
-> assembly
-> Technical Preflight
-> Preview
-> QA-A + QA-B
-> bounded Automated Repair
-> Release Ready OR HUMAN_REVIEW_REQUIRED
-> Approval
-> Publication
```

Reference Screenshot controls static composition. Reference URL supplements runtime/interaction/responsive evidence. Reference content/branding/assets/source are not copied as Business content.

## Image rules

- Normal target: 12 Accepted Images per completed Site.
- Two waves: CRITICAL/HIGH homepage, then NORMAL/supporting.
- Hard KIE image spend gate: USD 3.00/Site.
- CSS crop/object-position, routing and remapping before regeneration where possible.
- No temporary provider URL may ship.

## QA and repair

- QA-A: rendered visual/content quality + hard composition gates.
- QA-B: browser/source/DOM/network/accessibility/SEO/form contract.
- Release Ready requires zero P0/P1 Release Blocker and all mandatory gates.
- One Fix Coordinator batch + at most one Release Blocker Fix.
- Every material repair creates a new Build Version that must be re-evaluated.
- Never create an unbounded retry/mutation loop.

## Contact form and email

V2 generated Sites use one central WAZIBIZ Form Service.

Browser code never controls recipient, From sender, sender domain, template or credentials.

- Form Destination and Sender Identity are mutable Site Configuration.
- Default Sender Identity is a verified WAZIBIZ platform sender.
- Visitor email may be validated Reply-To only.
- A Form Submission becomes Accepted Submission when the platform validates and durably accepts responsibility.
- Email Delivery happens downstream with bounded server-side retry.

Any existing SMTP2Go/per-Site mail-worker implementation is V1 brownfield code unless explicitly retained by the V2 migration audit.

## Prompt rules

Do not invoke retained detailed prompt files directly by filename version. Runtime prompt IDs/versions come from `v2-docs/prompts/PROMPT-MANIFEST.md` and are composed as:

```text
00-domain-contract-v1.md
+
retained full detailed stage body
```

The domain contract supersedes contradictory legacy clauses.

## Brownfield implementation rule

Audit before deleting infrastructure, but do not preserve obsolete V1 product architecture for compatibility. Classify modules as KEEP, KEEP+RENAME, EXTEND, REFACTOR, REPLACE or DELETE BEFORE V2 RELEASE.

Final V2 release must remove superseded V1 generator paths, feature flags, prompt registry entries, dead schemas/types/tests/routes and production V1 invocation paths.

## Engineering conventions

- TypeScript/Hono/Cloudflare-native where existing infrastructure remains suitable.
- Secrets only through Cloudflare bindings/secrets; never generated assets.
- AI returns structured schema-validated outputs; application services perform idempotent writes.
- Prefer deterministic extraction/validation for machine-measurable facts.
- Persist Build-centric provenance, cost and error classification.
