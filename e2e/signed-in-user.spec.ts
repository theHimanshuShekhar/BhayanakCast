import { fakeDiscordId, signIn } from "./auth";
import { expect, test } from "./fixtures";
import { createUser } from "./profiles";
import { createRoomAs, createUsers, minutesAgo, seedRoom, uniqueRoomName } from "./rooms";

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
  await page.goto(`/room/${roomId}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("kodama_jpg (you)")).toHaveCount(1);
  // The host is someone else.
  await expect(page.getByText("room.host (you)")).toHaveCount(0);
});

test("the room shows who is in it now, with an empty chat and feed", async ({
  page,
  context,
  browser,
}) => {
  const [hostId = "", viewerId = ""] = await createUsers(browser, [
    "present.host",
    "present.viewer",
  ]);
  const name = uniqueRoomName("people present");
  const roomId = await seedRoom(context, {
    name,
    hostUserId: hostId,
    createdAt: minutesAgo(20),
    presence: [
      { userId: hostId, startedAt: minutesAgo(20) },
      { userId: viewerId, startedAt: minutesAgo(10) },
    ],
    streams: [{ userId: hostId, startedAt: minutesAgo(15) }],
  });
  await signIn(context, { username: "present.me" });
  await page.goto(`/room/${roomId}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  // Live since the room was created (a slow run may tick a minute over).
  await expect(page.getByText(/^LIVE · 2[01]m$/)).toBeVisible();
  await expect(page.getByText("3/10")).toBeVisible();
  await expect(page.getByText("no messages yet")).toBeVisible();

  await page.getByRole("tab", { name: /people/ }).click();
  const people = page.getByRole("tabpanel", { name: /people/ });
  await expect(people).toContainText("present.host");
  await expect(people).toContainText("present.viewer");
  await expect(people).toContainText("present.me (you)");
  await page.getByRole("tab", { name: /feed/ }).click();
  await expect(page.getByText("nothing has happened yet")).toBeVisible();
});
