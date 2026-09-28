import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

const chatPanel = (page: Page) => page.getByRole("tabpanel", { name: /chat/ });
const composer = (page: Page) => page.getByRole("textbox", { name: "Chat message" });

test("two users chat live, with emoji, mentions and safe links; a late joiner sees history", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "chat.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("chat hang") });
  const hostChat = chatPanel(page);

  const guestContext = await browser.newContext();
  const lateContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "chat.guest" });
    const guest = await newPage(guestContext);
    await enterRoom(guest, roomId);
    const guestChat = chatPanel(guest);
    await expect(hostChat).toContainText("chat.guest joined");

    // The host says hi with a mention and a link; the guest sees it, the link made safe.
    await composer(page).fill("hey @chat.guest see https://example.com/docs.");
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue("");
    await expect(guestChat).toContainText("hey @chat.guest see https://example.com/docs.");
    await expect(guestChat.getByText("@chat.guest", { exact: true })).toBeVisible();
    const link = guestChat.getByRole("link", { name: "https://example.com/docs" });
    await expect(link).toHaveAttribute("href", "https://example.com/docs");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("target", "_blank");

    // The guest answers, inserting an emoji at the caret from the picker by keyboard.
    await composer(guest).fill("nice !");
    await composer(guest).press("End");
    await composer(guest).press("ArrowLeft");
    await guest.getByRole("button", { name: "Insert emoji" }).click();
    await expect(guest.getByRole("button", { name: "grinning face" })).toBeFocused();
    await guest.keyboard.press("ArrowRight");
    await guest.keyboard.press("ArrowDown");
    await expect(guest.getByRole("button", { name: "loudly crying" })).toBeFocused();
    await guest.keyboard.press("Enter");
    await expect(composer(guest)).toBeFocused();
    await expect(composer(guest)).toHaveValue("nice 😭!");
    await guest.keyboard.type(" <b>really</b>");
    await expect(composer(guest)).toHaveValue("nice 😭 <b>really</b>!");
    await guest.keyboard.press("Enter");
    await expect(hostChat).toContainText("nice 😭 <b>really</b>!");
    await expect(hostChat.locator("b")).toHaveCount(0);
    await expect(guestChat).toContainText("nice 😭 <b>really</b>!");

    // Someone arriving later gets the history, then live messages.
    await signIn(lateContext, { username: "chat.late" });
    const late = await newPage(lateContext);
    await enterRoom(late, roomId);
    const lateChat = chatPanel(late);
    await expect(lateChat).toContainText("hey @chat.guest see https://example.com/docs.");
    await expect(lateChat).toContainText("nice 😭 <b>really</b>!");
    await expect(hostChat).toContainText("chat.late joined");

    await guest.getByRole("button", { name: /^leave$/ }).click();
    await expect(hostChat).toContainText("chat.guest left");
    await expect(lateChat).toContainText("chat.guest left");
  } finally {
    await guestContext.close();
    await lateContext.close();
  }
});
