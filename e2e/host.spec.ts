import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

/** The room's people tab, opened. */
async function peopleTab(page: Page) {
  await page.getByRole("tab", { name: /people/ }).click();
  return page.getByRole("tabpanel", { name: /people/ });
}

/** `username`'s name-and-badges block in the people tab. */
const personIn = (page: Page, username: string) =>
  page
    .getByRole("tabpanel", { name: /people/ })
    .locator("div")
    .filter({ has: page.getByRole("button", { name: username, exact: true }) })
    .last();

test("when the host leaves, host passes to the other person after the 30s grace", async ({
  page,
  context,
  browser,
}) => {
  // The host grace is 30 real seconds on the e2e server.
  test.setTimeout(120_000);
  await signIn(context, { username: "hg.lead" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("host grace hang") });

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "hg.guest" });
    const guest = await newPage(guestContext);
    await enterRoom(guest, roomId);
    await peopleTab(guest);
    await expect(personIn(guest, "hg.lead")).toContainText("host");
    await expect(personIn(guest, "hg.guest (you)")).not.toContainText("host");

    // The host leaves the room: the guest sees the host grace, then becomes host.
    await page.goto("/");
    const pending = guest.getByText("host reconnecting…");
    await expect(pending).toBeVisible();
    await expect(personIn(guest, "hg.guest (you)")).toContainText("host", { timeout: 45_000 });
    await expect(personIn(guest, "hg.lead")).toBeHidden();
    await expect(pending).toBeHidden();
    await guest.getByRole("tab", { name: /chat/ }).click();
    await expect(guest.getByText("hg.guest is the host now")).toBeVisible();
  } finally {
    await guestContext.close();
  }
});
