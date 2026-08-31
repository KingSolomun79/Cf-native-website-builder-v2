// Deterministic base stylesheet for the blueprint primitive library.
//
// Consumes only the CSS custom properties emitted by blueprint-tokens.ts. No
// framework, no utility classes — the rendered class names are owned entirely by
// this renderer.

export function buildPrimitiveCss(): string {
  return `
:root {
  --maxw: 72rem;
  --gutter: 1.5rem;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-body);
  font-weight: var(--font-body-weight);
  font-size: var(--font-body-size);
  line-height: var(--line-height-body);
  color: var(--foreground);
  background: var(--background);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 {
  font-family: var(--font-heading);
  font-weight: var(--font-heading-weight);
  line-height: var(--line-height-heading);
  color: var(--foreground);
}

h1 { font-size: var(--font-heading-size); }
h2 { font-size: calc(var(--font-heading-size) / var(--type-scale)); }
h3 { font-size: calc(var(--font-heading-size) / (var(--type-scale) * var(--type-scale))); }

p { color: var(--foreground); }

img { max-width: 100%; height: auto; display: block; }
a { color: var(--primary-text); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--primary); outline-offset: 2px;
}

.skip-link {
  position: absolute; left: 0; top: -100%; z-index: 100;
  background: var(--foreground); color: var(--background);
  padding: 0.75rem 1.5rem;
}
.skip-link:focus { top: 0; }

body.no-scroll { overflow: hidden; }

.section { padding: var(--space-section); }
.section__inner { max-width: var(--maxw); margin-inline: auto; }
.section--inverted { background: var(--foreground); color: var(--background); }
.section--inverted h1, .section--inverted h2, .section--inverted h3, .section--inverted p { color: var(--background); }
.section--inverted .accordion__trigger, .section--inverted .accordion__panel, .section--inverted .stat__value, .section--inverted .stat__label, .section--inverted .section__eyebrow, .section--inverted a:not(.btn) { color: var(--background); }
.section--inverted .card, .section--inverted .card h1, .section--inverted .card h2, .section--inverted .card h3, .section--inverted .card p, .section--inverted .card a:not(.btn) { color: var(--surface-foreground); }
.section--accent { background: var(--accent); color: var(--accent-foreground); }
.section--accent h1, .section--accent h2, .section--accent h3, .section--accent p { color: var(--accent-foreground); }
.section--accent .section__eyebrow, .section--accent .stat__value, .section--accent .stat__label, .section--accent a:not(.btn) { color: var(--accent-foreground); }
.section--accent .card, .section--accent .card h1, .section--accent .card h2, .section--accent .card h3, .section--accent .card p, .section--accent .card a:not(.btn) { color: var(--surface-foreground); }

.nav { background: var(--background); border-bottom: 1px solid var(--border); }
.nav__bar { max-width: var(--maxw); margin-inline: auto; display: flex; align-items: center; justify-content: space-between; padding: 1rem var(--gutter); gap: 1rem; }
.nav__brand { display: inline-flex; align-items: center; gap: 0.6rem; color: var(--foreground); font-family: var(--font-heading); font-weight: var(--font-heading-weight); }
.nav__brand:hover { text-decoration: none; }
.nav__logo { height: 40px; width: auto; }
.nav__menu { display: none; flex-direction: column; padding: 0 var(--gutter) 1rem; gap: 0.25rem; }
.nav__menu.is-open { display: flex; }
.nav__link { color: var(--foreground); padding: 0.6rem 0; font-weight: 500; }
.nav__link--current { color: var(--primary); }
.nav__toggle { background: none; border: 1px solid var(--border); border-radius: var(--radius-button); padding: 0.5rem 0.75rem; cursor: pointer; display: inline-flex; }
.nav__toggle-icon, .nav__toggle-icon::before, .nav__toggle-icon::after { display: block; width: 20px; height: 2px; background: var(--foreground); position: relative; }
.nav__toggle-icon::before, .nav__toggle-icon::after { content: ""; position: absolute; left: 0; }
.nav__toggle-icon::before { top: -6px; }
.nav__toggle-icon::after { top: 6px; }

@media (min-width: 768px) {
  .nav__bar { padding: 1rem var(--gutter); }
  .nav__toggle { display: none; }
  .nav__menu { display: flex; flex-direction: row; align-items: center; padding: 0; gap: 1.25rem; }
}

.hero__heading { font-size: var(--font-heading-size); }
.hero__sub { margin-top: 1rem; max-width: 40rem; font-size: 1.125rem; }
.hero__media { margin-top: 2rem; }

.grid { display: grid; gap: 1.5rem; grid-template-columns: 1fr; }
@media (min-width: 640px) { .grid--2 { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 768px) { .grid--3 { grid-template-columns: repeat(3, 1fr); } .grid--4 { grid-template-columns: repeat(4, 1fr); } }

.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); padding: 1.5rem; color: var(--surface-foreground); }
.card__icon { display: inline-flex; align-items: center; color: var(--primary-surface-text); margin-bottom: 0.5rem; }
.card__icon .icon { width: 1.75rem; height: 1.75rem; }
.icon { display: inline-block; flex-shrink: 0; vertical-align: middle; }
.card__title { margin-top: 0.5rem; }
.card__body { margin-top: 0.5rem; color: var(--surface-foreground); }

.lead { max-width: 40rem; }
.prose p { margin-top: 1rem; }

.media { margin: 0; border-radius: var(--radius-card); overflow: hidden; border: 1px solid var(--border); }
.media img { width: 100%; height: 100%; object-fit: cover; aspect-ratio: var(--media-ratio, 16/9); }
.media--16x9 { --media-ratio: 16/9; }
.media--4x3 { --media-ratio: 4/3; }
.media--1x1 { --media-ratio: 1/1; }
.media--3x2 { --media-ratio: 3/2; }

.btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 2.75rem; padding: 0.75rem 1.5rem;
  border-radius: var(--radius-button); border: 2px solid transparent;
  font-family: var(--font-body); font-weight: 600; font-size: 0.95rem;
  cursor: pointer; text-align: center;
}
.btn--primary { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
.btn--primary:hover { text-decoration: none; filter: brightness(1.05); }
.btn--secondary { background: transparent; color: var(--primary); border-color: var(--primary); }
.btn--secondary:hover { text-decoration: none; background: var(--primary); color: var(--primary-foreground); }
.btn--ghost { background: transparent; color: var(--foreground); border-color: var(--border); }
.btn--ghost:hover { text-decoration: none; border-color: var(--foreground); }

.cta { background: var(--primary); color: var(--primary-foreground); border-radius: var(--radius-card); padding: 2.5rem; text-align: center; }
.cta__heading { color: var(--primary-foreground); }
.cta__body { color: var(--primary-foreground); margin-top: 0.75rem; max-width: 36rem; margin-inline: auto; }
.cta .btn { margin-top: 1.5rem; }
.cta .btn--primary { background: var(--background); color: var(--foreground); border-color: var(--background); }

.accordion__item { border-bottom: 1px solid var(--border); }
.accordion__heading { margin: 0; }
.accordion__trigger { width: 100%; text-align: left; background: none; border: none; padding: 1rem 0; font-family: var(--font-heading); font-size: 1.05rem; font-weight: var(--font-heading-weight); color: var(--foreground); cursor: pointer; display: flex; justify-content: space-between; gap: 1rem; }
.accordion__trigger::after { content: "+"; font-weight: 400; }
.accordion__trigger[aria-expanded="true"]::after { content: "\\2013"; }
.accordion__panel { padding-bottom: 1rem; color: var(--foreground); }
.accordion__panel[hidden] { display: none; }

.form { max-width: 40rem; }
.form__field { margin-bottom: 1rem; }
.form__label { display: block; margin-bottom: 0.35rem; font-weight: 500; font-size: 0.95rem; }
.form__input { width: 100%; padding: 0.65rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius-input); background: var(--background); color: var(--foreground); font-family: var(--font-body); font-size: 1rem; }
.form__input:focus { border-color: var(--primary); }
.form__actions { margin-top: 1rem; }
.form__status { margin-top: 1rem; padding: 0.75rem 1rem; border-radius: var(--radius-input); font-size: 0.9rem; }
.form__status[data-state="error"] { background: #fef2f2; color: #991b1b; }
.form__status[data-state="success"] { background: #f0fdf4; color: #166534; }

.stats { display: grid; gap: 1.5rem; grid-template-columns: 1fr; }
@media (min-width: 640px) { .stats { grid-template-columns: repeat(3, 1fr); } }
.stat__value { font-family: var(--font-heading); font-size: calc(var(--font-heading-size) / var(--type-scale)); font-weight: var(--font-heading-weight); color: var(--primary-text); }
.stat__label { margin-top: 0.25rem; color: var(--foreground); }

.contact-details { list-style: none; display: grid; gap: 0.5rem; }
.contact-details li { color: var(--foreground); }

.footer { background: var(--surface); border-top: 1px solid var(--border); color: var(--surface-foreground); padding: 2.5rem var(--gutter); margin-top: var(--space-section); }
.footer__inner { max-width: var(--maxw); margin-inline: auto; display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: center; }
.footer__brand { font-family: var(--font-heading); font-weight: var(--font-heading-weight); color: var(--surface-foreground); }
.footer__socials { display: flex; gap: 1rem; flex-wrap: wrap; }
.footer__socials a { color: var(--surface-foreground); }
.footer__copy { width: 100%; color: var(--muted); font-size: 0.85rem; margin-top: 1rem; }

.section__eyebrow { color: var(--primary-text); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.8rem; }
`.trim();
}
