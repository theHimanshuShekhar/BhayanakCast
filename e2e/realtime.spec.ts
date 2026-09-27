import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, uniqueRoomName } from "./rooms";

/** The room's people tab, opened. */
async function peopleTab(page: Page) {
  await page.getByRole("tab", { name: /people/ }).click();
  return page.getByRole("tabpanel", { name: /people/ });
}

test("two signed-in users in one room see each other arrive and leave", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "rt.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("realtime hang") });
  const hostPeople = await peopleTab(page);
  await expect(hostPeople).toContainText("rt.host (you)");
  await expect(page.getByText("1/10")).toBeVisible();

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "rt.guest" });
    const guest = await newPage(guestContext);
    await guest.goto(`/room/${roomId}`);
    const guestPeople = await peopleTab(guest);
    await expect(guestPeople).toContainText("rt.host");
    await expect(guestPeople).toContainText("rt.guest (you)");

    // The host sees the guest arrive live, on stage and in the people tab.
    await expect(hostPeople).toContainText("rt.guest");
    await expect(page.getByText("2/10")).toBeVisible();

    await guest.getByRole("button", { name: /^leave$/ }).click();
    await expect(guest).toHaveURL(/\/$/);
    await expect(hostPeople).not.toContainText("rt.guest");
    await expect(page.getByText("1/10")).toBeVisible();

    // Coming back, and then closing the tab, work the same way.
    await guest.goto(`/room/${roomId}`);
    await expect(hostPeople).toContainText("rt.guest");
    await guest.close();
    await expect(hostPeople).not.toContainText("rt.guest");
  } finally {
    await guestContext.close();
  }
});
