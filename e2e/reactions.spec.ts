import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, uniqueRoomName } from "./rooms";

// Reactions and the room feed over the realtime socket (#28).

const tile = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const feedPanel = (page: Page) => page.getByRole("tabpanel", { name: /feed/ });

test("a reaction floats on the target's tile for everyone and shows in the feed", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "rx.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("reactions") });

  const guestContext = await browser.newContext();
  const lateContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "rx.guest" });
    const guest = await newPage(guestContext);
    await guest.goto(`/room/${roomId}`);
    await expect(tile(page, "rx.guest")).toBeVisible();
    await expect(tile(guest, "rx.host")).toBeVisible();

    // The guest reacts; with nobody pinned or sharing it lands on the host, the first on stage.
    await guest.getByRole("button", { name: "Reactions" }).click();
    await guest.getByRole("menuitem", { name: "React 🔥" }).click();
    await guest.keyboard.press("Escape"); // the picker stays open for more reactions
    await expect(tile(page, "rx.host (you)").getByRole("img", { name: "reaction 🔥" })).toHaveCount(
      1,
    );
    await expect(tile(guest, "rx.host").getByRole("img", { name: "reaction 🔥" })).toHaveCount(1);
    await expect(tile(guest, "rx.guest (you)").getByRole("img")).toHaveCount(0);

    await page.getByRole("tab", { name: /feed/ }).click();
    await expect(feedPanel(page)).toContainText("rx.guest reacted 🔥 to rx.host");
    await expect(feedPanel(page)).toContainText("rx.guest joined");

    // Someone arriving later sees what happened, newest first.
    await signIn(lateContext, { username: "rx.late" });
    const late = await newPage(lateContext);
    await late.goto(`/room/${roomId}`);
    await late.getByRole("tab", { name: /feed/ }).click();
    await expect(feedPanel(late)).toContainText("rx.late joined");
    await expect(feedPanel(late)).toContainText("rx.guest reacted 🔥 to rx.host");
    await expect(feedPanel(late)).toContainText("rx.host joined");
    const text = await feedPanel(late).innerText();
    expect(text.indexOf("rx.late joined")).toBeLessThan(text.indexOf("rx.guest reacted"));
    expect(text.indexOf("rx.guest reacted")).toBeLessThan(text.indexOf("rx.host joined"));

    await guest.getByRole("button", { name: /^leave$/ }).click();
    await expect(feedPanel(page)).toContainText("rx.guest left");
  } finally {
    await guestContext.close();
    await lateContext.close();
  }
});
