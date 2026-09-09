// EXPERIMENT Phase 1 — human-inspection renderer. Loads the MIRRORED frozen
// candidate (as downloaded from the live preview URL), scrolls through each
// page like a user so the IntersectionObserver reveals fire, then captures
// full-page screenshots at desktop (1440) and mobile (390) viewports.
import { chromium } from "playwright";

const BUNDLE = ".tmp-exp-phase1/site";

const pages = ["index", "about", "services", "contact"];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch();
for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  for (const pageName of pages) {
    await page.goto(`file://${process.cwd().replace(/\\/g, "/")}/${BUNDLE}/${pageName}.html`);
    await page.waitForLoadState("load");
    await page.waitForTimeout(600);
    // Scroll through the whole document like a reader so every .reveal fires.
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.7;
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 260));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 500));
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `.tmp-exp-phase1/render-${pageName === "index" ? "home" : pageName}-${vp.name}.png`, fullPage: true });
    console.log(`render-${pageName}-${vp.name}.png`);
  }
  await context.close();
}
await browser.close();
