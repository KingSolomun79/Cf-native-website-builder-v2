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
| Website Builder — the ONE visual owner (v10: copy style + touch targets 44x36 + mobile marker composition — no em/en dashes in copy, no stock AI phrasing) | `simple-website-builder/v10` | `simple/02-website-builder.md` |
| Visual QA (v4: all-page renders; mobile defects outrank desktop polish) | `simple-visual-qa/v4` | `simple/03-visual-qa.md` |
| Site Repair — the ONE repair (v3: multimodal sight + structural-defect rule + copy style) | `simple-site-repair/v3` | `simple/04-site-repair.md` |

## ORIGINAL_DESIGN — SIMPLE pipeline stages (issue #24, enabled 2026-09-12)

Both Build Modes share EVERYTHING downstream of the Design Blueprint. The
divergence is only the Blueprint inputs/prompt and the Visual QA evaluation
context/prompt. Both Blueprint prompts output the SAME `design-blueprint/2`
schema; both Visual QA prompts output the SAME report schema.

| Stage | prompt id/version | Detailed body |
|---|---|---|
| Original Design Blueprint Generator (text-only — Business Facts + Creative Direction, no Reference) | `simple-original-design-blueprint/v1` | `simple/05-original-design-blueprint.md` |
| Website Builder — the ONE visual owner (SHARED with REFERENCE_BOUND) | `simple-website-builder/v10` | `simple/02-website-builder.md` |
| Original Design Visual QA (candidate renders vs Blueprint + Creative Direction; no Reference; v3: all-page renders; mobile defects outrank desktop polish) | `simple-original-design-visual-qa/v3` | `simple/06-original-design-visual-qa.md` |
| Site Repair — the ONE repair (SHARED with REFERENCE_BOUND) | `simple-site-repair/v3` | `simple/04-site-repair.md` |
