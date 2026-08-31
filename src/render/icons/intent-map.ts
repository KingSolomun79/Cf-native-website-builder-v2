// Semantic icon-intent resolution (Phase 16.6).
//
// The design blueprint expresses icon intent semantically (education, health,
// community, ...). The renderer resolves an intent to a single approved Lucide
// icon name deterministically. Intent — not exact reference-site icon matching —
// drives icon selection, so two sites with the same intent render the same icon.

import type { DesignBlueprintV2 } from "../../lib/blueprint-schema-v2";
import { isAllowedIcon } from "./registry";

export const ALLOWED_INTENTS = Object.freeze([
  "education", "health", "community", "location", "contact",
  "security", "growth", "support", "accessibility",
] as const);

export type IconIntent = (typeof ALLOWED_INTENTS)[number];

export function isAllowedIntent(value: unknown): value is IconIntent {
  return typeof value === "string" && (ALLOWED_INTENTS as readonly string[]).includes(value);
}

// One canonical icon per intent. Intent is the contract; the icon name is an
// implementation detail owned here, so the catalog can evolve without touching
// the blueprint schema or the renderer call sites.
const INTENT_TO_ICON: Record<IconIntent, string> = {
  education: "graduation-cap",
  health: "heart-pulse",
  community: "users",
  location: "map-pin",
  contact: "mail",
  security: "shield-check",
  growth: "trending-up",
  support: "life-buoy",
  accessibility: "accessibility",
};

export function iconNameForIntent(intent: unknown): string | null {
  if (!isAllowedIntent(intent)) return null;
  const name = INTENT_TO_ICON[intent];
  return isAllowedIcon(name) ? name : null;
}

// Deterministic, content-grounded intent inference. Reads intake-derived card
// text only (never model output) and returns the first matching allowed intent.
const INTENT_KEYWORDS: Record<IconIntent, readonly RegExp[]> = {
  education: [/\b(educat\w*|learn\w*|courses?|train\w*|classes?|teach\w*|academ\w*|schools?|stud(?:y|ies|ying))\b/i],
  health: [/\b(health\w*|care|medical|clinics?|wellness|therapy|nursing|patients?|doctors?|hospitals?)\b/i],
  community: [/\b(community|communities|people|members?|customers?|clients?|families?|networks?|groups?)\b/i],
  location: [/\b(location|address|based in|situated|street|road|avenue|county|city|map)\b/i],
  contact: [/\b(contacts?|emails?|phones?|calls?|reach|enquir\w*|inquir\w*|messages?|whatsapp)\b/i],
  security: [/\b(secur\w*|safe\w*|protect\w*|trust\w*|insur\w*|guarantee\w*|complian\w*|privacy)\b/i],
  growth: [/\b(growth|grow\w*|results?|scal\w*|increase\w*|revenue|sales|marketing|strateg\w*)\b/i],
  support: [/\b(support\w*|help\w*|assist\w*|servic\w*|consult\w*|advice|guidance|onboard\w*)\b/i],
  accessibility: [/\b(accessib\w*|access|inclusiv\w*|disabilit\w*|wheelchairs?|a11y)\b/i],
};

export function inferIntentFromText(...parts: (string | null | undefined)[]): string | null {
  const text = parts.filter(Boolean).join(" ");
  if (!text) return null;
  for (const intent of ALLOWED_INTENTS) {
    if (INTENT_KEYWORDS[intent].some((re) => re.test(text))) return intent;
  }
  return null;
}

// The intents the blueprint declared for this site, deduped and order-preserved.
// Only declared intents are ever rendered — the site never gets icons it did not
// ask for, which keeps icon usage intentional rather than decorative noise.
export function declaredIntents(design: DesignBlueprintV2): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of design.icons.intents) {
    const intent = typeof entry?.intent === "string" ? entry.intent : "";
    if (isAllowedIntent(intent) && !seen.has(intent)) {
      seen.add(intent);
      out.push(intent);
    }
  }
  return out;
}
