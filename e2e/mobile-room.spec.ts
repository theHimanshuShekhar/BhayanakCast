import { devices, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import {
  createRoomOnPage,
  enterRoom,
  enterWithCamera,
  fakeClipboard,
  uniqueRoomName,
} from "./rooms";

// The room on a phone (#76): a touch screen with no hover, a narrow viewport. Chromium only:
// Firefox has no mobile emulation (`isMobile`), and `(pointer: coarse)` needs it.
const { defaultBrowserType: _, ...phone } = devices["Pixel 7"];
test.use(phone);
test.skip(({ browserName }) => browserName !== "chromium", "needs Chromium's mobile emulation");

/** `locator`'s opacity: Playwright counts an invisible (opacity 0) element as visible. */
const opacityOf = (locator: ReturnType<Page["locator"]>) =>
  locator.evaluate((el) => Number(getComputedStyle(el).opacity));

test("tile controls are reachable by tap, and a second tap on the tile hides them", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "mob.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("mobile tiles") });

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "mob.guest" });
    await enterWithCamera(await newPage(guestContext), roomId);

    const tile = page.getByRole("group", { name: "mob.guest", exact: true });
    const pin = tile.getByRole("button", { name: "Pin" });
    await expect(pin).toBeAttached();
    // Hidden until the tile is tapped, and not catching taps meanwhile.
    expect(await opacityOf(pin.locator("xpath=.."))).toBe(0);

    await tile.tap({ position: { x: 20, y: 60 } });
    await expect.poll(() => opacityOf(pin.locator("xpath=.."))).toBe(1);
    await expect(tile.getByRole("button", { name: "Mute for me" })).toBeVisible();
    await expect(tile.getByRole("slider", { name: "Volume for mob.guest" })).toBeVisible();
    await expect(tile.getByRole("button", { name: "Fullscreen" })).toBeVisible();
    await expect(tile.getByRole("button", { name: "Moderate mob.guest" })).toBeVisible();

    // A control works from a tap.
    await tile.getByRole("button", { name: "Mute for me" }).tap();
    await expect(tile.getByRole("button", { name: "Unmute for me" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await tile.getByRole("button", { name: "Moderate mob.guest" }).tap();
    await expect(page.getByRole("menuitem", { name: "kick from room" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "kick from room" })).toBeHidden();

    // Tapping the tile again (even on the bar's own background) puts them away.
    await tile.tap({ position: { x: 20, y: 60 } });
    await expect.poll(() => opacityOf(pin.locator("xpath=.."))).toBe(0);
  } finally {
    await guestContext.close();
  }
});

test("a tile's fullscreen button works from a tap, and its controls stay reachable in fullscreen", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "mob.full" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("mobile fullscreen") });

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "mob.fullguest" });
    await enterWithCamera(await newPage(guestContext), roomId);

    const tile = page.getByRole("group", { name: "mob.fullguest", exact: true });
    await tile.tap({ position: { x: 20, y: 60 } });
    await tile.getByRole("button", { name: "Fullscreen mob.fullguest", exact: true }).tap();
    const exit = tile.getByRole("button", { name: "Exit fullscreen" });
    await expect(exit).toHaveAttribute("aria-pressed", "true");

    // The bar is still reachable, and so is the moderation menu: only the fullscreen element
    // shows, so the menu opens inside it.
    await expect(tile.getByRole("button", { name: "Pin" })).toBeVisible();
    await tile.getByRole("button", { name: "Moderate mob.fullguest" }).tap();
    const kick = page.getByRole("menuitem", { name: "kick from room" });
    await expect(kick).toBeVisible();
    expect(await kick.evaluate((el) => document.fullscreenElement?.contains(el))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(kick).toBeHidden();

    await exit.tap();
    await expect(
      tile.getByRole("button", { name: "Fullscreen mob.fullguest", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  } finally {
    await guestContext.close();
  }
});

test("the host copies the invite link from the control bar", async ({ page, context }) => {
  await signIn(context, { username: "mob.invite" });
  await fakeClipboard(context);
  await createRoomOnPage(page, { name: uniqueRoomName("mobile invite"), isPrivate: true });

  await page.getByRole("button", { name: "Room info" }).tap();
  await page.getByRole("menuitem", { name: "regenerate invite link" }).waitFor();
  await page.getByRole("menuitem", { name: "copy invite link" }).tap();
  await expect(page.getByText("invite link copied")).toBeVisible();
  const link = await page.evaluate(() => (window as unknown as { copied?: string }).copied);
  expect(link).toMatch(/\/join\/[\w-]+$/);
});

test("a public room's info offers its own link on a phone, not an invite", async ({
  page,
  context,
}) => {
  await signIn(context, { username: "mob.public" });
  await fakeClipboard(context);
  await createRoomOnPage(page, { name: uniqueRoomName("mobile public") });
  await page.getByRole("button", { name: "Room info" }).tap();
  await expect(page.getByRole("menuitem", { name: "copy invite link" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "copy room link" }).tap();
  await expect(page.getByText("room link copied")).toBeVisible();
});

test("a chip's controls (someone with no camera or share) open with a tap", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "mob.chiphost" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("mobile chip") });
  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "mob.chip" });
    await enterRoom(await newPage(guestContext), roomId);
    const chip = page.getByRole("group", { name: "mob.chip", exact: true });
    const mute = chip.getByRole("button", { name: "Mute for me" });
    await expect(mute).toBeAttached();
    expect(await opacityOf(mute.locator("xpath=../.."))).toBe(0);
    await chip.tap({ position: { x: 60, y: 20 } });
    await expect.poll(() => opacityOf(mute.locator("xpath=../.."))).toBe(1);
    await mute.tap();
    await expect(chip.getByRole("button", { name: "Unmute for me" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } finally {
    await guestContext.close();
  }
});

