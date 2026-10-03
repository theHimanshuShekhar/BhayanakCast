import type { Browser, BrowserContext, Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// Leaving a room by navigating away asks first (#86, ADR 14 addendum).

const confirm = (page: Page) => page.getByRole("dialog", { name: "Leave the room?" });
const railHome = (page: Page) => page.getByRole("link", { name: "Active Rooms" });
const tile = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const inRoom = (page: Page, roomId: string) =>
  expect(page).toHaveURL(new RegExp(`/room/${roomId}$`));

/**
 * Whether the page would raise the browser's leave prompt: the router's `beforeunload` handler
 * (registered only while a blocker is) cancels a cancelable `beforeunload` event.
 */
const asksOnUnload = (page: Page) =>
  page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

/** On `page`, kick `name` through their tile's moderation menu and its confirmation. */
async function kick(page: Page, name: string) {
  await tile(page, name).hover();
  await page.getByRole("button", { name: `Moderate ${name}` }).click();
  await page.getByRole("menuitem", { name: "kick from room" }).click();
  await page
    .getByRole("dialog", { name: `kick ${name}?` })
    .getByRole("button", { name: `kick ${name}` })
    .click();
}

/** `host` creates a room (and is in it); returns its id. */
async function hostRoom(page: Page, context: BrowserContext, host: string) {
  await signIn(context, { username: host });
  return createRoomOnPage(page, { name: uniqueRoomName("leave guard") });
}

/** A fresh signed-in `username` on a page of their own. */
async function guestPage(browser: Browser, username: string) {
  const context = await browser.newContext();
  await signIn(context, { username });
  return { context, page: await newPage(context) };
}

test("a rail link while joined asks first: Stay keeps you in the room, Leave leaves and goes", async ({
  page,
  context,
  browser,
}) => {
  const roomId = await hostRoom(page, context, "lg.host.link");
  const guest = await guestPage(browser, "lg.guest.link");
  try {
    await enterRoom(guest.page, roomId);
    await expect(tile(page, "lg.guest.link")).toBeVisible();

    // From the keyboard: focus moves into the dialog (onto Stay), Escape means Stay, and focus
    // goes back to the link.
    await railHome(guest.page).focus();
    await guest.page.keyboard.press("Enter");
    await expect(confirm(guest.page)).toBeVisible();
    await expect(confirm(guest.page).getByRole("button", { name: "Stay" })).toBeFocused();
    await guest.page.keyboard.press("Escape");
    await expect(confirm(guest.page)).toHaveCount(0);
    await expect(railHome(guest.page)).toBeFocused();

    // Still there and connected: the host sees them, and their controls work.
    await inRoom(guest.page, roomId);
    await expect(guest.page.getByRole("button", { name: "Turn camera on" })).toBeEnabled();
    await expect(tile(page, "lg.guest.link")).toBeVisible();

    // The Stay button does the same.
    await railHome(guest.page).click();
    await confirm(guest.page).getByRole("button", { name: "Stay" }).click();
    await expect(confirm(guest.page)).toHaveCount(0);
    await inRoom(guest.page, roomId);
    await expect(tile(page, "lg.guest.link")).toBeVisible();

    // Leave: out of the room cleanly (the host sees them go) and on to where the link went.
    await railHome(guest.page).click();
    await confirm(guest.page).getByRole("button", { name: "Leave" }).click();
    await expect(guest.page).toHaveURL(/\/$/);
    await expect(tile(page, "lg.guest.link")).toHaveCount(0);
    // It was a leave, not a reload: coming back goes through the lobby.
    await guest.page.goto(`/room/${roomId}`);
    await expect(guest.page.getByRole("button", { name: "Enter room" })).toBeVisible();
  } finally {
    await guest.context.close();
  }
});

test("the browser's Back button while joined asks first", async ({ page, context }) => {
  // Home, then the new room inside the app: Back has somewhere to go.
  const roomId = await hostRoom(page, context, "lg.host.back");
  await page.evaluate(() => history.back());
  await expect(confirm(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm(page)).toHaveCount(0);
  await inRoom(page, roomId);
  await expect(page.getByRole("button", { name: "Turn camera on" })).toBeEnabled();

  await page.evaluate(() => history.back());
  await confirm(page).getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(confirm(page)).toHaveCount(0);
});

test("being kicked while the leave dialog is open settles it: the kick notice shows under the room's URL", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "lg.host.kickdlg" });
  const name = uniqueRoomName("leave guard kick dialog");
  const roomId = await createRoomOnPage(page, { name });
  const guest = await guestPage(browser, "lg.guest.kickdlg");
  try {
    // Home first, then the room through the app, so Back has somewhere to go.
    await guest.page.goto("/");
    await guest.page.getByRole("button", { name: `Join ${name}` }).click();
    await enterRoom(guest.page);
    await expect(tile(page, "lg.guest.kickdlg")).toBeVisible();

    await guest.page.evaluate(() => history.back());
    await expect(confirm(guest.page)).toBeVisible();

    await kick(page, "lg.guest.kickdlg");
    await expect(
      guest.page.getByRole("heading", { name: "you were removed from this room" }),
    ).toBeVisible();
    await expect(confirm(guest.page)).toHaveCount(0);
    // The browser had moved on to home; it is back at the room, matching what's shown.
    await inRoom(guest.page, roomId);

    // And a reload there is the lobby, not a rejoin.
    await guest.page.reload();
    await expect(guest.page.getByRole("button", { name: "Enter room" })).toBeVisible();
  } finally {
    await guest.context.close();
  }
});

test("no prompt after the Leave button or in the lobby; the unload prompt is registered only while joined", async ({
  page,
  context,
  browser,
}) => {
  const roomId = await hostRoom(page, context, "lg.host.none");
  const visitor = await guestPage(browser, "lg.guest.none");
  try {
    // Only in the lobby: nothing to confirm.
    await visitor.page.goto(`/room/${roomId}`);
    await expect(visitor.page.getByRole("button", { name: "Enter room" })).toBeVisible();
    expect(await asksOnUnload(visitor.page)).toBe(false);
    await railHome(visitor.page).click();
    await expect(visitor.page).toHaveURL(/\/$/);
    await expect(confirm(visitor.page)).toHaveCount(0);

    // Joined: the unload prompt is on. The Leave button just leaves, and it is off again.
    expect(await asksOnUnload(page)).toBe(true);
    await page.getByRole("button", { name: "leave" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(confirm(page)).toHaveCount(0);
    expect(await asksOnUnload(page)).toBe(false);
  } finally {
    await visitor.context.close();
  }
});

test("being kicked is not a leave: no prompt, and the removal notice's link goes home", async ({
  page,
  context,
  browser,
}) => {
  const roomId = await hostRoom(page, context, "lg.host.kick");
  const guest = await guestPage(browser, "lg.guest.kick");
  try {
    await enterRoom(guest.page, roomId);
    await expect(tile(page, "lg.guest.kick")).toBeVisible();
    expect(await asksOnUnload(guest.page)).toBe(true);

    await kick(page, "lg.guest.kick");
    await expect(
      guest.page.getByRole("heading", { name: "you were removed from this room" }),
    ).toBeVisible();
    expect(await asksOnUnload(guest.page)).toBe(false);

    await guest.page.getByRole("link", { name: "back to rooms" }).click();
    await expect(guest.page).toHaveURL(/\/$/);
    await expect(confirm(guest.page)).toHaveCount(0);
  } finally {
    await guest.context.close();
  }
});
