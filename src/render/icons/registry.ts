// Approved Lucide icon allowlist — vendored at build time (Phase 16.6).
//
// SVG inner markup sourced from lucide-static (ISC License). Only these icons
// may be emitted by the renderer; an unknown intent omits the icon rather than
// resolving to an arbitrary glyph. No client-side icon runtime, CDN, icon font,
// or remote SVG fetch is introduced — every emitted icon is an inline <svg>
// whose inner markup is fixed here at build time.

export const LUCIDE_LICENSE = "lucide-static v0.487.0 (ISC License)";

export const LUCIDE_NOTICE = `Lucide v0.487.0

ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

export interface LucideIcon {
  name: string;
  inner: string;
}

// Each value is the raw inner markup of the 24×24 Lucide icon. The renderer
// wrapper supplies fill="none", stroke="currentColor", stroke-width="2", and
// round caps/joins, so those presentation attributes are NOT repeated per icon.
export const LUCIDE_ICONS: Record<string, LucideIcon> = {
  "graduation-cap": {
    name: "graduation-cap",
    inner: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/>\n<path d="M22 10v6"/>\n<path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  },
  "heart-pulse": {
    name: "heart-pulse",
    inner: '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>\n<path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  },
  users: {
    name: "users",
    inner: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>\n<circle cx="9" cy="7" r="4"/>\n<path d="M22 21v-2a4 4 0 0 0-3-3.87"/>\n<path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  },
  "map-pin": {
    name: "map-pin",
    inner: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>\n<circle cx="12" cy="10" r="3"/>',
  },
  mail: {
    name: "mail",
    inner: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/>\n<rect x="2" y="4" width="20" height="16" rx="2"/>',
  },
  "shield-check": {
    name: "shield-check",
    inner: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>\n<path d="m9 12 2 2 4-4"/>',
  },
  "trending-up": {
    name: "trending-up",
    inner: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>\n<polyline points="16 7 22 7 22 13"/>',
  },
  "life-buoy": {
    name: "life-buoy",
    inner: '<circle cx="12" cy="12" r="10"/>\n<path d="m4.93 4.93 4.24 4.24"/>\n<path d="m14.83 9.17 4.24-4.24"/>\n<path d="m14.83 14.83 4.24 4.24"/>\n<path d="m9.17 14.83-4.24 4.24"/>\n<circle cx="12" cy="12" r="4"/>',
  },
  accessibility: {
    name: "accessibility",
    inner: '<circle cx="16" cy="4" r="1"/>\n<path d="m18 19 1-7-6 1"/>\n<path d="m5 8 3-3 5.5 3-2.36 3.5"/>\n<path d="M4.24 14.5a5 5 0 0 0 6.88 6"/>\n<path d="M13.76 17.5a5 5 0 0 0-6.88-6"/>',
  },
};

export const LUCIDE_ICON_NAMES: readonly string[] = Object.freeze(Object.keys(LUCIDE_ICONS));

export function isAllowedIcon(name: unknown): name is string {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(LUCIDE_ICONS, name);
}

export function getLucideIcon(name: unknown): LucideIcon | null {
  return isAllowedIcon(name) ? LUCIDE_ICONS[name] : null;
}
