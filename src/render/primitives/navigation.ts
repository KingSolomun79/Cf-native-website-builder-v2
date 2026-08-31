import { text, sanitizeUrl } from "../sanitize";
import type { NavProps } from "./types";

export function renderNav(props: NavProps): string {
  const brand = text(props.brand);
  const logo = props.logoUrl
    ? `<img class="nav__logo" src="${sanitizeUrl(props.logoUrl)}" alt="${brand} logo" height="40">`
    : "";
  const brandHtml = `<a class="nav__brand" href="/">${logo}${brand ? `<span class="nav__name">${brand}</span>` : ""}</a>`;

  const links = props.items.map((item) => {
    const href = sanitizeUrl(item.href);
    const isCurrent = href === props.currentSlug || (props.currentSlug === "/" && href === "/");
    const cls = isCurrent ? "nav__link nav__link--current" : "nav__link";
    const aria = isCurrent ? ' aria-current="page"' : "";
    return `<a class="${cls}" href="${href}"${aria}>${text(item.label)}</a>`;
  }).join("\n");

  return `<header class="nav" role="banner">
  <div class="nav__bar">
    ${brandHtml}
    <button class="nav__toggle" type="button" aria-expanded="false" aria-controls="nav-menu" aria-label="Toggle navigation menu">
      <span class="nav__toggle-icon" aria-hidden="true"></span>
    </button>
  </div>
  <nav class="nav__menu" id="nav-menu" aria-label="Primary" data-nav-menu>
    ${links}
  </nav>
</header>`;
}
