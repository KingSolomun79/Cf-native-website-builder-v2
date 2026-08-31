export function checkImages(html: string, pageSlug: string): "pass" | "fail" {
  const mainHtml = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
  const required: Record<string, number> = { "/": 3, "/services": 3, "/about": 1, "/contact": 1 };
  const mainImages = mainHtml.match(/<img\s[^>]*>/g) ?? [];
  if (mainImages.length < (required[pageSlug] ?? 1)) return "fail";
  const imgRegex = /<img\s[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(html)) !== null) {
    const tag = match[0];

    if (!tag.includes("alt=")) {
      return "fail";
    }

    const altMatch = tag.match(/alt="([^"]*)"/);
    if (altMatch && altMatch[1].trim() === "") {
      return "fail";
    }

    const srcMatch = tag.match(/src="([^"]+)"/);
    if (!srcMatch || !srcMatch[1].trim()) {
      return "fail";
    }
  }

  return "pass";
}
