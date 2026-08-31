// Deterministic sanitization for blueprint-derived values.
//
// The model controls every string in a DesignBlueprint / InteractionBlueprint.
// Before any of those strings can reach the generated HTML or CSS, it MUST pass
// through one of these guards. A value that does not match the expected shape is
// rejected and a documented fallback is used instead — the model can never emit
// arbitrary HTML, scripts, event handlers, or CSS into the generated site.

import { escapeHtml } from "../lib/html";

// Hex (#rgb / #rrggbb) or the css rgb()/rgba()/hsl()/hsla() functions with
// numeric/comma/space content only. No parentheses tricks, no semicolons, no
// quotes — impossible to break out of a CSS declaration value.
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FN_RE = /^(rgba?|hsla?)\(\s*[\d.%\s,/-]+\s*\)$/i;

export function sanitizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (COLOR_RE.test(v) || RGB_FN_RE.test(v)) return v;
  return fallback;
}

// A single font-family name (e.g. "Inter", "Playfair Display"). The whole
// string must consist only of word chars, spaces, dots, commas, and hyphens —
// any quote/brace/semicolon breaks out of a CSS value, so reject outright.
export function sanitizeFontName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (v.length === 0 || v.length > 64) return fallback;
  if (/^[\w .,-]+$/.test(v)) return v;
  return fallback;
}

// A CSS length / percentage: digits with an optional unit. Never allows letters
// outside the known unit set, so it cannot form a CSS property or function.
const LENGTH_RE = /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|pc|in|cm|mm|s|ms|deg)?$/;

export function sanitizeLength(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (LENGTH_RE.test(v)) return v;
  return fallback;
}

// A bare number (font weight, line-height ratio, scale multiplier).
export function sanitizeNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (Number.isFinite(n) && n >= min && n <= max) return n;
  return fallback;
}

// A font weight keyword/number.
export function sanitizeFontWeight(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (/^(normal|bold|lighter|bolder)$/.test(v)) return v;
  if (/^\d{3}$/.test(v)) return v;
  return fallback;
}

// A breakpoint: a positive integer px value.
export function sanitizeBreakpoint(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (Number.isInteger(n) && n >= 240 && n <= 4000) return n;
  return fallback;
}

// A slug-like identifier used as a CSS class suffix or data attribute. Only
// lowercase letters, digits, and hyphens.
export function sanitizeIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase();
  if (/^[a-z][a-z0-9-]{0,40}$/.test(v)) return v;
  return fallback;
}

// Text intended for human display. Always HTML-escaped on emission; this helper
// is exposed so callers do not reach for raw concatenation.
export function text(value: unknown): string {
  return escapeHtml(typeof value === "string" ? value : "");
}

// A URL: only allow http(s), relative, mailto, tel. Reject anything else so a
// model value can never produce a javascript:/data: link.
const SAFE_URL_RE = /^(https?:\/\/|mailto:|tel:|\/|#)/i;

export function sanitizeUrl(value: unknown, fallback = "#"): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (v === "") return fallback;
  if (v.startsWith("//")) return fallback;
  if (SAFE_URL_RE.test(v) && !/[\s<>"'`]/.test(v)) return v;
  return fallback;
}
