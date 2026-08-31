import { describe, expect, it } from "vitest";
import { validateBundle } from "../src/lib/bundle-validation";
import type { StyleTokens } from "../src/types";

const tokens: StyleTokens = {
  cssVars: {},
  googleFonts: [],
  framework: "none",
};

function makeBundle(injectedMarkup: string): Map<string, string | ArrayBuffer> {
  const page = `<html><head><link rel="stylesheet" href="/assets/styles.css"></head><body><h1>Title</h1><section>${injectedMarkup}</section><section>Two</section><section>Three</section><section>Four</section><section>Five</section><script src="/assets/app.js" defer></script></body></html>`;
  return new Map([
    ["index.html", page],
    ["services/index.html", page],
    ["about/index.html", page],
    ["contact/index.html", page.replace("<section>", '<form action="/api/contact"></form><section>')],
    ["assets/styles.css", "body{}"],
    ["assets/app.js", ""],
  ]);
}

describe("generated bundle security", () => {
  it.each([
    '<img src="x" onerror="alert(1)">',
    '<a href="javascript:alert(1)">Click</a>',
    '<iframe src="https://example.com"></iframe>',
  ])("rejects executable markup: %s", (markup) => {
    const result = validateBundle(makeBundle(markup), tokens);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.issue.includes("Generated HTML contains"))).toBe(true);
  });
});
