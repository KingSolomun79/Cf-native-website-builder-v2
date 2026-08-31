# WAZIBIZ Website Builder V2 — Consistency Audit

**Status:** SPECIFICATION LAYER RECONCILED  
**Date:** 2026-08-31  
**Scope:** Domain model, authoritative V2 docs, capability envelope, prompt governance, root agent/readme guidance and conflicting legacy documentation.

## Result

The V2 specification layer now has one consistent authority chain:

1. `../CONTEXT.md` — canonical domain vocabulary/semantics.
2. `IMPLEMENTATION-PRD.md` — normative implementation requirements.
3. `CAPABILITY-ENVELOPE.md` + `capability-envelope.json` — capability boundary.
4. `FINAL-DECISION-RECORD.md` — locked decisions/rationale.
5. `prompts/PROMPT-MANIFEST.md` — canonical runtime prompt IDs/versions.
6. `prompts/00-domain-contract-v1.md` + retained full detailed stage-prompt body — composed executable prompt.
7. Root/V1 material — historical/brownfield context only where explicitly retained.

## Reconciled domain boundaries

Confirmed consistent across canonical docs:

- Business vs Site vs Site Generation.
- fresh immutable Onboarding Submission per new Site Generation.
- no Client Account/Client User domain.
- Revision Request vs new Site Generation.
- Fact Update without historical intake mutation.
- Build vs Build Version.
- human new intent vs Automated Repair.
- Reference vs Reference Screenshot vs Reference URL.
- Reference Evidence vs Reference Analysis.
- Visual Blueprint vs Implementation Contract.
- `BLUEPRINT_REVIEW_REQUIRED` vs `HUMAN_REVIEW_REQUIRED`.
- Image Slot vs Image Attempt vs Accepted Image.
- Release Candidate vs Release Ready.
- Release Blocker vs P2/P3 polish.
- Approval vs Publication.
- Published Version vs Rollback Version vs Rollback.
- Site Configuration vs immutable Build artifacts.
- Form Submission vs Accepted Submission vs Email Delivery.
- Form Destination vs Sender Identity vs Reply-To.
- Degraded vs Failed.
- Benchmark Site vs Benchmark Pass.

## Release-state consistency

Canonical release progression is:

```text
Build Version
-> Release Candidate
-> Release Ready
-> Approval
-> Publication
-> Published Version
```

Resolved rules:

- Approval does not itself make a version live.
- Publication uses the exact approved Build Version and never regenerates.
- Operational publication failure can retry under the same Approval if the Build Version is unchanged.
- Material repair creates a new Build Version and requires re-evaluation.
- Human revision creates a new Build and eventually fresh Approval.
- Rollback restores the exact retained previous Published Version without new Build/Approval.
- Site Configuration does not roll back by default.

The obsolete `READY_FOR_APPROVAL` wording is not part of the canonical V2 state model; use `RELEASE_READY`/Release Ready.

## Prompt consistency

The 11 retained detailed prompt bodies remain intentionally preserved for their full stage detail. They are no longer invoked directly as canonical standalone prompts.

Runtime composition is:

```text
prompts/00-domain-contract-v1.md
+
full retained detailed body named in prompts/PROMPT-MANIFEST.md
```

The shared domain contract explicitly supersedes obsolete clauses including:

- presentation-only/no-submit Contact forms;
- browser-controlled or per-Site mail routing assumptions;
- Blueprint mutation during QA repair;
- treating repaired output as the same Build Version;
- old approval/publication conflation;
- Client Account/User language;
- blind/unbounded retry semantics;
- benchmark Approval/Publication requirements.

Canonical runtime prompt versions are the manifest versions, not historical filename suffixes.

## Root-document cleanup

Resolved:

- root `README.md` replaced with V2-first overview and authority chain;
- root `AGENTS.md` replaced with V2-first coding-agent instructions;
- root `design_archetypes.md` deleted because its old industry-mapping semantics conflicted with the non-binding Design Archetype decision;
- `docs/prd.md` quarantined as historical-only pointer;
- `docs/roadmap.md` quarantined as historical-only pointer.

`docs/candidate-validation.md` remains as an operational brownfield harness note and is not a product/domain authority.

## Capability consistency

`CAPABILITY-ENVELOPE.md` and `capability-envelope.json` v2.0.0 agree on:

- four-page static/framework-light product;
- two Build Modes and sequencing;
- Reference Screenshot authority;
- Reference Suitability outcomes/Adaptation Contract;
- hard KIE USD 3.00 budget and two image waves;
- hard visual QA gates;
- bounded Automated Repair;
- Blueprint immutability under repair;
- central WAZIBIZ Form Service;
- Accepted Submission before Email Delivery;
- verified WAZIBIZ platform Sender Identity default;
- Approval separate from Publication;
- rollback semantics;
- 3/5 fixed Benchmark Pass threshold.

## Known brownfield implementation migration risks

These are implementation tasks, not unresolved domain questions. Existing V1 code/migrations may still contain old concepts and must be classified by the Phase 0 audit before reuse or deletion:

- `clients`/client-slug based persistence naming;
- Fluent Forms-specific intake assumptions;
- mandatory Reference input assumptions that conflict with `ORIGINAL_DESIGN`;
- old DesignBlueprint/InteractionBlueprint product model;
- deterministic old renderer/template rules that may over-constrain V2 topology;
- SMTP2Go/per-Site contact-delivery code;
- per-Site contact Worker/mail secrets;
- old `waiting_approval`, revision-count or `MAX_REVISIONS` lifecycle logic;
- GitHub-push production pipeline semantics that regenerate/repackage rather than publish an exact approved Build Version;
- fixed 30-day Preview cleanup logic that does not distinguish current Published Version/Rollback Version/Build Record retention;
- V1 schema/table names that embed Client Account assumptions;
- direct invocation/registry references to historical prompt filename versions.

The coding agent must not preserve these merely because they already exist. Each is KEEP/RENAME/EXTEND/REFACTOR/REPLACE/DELETE according to the V2 brownfield audit.

## Remaining specification questions

None currently identified.

If implementation exposes a genuinely new domain ambiguity, update `CONTEXT.md` immediately before encoding a competing concept in code. Architecture-only irreversible/surprising tradeoffs should be captured as ADRs when they meet the ADR threshold.

## Final status

**Domain interview:** complete.  
**Canonical glossary:** complete.  
**PRD reconciliation:** complete.  
**Decision-record reconciliation:** complete.  
**Capability-envelope reconciliation:** complete.  
**Prompt governance/version reconciliation:** complete.  
**Conflicting root/legacy documentation cleanup:** complete.  
**Specification consistency audit:** complete.  
**Brownfield code migration:** not yet implemented; proceed from Phase 0/Phase 1 of `IMPLEMENTATION-PRD.md`.
