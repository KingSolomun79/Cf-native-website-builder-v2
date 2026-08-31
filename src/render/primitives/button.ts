import { text, sanitizeUrl } from "../sanitize";
import type { ButtonProps, ButtonVariant } from "./types";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn btn--primary",
  secondary: "btn btn--secondary",
  ghost: "btn btn--ghost",
};

export function renderButton(props: ButtonProps): string {
  const label = text(props.label);
  if (label === "") return "";
  const variant: ButtonVariant = props.variant ?? "primary";
  const cls = VARIANT_CLASS[variant] ?? VARIANT_CLASS.primary;
  const aria = props.ariaLabel ? ` aria-label="${text(props.ariaLabel)}"` : "";

  if (props.href) {
    const href = sanitizeUrl(props.href);
    return `<a class="${cls}" href="${href}"${aria}>${label}</a>`;
  }

  const type = props.type === "submit" ? "submit" : "button";
  return `<button class="${cls}" type="${type}"${aria}>${label}</button>`;
}
