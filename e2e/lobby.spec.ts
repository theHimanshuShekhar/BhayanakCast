import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomAs, enterRoom, uniqueRoomName } from "./rooms";

// The lobby channel (ADR 20): a visitor's page follows the online count and public rooms live.
// Other tests connect and create rooms concurrently on the same server, so assert growth and
// presence, never exact totals (a visitor counts too, once per browser: ADR 20 addendum).

/** The rail's online count, once the lobby socket has reported it. */
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

/**
 * Record every value the rail's online count takes from now on. Users of other tests leave as
 * ours arrives, so a snapshot of the count can miss the arrival (1 -> 2 -> 1); the sequence
 * can't.
 */
async function recordRailOnline(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as { __railOnline?: number[] }).__railOnline = seen;
    const read = () => {
      const label = document.querySelector('[role="status"]')?.getAttribute("aria-label");
      const value = Number.parseInt(label?.match(/^(\d+) online$/)?.[1] ?? "", 10);
      if (!Number.isNaN(value) && value !== seen.at(-1)) seen.push(value);
    };
    new MutationObserver(read).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });
    read();
  });
}

/** Whether the recorded rail count ever went up. */
async function railOnlineWentUp(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const seen = (window as { __railOnline?: number[] }).__railOnline ?? [];
    return seen.some((value, i) => i > 0 && value > (seen[i - 1] ?? value));
  });
}

test("a visitor's rail counts a user who signs in elsewhere", async ({ page, browser }) => {
  await page.goto("/");
  await railOnline(page); // the lobby socket is up
  await markDocument(page);
  await recordRailOnline(page);

  const other = await browser.newContext();
  try {
    await signIn(other, { username: "lobby.arrival" });
    await (await newPage(other)).goto("/");
    await expect.poll(() => railOnlineWentUp(page)).toBe(true);
    expect(await stillSameDocument(page)).toBe(true);
  } finally {
    await other.close();
  }
});

/**
 * The visitor ids `page`'s sockets say hello with, as they open. Register before the first
 * `goto`. The count itself can't tell one browser from two here, as other tests' visitors come
 * and go on the same server; the hub's unit tests pin how an id is counted.
 */
function recordHelloIds(page: Page): (string | undefined)[] {
  const ids: (string | undefined)[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const message = JSON.parse(String(payload)) as { type?: string; visitorId?: string };
      if (message.type === "hello") ids.push(message.visitorId);
    });
  });
  return ids;
}

test("a second browser raises a visitor's rail count", async ({ page, browser }) => {
  await page.goto("/");
  await railOnline(page); // the lobby socket is up, and counts this visitor
  await recordRailOnline(page);

  const other = await browser.newContext();
  try {
    await (await newPage(other)).goto("/");
    await expect.poll(() => railOnlineWentUp(page)).toBe(true);
  } finally {
    await other.close();
  }
});

test("tabs of one browser are one visitor, another browser is another", async ({
  page,
  context,
  browser,
}) => {
  const first = recordHelloIds(page);
  await page.goto("/");
  await railOnline(page);
  await expect.poll(() => first.length).toBeGreaterThan(0);

  // A second tab of the same browser says hello with the same id...
  const tab = await newPage(context);
  const second = recordHelloIds(tab);
  await tab.goto("/");
  await railOnline(tab);
  await expect.poll(() => second.length).toBeGreaterThan(0);
  expect(second[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(second[0]).toBe(first[0]);

  // ...and another browser with its own.
  const other = await browser.newContext();
  try {
    const away = await newPage(other);
    const third = recordHelloIds(away);
    await away.goto("/");
    await expect.poll(() => third.length).toBeGreaterThan(0);
    expect(third[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(third[0]).not.toBe(first[0]);
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
