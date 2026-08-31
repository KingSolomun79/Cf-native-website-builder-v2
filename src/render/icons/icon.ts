// Inline SVG icon renderer (Phase 16.6).
//
// Emits a single, self-contained inline <svg> with consistent 24×24 geometry,
// stroke-width, and currentColor inheritance. No <use>, no href, no external
// request — the icon is fully described by the vendored inner markup.
//
// Accessibility (WCAG):
//   - Decorative icons (the default for in-card icons) are hidden from assistive
//     tech via aria-hidden="true" focusable="false".
//   - Meaningful standalone icons expose role="img" and an accessible label.

import { getLucideIcon } from "./registry";
import { text, sanitizeIdentifier } from "../sanitize";

export interface RenderIconOptions {
  name: string;
  // Decorative icons are hidden from assistive tech. Meaningful icons expose
  // role="img" + aria-label (requires `title`).
  decorative?: boolean;
  title?: string | null;
  // CSS class hook for sizing/alignment. Defaults to "icon".
  className?: string;
}

export function renderIcon(options: RenderIconOptions): string {
  const { name, decorative = true, title, className = "icon" } = options;
  const icon = getLucideIcon(name);
  if (!icon) return "";

  const cls = sanitizeIdentifier(className, "icon");
  const shared = `class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

  if (decorative || !title) {
    return `<svg ${shared} aria-hidden="true" focusable="false">${icon.inner}</svg>`;
  }

  const labelled = text(title);
  if (labelled === "") {
    return `<svg ${shared} aria-hidden="true" focusable="false">${icon.inner}</svg>`;
  }
  return `<svg ${shared} role="img" aria-label="${labelled}">${icon.inner}</svg>`;
}
