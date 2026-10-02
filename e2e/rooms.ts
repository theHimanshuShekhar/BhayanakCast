import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { SeedRoom } from "../src/lib/test-sign-in";
import { postTestAuth, signIn } from "./auth";
import { expect, hydrating, newPage } from "./fixtures";

export type { SeedRoom };

/**
 * Insert a room as given (host, end time, presence and stream intervals) through the
 * test-only seed endpoint, bypassing the UI and realtime server. User ids come from
 * `signIn`. Returns the room id.
 */
export async function seedRoom(context: BrowserContext, room: SeedRoom): Promise<string> {
  const response = await postTestAuth(context, "seed-room", room);
  expect(response.ok(), await response.text()).toBe(true);
  const { roomId } = (await response.json()) as { roomId: string };
  return roomId;
}

/** Sign up fresh users (one per username) in a throwaway context; returns their ids in order. */
export async function createUsers(browser: Browser, usernames: string[]): Promise<string[]> {
  const context = await browser.newContext();
  try {
    const ids: string[] = [];
    for (const username of usernames) ids.push(await signIn(context, { username }));
    return ids;
  } finally {
    await context.close();
  }
}

/** An ISO timestamp `minutes` before now. */
export const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

/**
 * A public past stream named `name`: 30 minutes, ended 10 minutes ago, with a fresh
 * `hostUsername` present and streaming throughout. Returns the room id.
 */
export async function seedPastRoom(
  browser: Browser,
  hostUsername: string,
  name: string,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const hostUserId = await signIn(context, { username: hostUsername });
    const span = { userId: hostUserId, startedAt: minutesAgo(40), endedAt: minutesAgo(10) };
    return await seedRoom(context, {
      name,
      hostUserId,
      createdAt: span.startedAt,
      endedAt: span.endedAt,
      presence: [span],
      streams: [span],
    });
  } finally {
    await context.close();
  }
}

/**
 * `count` public live rooms, each with a fresh host present: enough that home shows its
 * "Filling Up" panel (it waits for more live rooms than the grid shows at a glance).
 */
export async function seedLiveRooms(browser: Browser, count = 5): Promise<void> {
  const context = await browser.newContext();
  try {
    for (let i = 0; i < count; i++) {
      const hostUserId = await signIn(context, { username: `filler.${i}` });
      const span = { userId: hostUserId, startedAt: minutesAgo(5) };
      await seedRoom(context, {
        name: uniqueRoomName("filler"),
        hostUserId,
        createdAt: span.startedAt,
        presence: [span],
      });
    }
  } finally {
    await context.close();
  }
}

/**
 * A room name no other test (or browser project) uses: every test shares one server and
 * one database, so lists hold everyone's rooms. Search for the returned name, not `base`.
 */
export function uniqueRoomName(base: string): string {
  return `${base} ${Math.random().toString(36).slice(2, 8)}`;
}

export interface NewRoom {
  name: string;
  isPrivate?: boolean;
  /** The create dialog's kind button, e.g. "coding" (default: just chatting). */
  kind?: string;
  /** Tags to pick, without the "#" (default: none). */
  tags?: string[];
}

/**
 * Go through the pre-join lobby on `page` (opening `/room/{roomId}` first if given) with mic
 * and camera as they are (off unless the test turned them on), and wait until the room has
 * let the page in (its controls are enabled once joined).
 */
export async function enterRoom(page: Page, roomId?: string): Promise<void> {
  if (roomId) await page.goto(`/room/${roomId}`);
  await page.getByRole("button", { name: "Enter room" }).click();
  await expect(
    page.getByRole("button", { name: /^(Turn camera on|Turn camera off)$/ }),
  ).toBeEnabled();
}

/**
 * Create a room through the create dialog on `page` (signed in), enter it through the lobby,
 * and return its id.
 */
export async function createRoomOnPage(page: Page, room: NewRoom): Promise<string> {
  await hydrating(page).goto("/");
  // The rail's button (home has its own "start a room" button too).
  await page.getByRole("button", { name: "Start a Room" }).first().click();
  const dialog = page.getByRole("dialog", { name: "start a room" });
  await dialog.getByLabel("room name").fill(room.name);
  if (room.kind) await dialog.getByRole("button", { name: room.kind, exact: true }).click();
  if (room.tags?.length) {
    await dialog.getByText("tags and a description").click();
    for (const tag of room.tags) {
      await dialog.getByRole("button", { name: `#${tag}`, exact: true }).click();
    }
  }
  if (room.isPrivate) await dialog.getByRole("switch").click();
  await dialog.getByRole("button", { name: /start room/ }).click();
  await expect(page.getByRole("heading", { name: room.name })).toBeVisible();
  const id = /\/room\/([^/?#]+)$/.exec(new URL(page.url()).pathname)?.[1];
  if (!id) throw new Error(`Not on a room page: ${page.url()}`);
  await enterRoom(page);
  return id;
}

/** Create a room hosted by a fresh user `hostUsername` in a separate browser context. */
export async function createRoomAs(
  browser: Browser,
  hostUsername: string,
  room: NewRoom,
): Promise<string> {
  const context = await browser.newContext();
  try {
    await signIn(context, { username: hostUsername });
    return await createRoomOnPage(await newPage(context), room);
  } finally {
    await context.close();
  }
}

/** The row of live room `name` in the admin's live rooms table (on /admin). */
export const liveRoomRow = (admin: Page, name: string) =>
  admin.getByRole("table", { name: "live rooms" }).getByRole("row").filter({ hasText: name });

/** On `admin` (at /admin), end the live room `name` through its confirmation dialog. */
export async function endRoom(admin: Page, name: string) {
  await liveRoomRow(admin, name)
    .getByRole("button", { name: `End ${name}` })
    .click();
  const dialog = admin.getByRole("dialog", { name: `end ${name}` });
  await dialog.getByRole("button", { name: "end room" }).click();
  await expect(dialog).toHaveCount(0);
}
