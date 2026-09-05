# Generator-negative fixture — RankForge v3 (build 2c8e73ec) realization failure

Frozen 2026-09-05 from the immutable v3 preview deployment of the production
REFERENCE_BOUND retest (Reference: morabeza.digital, Business: RankForge
Kenya). The candidate reached `HUMAN_REVIEW_REQUIRED` with correct Reference
understanding (frozen evidence → analyzer → Blueprint all verified faithful)
and correct QA truth-telling, but the GENERATED REALIZATION was low-fidelity.

This fixture is the complementary negative to the original false-PASS
specimen (build 5320a229):

```text
5320a229 fixture proves: blind QA must reject a bad candidate.
2c8e73ec fixture proves: correctly understood Reference can still be
                         badly realized — and deterministic checks must
                         catch it before expensive QA.
```

## Contents

- `home.html` — v3 home page source, verbatim (resolved asset paths).
- `site.css` — v3 shared stylesheet, verbatim.
- `measured-desktop-home.json` — measured rendered geometry, computed
  typography, image audit and the CSS/HTML class-vocabulary diff.

## What it must fail (issues #47/#48)

1. `REGION_STYLE_MISSING` — most canonical regions have no CSS rule scoped
   to their `data-region` attribute (the contract's region style binding).
2. `ORPHANED_CLASS` — 28 of 59 HTML classes have no rule in site.css while
   58 of 87 CSS classes are unused: the CSS and the pages were generated in
   separate calls with no shared class contract, so the Blueprint-faithful
   4-up service grid, display typography, full-bleed hero media rule and
   split layouts never applied to the markup.
3. Realization precheck — headline clipped off-canvas (h1 pushed to the
   right viewport edge by the unstyled hero image flex row), UA-default
   32px h1 where the Blueprint tokens demand 60px display type, services
   region 3.2 viewports of single-column stack.
4. Image acceptance — the about-split slot requires a 2:3 portrait role;
   the accepted asset is a 1344×768 landscape that also embeds a fabricated
   client-logo strip ("Glap Thon", "Marivert", "6699", "Scap Thes",
   "Hopes") baked into its pixels. Both the orientation conformance gate
   (#47) and the image fabrication defenses (#48) must reject this class
   of asset.

Do not mutate the fixture files; new negative specimens deserve new
fixtures.
