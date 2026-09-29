import type { BrowserContext } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, uniqueRoomName } from "./rooms";

// Private rooms (#41, ADR 16): copy the invite link, knock, and the host admits.

/**
 * Record what the page copies instead of touching the real clipboard, which needs permissions
 * Playwright can't grant in every browser. Read it back with `copied(page)`.
 */
async function fakeClipboard(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied?: string }).copied = text;
        },
      },
    });
  });
}

test("the host copies the invite link, a guest knocks and is admitted", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "priv.host" });
  await fakeClipboard(context);
  const name = uniqueRoomName("private hang");
  const roomId = await createRoomOnPage(page, { name, isPrivate: true });

  await page.getByRole("button", { name: "room info" }).click();
  await page.getByRole("menuitem", { name: "copy invite link" }).click();
  await expect(page.getByText("invite link copied")).toBeVisible();
  const link = await page.evaluate(() => (window as unknown as { copied?: string }).copied);
  expect(link).toMatch(/\/join\/[\w-]+$/);

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "priv.guest" });
    const guest = await newPage(guestContext);

    // Not approved: the room itself isn't there for them.
    await guest.goto(`/room/${roomId}`);
    await expect(guest.getByRole("heading", { name: "room not found" })).toBeVisible();

    await guest.goto(link ?? "");
    await expect(guest.getByRole("heading", { name })).toBeVisible();
    await guest.getByRole("button", { name: "knock" }).click();
    await expect(guest.getByText("waiting for the host to let you in")).toBeVisible();

    // The toast (its title; the text is also announced in a live region).
    const knockToast = page.getByRole("heading", { name: "priv.guest wants to join" });
    await expect(knockToast).toBeVisible();
    await page.getByRole("button", { name: "admit priv.guest" }).click();
    await expect(knockToast).toHaveCount(0);

    // Straight into the room, and everyone sees them there.
    await expect(guest).toHaveURL(new RegExp(`/room/${roomId}$`));
    await expect(guest.getByRole("button", { name: "Turn camera on" })).toBeEnabled();
    await expect(page.getByRole("group", { name: "priv.guest", exact: true })).toBeVisible();

    // The approval lasts: a reload goes back in without knocking.
    await guest.reload();
    await expect(guest.getByRole("button", { name: "Turn camera on" })).toBeEnabled();
  } finally {
    await guestContext.close();
  }
});
