import type { Browser, Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// Moderation over the realtime socket (#32, ADR 15): kick, stop share, roles and rename.

/** A new signed-in context on `roomId`, joined (its controls are enabled once joined). */
async function joinAs(browser: Browser, username: string, roomId: string) {
  const context = await browser.newContext();
  await signIn(context, { username });
  const page = await newPage(context);
  await enterRoom(page, roomId);
  return { context, page };
}

/** Open `name`'s moderation menu on `page` and pick `item`. */
async function moderateOn(page: Page, name: string, item: string) {
  // A person's controls show on hover (or keyboard focus), as for anyone using a mouse.
  await tile(page, name).hover();
  await page.getByRole("button", { name: `Moderate ${name}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
  // A kick asks first (ADR 15: it's permanent for the room).
  if (item === "kick from room") {
    await page
      .getByRole("dialog", { name: `kick ${name}?` })
      .getByRole("button", { name: `kick ${name}` })
      .click();
  }
}

const tile = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("the host kicks someone, who is removed and can't come back", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "mod.kicker" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("mod kick") });
  const guest = await joinAs(browser, "mod.kicked", roomId);
  try {
    await expect(tile(page, "mod.kicked")).toBeVisible();
    await moderateOn(page, "mod.kicked", "kick from room");

    await expect(
      guest.page.getByRole("heading", { name: "you were removed from this room" }),
    ).toBeVisible();
    await expect(tile(page, "mod.kicked")).toHaveCount(0);

    // Coming back doesn't help.
    await guest.page.reload();
    await guest.page.getByRole("button", { name: "Enter room" }).click();
    await expect(
      guest.page.getByRole("heading", { name: "you were removed from this room" }),
    ).toBeVisible();
    await expect(tile(page, "mod.kicked")).toHaveCount(0);
  } finally {
    await guest.context.close();
  }
});

test("the host stops a share, promotes a mod and renames the room for everyone", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "mod.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("mod powers") });
  const guest = await joinAs(browser, "mod.guest", roomId);
  try {
    // Stop share: the streamer's own controls turn off, and nobody shows it any more.
    await guest.page.getByRole("button", { name: "Share screen" }).click();
    const live = (p: Page) => p.getByText("LIVE", { exact: true });
    await expect(live(page)).toHaveCount(1);
    await moderateOn(page, "mod.guest", "stop their share");
    await expect(live(page)).toHaveCount(0);
    await expect(live(guest.page)).toHaveCount(0);
    await expect(guest.page.getByRole("button", { name: "Share screen" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(guest.page.getByText("mod.host stopped your share")).toBeVisible();

    // Promote: everyone sees the mod badge.
    await moderateOn(page, "mod.guest", "make mod");
    await expect(tile(page, "mod.guest").getByText("mod", { exact: true })).toBeVisible();
    await guest.page.getByRole("tab", { name: /feed/ }).click();
    const feed = guest.page.getByRole("tabpanel", { name: /feed/ });
    await expect(feed).toContainText("mod.guest was made a mod by mod.host");
    await expect(feed).toContainText("mod.guest had their share stopped by mod.host");

    // Rename: only the host gets the button; everyone sees the new name.
    await expect(guest.page.getByRole("button", { name: "rename" })).toHaveCount(0);
    const renamed = uniqueRoomName("mod renamed");
    await page.getByRole("button", { name: "rename" }).click();
    await page.getByRole("textbox", { name: "Room name" }).fill(renamed);
    await page.getByRole("button", { name: "save" }).click();
    await expect(guest.page.getByRole("heading", { name: renamed })).toBeVisible();
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  } finally {
    await guest.context.close();
  }
});
