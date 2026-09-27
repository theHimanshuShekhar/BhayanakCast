import { expect, type Page, test } from "@playwright/test";
import { createUser, uniqueUsername } from "./profiles";

const HOUR = 3600;

const statValue = (page: Page, label: string) =>
  page.getByText(label, { exact: true }).locator("xpath=../..");

test("a seeded user's profile shows their stats and co-users, linked by id", async ({
  page,
  browser,
}) => {
  const close = await createUser(browser, uniqueUsername("close.friend"));
  const casual = await createUser(browser, uniqueUsername("casual.friend"));
  const star = await createUser(browser, uniqueUsername("profile.star"), {
    stats: {
      secondsStreamed: 12.5 * HOUR,
      secondsWatched: 40 * HOUR,
      roomsHosted: 6,
      roomsJoined: 21,
      peakViewers: 8,
    },
    cotime: [
      { discordId: casual.discordId, secondsTogether: 30 * 60 },
      { discordId: close.discordId, secondsTogether: 3 * HOUR },
    ],
  });

  await page.goto(`/profile/${star.id}`);
  await expect(page.getByRole("heading", { level: 1, name: star.username })).toBeVisible();
  await expect(statValue(page, "hours streamed")).toContainText("12.5h");
  await expect(statValue(page, "hours watched")).toContainText("40.0h");
  await expect(statValue(page, "rooms hosted")).toContainText("6");
  await expect(statValue(page, "rooms joined")).toContainText("21");
  await expect(statValue(page, "peak viewers")).toContainText("8");

  // Most time together first.
  const coUsers = page.getByRole("link", { name: /friend/ });
  await expect(coUsers).toHaveCount(2);
  await expect(coUsers.nth(0)).toContainText(close.username);
  await expect(coUsers.nth(0)).toContainText("3h 0m");
  await expect(coUsers.nth(1)).toContainText(casual.username);
  await expect(coUsers.nth(1)).toContainText("30m");

  await coUsers.nth(0).click();
  await expect(page).toHaveURL(new RegExp(`/profile/${close.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: close.username })).toBeVisible();
  // Co-time is symmetric.
  await expect(page.getByRole("link", { name: new RegExp(star.username) })).toBeVisible();
});

test("a new user's profile shows zero stats", async ({ page, browser }) => {
  const fresh = await createUser(browser, uniqueUsername("fresh.face"));
  await page.goto(`/profile/${fresh.id}`);
  await expect(page.getByRole("heading", { level: 1, name: fresh.username })).toBeVisible();
  await expect(statValue(page, "hours streamed")).toContainText("0.0h");
  await expect(statValue(page, "peak viewers")).toContainText("0");
  await expect(page.getByText("no shared time yet")).toBeVisible();
});

test("home search finds a user by Discord username and opens their profile", async ({
  page,
  browser,
}) => {
  const found = await createUser(browser, uniqueUsername("findable.person"), {
    stats: { secondsStreamed: 5 * HOUR },
  });
  await page.goto("/");
  // A case-insensitive substring of the username.
  await page.getByLabel("Search rooms and users").fill(found.username.slice(3).toUpperCase());
  const result = page.getByRole("button", { name: new RegExp(found.username) });
  await expect(result).toBeVisible();
  await expect(result).toContainText("5h");
  await result.click();
  await expect(page).toHaveURL(new RegExp(`/profile/${found.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: found.username })).toBeVisible();
});

test("an unknown profile id shows user not found", async ({ page }) => {
  await page.goto("/profile/no-such-user");
  await expect(page.getByRole("heading", { level: 1, name: "user not found" })).toBeVisible();
});
