import type { Page } from "@playwright/test";
import { E2E_ADMIN_DISCORD_ID, fakeDiscordId, setBan, signIn, trySignIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// Each test bans only its own fake user (fakeDiscordId), never one another test signs in as.

const accountMenu = (page: Page) => page.getByRole("button", { name: "Account menu" });
const railSignIn = (page: Page) =>
  page.getByRole("navigation").getByRole("button", { name: /sign in with discord/i });

test("a signed-in user who gets banned is a visitor on their next navigation", async ({
  page,
  context,
}) => {
  const discordId = fakeDiscordId("soon_banned");
  await signIn(context, { discordId, username: "soon_banned" });
  await page.goto("/past/no-such-room");
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
  const discordId = fakeDiscordId("banned_user");
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

test("an admin bans a user who is in a room: they land on home as a visitor with the ban notice", async ({
  page,
  context,
  browser,
}) => {
  // Unique across browser projects too: the admin finds them by searching the users table.
  const username = `ban.target.${Math.random().toString(36).slice(2, 8)}`;
  await signIn(context, { username: "ban.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("ban room") });

  const targetContext = await browser.newContext();
  const adminContext = await browser.newContext();
  try {
    await signIn(targetContext, { username });
    const target = await newPage(targetContext);
    await enterRoom(target, roomId);
    await expect(page.getByRole("group", { name: username, exact: true })).toBeVisible();

    await signIn(adminContext, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
    const admin = await newPage(adminContext);
    await admin.goto("/admin");
    const users = admin.getByRole("table", { name: "users" });
    await admin.getByRole("textbox", { name: "Search users" }).fill(username);
    const row = users.getByRole("row").filter({ hasText: username });
    await expect(row).toContainText("active");
    await row.getByRole("button", { name: `Ban ${username}` }).click();

    const dialog = admin.getByRole("dialog", { name: `ban ${username}` });
    await dialog.getByLabel("reason").fill("spamming rooms");
    await dialog.getByRole("button", { name: "permanent" }).click();
    await dialog.getByRole("button", { name: "ban user" }).click();
    await expect(dialog).toHaveCount(0);

    // The banned user is sent home, signed out, with the notice; the room sees them leave.
    await expect(target).toHaveURL(/\/\?error=BANNED_USER/);
    const notice = target.getByRole("alert");
    await expect(notice).toContainText("Your account is banned");
    await expect(notice).toContainText("Reason: spamming rooms.");
    await expect(notice).toContainText("The ban has no end date.");
    await expect(railSignIn(target)).toBeVisible();
    await expect(accountMenu(target)).toHaveCount(0);
    await expect(page.getByRole("group", { name: username, exact: true })).toHaveCount(0);

    // Listed as banned with the reason; unbanning lifts it.
    await expect(row).toContainText("banned");
    await expect(row).toContainText("spamming rooms · permanent");
    await row.getByRole("button", { name: `Unban ${username}` }).click();
    await admin
      .getByRole("dialog", { name: `unban ${username}` })
      .getByRole("button", { name: "unban user" })
      .click();
    await expect(row).toContainText("active");
    await expect(row.getByRole("button", { name: `Ban ${username}` })).toBeVisible();
  } finally {
    await targetContext.close();
    await adminContext.close();
  }
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
