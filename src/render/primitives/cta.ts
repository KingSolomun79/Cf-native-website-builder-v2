import { text } from "../sanitize";
import { renderButton } from "./button";
import type { CtaProps } from "./types";

export function renderCta(props: CtaProps): string {
  const heading = text(props.heading);
  if (heading === "") return "";
  const body = props.body ? `<p class="cta__body">${text(props.body)}</p>` : "";
  const button = props.button ? renderButton(props.button) : "";
  return `<div class="cta"><div class="cta__inner"><h2 class="cta__heading">${heading}</h2>${body}${button}</div></div>`;
}
