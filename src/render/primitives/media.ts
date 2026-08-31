import { text, sanitizeUrl } from "../sanitize";
import type { MediaProps } from "./types";

export function renderMedia(props: MediaProps): string {
  if (!props.src) return "";
  const ratio = props.ratio ?? "16/9";
  const loading = props.loading ?? "lazy";
  const alt = text(props.alt);
  const src = sanitizeUrl(props.src, "");
  if (src === "") return "";
  return `<figure class="media media--${ratio.replace("/", "x")}"><img src="${src}" alt="${alt}" loading="${loading}"></figure>`;
}
