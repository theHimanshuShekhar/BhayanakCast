import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// The fullscreen buttons on a tile and in the room's control bar toggle (#85), and follow the
// browser's real fullscreen state. Playwright's headless Firefox has no Fullscreen API
// (`document.fullscreenEnabled` is false), so the button is rightly absent there.
const NO_FIREFOX = "headless Firefox has no Fullscreen API";

const fullscreenTag = (page: Page) =>
  page.evaluate(() => document.fullscreenElement?.tagName ?? null);

test("the tile's fullscreen button enters and exits, and follows Escape", async ({
  page,
  context,
  browser,
  browserName,
}) => {
  test.skip(browserName === "firefox", NO_FIREFOX);
  await signIn(context, { username: "fs.tile" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("fullscreen tile") });

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "fs.tileguest" });
    await enterRoom(await newPage(guestContext), roomId);

    // Your own tile has no controls until you show something; the guest's does.
    const tile = page.getByRole("group", { name: "fs.tileguest", exact: true });
    await tile.hover();
    const enter = tile.getByRole("button", { name: "Fullscreen", exact: true });
    const exit = tile.getByRole("button", { name: "Exit fullscreen" });
    await expect(enter).toHaveAttribute("aria-pressed", "false");

    await enter.click();
    await expect(exit).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("aria-label")))
      .toBe("fs.tileguest");
    // Its other controls stay reachable meanwhile.
    await expect(tile.getByRole("button", { name: "Pin" })).toBeVisible();

    await exit.click();
    await expect(enter).toHaveAttribute("aria-pressed", "false");
    expect(await fullscreenTag(page)).toBeNull();

    // Leaving the browser's own way (Escape) updates the button too.
    await enter.click();
    await expect(exit).toBeVisible();
    await page.evaluate(() => document.exitFullscreen());
    await expect(enter).toHaveAttribute("aria-pressed", "false");
    await expect(exit).toHaveCount(0);
  } finally {
    await guestContext.close();
  }
});

test("the room's fullscreen button enters and exits, and a tile takes over from it", async ({
  page,
  context,
  browser,
  browserName,
}) => {
  test.skip(browserName === "firefox", NO_FIREFOX);
  await signIn(context, { username: "fs.room" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("fullscreen room") });

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "fs.roomguest" });
    await enterRoom(await newPage(guestContext), roomId);
    const tile = page.getByRole("group", { name: "fs.roomguest", exact: true });
    await expect(tile).toBeVisible();

    // The room's button is the one outside any tile.
    const enter = page.locator('button[aria-label="Fullscreen"]:not([role=group] *)');
    const exit = page.locator('button[aria-label="Exit fullscreen"]:not([role=group] *)');
    await expect(enter).toHaveAttribute("aria-pressed", "false");
    await enter.click();
    await expect(exit).toHaveAttribute("aria-pressed", "true");
    expect(await fullscreenTag(page)).toBe("HTML");

    await exit.click();
    await expect(enter).toHaveAttribute("aria-pressed", "false");
    expect(await fullscreenTag(page)).toBeNull();

    // The room, then a tile: it switches cleanly, and the room's button lets go.
    await enter.click();
    await expect(exit).toBeVisible();
    await tile.hover();
    await tile.getByRole("button", { name: "Fullscreen", exact: true }).click();
    await expect(tile.getByRole("button", { name: "Exit fullscreen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await fullscreenTag(page)).toBe("DIV");
    await expect(enter).toHaveAttribute("aria-pressed", "false");
  } finally {
    await guestContext.close();
  }
});

test("without the Fullscreen API there is no fullscreen button", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "fs.none" });
  // iPhone Safari: `fullscreenEnabled` is false for anything but video.
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false });
  });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("fullscreen none") });

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "fs.noneguest" });
    await enterRoom(await newPage(guestContext), roomId);
    const tile = page.getByRole("group", { name: "fs.noneguest", exact: true });
    await expect(tile.getByRole("button", { name: "Pin" })).toBeAttached();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: /fullscreen/i })).toHaveCount(0);
  } finally {
    await guestContext.close();
  }
});
