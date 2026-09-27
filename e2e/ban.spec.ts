import { expect, type Page, test } from "@playwright/test";
import { setBan, signIn, trySignIn } from "./auth";

/** These tests change the user's ban state, so each browser project gets its own fake user. */
const fakeDiscordId = (n: number) =>
  `900000000000000${test.info().project.name === "firefox" ? 4 : 3}0${n}`;

const accountMenu = (page: Page) => page.getByRole("button", { name: "Account menu" });
const railSignIn = (page: Page) =>
  page.getByRole("navigation").getByRole("button", { name: /sign in with discord/i });

test("a signed-in user who gets banned is a visitor on their next navigation", async ({
  page,
  context,
}) => {
  const discordId = fakeDiscordId(1);
  await signIn(context, { discordId, username: "soon_banned" });
  await page.goto("/past/p3");
  await expect(accountMenu(page)).toBeVisible();

  await setBan(context, discordId, { reason: "spam" });
  await page.getByRole("link", { name: "Active Rooms" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(railSignIn(page)).toBeVisible();
  await expect(accountMenu(page)).toHaveCount(0);

  // Protected routes treat them as a visitor too, and a reload doesn't bring the session back.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
  await expect(railSignIn(page)).toBeVisible();
  await expect(accountMenu(page)).toHaveCount(0);
});

test("a banned user can't sign in until the ban is lifted", async ({ page, context }) => {
  const discordId = fakeDiscordId(2);
  await signIn(context, { discordId, username: "banned_user" });
  await setBan(context, discordId, { expiresAt: "2031-01-02T03:04:00Z" });

  const refused = await trySignIn(context, { discordId, username: "banned_user" });
  expect(refused.status()).toBe(403);
  await page.goto("/");
  await expect(accountMenu(page)).toHaveCount(0);

  await setBan(context, discordId, null);
  await page.goto("/");
  await expect(accountMenu(page)).toBeVisible();
});

test("a sign-in refused for a ban lands on home with the ban notice", async ({ page }) => {
  // Where Better Auth's Discord callback sends a banned user (see auth.test.ts).
  const description = "Reason: spamming rooms. The ban ends 2 Jan 2031, 03:04 UTC.";
  await page.goto(
    `/?${new URLSearchParams({ error: "BANNED_USER", error_description: description })}`,
  );

  const notice = page.getByRole("alert");
  await expect(notice).toContainText("Your account is banned");
  await expect(notice).toContainText("Reason: spamming rooms.");
  await expect(notice).toContainText("The ban ends 2 Jan 2031, 03:04 UTC.");
  await expect(railSignIn(page)).toBeVisible();

  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});
