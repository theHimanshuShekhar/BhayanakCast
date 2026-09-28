import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomAs, enterRoom, uniqueRoomName } from "./rooms";

// The lobby channel (ADR 20): a visitor's page follows online users and public rooms live.
// Other tests connect and create rooms concurrently on the same server, so assert growth and
// presence, never exact totals.

/** The rail's online-user count, once the lobby socket has reported it. */
async function railOnline(page: Page): Promise<number> {
  const status = page.getByRole("status", { name: /^\d+ online$/ });
  await expect(status).toBeVisible();
  return Number.parseInt((await status.getAttribute("aria-label")) ?? "", 10);
}

/** Mark the document, so a later check can tell the page was never reloaded. */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as { __lobbyMark?: boolean }).__lobbyMark = true;
  });
}

async function stillSameDocument(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as { __lobbyMark?: boolean }).__lobbyMark === true);
}

test("a visitor's rail counts a user who signs in elsewhere", async ({ page, browser }) => {
  await page.goto("/");
  const before = await railOnline(page);
  await markDocument(page);

  const other = await browser.newContext();
  try {
    await signIn(other, { username: "lobby.arrival" });
    await (await newPage(other)).goto("/");
    await expect.poll(() => railOnline(page)).toBeGreaterThan(before);
    expect(await stillSameDocument(page)).toBe(true);
  } finally {
    await other.close();
  }
});

test("a new room appears on a visitor's home without a reload", async ({ page, browser }) => {
  await page.goto("/");
  await railOnline(page); // the lobby socket is up
  await markDocument(page);

  const name = uniqueRoomName("lobby room");
  await createRoomAs(browser, "lobby.host", { name });
  await expect(page.getByText(name).first()).toBeVisible();
  expect(await stillSameDocument(page)).toBe(true);
});

test("a private room never shows up on a visitor's home", async ({ page, browser }) => {
  await page.goto("/");
  await railOnline(page);
  const secret = uniqueRoomName("lobby secret");
  const shown = uniqueRoomName("lobby shown");
  await createRoomAs(browser, "lobby.secret.host", { name: secret, isPrivate: true });
  // A public room afterwards: once it shows, the private one has had its chance to leak.
  await createRoomAs(browser, "lobby.shown.host", { name: shown });
  await expect(page.getByText(shown).first()).toBeVisible();
  await expect(page.getByText(secret)).toHaveCount(0);
});

test("after signing in, the page's socket is authenticated without a reload", async ({
  page,
  context,
  browser,
}) => {
  const name = uniqueRoomName("lobby upgrade");
  await createRoomAs(browser, "lobby.upgrade.host", { name });

  await page.goto("/past/no-such-room");
  await railOnline(page); // this page's socket is up, anonymous
  await markDocument(page);
  await signIn(context, { username: "lobby.signer" });
  // The app notices the new session on its next client navigation; no document load.
  await page.getByRole("link", { name: "Active Rooms" }).click();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();

  // Only an authenticated socket may join a room.
  await page.getByRole("button", { name: `Join ${name}` }).click();
  await enterRoom(page);
  await page.getByRole("tab", { name: /people/ }).click();
  await expect(page.getByRole("tabpanel", { name: /people/ })).toContainText("lobby.signer (you)");
  expect(await stillSameDocument(page)).toBe(true);
});
