import { type Browser, expect, type Page, test } from "@playwright/test";
import { signIn } from "./auth";
import { createUsers, minutesAgo, seedRoom, uniqueRoomName } from "./rooms";

/**
 * An hour-long room that ended 2 hours ago: the host stayed throughout and streamed for
 * the first 30 minutes (left open, last seen at 30), the viewer came and went in two
 * overlapping visits that merge into 40 minutes.
 */
async function seedEndedRoom(browser: Browser, opts: { isPrivate?: boolean } = {}) {
  const name = uniqueRoomName("recap night");
  const [hostId = "", viewerId = ""] = await createUsers(browser, ["recap.host", "recap.viewer"]);
  const context = await browser.newContext();
  try {
    const roomId = await seedRoom(context, {
      name,
      hostUserId: hostId,
      isPrivate: opts.isPrivate,
      createdAt: minutesAgo(180),
      endedAt: minutesAgo(120),
      presence: [
        { userId: hostId, startedAt: minutesAgo(180), endedAt: minutesAgo(120) },
        { userId: viewerId, startedAt: minutesAgo(170), endedAt: minutesAgo(140) },
        { userId: viewerId, startedAt: minutesAgo(145), endedAt: minutesAgo(130) },
      ],
      streams: [{ userId: hostId, startedAt: minutesAgo(180), lastSeenAt: minutesAgo(150) }],
    });
    return { name, roomId, hostId, viewerId };
  } finally {
    await context.close();
  }
}

const person = (page: Page, username: string) =>
  page.getByTestId("recap-person").filter({ has: page.getByRole("link", { name: username }) });

test("a recap shows who joined and streamed, and for how long", async ({ page, browser }) => {
  const { name, roomId, viewerId } = await seedEndedRoom(browser);
  await page.goto(`/past/${roomId}`);

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("lasted 1h", { exact: true })).toBeVisible();
  const stat = (label: string) => page.getByText(label, { exact: true }).locator("../..");
  await expect(stat("duration")).toContainText("1h");
  await expect(stat("joined")).toContainText("2");
  await expect(stat("streamers")).toContainText("1");
  // Host 60m in the room minus 30m streaming, plus the viewer's 40m.
  await expect(stat("watch time")).toContainText("1h 10m");

  const streamed = page.getByRole("heading", { name: "who streamed" }).locator("../..");
  await expect(streamed.getByRole("link", { name: "recap.host" })).toBeVisible();
  await expect(streamed).toContainText("30m");
  await expect(streamed.getByRole("link", { name: "recap.viewer" })).toHaveCount(0);

  await expect(person(page, "recap.host")).toContainText("1h");
  await expect(person(page, "recap.viewer")).toContainText("40m");
  await person(page, "recap.viewer").getByRole("link", { name: "recap.viewer" }).click();
  await expect(page).toHaveURL(new RegExp(`/profile/${viewerId}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("home lists the past stream and opens its recap", async ({ page, browser }) => {
  const { name, roomId } = await seedEndedRoom(browser);
  await page.goto("/");
  await page.getByLabel("Search rooms and users").fill(name);
  await expect(page.getByRole("heading", { name: "Past Streams" })).toBeVisible();
  const card = page.getByRole("button", { name: `View recap of ${name}` });
  await expect(card).toContainText("2 joined");
  await expect(card).toContainText("lasted 1h");
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/past/${roomId}$`));
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("a private recap is only for its members", async ({ page, context, browser }) => {
  const { name, roomId } = await seedEndedRoom(browser, { isPrivate: true });
  await page.goto(`/past/${roomId}`);
  await expect(page.getByRole("heading", { name: "recap not found" })).toBeVisible();
  await page.goto("/");
  await page.getByLabel("Search rooms and users").fill(name);
  await expect(page.getByRole("button", { name: `View recap of ${name}` })).toHaveCount(0);

  // The host (same fake Discord id as the seeded user) sees it.
  await signIn(context, { username: "recap.host" });
  await page.goto(`/past/${roomId}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("an unknown or expired recap says recaps are kept for 30 days", async ({ page, browser }) => {
  await page.goto("/past/no-such-room");
  await expect(page.getByRole("heading", { name: "recap not found" })).toBeVisible();
  await expect(page.getByText("past streams are kept for 30 days")).toBeVisible();

  const [hostId = ""] = await createUsers(browser, ["old.host"]);
  const roomId = await seedRoom(page.context(), {
    name: uniqueRoomName("long gone"),
    hostUserId: hostId,
    createdAt: minutesAgo(31 * 24 * 60 + 60),
    endedAt: minutesAgo(31 * 24 * 60),
  });
  await page.goto(`/past/${roomId}`);
  await expect(page.getByRole("heading", { name: "recap not found" })).toBeVisible();
});

test("a profile's recent streams show rooms they hosted or joined, minus hidden private ones", async ({
  page,
  context,
  browser,
}) => {
  const [hostId = "", memberId = "", outsiderId = ""] = await createUsers(browser, [
    "recents.host",
    "recents.member",
    "recents.outsider",
  ]);
  const publicName = uniqueRoomName("recents open");
  const privateName = uniqueRoomName("recents secret");
  const seed = (name: string, isPrivate: boolean) =>
    seedRoom(context, {
      name,
      hostUserId: hostId,
      isPrivate,
      members: isPrivate ? [{ userId: memberId }] : [],
      createdAt: minutesAgo(90),
      endedAt: minutesAgo(30),
      presence: [
        { userId: hostId, startedAt: minutesAgo(90), endedAt: minutesAgo(30) },
        { userId: memberId, startedAt: minutesAgo(80), endedAt: minutesAgo(40) },
      ],
    });
  const publicId = await seed(publicName, false);
  await seed(privateName, true);

  const recap = (name: string) => page.getByRole("button", { name: `View recap of ${name}` });
  // As a visitor: the public room on the host's and the member's profile, the private one on neither.
  for (const userId of [hostId, memberId]) {
    await page.goto(`/profile/${userId}`);
    await expect(page.getByRole("heading", { name: "recent streams" })).toBeVisible();
    await expect(recap(publicName)).toBeVisible();
    await expect(recap(privateName)).toHaveCount(0);
  }
  await page.goto(`/profile/${outsiderId}`);
  await expect(page.getByText("no streams in the last 30 days")).toBeVisible();

  // The approved member sees the private room on the host's profile; a card opens its recap.
  await signIn(context, { username: "recents.member" });
  await page.goto(`/profile/${hostId}`);
  await expect(recap(privateName)).toBeVisible();
  await recap(publicName).click();
  await expect(page).toHaveURL(new RegExp(`/past/${publicId}$`));
  await expect(page.getByRole("heading", { level: 1, name: publicName })).toBeVisible();
});
