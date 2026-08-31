// Maps a validated InteractionBlueprint into bounded CSS + minimal JS.
//
// The model only chooses WHICH interaction kinds are present (by trigger) and
// their reduced-motion behavior text. The actual code is a fixed, audited
// template parameterized solely by trigger-kind booleans — the model can never
// contribute executable source. Every animated rule is gated behind
// `@media (prefers-reduced-motion: no-preference)` so reduced-motion users see
// no motion by default.

import type { InteractionBlueprintV2 } from "../lib/blueprint-schema-v2";
export interface InteractionCss {
  css: string;
  enabledKinds: Set<string>;
}

export function interactionBlueprintToCss(interaction: InteractionBlueprintV2): InteractionCss {
  const kinds = new Set(interaction.interactions.map((i) => i.trigger));
  const blocks: string[] = [];

  if (kinds.has("scroll-reveal")) {
    blocks.push(`@media (prefers-reduced-motion: no-preference) {
  html.motion-ready [data-reveal] { opacity: 0; transform: translateY(1rem); transition: opacity 0.6s ease, transform 0.6s ease; }
  html.motion-ready [data-reveal].is-visible { opacity: 1; transform: none; }
}`);
  }

  if (kinds.has("hover") || kinds.has("active")) {
    blocks.push(`@media (prefers-reduced-motion: no-preference) {
  .btn { transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.2s ease; }
  .btn:hover { transform: translateY(-1px); }
  .btn:active { transform: translateY(0) scale(0.98); }
  .card { transition: box-shadow 0.2s ease, transform 0.2s ease; }
  .card:hover { transform: translateY(-2px); }
  .nav__link { transition: color 0.2s ease; }
  .nav__link:hover { color: var(--primary); }
  .nav__link:active { opacity: 0.75; }
}`);
  }

  if (kinds.has("sticky")) {
    blocks.push(`@media (min-width: 768px) {
  .nav { position: sticky; top: 0; z-index: 50; }
}`);
  }

  if (kinds.has("section-transition")) {
    blocks.push(`@media (prefers-reduced-motion: no-preference) {
  .section { transition: opacity 0.4s ease; }
}`);
  }

  return { css: blocks.join("\n\n"), enabledKinds: kinds };
}

export function interactionBlueprintToJs(enabledKinds: Set<string>): string {
  const hasReveal = enabledKinds.has("scroll-reveal");
  const hasNav = true;

  const revealSnippet = hasReveal ? `
  try {
    var revealEls = document.querySelectorAll('[data-reveal]');
    var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('is-visible'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
        });
      }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
      revealEls.forEach(function (el) { io.observe(el); });
    }
  } catch (e) {}
` : "";

  const toggleSnippet = `
  document.querySelectorAll('.accordion__trigger').forEach(function (trigger) {
    trigger.addEventListener('click', function () {
      var expanded = trigger.getAttribute('aria-expanded') === 'true';
      var panel = document.getElementById(trigger.getAttribute('aria-controls'));
      trigger.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      if (panel) { if (expanded) { panel.setAttribute('hidden', ''); } else { panel.removeAttribute('hidden'); } }
    });
  });
`;

  const navSnippet = hasNav ? `
  var toggle = document.querySelector('.nav__toggle');
  var menu = document.querySelector('[data-nav-menu]');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      menu.classList.toggle('is-open');
      document.body.classList.toggle('no-scroll');
    });
    menu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        toggle.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
        document.body.classList.remove('no-scroll');
      });
    });
  }
` : "";

  const readinessSnippet = hasReveal ? `document.documentElement.classList.add('motion-ready');` : "";
  return `${readinessSnippet}document.addEventListener('DOMContentLoaded', function () {${revealSnippet}${toggleSnippet}${navSnippet}});`;
}
