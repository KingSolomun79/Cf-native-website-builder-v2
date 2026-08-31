// Maps a validated DesignBlueprint into deterministic CSS custom properties.
//
// Every blueprint string is sanitized before it reaches a CSS declaration, so a
// model value can never break out of a property value. Color roles drive the
// semantic token set the primitives consume (--background, --foreground, etc.).
// Foreground-on-color tokens are derived from luminance for legible contrast.

import type { DesignBlueprintV2 } from "../lib/blueprint-schema-v2";
import {
  sanitizeColor,
  sanitizeFontName,
  sanitizeFontWeight,
  sanitizeLength,
  sanitizeNumber,
  sanitizeBreakpoint,
} from "./sanitize";
import type { StyleTokens } from "../types";

export interface BlueprintTokens {
  cssVars: Record<string, string>;
  googleFonts: string[];
  framework: "none";
}

type ColorRole = DesignBlueprintV2["colors"]["roles"][number];

const FALLBACK_COLORS: Record<string, string> = {
  background: "#ffffff",
  text: "#1a1a1a",
  primary: "#2563eb",
  accent: "#0ea5e9",
  surface: "#f8fafc",
  muted: "#64748b",
  border: "#e2e8f0",
};

function roleValue(roles: ColorRole[], role: string, fallback: string): string {
  const found = roles.find((r) => r.role === role);
  return sanitizeColor(found?.value, fallback);
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function parseColor(value: string): RgbColor | null {
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const full = hex[1].length === 3 ? [...hex[1]].map((part) => part + part).join("") : hex[1];
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  const hsl = value.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (!hsl) return null;
  const h = ((Number(hsl[1]) % 360) + 360) % 360 / 360;
  const s = Number(hsl[2]) / 100;
  const l = Number(hsl[3]) / 100;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset: number) => {
    let t = h + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: channel(1 / 3) * 255, g: channel(0) * 255, b: channel(-1 / 3) * 255 };
}

function relativeLuminance(value: string): number | null {
  const parsed = parseColor(value);
  if (!parsed) return null;
  const r = parsed.r / 255;
  const g = parsed.g / 255;
  const b = parsed.b / 255;
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(first: string, second: string): number | null {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function onColor(color: string): string {
  const dark = contrastRatio(color, "#000000") ?? 0;
  const light = contrastRatio(color, "#ffffff") ?? 0;
  return dark >= light ? "#000000" : "#ffffff";
}

function readableColor(preferred: string, background: string): string {
  const ratio = contrastRatio(preferred, background);
  return ratio !== null && ratio >= 4.6 ? preferred : onColor(background);
}

function googleFontSlug(family: string): string | null {
  if (!family || /^(arial|helvetica|georgia|times new roman|courier new|serif|sans-serif|monospace|system-ui|verdana|tahoma|trebuchet ms|impact|comic sans ms)$/i.test(family)) {
    return null;
  }
  return family.split(",")[0].trim().replace(/\s+/g, "+");
}

function sanitizeSpacing(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) return fallback;
  const sanitized = parts.map((part) => sanitizeLength(part, ""));
  return sanitized.every(Boolean) ? sanitized.join(" ") : fallback;
}

export function designBlueprintToTokens(design: DesignBlueprintV2): BlueprintTokens {
  const colorRoles = design.colors.roles;

  const background = roleValue(colorRoles, "background", FALLBACK_COLORS.background);
  const requestedForeground = roleValue(colorRoles, "text", FALLBACK_COLORS.text);
  const primary = roleValue(colorRoles, "primary", FALLBACK_COLORS.primary);
  const accent = roleValue(colorRoles, "accent", FALLBACK_COLORS.accent);
  const surface = roleValue(colorRoles, "surface", FALLBACK_COLORS.surface);
  const requestedMuted = roleValue(colorRoles, "muted", FALLBACK_COLORS.muted);
  const border = roleValue(colorRoles, "border", FALLBACK_COLORS.border);
  const foreground = readableColor(requestedForeground, background);
  const surfaceForeground = onColor(surface);
  const muted = readableColor(requestedMuted, surface);

  const bodyType = design.typography.body;
  const headingType = design.typography.headings[0] ?? bodyType;

  const fontBody = sanitizeFontName(bodyType.fontFamily, "system-ui");
  const fontHeading = sanitizeFontName(headingType.fontFamily, fontBody);
  const fontBodyWeight = sanitizeFontWeight(bodyType.fontWeight, "400");
  const fontHeadingWeight = sanitizeFontWeight(headingType.fontWeight, "700");
  const fontBodySize = sanitizeLength(bodyType.fontSize, "1rem");
  const fontHeadingSize = sanitizeLength(headingType.fontSize, "2.25rem");
  const bodyLineHeight = sanitizeLength(bodyType.lineHeight, "1.6");
  const headingLineHeight = sanitizeLength(headingType.lineHeight, "1.15");

  const typeScale = sanitizeNumber(parseFloatNumber(design.typography.scale), 1, 2, 1.25);
  const sectionPadding = sanitizeSpacing(design.spacing.sectionPadding, "5rem 1.5rem");

  const radiusCard = "0.75rem";
  const radiusButton = "0.5rem";
  const radiusInput = "0.375rem";

  const cssVars: Record<string, string> = {
    "--background": background,
    "--foreground": foreground,
    "--primary": primary,
    "--primary-foreground": onColor(primary),
    "--primary-text": readableColor(primary, background),
    "--primary-surface-text": readableColor(primary, surface),
    "--accent": accent,
    "--accent-foreground": onColor(accent),
    "--surface": surface,
    "--surface-foreground": surfaceForeground,
    "--muted": muted,
    "--border": border,
    "--font-body": `${fontBody}, system-ui, sans-serif`,
    "--font-heading": `${fontHeading}, system-ui, sans-serif`,
    "--font-body-weight": fontBodyWeight,
    "--font-heading-weight": fontHeadingWeight,
    "--font-body-size": fontBodySize,
    "--font-heading-size": fontHeadingSize,
    "--line-height-body": bodyLineHeight,
    "--line-height-heading": headingLineHeight,
    "--type-scale": String(typeScale),
    "--space-section": sectionPadding,
    "--radius-card": radiusCard,
    "--radius-button": radiusButton,
    "--radius-input": radiusInput,
  };

  const breakpoints = design.responsive.breakpoints
    .map((b) => sanitizeBreakpoint(b, 0))
    .filter((b) => b > 0)
    .sort((a, b) => a - b);
  if (breakpoints.length > 0) cssVars["--bp"] = `${breakpoints[0]}px`;

  const googleFonts = [googleFontSlug(fontBody), googleFontSlug(fontHeading)]
    .filter((f): f is string => f !== null);
  const deduped = [...new Set(googleFonts)];

  return { cssVars, googleFonts: deduped, framework: "none" };
}

function parseFloatNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 1.25;
}

export function blueprintTokensToStyleTokens(tokens: BlueprintTokens): StyleTokens {
  return { cssVars: tokens.cssVars, googleFonts: tokens.googleFonts, framework: "none" };
}
