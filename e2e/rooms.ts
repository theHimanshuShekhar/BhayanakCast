import { type Browser, expect, type Page } from "@playwright/test";
import { signIn } from "./auth";

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
  await page.goto("/");
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
    return await createRoomOnPage(await context.newPage(), room);
  } finally {
    await context.close();
  }
}
