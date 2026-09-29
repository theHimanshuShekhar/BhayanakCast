/**
 * `test` and `expect` for every spec: Playwright's, with pages that wait for React to hydrate
 * after each `goto` and `reload`. The server-rendered HTML is visible (and clickable) before
 * React takes over, and input typed or clicks landing before then are lost, which flakes
 * under load. The root route marks `<html data-hydrated>` once hydrated (src/routes/__root.tsx).
 *
 * The `page` fixture is patched already; wrap pages from other contexts with `newPage`.
 *
 * Screen sharing: Chromium's fake media UI captures a fake screen (with tab audio), but
 * headless Firefox has no screen to capture, so every Firefox context shares a stand-in instead
 * (`fakeScreenCapture`: an animated canvas plus a tone).
 */
import { type Browser, type BrowserContext, test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

/** Wait until React has hydrated the current document. */
export async function waitForHydration(page: Page): Promise<void> {
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
}

const patched = new WeakSet<Page>();

/** Make `page.goto` and `page.reload` also wait for hydration. Returns the same page. */
export function hydrating(page: Page): Page {
  if (patched.has(page)) return page;
  patched.add(page);
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (...args) => {
    const response = await goto(...args);
    await waitForHydration(page);
    return response;
  };
  page.reload = async (...args) => {
    const response = await reload(...args);
    await waitForHydration(page);
    return response;
  };
  return page;
}

/** A new page in `context` whose navigations wait for hydration. */
export async function newPage(context: BrowserContext): Promise<Page> {
  return hydrating(await context.newPage());
}

/** In every page of `context`, `getDisplayMedia` shares an animated canvas and a tone. */
async function fakeScreenCapture(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (typeof MediaDevices === "undefined") return;
    MediaDevices.prototype.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const g = canvas.getContext("2d");
      let frame = 0;
      const draw = () => {
        if (!g) return;
        g.fillStyle = `hsl(${(frame++ * 7) % 360} 60% 45%)`;
        g.fillRect(0, 0, canvas.width, canvas.height);
      };
      draw();
      setInterval(draw, 66);
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      const out = audio.createMediaStreamDestination();
      tone.connect(out);
      tone.start();
      return new MediaStream([
        ...canvas.captureStream(15).getVideoTracks(),
        ...out.stream.getAudioTracks(),
      ]);
    };
  });
}

const withScreenCapture = new WeakSet<Browser>();

export const test = base.extend<object, { browser: Browser }>({
  browser: [
    async ({ browser, browserName }, use) => {
      if (browserName === "firefox" && !withScreenCapture.has(browser)) {
        withScreenCapture.add(browser);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (...args) => {
          const context = await newContext(...args);
          await fakeScreenCapture(context);
          return context;
        };
      }
      await use(browser);
    },
    { scope: "worker" },
  ],
  page: async ({ page }, use) => {
    await use(hydrating(page));
  },
});
