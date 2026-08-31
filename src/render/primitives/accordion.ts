import { text } from "../sanitize";
import type { AccordionItem } from "./types";

export function renderAccordion(items: AccordionItem[]): string {
  const valid = items.filter((i) => i.summary.trim() !== "");
  if (valid.length === 0) return "";

  const panels = valid.map((item, idx) => {
    const summary = text(item.summary);
    const detail = text(item.detail);
    const panelId = `acc-panel-${idx}`;
    return `<div class="accordion__item">
  <h3 class="accordion__heading">
    <button class="accordion__trigger" type="button" aria-expanded="false" aria-controls="${panelId}">${summary}</button>
  </h3>
  <div class="accordion__panel" id="${panelId}" role="region" hidden>${detail}</div>
</div>`;
  }).join("\n");

  return `<div class="accordion">${panels}</div>`;
}
