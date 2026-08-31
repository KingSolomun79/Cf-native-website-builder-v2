import { text, sanitizeIdentifier } from "../sanitize";
import type { SectionProps } from "./types";

export function renderSection(props: SectionProps): string {
  const variant = props.variant ?? "default";
  const kind = sanitizeIdentifier(props.kind, "section");
  const cls = ["section", `section--${variant}`, `section--${kind}`].join(" ");
  const label = props.ariaLabel ? ` aria-label="${text(props.ariaLabel)}"` : "";
  return `<section class="${cls}"${label} data-section="${kind}">\n  <div class="section__inner">\n${props.innerHtml}\n  </div>\n</section>`;
}
