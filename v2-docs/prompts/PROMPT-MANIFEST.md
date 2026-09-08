# WAZIBIZ Website Builder V2 — Canonical Prompt Manifest

All V2 runtime prompts are composed as:

```text
00-domain-contract-v1.md
+
full retained stage prompt body listed below
```

The domain contract is prepended at runtime and is authoritative over contradictory legacy clauses inside the retained detailed body. This preserves the full detailed prompt content while versioning the reconciled V2 contract explicitly.

| Stage | Reconciled prompt id/version | Detailed body |
|---|---|---|
| Reference Analyzer | `reference-analyzer/v3` | `01-reference-analyzer-v2.md` |
| Visual Blueprint Generator | `visual-blueprint-generator/v5` | `02-visual-blueprint-generator-v2.md` |
| Original Design Blueprint Generator | `original-design-blueprint-generator/v3` | `03-original-design-blueprint-generator-v2.md` |
| Website Generator | `website-generator/v4` | `04-website-generator-v3.md` |
| KIE Image Prompt Generator | `kie-image-prompt-generator/v2` | `05-kie-image-prompt-generator-v1.md` |
| QA-A Visual/Content | `qa-a-visual-content/v4` | `06-qa-a-visual-content-v2.md` |
| QA-B Browser/Technical | `qa-b-browser-technical/v3` | `07-qa-b-browser-technical-v2.md` |
| Fix Coordinator | `fix-coordinator/v3` | `08-fix-coordinator-v2.md` |
| QA-A Confirmation | `qa-a-confirmation/v3` | `09-qa-a-confirmation-v2.md` |
| QA-B Confirmation | `qa-b-confirmation/v3` | `10-qa-b-confirmation-v2.md` |
| Release Blocker Fix | `release-blocker-fix/v2` | `11-release-blocker-fix-v1.md` |
| Realization Repair | `realization-repair/v1` | `12-realization-repair-v1.md` |

## Experiment branch only — SIMPLE design pipeline (`experiment/simplified-design-pipeline`)

Registered for the `DESIGN_PIPELINE_VERSION=simple_blueprint_v1` experiment (branch-only; never invoked by the `legacy_v2` chain). Same composition rule — domain contract first. The Design Blueprint Generator is multimodal (Reference screenshots attached).

| Stage | Reconciled prompt id/version | Detailed body |
|---|---|---|
| SIMPLE Design Blueprint Generator | `simple-design-blueprint/v2` | `simple/01-design-blueprint.md` |
| SIMPLE Website Builder | `simple-website-builder/v1` | `simple/02-website-builder.md` |
| SIMPLE Visual QA | `simple-visual-qa/v1` | `simple/03-visual-qa.md` |
| SIMPLE Site Repair | `simple-site-repair/v1` | `simple/04-site-repair.md` |

### simple-design-blueprint v1

One multimodal call translating the Reference screenshots into an implementation-ready Design Blueprint (`design-blueprint/1`) for a DIFFERENT business. Screenshots are design authority; business content authority is never carried (businessFactsRef provenance only). Emits image slots with ready KIE prompts — no separate KIE prompt LLM stage. Deterministic quality gate (DNA count, page specs, signature elements, checklist) follows; one schema correction, then HUMAN_REVIEW_REQUIRED.

### simple-website-builder v1

The ONE visual owner producing `site-bundle/1` (four pages + shared site.css/site.js) from the frozen Blueprint + immutable Business Facts + Accepted Images + form contract. Reference screenshots remain visible as visual ground truth. IMG:{slotId} placeholder convention identical to legacy assembly.

### simple-visual-qa v1

One multimodal comparative judgement (Reference vs Candidate, desktop + mobile): nine 0–100 scores plus AT MOST 5 impact-ranked findings that constitute the entire repair brief. Content replacement is explicitly not penalizable.

### simple-site-repair v1

The ONE semantic repair (max one call per Build): holistic edit of HTML/CSS/JS against the combined qa-package, with the preservation set (Business Facts, contact details, form contract, Accepted Image identities, Blueprint direction) frozen.


## Mandatory stage-specific reconciliation

### Reference Analyzer v3

Consumes versioned Reference Evidence, not loose browser dumps. It is forensic/descriptive and cannot redesign, map Business content, or fabricate observations. Reference Screenshot controls static composition; Reference URL is supplemental behavioral/runtime evidence. The analysis contract binds exactly 3-8 signature traits (schema-enforced since `reference-analysis/2`, issue #59); a model output exceeding the bound is rejected by the Analyzer boundary and must return a compliant ranked set through the targeted schema repair — never silent truncation.

### Visual Blueprint Generator v5

Produces the binding Visual Blueprint from Reference Analysis plus Business/brand inputs and Adaptation Contract. It cannot copy reference content/branding/assets. Raw Reference Evidence segmentation is observational: the blueprint may aggregate adjacent raw segments into canonical regions and must preserve `sourceEvidenceRegionIds` provenance per canonical region; the ordered canonical region list is the binding topology for implementation and QA. v5 (issue #59) adds the binding trait obligation ledger: every identity-defining Reference Analysis trait carries exactly one `traitObligations` disposition — PRESERVED (realized by existing canonical regions) or ADAPTED under an existing immutable Adaptation Contract clause — and `fidelityPriorities` are ordered plain strings (`N. dimension — reason`). Once generation begins the Blueprint cannot be silently changed by downstream repair.

### Original Design Blueprint Generator v3

Uses Business, audience, brand, conversion goal, physical/service context and explicit creative direction. Industry/design archetypes are non-binding inspiration only and may never deterministically select the design.

### Website Generator v4

Consumes one Visual Blueprint + one Implementation Contract and generates incrementally under those shared contracts. The Contact form must implement the WAZIBIZ Form Service browser contract; any retained presentation-only/no-backend/no-submit rule is superseded. Browser code never controls Form Destination or Sender Identity.

### KIE Image Prompt Generator v2

Consumes stable Image Slots. Enforces CRITICAL/HIGH/NORMAL priority, two-wave orchestration, budget awareness, repair reserve, slot-preserving retries and the USD 3.00 hard completed-site image spend gate.

### QA-A v4

Uses standardized rendered evidence and geometry-comparator evidence. Release requires >=90 visual, >=90 content, zero P0/P1, no fabrication and all hard visual composition gates. QA-A cannot compensate a hard-gate failure with aggregate score. Region topology gates judge the generated canonical region sequence against the Visual Blueprint; raw Reference Evidence remains the authority for measured fidelity only.

### QA-B v3

Validates the real WAZIBIZ Form Service/Turnstile contract, browser/runtime/source/DOM/network behavior, accessibility, SEO, image resolution and Implementation Contract integrity. Any retained rule requiring absence of form submission logic is superseded.

### Fix Coordinator v3

Plans one bounded main Automated Repair batch. It cannot mutate Business Facts, Reference, Build Mode or Visual Blueprint. Blueprint root defects emit `BLUEPRINT_REVIEW_REQUIRED`. A material applied repair creates a new Build Version.

### QA-A Confirmation v3 / QA-B Confirmation v3

Re-evaluate the new Build Version produced by repair, focusing on previous/changed blocker domains. Confirmation never treats a repaired candidate as the same immutable Build Version.

### Release Blocker Fix v2

At most one narrow final Automated Repair batch after failed confirmation. It cannot introduce new human intent or Blueprint change. If valid blockers remain afterward, stop automation and emit `HUMAN_REVIEW_REQUIRED`.

## Runtime rule

Only prompt IDs/versions in this manifest are canonical for V2 runtime. The filename version suffix of the retained detailed body is historical and must not be used as the runtime prompt version.
