import type { Page } from "@playwright/test";
import { E2E_ADMIN_DISCORD_ID, signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createUser, uniqueUsername } from "./profiles";
import { minutesAgo, seedPastRoom, seedRoom, uniqueRoomName } from "./rooms";

const dashboard = { level: 1, name: "Dashboard" } as const;

test("a visitor opening /admin is sent home", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(page.getByRole("heading", dashboard)).toHaveCount(0);
});

test("a non-admin has no Admin Dashboard rail item and /admin sends them home", async ({
  page,
  context,
}) => {
  await signIn(context, { username: "plain_user" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin Dashboard" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(page.getByRole("heading", dashboard)).toHaveCount(0);
});

test("an ADMIN_DISCORD_IDS user sees the rail item and opens the dashboard", async ({
  page,
  context,
}) => {
  await signIn(context, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
  await page.goto("/");
  await page.getByRole("link", { name: "Admin Dashboard" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", dashboard)).toBeVisible();
});

// The e2e server has no Cloudflare analytics credentials, so the TURN usage panel takes its
// "not configured" state and the rest of the dashboard is unaffected. The stat card, bar, chart
// and warning are covered by the server tests with a fake Cloudflare client.
test("the TURN usage panel says not configured without Cloudflare analytics credentials", async ({
  page,
  context,
}) => {
  await signIn(context, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
  await page.goto("/admin");
  await expect(page.getByRole("heading", dashboard)).toBeVisible();
  await expect(page.getByRole("heading", { name: "TURN usage" })).toBeVisible();
  await expect(page.getByText("not configured", { exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "live rooms" })).toBeVisible();
});

const HOUR = 3600;

/** A dashboard stat card's number (hours drop their "h"). */
async function stat(page: Page, label: string): Promise<number> {
  const card = page.getByRole("region", { name: label, exact: true });
  const value = await card.locator("div").nth(1).textContent();
  return Number(value?.replace(/h$/, ""));
}

// Every test shares one database: assert growth by at least what this test seeded, and
// find this test's rows by their unique names, never exact totals. Only monotonic totals
// (users, lifetime hours) get a growth check: other tests' rooms end at any moment, so
// "live now" can drop while this test runs. This test's own live row proves that wiring.
test("an admin sees real platform numbers, rooms and leaderboards", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
  await page.goto("/admin");
  await expect(page.getByRole("heading", dashboard)).toBeVisible();
  const usersBefore = await stat(page, "total users");
  const newUsersBefore = await stat(page, "new users (30d)");
  const streamedBefore = await stat(page, "hours streamed");

  const streamer = await createUser(browser, uniqueUsername("admin.streamer"), {
    stats: { secondsStreamed: 100_000 * HOUR, secondsWatched: 90_000 * HOUR },
  });
  const liveName = uniqueRoomName("admin live");
  await seedRoom(context, {
    name: liveName,
    hostUserId: streamer.id,
    isPrivate: true,
    createdAt: minutesAgo(15),
    presence: [{ userId: streamer.id, startedAt: minutesAgo(15) }],
  });
  const pastName = uniqueRoomName("admin past");
  await seedPastRoom(browser, uniqueUsername("admin.past"), pastName);

  await page.reload();
  expect(await stat(page, "total users")).toBeGreaterThanOrEqual(usersBefore + 2);
  expect(await stat(page, "new users (30d)")).toBeGreaterThanOrEqual(newUsersBefore + 2);
  expect(await stat(page, "hours streamed")).toBeGreaterThanOrEqual(streamedBefore + 99_999);
  // This test's room is live throughout, whatever other tests' rooms do: it's seeded straight
  // into the database after the server started, and nobody joins it, so the realtime hub never
  // tracks it and its empty-room timer can't end it.
  expect(await stat(page, "live now")).toBeGreaterThanOrEqual(1);

  // Private rooms included: admins see every room.
  const liveRow = page
    .getByRole("table", { name: "live rooms" })
    .getByRole("row")
    .filter({ hasText: liveName });
  await expect(liveRow).toContainText("private");
  await expect(liveRow).toContainText(streamer.username);
  await expect(liveRow.getByRole("cell").nth(2)).toHaveText("1/10");

  const recent = page.getByRole("table", { name: "recent rooms" });
  await page.getByRole("textbox", { name: "Search rooms or hosts" }).fill(pastName);
  // The header row and this test's room.
  await expect(recent.getByRole("row")).toHaveCount(2);
  const pastRow = recent.getByRole("row").filter({ hasText: pastName });
  await expect(pastRow).toContainText("ended");
  await expect(pastRow).toContainText("30m");

  await expect(
    page
      .getByRole("region", { name: "top users by hours streamed" })
      .getByRole("link", { name: streamer.username }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "top users by hours watched" })
      .getByRole("link", { name: streamer.username }),
  ).toBeVisible();
});

test("an admin promotes a user, who gets /admin, then demotes them, who loses it on their next navigation", async ({
  page,
  context,
  browser,
}) => {
  // Unique across browser projects too: the admin finds them by searching the users table.
  const username = uniqueUsername("role.target");
  await signIn(context, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
  const targetContext = await browser.newContext();
  try {
    await signIn(targetContext, { username });
    const target = await newPage(targetContext);
    await target.goto("/");
    await expect(target.getByRole("link", { name: "Admin Dashboard" })).toHaveCount(0);

    await page.goto("/admin");
    const users = page.getByRole("table", { name: "users" });
    const search = page.getByRole("textbox", { name: "Search users" });

    // The env admin (this admin) is marked, and can't be demoted.
    await search.fill("admin_jpg");
    const self = users.getByRole("row").filter({ hasText: "admin_jpg" });
    await expect(self).toContainText("env admin");
    await expect(self.getByRole("button", { name: "Demote admin_jpg" })).toBeDisabled();

    await search.fill(username);
    const row = users.getByRole("row").filter({ hasText: username });
    await expect(row.getByRole("cell").nth(2)).toHaveText("user");
    await row.getByRole("button", { name: `Promote ${username}` }).click();
    const promote = page.getByRole("dialog", { name: `promote ${username}` });
    await promote.getByRole("button", { name: "make admin" }).click();
    await expect(promote).toHaveCount(0);
    await expect(row.getByRole("cell").nth(2)).toHaveText("admin");
    // Admins can't be banned: demote first.
    await expect(row.getByRole("button", { name: `Ban ${username}` })).toHaveCount(0);

    await target.goto("/");
    await target.getByRole("link", { name: "Admin Dashboard" }).click();
    await expect(target.getByRole("heading", dashboard)).toBeVisible();

    await row.getByRole("button", { name: `Demote ${username}` }).click();
    const demote = page.getByRole("dialog", { name: `demote ${username}` });
    await demote.getByRole("button", { name: "remove admin" }).click();
    await expect(demote).toHaveCount(0);
    await expect(row.getByRole("cell").nth(2)).toHaveText("user");

    // Still signed in, but their next navigation to /admin sends them home.
    await target.getByRole("link", { name: "Active Rooms" }).click();
    await expect(target.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
    await expect(target.getByRole("link", { name: "Admin Dashboard" })).toHaveCount(0);
    await target.goto("/admin");
    await expect(target).toHaveURL(/\/$/);
    await expect(target.getByRole("heading", dashboard)).toHaveCount(0);
    await expect(target.getByRole("button", { name: "Account menu" })).toBeVisible();
  } finally {
    await targetContext.close();
  }
});
