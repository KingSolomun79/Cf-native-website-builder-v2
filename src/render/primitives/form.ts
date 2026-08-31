import { text, sanitizeUrl } from "../sanitize";
import type { ContactFormProps } from "./types";

export function renderContactForm(props: ContactFormProps): string {
  const action = sanitizeUrl(props.action, "/api/contact");
  const fields = props.fields.length > 0 ? props.fields : defaultFields();
  const whatsappAttr = props.whatsappNumber ? ` data-whatsapp="${text(props.whatsappNumber)}"` : "";
  const submitLabel = text(props.submitLabel ?? "Send message");

  const fieldHtml = fields.map((f) => renderField(f)).join("\n");

  return `<form class="form" action="${action}" method="post"${whatsappAttr}>
  ${fieldHtml}
  <div class="form__actions"><button class="btn btn--primary" type="submit">${submitLabel}</button></div>
  <div class="form__status" role="status" aria-live="polite" hidden></div>
</form>`;
}

function defaultFields() {
  return [
    { name: "name", label: "Full name", type: "text" as const, required: true, autocomplete: "name" },
    { name: "email", label: "Email address", type: "email" as const, required: true, autocomplete: "email" },
    { name: "phone", label: "Phone number (optional)", type: "tel" as const, required: false, autocomplete: "tel" },
    { name: "message", label: "Message", type: "textarea" as const, required: true, autocomplete: undefined },
  ];
}

function renderField(f: { name: string; label: string; type: "text" | "email" | "tel" | "textarea"; required?: boolean; autocomplete?: string }): string {
  const id = `field-${f.name}`;
  const label = text(f.label);
  const name = text(f.name);
  const required = f.required ? " required aria-required=\"true\"" : "";
  const autocomplete = f.autocomplete ? ` autocomplete="${text(f.autocomplete)}"` : "";

  if (f.type === "textarea") {
    return `<div class="form__field"><label class="form__label" for="${id}">${label}</label><textarea class="form__input" id="${id}" name="${name}" rows="5"${required}></textarea></div>`;
  }
  return `<div class="form__field"><label class="form__label" for="${id}">${label}</label><input class="form__input" id="${id}" name="${name}" type="${f.type}"${required}${autocomplete}></div>`;
}
