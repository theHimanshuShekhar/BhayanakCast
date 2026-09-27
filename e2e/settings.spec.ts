import { type APIRequestContext, expect, test } from "@playwright/test";
import { signIn } from "./auth";

/** The server-rendered `<html>` start tag of home: what the browser paints first. */
async function initialHtmlTag(request: APIRequestContext): Promise<string> {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  return (await response.text()).match(/<html[^>]*>/)?.[0] ?? "";
}

const isDark = (tag: string) => /\bclass="[^"]*\bdark\b/.test(tag);
const accentOf = (tag: string) => tag.match(/--accent-h:\s*(\d+)/)?.[1];

test("theme and accent follow the user to a fresh browser with no flash", async ({
  page,
  context,
  browser,
}) => {
  const username = "theme.mover";
  await signIn(context, { username });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await page.getByRole("button", { name: "Light mode" }).click();
  await page.getByRole("button", { name: "Accent · violet" }).click();
  await expect(page.getByRole("button", { name: "Accent · cyan" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

  // A fresh context has no localStorage or theme cookie: only the account knows the settings.
  const fresh = await browser.newContext();
  try {
    await signIn(fresh, { username });
    // The save is debounced, so give it a moment to land.
    await expect
      .poll(async () => {
        const tag = await initialHtmlTag(fresh.request);
        return { dark: isDark(tag), accent: accentOf(tag) };
      })
      .toEqual({ dark: false, accent: "190" });

    const freshPage = await fresh.newPage();
    await freshPage.goto("/");
    await expect(freshPage.locator("html")).not.toHaveClass(/\bdark\b/);
    await expect(freshPage.getByRole("button", { name: "Accent · cyan" })).toBeVisible();
  } finally {
    await fresh.close();
  }
});

test("a visitor's theme comes from the cookie mirror on first paint", async ({ context }) => {
  const initial = await initialHtmlTag(context.request);
  expect({ dark: isDark(initial), accent: accentOf(initial) }).toEqual({
    dark: true,
    accent: "265",
  });

  const baseURL = test.info().project.use.baseURL ?? "";
  await context.addCookies([{ name: "bc_theme", value: "light-30", url: baseURL }]);
  const mirrored = await initialHtmlTag(context.request);
  expect({ dark: isDark(mirrored), accent: accentOf(mirrored) }).toEqual({
    dark: false,
    accent: "30",
  });
});

test("a visitor's settings stay in the browser across reloads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await expect(page.getByRole("button", { name: "Dark mode" })).toBeVisible();
});
