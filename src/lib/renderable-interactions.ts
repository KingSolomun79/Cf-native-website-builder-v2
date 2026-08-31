export const RENDERABLE_INTERACTION_PAIRS = [
  { trigger: "hover", selector: ".btn" },
  { trigger: "hover", selector: ".card" },
  { trigger: "hover", selector: "nav a" },
  { trigger: "focus", selector: ".btn" },
  { trigger: "focus", selector: "nav a" },
  { trigger: "focus", selector: "a" },
  { trigger: "focus", selector: ".nav__toggle" },
  { trigger: "active", selector: ".btn" },
  { trigger: "active", selector: "nav a" },
  { trigger: "scroll-reveal", selector: "[data-reveal]" },
] as const;

export type RenderableInteractionPair = typeof RENDERABLE_INTERACTION_PAIRS[number];

export function isRenderableInteraction(trigger: string, selector: string): boolean {
  return RENDERABLE_INTERACTION_PAIRS.some((entry) => entry.trigger === trigger && entry.selector === selector);
}

export function renderableInteractionPairsDescription(): string {
  return RENDERABLE_INTERACTION_PAIRS.map((entry) => `${entry.trigger} → ${entry.selector}`).join("; ");
}
