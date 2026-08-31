import { text } from "../sanitize";
import { renderIcon } from "../icons";
import { iconNameForIntent } from "../icons/intent-map";
import type { CardProps } from "./types";

export function renderCard(props: CardProps): string {
  const title = text(props.title);
  const body = text(props.body);
  if (title === "" && body === "") return "";

  let iconHtml = "";
  const iconName = props.iconIntent ? iconNameForIntent(props.iconIntent) : null;
  if (iconName) {
    iconHtml = `<span class="card__icon">${renderIcon({ name: iconName, decorative: true })}</span>`;
  } else if (props.iconLabel) {
    iconHtml = `<span class="card__icon" aria-hidden="true">${text(props.iconLabel)}</span>`;
  }

  const titleHtml = title ? `<h3 class="card__title">${title}</h3>` : "";
  const bodyHtml = body ? `<p class="card__body">${body}</p>` : "";

  return `<article class="card">${iconHtml}${titleHtml}${bodyHtml}</article>`;
}
