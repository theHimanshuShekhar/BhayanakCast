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
 * A room name no other test (or browser project) uses: every test shares one server and
 * one database, so lists hold everyone's rooms. Search for the returned name, not `base`.
 */
export function uniqueRoomName(base: string): string {
  return `${base} ${Math.random().toString(36).slice(2, 8)}`;
}

export interface NewRoom {
  name: string;
  isPrivate?: boolean;
}

/** Create a room through the create dialog on `page` (signed in) and return its id. */
export async function createRoomOnPage(page: Page, room: NewRoom): Promise<string> {
  await hydrating(page).goto("/");
  // The rail's button; an empty home has a second "Start a Room" button.
  await page.getByRole("button", { name: "Start a Room" }).first().click();
  const dialog = page.getByRole("dialog", { name: "start a hang" });
  await dialog.getByLabel("room name").fill(room.name);
  if (room.isPrivate) await dialog.getByRole("switch").click();
  await dialog.getByRole("button", { name: /start hang/ }).click();
  await expect(page.getByRole("heading", { name: room.name })).toBeVisible();
  const id = /\/room\/([^/?#]+)$/.exec(new URL(page.url()).pathname)?.[1];
  if (!id) throw new Error(`Not on a room page: ${page.url()}`);
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
