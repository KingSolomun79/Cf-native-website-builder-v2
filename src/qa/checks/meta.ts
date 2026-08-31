import type { SiteSpecPage } from "../../types";

export function checkMeta(html: string, pageSlug: string, pageSpec?: SiteSpecPage): "pass" | "fail" {
  if (!html.includes("<title>") || !html.includes("</title>")) {
    return "fail";
  }

  const metaDescMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
  if (!metaDescMatch) {
    return "fail";
  }

  if (!html.includes('rel="canonical"')) {
    return "fail";
  }

  const h1Matches = html.match(/<h1[^>]*>/g);
  if (!h1Matches || h1Matches.length !== 1) {
    return "fail";
  }

  if (!html.includes('<html lang=')) {
    return "fail";
  }

  return "pass";
}
