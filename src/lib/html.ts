export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildDoctype(): string {
  return "<!DOCTYPE html>";
}

export function buildHead(params: {
  title: string;
  metaDescription: string;
  canonicalUrl: string;
  ogImage?: string;
  cssVars: Record<string, string>;
  googleFonts: string[];
  framework?: "tailwind" | "bootstrap" | "none";
  jsonLd?: object;
}): string {
  const fontLink = params.googleFonts.length > 0
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=${params.googleFonts.join("&family=")}&display=swap" rel="stylesheet">`
    : "";

  const varsString = Object.entries(params.cssVars)
    .map(([k, v]) => `${k}: ${v};`)
    .join("\n    ");

  const jsonLdBlock = params.jsonLd
    ? `\n    <script type="application/ld+json">${JSON.stringify(params.jsonLd)}</script>`
    : "";

  const frameworkBlock = params.framework === "tailwind"
    ? `
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              background: "var(--background)",
              foreground: "var(--foreground)",
              muted: "var(--muted)",
              border: "var(--border)",
              "border-light": "var(--border-light)"
            },
            fontFamily: {
              serif: [${JSON.stringify(params.cssVars["--font-display"] ?? "Georgia, serif")}],
              body: [${JSON.stringify(params.cssVars["--font-body"] ?? "Georgia, serif")}],
              mono: [${JSON.stringify(params.cssVars["--font-mono"] ?? "monospace")}]
            }
          }
        }
      };
    </script>
    <script src="https://cdn.tailwindcss.com"></script>`
    : "";

  return `    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(params.title)}</title>
    <meta name="description" content="${escapeHtml(params.metaDescription)}">
    <link rel="canonical" href="${escapeHtml(params.canonicalUrl)}">
    <meta property="og:title" content="${escapeHtml(params.title)}">
    <meta property="og:description" content="${escapeHtml(params.metaDescription)}">
    <meta property="og:type" content="website">
    ${params.ogImage ? `<meta property="og:image" content="${escapeHtml(params.ogImage)}">` : ""}
    ${fontLink}
    ${frameworkBlock}
    <link rel="stylesheet" href="/assets/styles.css">
    <style>
      :root {
    ${varsString}
      }
    </style>${jsonLdBlock}`;
}
