# WAZIBIZ Website Builder V2 Documentation

This folder is the canonical implementation package for Website Builder V2.

## Source-of-truth order

The coding agent must read these documents in this order:

1. `../CONTEXT.md` — **canonical domain vocabulary and semantics**. If another document uses a domain term inconsistently, `CONTEXT.md` wins for the meaning of that term.
2. `IMPLEMENTATION-PRD.md` — **normative implementation specification**. It defines architecture, workflow, persistence, runtime contracts and acceptance requirements using the vocabulary from `CONTEXT.md`.
3. `CAPABILITY-ENVELOPE.md` and `capability-envelope.json` — human- and machine-readable product support boundaries.
4. `FINAL-DECISION-RECORD.md` — locked decisions and rationale.
5. `prompts/PROMPT-MANIFEST.md` — canonical runtime prompt IDs/versions and stage-specific reconciliation.
6. `prompts/00-domain-contract-v1.md` + the retained full stage-prompt body named in the manifest — composed executable stage prompt.
7. Older root documentation and V1 implementation — historical/infrastructure context only where explicitly retained by the V1 fork audit.

No implementation may create a competing meaning for a term defined in `CONTEXT.md`.

## No client-account domain

V2 has no Client Account, Client User or persistent mutable Client Profile domain concept. A completely new Site Generation begins from a fresh immutable Onboarding Submission. A Site is the stable website identity for one Business and may have multiple Site Generations over time.

Normal later Business/content changes that preserve Reference and Build Mode use a Revision Request and a new Build. Business Fact changes are represented as Fact Updates rather than mutations of historical Onboarding Submissions.

## Build and release lifecycle

Canonical distinctions:

```text
Site
  -> Site Generation
      -> Build
          -> Build Version
              -> Release Candidate
                  -> Release Ready
                      -> Approval
                          -> Publication
                              -> Published Version
```

- Human new intent creates a new Build.
- Bounded Automated Repair creates a new Build Version inside the same Build.
- Approval and Publication are separate.
- Publication never regenerates an approved Build Version.
- The immediately previous Published Version may be retained temporarily as Rollback Version.
- Rollback restores that exact version without a new Build or Approval.
- Mutable Site Configuration does not roll back unless explicitly requested.

## Repository strategy

This repository is a fork of the original V1 builder. V1 remains preserved separately. Proven infrastructure may be reused after audit, but superseded V1 product logic must be removed before V2 release.

Final rule:

> Keep proven platform infrastructure. Delete superseded product logic.

## Locked implementation sequence

```text
REFERENCE_BOUND
  -> fixed five-site benchmark
  -> minimum 3/5 Benchmark Pass
  -> then ORIGINAL_DESIGN
```

Benchmark Pass means the exact candidate reaches Release Ready automatically with zero manual source-code edits and within the hard KIE image-generation budget of USD 3.00/site. Human Approval and Publication are not benchmark requirements.

## Canonical REFERENCE_BOUND workflow

```text
Onboarding Submission
  -> normalize Business Facts
  -> Reference Suitability Gate
  -> Reference acquisition
  -> deterministic Reference Evidence extraction
  -> Reference Analysis
  -> Visual Blueprint
  -> Implementation Contract
  -> incremental shared-contract site generation
  -> runtime schema + deterministic validation
  -> Image Wave 1
  -> Image Wave 2
  -> persist Accepted Images
  -> assembly
  -> Technical Preflight
  -> Preview
  -> standardized QA evidence
  -> Visual Geometry Comparator
  -> QA-A + QA-B
  -> Release Ready OR bounded Automated Repair
  -> confirmation
  -> optional one Release Blocker Fix
  -> Release Ready OR HUMAN_REVIEW_REQUIRED
  -> explicit Approval
  -> Publication of exact approved Build Version
```

A Blueprint-level defect emits `BLUEPRINT_REVIEW_REQUIRED` and cannot be silently repaired by implementation mutation.

## Form and email architecture

Generated sites use one central WAZIBIZ Form Service.

```text
static Contact form
  -> WAZIBIZ Form Service
  -> origin/schema/Turnstile/rate validation
  -> Accepted Submission
  -> current Site Configuration
  -> Form Destination + Sender Identity
  -> Cloudflare-native Email Delivery
```

The browser never chooses the recipient, From sender, sender domain, template or credentials. V2 defaults to a verified WAZIBIZ platform Sender Identity. Visitor email may be used as validated Reply-To, never transactional From.

Form Destination and Sender Identity are mutable Site Configuration and can change without rebuilding/reapproving the website. An operational Rollback does not roll them back unless explicitly requested.

## Canonical prompts

Runtime must use `prompts/PROMPT-MANIFEST.md`. Each prompt is composed from:

```text
prompts/00-domain-contract-v1.md
+
retained full detailed stage prompt body
```

The domain contract supersedes contradictory clauses in older detailed bodies while preserving their full useful detail. The manifest version, not the filename suffix of the retained body, is the runtime prompt version.

## Hard automation limit

1. Initial generation.
2. One Fix Coordinator Automated Repair batch.
3. At most one narrow Release Blocker Fix.
4. If a valid Release Blocker remains, stop and emit `HUMAN_REVIEW_REQUIRED`.

No unbounded mutation loop is permitted.

## V1 release gate

V2 is not complete until superseded V1 generator paths, flags, prompt registry entries, schemas/types/tests/routes and obsolete root documentation are removed or clearly quarantined as historical context. No production route may invoke V1 after V2 acceptance.
