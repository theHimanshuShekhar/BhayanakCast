/**
 * `test` and `expect` for every spec: Playwright's, with pages that wait for React to hydrate
 * after each `goto` and `reload`. The server-rendered HTML is visible (and clickable) before
 * React takes over, and input typed or clicks landing before then are lost, which flakes
 * under load. The root route marks `<html data-hydrated>` once hydrated (src/routes/__root.tsx).
 *
 * The `page` fixture is patched already; wrap pages from other contexts with `newPage`.
 */
import { type BrowserContext, test as base, type Page } from "@playwright/test";

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

export const test = base.extend({
  page: async ({ page }, use) => {
    await use(hydrating(page));
  },
});
