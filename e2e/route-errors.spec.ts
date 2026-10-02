import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createUser, uniqueUsername } from "./profiles";

// A loader that fails shows the styled error, not the router's raw one (#77). Unit tests cover
// the component (src/components/route-error.test.tsx); this is the real router and server.

/** Make the server-function calls that mention `userId` fail with `status` until `restore()`. */
async function failProfileReads(page: Page, userId: string, status: number, body: string) {
  let failing = true;
  await page.route("**/_serverFn/**", (route) => {
    const url = decodeURIComponent(route.request().url());
    if (failing && url.includes(userId)) {
      return route.fulfill({ status, contentType: "text/plain", body });
    }
    return route.continue();
  });
  return () => {
    failing = false;
  };
}

/** A profile with a link to another one, to navigate client-side (where `page.route` reaches). */
async function profileWithFriend(
  browser: Parameters<typeof createUser>[0],
  page: Page,
): Promise<{ friend: Awaited<ReturnType<typeof createUser>> }> {
  const friend = await createUser(browser, uniqueUsername("route.friend"));
  const star = await createUser(browser, uniqueUsername("route.star"), {
    cotime: [{ discordId: friend.discordId, secondsTogether: 3600 }],
  });
  await page.goto(`/profile/${star.id}`);
  await expect(page.getByRole("link", { name: friend.username })).toBeVisible();
  return { friend };
}

test("a loader the server fails shows the styled error, no stack, and a way home", async ({
  page,
}) => {
  // A user id over the 64-character limit fails the server function's validation.
  await page.goto(`/profile/${"x".repeat(65)}`);
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  const alert = page.getByRole("alert");
  await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(alert).not.toContainText(/\bat .*\(|node_modules|\.tsx?:\d+/);

  // Retry runs the loader again: still failing here, and still the styled error.
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();

  await alert.getByRole("link", { name: "Back to rooms" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a failed profile load shows the error and Retry loads the page once the server recovers", async ({
  page,
  browser,
}) => {
  const { friend } = await profileWithFriend(browser, page);
  const restore = await failProfileReads(page, friend.id, 500, "database unavailable");

  await page.getByRole("link", { name: friend.username }).click();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(page.getByRole("alert")).not.toContainText("Too many requests");

  restore();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { level: 1, name: friend.username })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a rate-limited profile load says to wait, and Retry works", async ({ page, browser }) => {
  const { friend } = await profileWithFriend(browser, page);
  const restore = await failProfileReads(
    page,
    friend.id,
    429,
    "Too many requests. Wait a moment and try again.",
  );

  await page.getByRole("link", { name: friend.username }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Too many requests. Wait a moment and try again.",
  );
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);

  restore();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { level: 1, name: friend.username })).toBeVisible();
});

test("an unknown URL shows the styled not-found page", async ({ page }) => {
  await page.goto("/no/such/page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to rooms" })).toBeVisible();
});
