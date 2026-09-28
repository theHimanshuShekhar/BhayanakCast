import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomAs, createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

/** The room's people tab, opened. */
async function peopleTab(page: Page) {
  await page.getByRole("tab", { name: /people/ }).click();
  return page.getByRole("tabpanel", { name: /people/ });
}

test("joining a room from a second tab takes over: the first tab is told and leaves", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "to.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("takeover hang") });
  await expect(await peopleTab(page)).toContainText("to.host (you)");

  // A second tab of the same user opens another room: the first tab loses its room.
  const otherRoom = await createRoomAs(browser, "to.other", { name: uniqueRoomName("elsewhere") });
  const second = await newPage(context);
  await enterRoom(second, otherRoom);
  await expect(await peopleTab(second)).toContainText("to.host (you)");
  const notice = page.getByRole("alert").filter({ hasText: "you joined from elsewhere" });
  await expect(notice).toBeVisible();

  // The second tab can come to the first room too; the first tab stays out of it.
  await enterRoom(second, roomId);
  await expect(await peopleTab(second)).toContainText("to.host (you)");
  await expect(notice).toBeVisible();

  // The notice links home, where the first tab carries on browsing.
  await notice.getByRole("link", { name: "back to rooms" }).click();
  await expect(page).toHaveURL(/\/$/);
});
