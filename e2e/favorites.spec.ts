import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./auth";
import { createUser, uniqueUsername } from "./profiles";

/** The "favorite" badge beside the profile's username (not the button). */
const badge = (page: Page) =>
  page.getByRole("heading", { level: 1 }).locator("..").getByText("favorite", { exact: true });
const favoriteButton = (page: Page) => page.getByRole("button", { name: "favorite", exact: true });
const unfavoriteButton = (page: Page) => page.getByRole("button", { name: "unfavorite" });

/** Click, and wait for the toggle's server call (a POST) to finish. */
async function clickAndSave(page: Page, button: ReturnType<Page["getByRole"]>) {
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.ok());
  await button.click();
  await saved;
}

test("a favorite persists across reloads until unfavorited", async ({ page, context, browser }) => {
  const star = await createUser(browser, uniqueUsername("fave.star"));
  await signIn(context, { username: uniqueUsername("fave.fan") });

  await page.goto(`/profile/${star.id}`);
  await expect(page.getByRole("heading", { level: 1, name: star.username })).toBeVisible();
  await expect(badge(page)).toHaveCount(0);

  await clickAndSave(page, favoriteButton(page));
  await expect(unfavoriteButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(badge(page)).toBeVisible();

  await page.reload();
  await expect(badge(page)).toBeVisible();
  await expect(unfavoriteButton(page)).toBeVisible();

  await clickAndSave(page, unfavoriteButton(page));
  await expect(favoriteButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(badge(page)).toHaveCount(0);

  await page.reload();
  await expect(favoriteButton(page)).toBeVisible();
  await expect(badge(page)).toHaveCount(0);
});

test("visitors and the user themselves see no favorite button", async ({
  page,
  context,
  browser,
}) => {
  const star = await createUser(browser, uniqueUsername("fave.solo"));

  await page.goto(`/profile/${star.id}`);
  await expect(page.getByRole("heading", { level: 1, name: star.username })).toBeVisible();
  await expect(page.getByRole("button", { name: /favorite/ })).toHaveCount(0);

  await signIn(context, { username: star.username, discordId: star.discordId });
  await page.reload();
  await expect(page.getByRole("button", { name: "edit profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: /favorite/ })).toHaveCount(0);
});
