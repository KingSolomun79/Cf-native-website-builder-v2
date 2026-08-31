export function checkLayout(html: string, pageSlug: string): "pass" | "fail" {
  if (!html.includes("<header") && !html.includes("<nav")) {
    return "fail";
  }

  if (!html.includes("<footer")) {
    return "fail";
  }

  return "pass";
}
