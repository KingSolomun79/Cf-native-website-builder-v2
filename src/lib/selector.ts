// Stable, provably-unique evidence selectors for capture + interaction.
//
// Generic selectors (`nav a`, `img`, first class name) do not uniquely
// identify an element. Phase 16.R3 instead assigns a deterministic
// `data-cf-evidence-id` to each candidate element in the captured page state
// and acts through `[data-cf-evidence-id="..."]` selectors. Before any action,
// the caller asserts the selector resolves to exactly one element.

export const EVIDENCE_ID_ATTR = "data-cf-evidence-id";

export function evidenceIdSelector(evidenceId: string): string {
  return `[${EVIDENCE_ID_ATTR}="${evidenceId}"]`;
}

// Build a deterministic, human-readable evidence id from a stable description.
// The id encodes viewport + element kind + index so duplicates (e.g. two
// buttons) receive independent ids: mobile-button-0, mobile-button-1.
export function buildEvidenceId(parts: { viewport: string; kind: string; index: number }): string {
  const safeKind = parts.kind.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "element";
  const safeVp = parts.viewport.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vp";
  return `${safeVp}-${safeKind}-${parts.index}`;
}

export class SelectorNotUniqueError extends Error {
  readonly selector: string;
  readonly matchCount: number;
  constructor(selector: string, matchCount: number) {
    super(`Selector "${selector}" resolved to ${matchCount} elements; expected exactly one.`);
    this.name = "SelectorNotUniqueError";
    this.selector = selector;
    this.matchCount = matchCount;
  }
}

// Assert a selector resolves to exactly one element before acting on it.
export async function assertUnique(
  countMatches: (selector: string) => Promise<number>,
  selector: string
): Promise<void> {
  const count = await countMatches(selector);
  if (count !== 1) throw new SelectorNotUniqueError(selector, count);
}
