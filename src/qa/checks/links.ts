export function checkLinks(html: string, pageSlug: string, baseUrl: string, validSlugs: string[]): "pass" | "fail" {
  const hrefRegex = /href="([^"]+)"/g;
  let match: RegExpExecArray | null;
  const internalSlugs = new Set(validSlugs);

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];

    if (href.startsWith("/") && !href.startsWith("/api/") && !href.startsWith("/assets/")) {
      const cleanSlug = href.split("?")[0].split("#")[0];
      if (!internalSlugs.has(cleanSlug) && cleanSlug !== "/") {
        return "fail";
      }
    }

    if (href.startsWith("http")) {
      try {
        new URL(href);
      } catch {
        return "fail";
      }
    }
  }

  return "pass";
}
