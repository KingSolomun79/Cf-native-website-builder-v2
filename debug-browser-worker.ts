// TEMPORARY diagnostic (issue #30 QA evidence debugging) — remote-dev only.
import { playwrightAdapter } from "./src/lib/browser-adapter";
import { withBrowser } from "./src/lib/browser-lifecycle";

const SPEC = [
  { page: "home", width: 1440 },
  { page: "home", width: 768 },
  { page: "home", width: 390 },
  { page: "about", width: 1440 },
  { page: "about", width: 390 },
  { page: "services", width: 1440 },
  { page: "services", width: 390 },
  { page: "contact", width: 1440 },
  { page: "contact", width: 390 },
];

export default {
  async fetch(request: Request, env: { BROWSER: unknown }): Promise<Response> {
    const url = new URL(request.url);
    const base = (url.searchParams.get("url") ?? "https://example.com").replace(/\/$/, "");
    const limit = Number(url.searchParams.get("limit") ?? "9");
    const results: unknown[] = [];
    try {
      const session = await playwrightAdapter.launch(env);
      return await withBrowser(session, async (browser) => {
        for (const [index, entry] of SPEC.slice(0, limit).entries()) {
          const started = Date.now();
          try {
            const page = await browser.newPage({
              viewport: { name: entry.width <= 500 ? "mobile" : entry.width <= 900 ? "tablet" : "desktop", width: entry.width, height: 900 },
              reducedMotion: false,
            });
            const path = entry.page === "home" ? "" : entry.page;
            const diagnostics = await page.goto(`${base}/${path}`, { timeoutMs: 45_000, waitUntil: "networkidle" });
            await page.waitForImages(10_000);
            const layout = await page.extractLayout();
            const shot = await page.screenshot({ fullPage: true });
            await page.close();
            results.push({ i: index, page: entry.page, w: entry.width, ms: Date.now() - started, status: diagnostics.httpStatus, sections: layout.sections.length, bytes: shot.byteLength });
          } catch (error) {
            results.push({ i: index, page: entry.page, w: entry.width, ms: Date.now() - started, error: `${(error as Error).name}: ${(error as Error).message}`.slice(0, 250) });
          }
        }
        return Response.json({ ok: true, results });
      });
    } catch (error) {
      return Response.json({ ok: false, error: `${(error as Error).name}: ${(error as Error).message}`.slice(0, 400), results });
    }
  },
};
