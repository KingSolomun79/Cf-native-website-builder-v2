# WAZIBIZ Website Builder V2 — Canonical Prompt Manifest

SIMPLE is the canonical V2 design pipeline (legacy cleanup, 2026-09-10): the
retained detailed bodies below are the ONLY runtime stage prompts. The retired
complex-pipeline stage bodies (Reference Analyzer, Visual Blueprint, Website
Generator, Fix Coordinator, QA-A/QA-B stages and confirmations, Realization
Repair, KIE Image Prompt Generator, Original Design Blueprint Generator) were
removed; their git history remains the archive.

All V2 runtime prompts are composed as:

```text
00-domain-contract-v1.md
+
full retained stage prompt body listed below
```

The domain contract is prepended at runtime and is authoritative over
contradictory clauses inside the retained detailed body.

## REFERENCE_BOUND — SIMPLE pipeline stages

| Stage | prompt id/version | Detailed body |
|---|---|---|
| Design Blueprint Generator (multimodal — Reference screenshots attached) | `simple-design-blueprint/v5` | `simple/01-design-blueprint.md` |
| Website Builder — the ONE visual owner | `simple-website-builder/v7` | `simple/02-website-builder.md` |
| Visual QA | `simple-visual-qa/v2` | `simple/03-visual-qa.md` |
| Site Repair — the ONE repair | `simple-site-repair/v1` | `simple/04-site-repair.md` |

## Deferred mode

ORIGINAL_DESIGN remains a recognized V2 Build Mode whose runtime is explicitly
NOT ENABLED (deterministic lock; see `src/domain/original-design-lock.ts`).
Its future SIMPLE implementation will reuse `simple-design-blueprint` (with
Business Facts + creative-direction inputs instead of Reference captures) and
the SAME downstream bodies: `simple/02`, `simple/03`, `simple/04`.
