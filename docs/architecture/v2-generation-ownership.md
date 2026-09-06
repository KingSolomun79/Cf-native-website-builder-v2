# V2 Generation Ownership Map (issue #47)

One Site Generation produces the generated Site through incremental AI calls
under fixed contracts. This map is the binding answer to "which stage owns
which artifact" — the failed production realization (RankForge v3, build
2c8e73ec) happened because ownership was implicit: the CSS call and the page
calls each invented their own class vocabulary, and nothing bound them
together. Encoding here and in the code is part of the realization contract.

The map is enforced mechanically, not just documented:

- `planImplementationContract` derives the deterministic `realization` block
  (region style bindings, `classVocabularyPolicy`,
  `contentCapacityPolicy`) into the Implementation Contract
  (`src/domain/implementation-planner.ts`).
- The CSS call receives the binding block and MUST scope at least one real
  rule to every bound `[data-region]` selector
  (`cssPrompt` in `src/domain/site-generator.ts`).
- Every page call receives the frozen inventory of classes the generated CSS
  actually defines and must style itself with those classes verbatim
  (`pagePrompt` — `STYLING CONTRACT`).
- `validateAssembledSite` rejects the assembly otherwise:
  `REGION_STYLE_MISSING` (rule-level CSS check) and `ORPHANED_CLASS`
  (classified: behavior/state hooks are exempt, styling-intent orphans are
  defects).

## Ownership

| Artifact | Owning stage | Binding downstream rule |
| --- | --- | --- |
| Design tokens | Visual Blueprint stage (frozen artifact); carried verbatim into the contract (`contract.tokens`) | Generation may use but never alter tokens; repair may not touch them |
| Global CSS (`site.css` structure, container/grid logic, responsive `@media`) | Shared-CSS generation call (call 1 of the incremental generator) | Pages must not carry inline layout CSS that fights it; responsive CSS lives here only |
| Component vocabulary (reusable classes: buttons, cards, pills, nav) | Shared-CSS generation call — the CSS call OWNS the class vocabulary | Page calls receive the frozen class inventory verbatim and invent no styling class outside it |
| Region vocabulary (canonical `data-region` ids) | Implementation Contract planner (deterministic, mirrors the Blueprint topology) | Every call uses the canonical ids verbatim; QA, crops and repair target the same ids |
| Page HTML (`index/about/services/contact.html`) | Per-page generation calls (calls 3-6) | Structure mirrors the Blueprint topology (`data-region` sections on home); styling only through the CSS inventory + region attributes |
| Responsive CSS | Shared-CSS generation call (real `@media` rules; validated by `NON_RESPONSIVE_CSS`) | Page markup stays responsive-neutral (viewport meta only) |
| Shared header/footer | Page calls realize them per page from the Blueprint `headerNavigation` language; the validator mechanically requires semantic `<header>/<nav>/<main>/<footer>` elements on every page | No shared server-side include exists — the class vocabulary for them comes from the CSS call |
| Page-specific layout | Per-page call, expressed with CSS-inventory classes inside the canonical region sections | A page may not invent a second visual vocabulary to express layout |
| Shared runtime JS (`site.js`) | Shared-JS generation call (call 2) | Behavior/state classes it toggles are exempt from the CSS vocabulary check (`classifyGeneratedClass`) |

## Classification of generated classes (`ORPHANED_CLASS`)

- `behavior-state` — referenced by `site.js`, or matching the reserved state
  conventions (`is-*`, `has-*`, `js-*`, `active`, `open`, …). Never a defect.
- `non-styling-hook` — reserved non-styling markers (`no-js`). Never a defect.
- `styling-intent` — everything else. An orphaned styling-intent class is a
  defect: generated markup has no third-party classes, so a class the CSS
  never heard of is a vocabulary split until the CSS defines it (within the
  same allowed operation — a repair round may update CSS and pages
  consistently).

## Rendered-level verification

The assembly checks above are source-level. The rendered-level realization
checks (region geometry, first-viewport height, grid topology, headline
clipping, image-role realization) run in the deterministic craft preflight
(issue #49) after Preview, using `data-region` as the stable join key between
Blueprint region, DOM region, rendered geometry and repair target.
