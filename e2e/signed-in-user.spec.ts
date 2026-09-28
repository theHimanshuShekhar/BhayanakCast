import { fakeDiscordId, signIn } from "./auth";
import { expect, test } from "./fixtures";
import { createUser } from "./profiles";
import {
  createRoomAs,
  createUsers,
  enterRoom,
  minutesAgo,
  seedRoom,
  uniqueRoomName,
} from "./rooms";

test('"my profile" opens the signed-in user\'s own id URL', async ({ page, context }) => {
  const userId = await signIn(context, {
    username: "self.viewer",
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menu").getByText("self.viewer", { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: /my profile/ }).click();
  await expect(page).toHaveURL(new RegExp(`/profile/${userId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "self.viewer" })).toBeVisible();
  await expect(page.getByText("YOU", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /edit profile/ })).toBeVisible();
});

test("someone else's profile offers favorite, not edit", async ({ page, context, browser }) => {
  // Same username, different Discord account and user id: not "you".
  await signIn(context, { username: "nelly.jpg", discordId: fakeDiscordId("nelly.jpg (me)") });
  const namesake = await createUser(browser, "nelly.jpg");
  await page.goto(`/profile/${namesake.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "nelly.jpg" })).toBeVisible();
  await expect(page.getByText("YOU", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /edit profile/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /favorite/ })).toBeVisible();
});

test("the room marks the signed-in user, by id, as (you)", async ({ page, context, browser }) => {
  const name = uniqueRoomName("midnight speedrun club");
  const roomId = await createRoomAs(browser, "room.host", { name });
  await signIn(context, { username: "kodama_jpg" });
  await enterRoom(page, roomId);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("kodama_jpg (you)")).toHaveCount(1);
  // The host is someone else.
  await expect(page.getByText("room.host (you)")).toHaveCount(0);
});

test("the room shows who is connected, with an empty chat and a feed of just their arrival", async ({
  page,
  context,
  browser,
}) => {
  const [hostId = "", viewerId = ""] = await createUsers(browser, [
    "present.host",
    "present.viewer",
  ]);
  const name = uniqueRoomName("people present");
  // Open presence rows with nobody connected behind them (as a crash would leave them).
  const roomId = await seedRoom(context, {
    name,
    hostUserId: hostId,
    createdAt: minutesAgo(20),
    presence: [
      { userId: hostId, startedAt: minutesAgo(20) },
      { userId: viewerId, startedAt: minutesAgo(10) },
    ],
  });
  await signIn(context, { username: "present.me" });
  await enterRoom(page, roomId);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  // Live since the room was created (a slow run may tick a minute over).
  await expect(page.getByText(/^LIVE · 2[01]m$/)).toBeVisible();
  await expect(page.getByText("no messages yet")).toBeVisible();

  // The realtime server's snapshot decides who is here: only the signed-in user.
  await expect(page.getByText("1/10")).toBeVisible();
  await page.getByRole("tab", { name: /people/ }).click();
  const people = page.getByRole("tabpanel", { name: /people/ });
  await expect(people).toContainText("present.me (you)");
  await expect(people).not.toContainText("present.viewer");
  await page.getByRole("tab", { name: /feed/ }).click();
  const feed = page.getByRole("tabpanel", { name: /feed/ });
  await expect(feed).toContainText("present.me joined");
  await expect(feed).not.toContainText("present.viewer");
});
