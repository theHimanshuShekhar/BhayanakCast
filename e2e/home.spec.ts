import type { Browser, BrowserContext, Page } from "@playwright/test";
import { E2E_ADMIN_DISCORD_ID, signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createUser, uniqueUsername } from "./profiles";
import { createRoomOnPage, createUsers, minutesAgo, seedRoom, uniqueRoomName } from "./rooms";

const HOUR = 3600;

// Every test shares one database, so other tests add rooms, users and stats concurrently:
// assert that the sidebar's lifetime numbers grow by at least what this test added, never
// exact totals. Live counts can drop at any moment as other tests' rooms end, so they are
// only checked against a room this test holds open.

/** A "Right Now" tile's number. */
async function rightNow(page: Page, label: string): Promise<number> {
  const tile = page
    .getByRole("region", { name: "Right Now" })
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::div");
  return Number(await tile.textContent());
}

/** A "Community" row's number (hours drop their "h"). */
async function community(page: Page, label: string): Promise<number> {
  const value = page
    .getByRole("region", { name: "Community" })
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::span");
  return Number((await value.textContent())?.replace(/h$/, ""));
}

test("the home sidebar counts real rooms, members and lifetime stats", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const membersBefore = await community(page, "Members");
  const watchedBefore = await community(page, "Hours Watched");
  const streamedBefore = await community(page, "Hours Streamed");
  const hostedBefore = await community(page, "Rooms Hosted");

  // The host stays in the room until the checks are done, so it can't end meanwhile.
  const host = await browser.newContext();
  try {
    await signIn(host, { username: uniqueUsername("sidebar.host") });
    const name = uniqueRoomName("sidebar room");
    await createRoomOnPage(await newPage(host), { name });
    await createUser(browser, uniqueUsername("sidebar.veteran"), {
      stats: { secondsWatched: 500 * HOUR, secondsStreamed: 200 * HOUR, roomsHosted: 40 },
    });

    await page.reload();
    await expect(page.getByRole("button", { name: `Join ${name}` })).toBeVisible();
    expect(await rightNow(page, "Watching")).toBeGreaterThanOrEqual(1);
    expect(await community(page, "Members")).toBeGreaterThanOrEqual(membersBefore + 2);
    expect(await community(page, "Hours Watched")).toBeGreaterThanOrEqual(watchedBefore + 499);
    expect(await community(page, "Hours Streamed")).toBeGreaterThanOrEqual(streamedBefore + 199);
    expect(await community(page, "Rooms Hosted")).toBeGreaterThanOrEqual(hostedBefore + 40);
  } finally {
    await host.close();
  }
});

test("every Right Now tile shows a number, the online count from the lobby socket", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Right Now" });
  await expect(panel.getByTitle("Connecting to the live count")).toHaveCount(0);
  for (const label of ["Online", "Watching", "Streaming"]) {
    expect(Number.isInteger(await rightNow(page, label)), label).toBe(true);
  }
});

test("a visitor gets no You card, and keeps the sign-in intro", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Community" })).toBeVisible();
  await expect(page.getByRole("region", { name: "You" })).toHaveCount(0);
});

