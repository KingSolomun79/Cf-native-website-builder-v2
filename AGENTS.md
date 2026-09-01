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

# Mandatory execution protocol — first 11 implementation issues

For the first implementation tranche, work **strictly sequentially** through these GitHub issues in this exact order:

1. `#3` — Brownfield V1 → V2 migration manifest
2. `#4` — Establish the V2 domain lifecycle backbone
3. `#5` — Add Revision Request and Fact Update lifecycle
4. `#6` — Activate canonical prompt, schema and provenance contracts
5. `#7` — Implement Reference intake, suitability and evidence freeze
6. `#8` — Produce Reference Analysis, Visual Blueprint and Implementation Contract
7. `#9` — Generate a complete REFERENCE_BOUND four-page Site
8. `#10` — Integrate budgeted two-wave image generation
9. `#11` — Replace per-site contact email with WAZIBIZ Form Service
10. `#12` — Make immutable Build Versions pass Technical Preflight and deploy Preview
11. `#13` — Implement standardized visual evidence and release QA

This sequential order is an explicit project instruction and **overrides any opportunity to parallelize these tickets**.

## Hard per-issue commit gate

Every issue in `#3` through `#13` **must have its own completed commit before the next issue may begin**.

- Finish the current issue completely.
- Run and pass its required tests and typecheck.
- Commit the complete issue work with a commit message that references the GitHub issue number.
- Record that commit SHA in the issue or associated PR/verification note.
- Only after that commit exists may the agent fetch, read, plan, scaffold, or implement the next issue.
- Do not carry uncommitted changes from one issue into the next.
- Do not combine two or more issue implementations into one commit.
- Do not make a "checkpoint" commit for incomplete acceptance criteria merely to unlock the next issue.
- If additional fixes are required for the same issue after its first commit, finish them and commit them as part of that same issue before advancing. The repository must be clean at the handoff to the next issue.

**No commit = issue not complete = next issue forbidden.**

## Sequential-work guardrails

- Work on **one issue only at a time**.
- Do not start, partially implement, scaffold, pre-factor specifically for, or otherwise advance a later issue before the current issue is complete and committed.
- Do not even begin implementation planning for the next issue while the current issue has uncommitted or unverified work.
- Do not skip an issue because a later issue appears independently implementable.
- Do not run `#5` and `#6` in parallel; execute and commit `#5` completely before beginning `#6`.
- Do not run `#10` and `#11` in parallel; execute and commit `#10` completely before beginning `#11`.
- Do not begin `#14` or any later implementation ticket as part of this tranche. Stop after `#13` is complete and committed, then report repository status.
- If the current issue is blocked, ambiguous, or reveals a conflict with the authoritative V2 specification, resolve or report that problem **within the current issue**. Do not jump to another ticket to stay busy.
- Treat each issue body as the immediate scope. Parent `#2` and the authoritative repo documents provide constraints and context, but they do not authorize unrelated work from later tickets.
- Necessary supporting refactors are allowed only when they directly enable the current ticket and keep the repository green. Do not use a supporting refactor as a reason to implement future-ticket behavior early.
- Preserve reusable V1 infrastructure only where compatible with the V2 contracts. Do not retain obsolete V1 product behavior merely to reduce migration work.

## Definition of complete before moving to the next issue

The agent may move from issue `N` to issue `N+1` only when **all** of the following are true:

1. Every acceptance criterion in the current GitHub issue is satisfied or explicitly demonstrated as not applicable by the issue/spec itself.
2. Tests covering the changed externally observable behavior are added or updated at the highest practical existing test seam.
3. `npm test` passes.
4. `npm run typecheck` passes.
5. No known P0/P1 regression introduced by the ticket remains unresolved.
6. The implementation matches `CONTEXT.md`, parent `#2`, the implementation PRD, capability envelope and relevant prompt contracts.
7. No temporary compatibility path, TODO, commented-out alternative, hidden fallback or skipped test silently defers a required acceptance criterion to a later ticket unless the current issue explicitly says so.
8. **All work for the current issue is committed in Git before the next issue is opened for implementation.** The commit message must reference the issue number.
9. The working tree is clean; no uncommitted current-issue changes are allowed to leak into the next ticket.
10. The current issue is updated with concise verification evidence including tests run, important behavior verified, intentionally retained brownfield items, and the final commit SHA.
11. Only then may the next issue in the mandated sequence be fetched for implementation and started.

A ticket being "mostly done" is not sufficient to advance.

## Per-ticket working method

For each of `#3` through `#13`:

1. Re-read the current issue in full before changing code.
2. Inspect the existing implementation and tests that cover the affected behavior.
3. Prefer "make the change easy, then make the easy change" when a small enabling refactor is required.
4. Where practical, update/add the externally observable test first and observe the expected failure.
5. Implement the narrowest complete vertical slice that satisfies the issue.
6. Run focused tests while developing, then run the full `npm test` and `npm run typecheck` gates.
7. Re-check every acceptance criterion against the actual implementation, not merely the diff.
8. Commit the issue work with an issue-referencing commit message.
9. Verify the working tree is clean and record the commit SHA with the issue/PR verification evidence.
10. Only then fetch and begin the next issue.

Do not batch several issue implementations into one large speculative change or one combined commit.

## Scope and change-control guardrails

- Do not reopen settled domain decisions while implementing tickets. If code conflicts with the model, migrate the code.
- Do not invent new product concepts, states, modes, persistence entities or user-facing features that are absent from `CONTEXT.md`/parent `#2` merely because they simplify implementation.
- Do not weaken an acceptance criterion to fit existing V1 architecture.
- Do not silently change the capability envelope.
- Do not change Reference fidelity thresholds, image budget, QA gates, repair ceilings, Approval/Publication semantics or form-security rules without an explicit new project decision.
- Do not turn temporary V1 compatibility into permanent V2 architecture.
- Do not delete potentially reusable brownfield infrastructure until its role is understood; classify first where issue `#3` requires it.
- Do not preserve superseded product paths once their current ticket explicitly replaces them, except where the migration manifest requires an expand–contract overlap.
- Do not perform opportunistic unrelated cleanup. Keep diffs attributable to the current ticket.
- Do not edit frozen benchmark targets or introduce benchmark substitutions while implementing pre-benchmark tickets.

## Testing guardrails

The preferred primary seam is the existing Cloudflare Worker / `WebsiteBuildWorkflow` boundary in the Cloudflare Vitest environment. Assert observable behavior through workflow outcomes, route responses, D1 state, R2 artifacts/manifests and immutable Build Version identity rather than private helper implementation details.

Use narrower contract tests where the primary seam cannot reliably exercise an external/provider boundary, including runtime schemas, KIE budget behavior, browser evidence normalization, Form Service delivery adapters, publication idempotency and prompt composition.

- Never disable, skip or relax a failing test merely to make a ticket pass unless the test encodes superseded V1 semantics and the current ticket explicitly replaces that behavior.
- When replacing a stale V1 test, add the V2 behavior assertion in the same ticket.
- Keep CI/test fixtures deterministic where possible; external AI/image/browser providers should be stubbed/faked for ordinary automated tests.
- Do not use benchmark PASS as a substitute for unit/contract/primary-seam coverage.

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
