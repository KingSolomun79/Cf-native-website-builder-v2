// TEMPORARY diagnostic (issue #30 QA capture debugging) — remote-dev only.
import { playwrightAdapter } from "./src/lib/browser-adapter";
import { withBrowser } from "./src/lib/browser-lifecycle";

export default {
  async fetch(request: Request, env: { BROWSER: unknown }): Promise<Response> {
    const url = new URL(request.url);
    const target = url.searchParams.get("url") ?? "https://example.com/";
    try {
      const session = await playwrightAdapter.launch(env);
      return await withBrowser(session, async (browser) => {
        const page = await browser.newPage({ viewport: { name: "desktop", width: 1440, height: 900 }, reducedMotion: false });
        try {
          const diagnostics = await page.goto(target, { timeoutMs: 45_000, waitUntil: "networkidle" });
          await page.waitForImages(10_000);
          const layout = await page.extractLayout();
          const shot = await page.screenshot({ fullPage: true });
          return Response.json({
            ok: true,
            url: target,
            status: diagnostics.httpStatus,
            sections: layout.sections.length,
            images: layout.images.length,
            screenshotBytes: shot.byteLength,
            failed: diagnostics.failedResources.slice(0, 5),
          });
        } finally {
          await page.close();
        }
      });
    } catch (error) {
      return Response.json({ ok: false, url: target, error: `${(error as Error).name}: ${(error as Error).message}`.slice(0, 400) }, { status: 200 });
    }
  },
};