test("the chat drawer is a dialog: focus moves in and stays, Escape closes it and returns focus", async ({
  page,
  context,
}) => {
  await signIn(context, { username: "mob.chat" });
  await createRoomOnPage(page, { name: uniqueRoomName("mobile chat") });

  // By attribute, not role: while the drawer is open the page behind it is aria-hidden, which
  // role queries skip.
  const opener = page.locator('button[aria-label="Chat & people"]');
  const drawer = page.getByRole("dialog", { name: "Room chat and people" });
  await expect(drawer).toBeHidden();
  await expect(opener).toHaveAttribute("aria-expanded", "false");

  await opener.tap();
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  const focusInDrawer = () =>
    page.evaluate(() =>
      Boolean(
        document.activeElement?.closest('[role="dialog"][aria-label="Room chat and people"]'),
      ),
    );
  await expect.poll(focusInDrawer).toBe(true);

  // The page behind is out of reach: not in the accessibility tree, and Tab never leaves.
  await expect(page.getByRole("button", { name: "Mute mic" })).toHaveCount(0);
  // Past the drawer's last control Tab lands on one of Base UI's focus guards (a sentinel just
  // outside the popup), which sends focus back in on the next frame: so wait for focus to be
  // inside again. If it truly escaped, it would settle on the page and this would time out.
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(key);
      await expect.poll(focusInDrawer, { message: `focus after ${key} #${i + 1}` }).toBe(true);
    }
  }

  // The drawer works: send a message from it, and it is still there after a close and reopen.
  await drawer.getByLabel("Chat message").fill("hi from my phone");
  await drawer.getByRole("button", { name: "Send" }).tap();
  await expect(drawer.getByText("hi from my phone")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Mute mic" })).toBeVisible();

  // A tap outside closes it too, and its close button.
  await opener.tap();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("hi from my phone")).toBeVisible();
  await drawer.getByRole("button", { name: "Close panel" }).tap();
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.tap();
  await page.touchscreen.tap(8, 300);
  await expect(drawer).toBeHidden();
});

test("fields are 16px, so iOS doesn't zoom in on them", async ({ page, context }) => {
  await signIn(context, { username: "mob.zoom" });
  await createRoomOnPage(page, { name: uniqueRoomName("mobile zoom") });

  await page.getByRole("button", { name: "Chat & people" }).tap();
  const composer = page.getByRole("dialog").getByLabel("Chat message");
  expect(await composer.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "rename" }).tap();
  const rename = page.getByLabel("Room name");
  expect(await rename.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");

  await page.goto("/");
  const search = page.getByLabel("Search rooms and users");
  expect(await search.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
});
