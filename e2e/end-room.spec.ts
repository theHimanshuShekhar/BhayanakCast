import { E2E_ADMIN_DISCORD_ID, signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createUser, uniqueUsername } from "./profiles";
import {
  createRoomOnPage,
  endRoom,
  enterRoom,
  liveRoomRow,
  minutesAgo,
  seedRoom,
  uniqueRoomName,
} from "./rooms";

// An admin ends a room from /admin (#46, ADR 6).

test("an admin ends a room two people are in: both land on home with the notice", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "end.host" });
  const name = uniqueRoomName("ended hang");
  const roomId = await createRoomOnPage(page, { name });

  const guestContext = await browser.newContext();
  const adminContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "end.guest" });
    const guest = await newPage(guestContext);
    await enterRoom(guest, roomId);
    await expect(page.getByRole("group", { name: "end.guest", exact: true })).toBeVisible();

    await signIn(adminContext, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
    const admin = await newPage(adminContext);
    await admin.goto("/admin");
    await expect(liveRoomRow(admin, name)).toContainText("2/10");
    await endRoom(admin, name);
    await expect(liveRoomRow(admin, name)).toHaveCount(0);

    for (const person of [page, guest]) {
      await expect(person).toHaveURL(/\/\?ended=admin$/);
      await expect(person.getByRole("alert")).toContainText("This room was ended by an admin");
      // Gone from Live Now, under Past Streams.
      await expect(person.getByRole("button", { name: `Join ${name}` })).toHaveCount(0);
      await expect(person.getByRole("button", { name: `View recap of ${name}` })).toBeVisible();
    }

    // Coming back to it finds a past stream, not the room.
    await guest.goto(`/room/${roomId}`);
    await expect(guest.getByRole("heading", { name: "room not found" })).toBeVisible();

    await page.getByRole("alert").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  } finally {
    await guestContext.close();
    await adminContext.close();
  }
});

test("an admin ends a live room the realtime server doesn't hold: it ends all the same", async ({
  context,
  browser,
}) => {
  await signIn(context, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
  const host = await createUser(browser, uniqueUsername("end.seeded"));
  const name = uniqueRoomName("seeded live");
  // Seeded straight into the database after the server started: the hub never loaded it.
  await seedRoom(context, {
    name,
    hostUserId: host.id,
    createdAt: minutesAgo(15),
    presence: [{ userId: host.id, startedAt: minutesAgo(15) }],
  });
  const admin = await newPage(context);
  await admin.goto("/admin");
  await endRoom(admin, name);
  await expect(liveRoomRow(admin, name)).toHaveCount(0);

  await admin.getByRole("textbox", { name: "Search rooms or hosts" }).fill(name);
  const recentRow = admin
    .getByRole("table", { name: "recent rooms" })
    .getByRole("row")
    .filter({ hasText: name });
  await expect(recentRow).toContainText("ended");
});
