# Issue #53 CSO — Role-Aware Trust-Entity Classification + Truth-Contract Propagation

Date: 2026-09-06 · Scope: working-tree diff for issue #53 · Verdict: **SECURITY OK WITH WATCH ITEMS**

## 1. What was audited

- `src/domain/site-generator.ts` — `lintTrustContexts`/`collectTrustLabels` now classify each label
  by presentation role (identity / heading / text). Identity slots (li, img alt, logo-signaling
  attributes) keep the strict #48 semantics (shape gate + every-word fact check). Headings pass only
  when every capitalized word is generic/common-heading/fact/business vocabulary or the label is a
  business self-reference (all capitalized words safe AND the name's distinctive token present).
  Bare decorative numeric marks are exempt outside identity slots. Page prompts and the assembly
  repair directives now carry the binding trust-context truth rule.
- `tests/v2-truth-lint.test.ts` — MUST-PASS / MUST-FAIL matrix (8 new tests), frozen-name regression.
- `tests/v2-site-generator.test.ts` — prompt-propagation tests (2 new).

## 2. Security scope

Business-truth integrity control, not a security boundary. No auth, secrets, routes, payments, or
external inputs touched. The lint is a deterministic generation-quality gate inside the Build
workflow; prompts are static text plus `facts.businessName` interpolation (facts already flow into
every prompt via `factsBlock` — no new injection surface).

## 3. Attack-surface summary

The change RELAXES a fail-closed control for two text roles, so the review focused on whether any
real fabrication path opens:

- Identity slots (where the production fabricated entities lived: "Glap Thon", "Marivert", "6699" as
  logo-wall items / image alts) are UNCHANGED strict. Frozen names still fail (regression test).
- Heading relaxation requires EVERY capitalized word to be safe vocabulary; a foreign proper noun
  ("Digital Africa Awards", "Forbes Kenya", "John Kamau") still fails (tested).
- Self-reference requires the business name's DISTINCTIVE (longest) token, so "Acme Kenya" cannot
  borrow a multi-word name's geographic fragment (tested).
- Numeric marks remain blocked in identity presentation; exempt only as body/heading decoration.

## 4. Findings

No Critical/High findings. One Medium-considered, classified watch item:

- WATCH (low): a fabricated client whose name consists entirely of safe-vocabulary words rendered as
  a trust-band HEADING could pass (e.g. a fictional "Growth Approach Labs" would still fail on
  "labs", but pure-common-word shapes pass). Residual risk is bounded: headings cannot present logo
  identities convincingly, QA-A visual review still sees the rendered band, and the #48 confirmation
  invariant (active fabrication blocks Release Ready) is unchanged.

## 5. Severity summary

Watch items: 1 (low). No blocking findings.

## 6. Required remediation

None.

## 7. Watch items

- Monitor production QA-A fabrication verdicts for heading-carried fabrications; if observed, add a
  "named-entity in credibility-band heading" hard gate fed by the Reference trust-band mapping.
- `GENERIC_TRUST_LABEL_WORDS` / `HEADING_COMMON_WORDS` are curated sets; extend only with common
  function/heading words, never with plausible brand morphology.

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS**

## 9. Next best action

Commit as the dedicated issue #53 commit; both remediation issues are then complete — return the
remediation report and await operator GO before any deployment or fresh Build.
