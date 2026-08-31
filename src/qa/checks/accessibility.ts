export function checkAccessibility(html: string, pageSlug: string): "pass" | "fail" {
  if (!html.includes('class="skip-link"')) {
    return "fail";
  }

  if (!html.includes('<html lang=')) {
    return "fail";
  }

  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) ?? [];
  for (const btn of buttons) {
    const textContent = btn.replace(/<button\b[^>]*>|<\/button>|<[^>]+>/gi, "").trim();
    if (!/\baria-label\s*=\s*["'][^"']+/.test(btn) && textContent.length === 0) {
      return "fail";
    }
  }

  const inputs = html.match(/<(?:input|textarea|select)\b[^>]*>/gi) ?? [];
  for (const input of inputs) {
    if (/\baria-label\s*=\s*["'][^"']+/.test(input)) continue;
    const id = input.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!id || !new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*["']${escapeRegExp(id)}["']`, "i").test(html)) {
      return "fail";
    }
  }

  return "pass";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