test("a new user's You card nudges them into a room", async ({ page, context }) => {
  await signIn(context, { username: uniqueUsername("you.new") });
  await page.goto("/");
  const you = page.getByRole("region", { name: "You" });
  await expect(you.getByText("Join or start a room")).toBeVisible();
  await expect(you.getByText("most time with")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Sign in" })).toHaveCount(0);
});

test("the You card counts a private room and links to the co-user and the profile", async ({
  page,
  context,
  browser,
}) => {
  const friend = uniqueUsername("you.friend");
  const myId = await signIn(context, { username: uniqueUsername("you.me") });
  const [friendId = ""] = await createUsers(browser, [friend]);
  // A private room that ended 20 minutes ago, with both of them in it for three hours. A profile
  // leaves it out; the You card, which only its owner sees, counts it.
  // One reading of the clock each, so the span is exactly three hours.
  const [startedAt, endedAt] = [minutesAgo(200), minutesAgo(20)];
  const span = (userId: string) => ({ userId, startedAt, endedAt });
  await seedRoom(context, {
    name: uniqueRoomName("you private"),
    hostUserId: friendId,
    isPrivate: true,
    createdAt: minutesAgo(210),
    endedAt,
    members: [{ userId: myId }],
    presence: [span(friendId), span(myId)],
  });

  await page.goto("/");
  const you = page.getByRole("region", { name: "You" });
  const row = (label: string) =>
    you.getByText(label, { exact: true }).locator("xpath=following-sibling::span");
  await expect(row("Hours Watched")).toHaveText("3.0h");
  await expect(row("Hours Streamed")).toHaveText("0.0h");
  await expect(row("Rooms Joined")).toHaveText("1");
  await expect(you).toContainText("most time with");
  await expect(you).toContainText("3h 0m");

  await you.getByRole("link", { name: friend }).click();
  await expect(page).toHaveURL(`/profile/${friendId}`);

  await page.goto("/");
  await page.getByRole("link", { name: "You", exact: true }).click();
  await expect(page).toHaveURL(`/profile/${myId}`);
  // Their own profile counts public rooms only, so the private room is not on it.
  await expect(page.getByText("no shared time yet")).toBeVisible();
});

/**
 * Lifetime seconds that put a test's user at the top of Regulars. Every test shares one database
 * and its users stay in it, so the figure rises with the clock: whoever a test seeds is above
 * those seeded before it, and only the few tests running alongside can be above them.
 */
const topRegularSeconds = () => 1_000_000 * HOUR + Math.floor(Date.now() / 1000);

test("Regulars shows a regular in their live room and links to their profile", async ({
  page,
  context,
  browser,
}) => {
  const regular = await createUser(browser, uniqueUsername("regular.live"), {
    stats: { secondsWatched: topRegularSeconds() },
  });
  const roomName = uniqueRoomName("regular room");
  await seedRoom(context, {
    name: roomName,
    hostUserId: regular.id,
    createdAt: minutesAgo(15),
    presence: [{ userId: regular.id, startedAt: minutesAgo(15) }],
  });

  // Visitors get the card too.
  await page.goto("/");
  const row = page
    .getByRole("region", { name: "Regulars" })
    .getByRole("link", { name: regular.username });
  await expect(row).toContainText(`in ${roomName}`);
  await expect(row).toContainText(/\d+\.\dh$/);

  await row.click();
  await expect(page).toHaveURL(`/profile/${regular.id}`);
});

test("Regulars names a private room only to someone who can see it", async ({ page, browser }) => {
  const regular = await createUser(browser, uniqueUsername("regular.priv"), {
    stats: { secondsWatched: topRegularSeconds() },
  });
  const roomName = uniqueRoomName("regular private");
  const admin = await browser.newContext();
  try {
    await signIn(admin, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
    await seedRoom(admin, {
      name: roomName,
      hostUserId: regular.id,
      isPrivate: true,
      createdAt: minutesAgo(15),
      presence: [{ userId: regular.id, startedAt: minutesAgo(15) }],
    });
    const regularsRow = (viewer: Page) =>
      viewer
        .getByRole("region", { name: "Regulars" })
        .getByRole("link", { name: regular.username });

    // The visitor sees the person, with no room and no ring, and the name is nowhere on the page.
    await page.goto("/");
    await expect(regularsRow(page)).toBeVisible();
    await expect(regularsRow(page)).not.toContainText("in ");
    await expect(page.getByText(roomName)).toHaveCount(0);

    // An admin can see every room, so the same row names it.
    const adminPage = await newPage(admin);
    await adminPage.goto("/");
    await expect(regularsRow(adminPage)).toContainText(`in ${roomName}`);
  } finally {
    await admin.close();
  }
});

/**
 * A past stream that began at `since` (an ISO time long before any other test's, so its length
 * beats theirs) and ended a minute ago, with `people` fresh users together for its last half
 * hour. Every test shares one database and its rooms stay in it, so a record is asserted through
 * what the card shows now, never by naming a room it might lose to.
 */
async function seedHugeRoom(
  browser: Browser,
  context: BrowserContext,
  {
    name,
    since,
    people,
    isPrivate,
  }: { name: string; since: string; people: number; isPrivate?: boolean },
): Promise<string> {
  const ids = await createUsers(
    browser,
    Array.from({ length: people }, (_, i) => uniqueUsername(`records.p${i}`)),
  );
  return seedRoom(context, {
    name,
    hostUserId: ids[0] ?? "",
    isPrivate,
    createdAt: since,
    endedAt: minutesAgo(1),
    presence: ids.map((userId) => ({ userId, startedAt: minutesAgo(31), endedAt: minutesAgo(1) })),
  });
}

test("the Records card shows the longest and biggest room, and a record opens its recap", async ({
  page,
  context,
  browser,
}) => {
  await seedHugeRoom(browser, context, {
    name: uniqueRoomName("record room"),
    since: "2020-01-01T00:00:00Z",
    people: 3,
  });

  // Visitors get the card too.
  await page.goto("/");
  const records = page.getByRole("region", { name: "Records" });
  const longest = records.getByRole("link").filter({ hasText: "Longest room" });
  const biggest = records.getByRole("link").filter({ hasText: "Biggest room" });
  await expect(longest).toContainText("last 30 days");
  const length = longest.getByText(/^\d+h( \d+m)?$/);
  await expect(length).toBeVisible();
  await expect(biggest).toContainText("last 30 days");
  await expect(biggest.getByText(/^\d+ people$/)).toBeVisible();

  // Whichever room holds the record now, its row opens that room's recap, which agrees on the length.
  const duration = await length.textContent();
  await longest.click();
  await expect(page).toHaveURL(/\/past\/[^/]+$/);
  // Home's own past cards say "lasted" too: wait until they are gone.
  await expect(page.getByRole("button", { name: /^View recap of / })).toHaveCount(0);
  await expect(page.getByText(`lasted ${duration}`, { exact: true })).toBeVisible();
});

test("the Records card names the streamer with the most viewers and links to their profile", async ({
  page,
  browser,
}) => {
  // More viewers than any other test seeds, rising with the clock.
  const viewers = 1_000_000 + Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 1000);
  await createUser(browser, uniqueUsername("records.streamer"), {
    stats: { peakViewers: viewers },
  });

  await page.goto("/");
  const row = page
    .getByRole("region", { name: "Records" })
    .getByRole("link", { name: "Most viewers on one stream" });
  await expect(row).toContainText("all time");
  await expect(row.getByText(/^\d+ viewers$/)).toBeVisible();
  await row.click();
  // Another test's streamer can hold the record by now, so any profile will do.
  await expect(page).toHaveURL(/\/profile\/[^/]+$/);
});

test("the Records card never names a private room that would win, for a visitor or an admin", async ({
  page,
  browser,
  context,
}) => {
  const name = uniqueRoomName("record secret");
  const admin = await browser.newContext();
  try {
    await signIn(admin, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
    // Longer than any public record room (from 2020) and with more people than the others'.
    await seedHugeRoom(browser, admin, {
      name,
      since: "2019-01-01T00:00:00Z",
      people: 5,
      isPrivate: true,
    });
    // A public one, so the card is there to be checked.
    await seedHugeRoom(browser, context, {
      name: uniqueRoomName("record public"),
      since: "2020-01-01T00:00:00Z",
      people: 2,
    });

    await page.goto("/");
    await expect(page.getByRole("region", { name: "Records" })).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);

    // An admin sees the room in the lists, but the card is the same for them.
    const adminPage = await newPage(admin);
    await adminPage.goto("/");
    const records = adminPage.getByRole("region", { name: "Records" });
    await expect(records).toBeVisible();
    await expect(records).not.toContainText(name);
  } finally {
    await admin.close();
  }
});
