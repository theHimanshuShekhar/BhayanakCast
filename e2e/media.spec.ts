import type { Browser, Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, uniqueRoomName } from "./rooms";

// Mic/cam/share state over the realtime socket (#29). No real media yet: sharing is a flag.

/** The LIVE chip on a streamer's tile (not the room's "LIVE · 3m" header chip). */
const liveTile = (page: Page) => page.getByText("LIVE", { exact: true });

/** A new signed-in context on `roomId`, joined (its share button is enabled once joined). */
async function joinAs(browser: Browser, username: string, roomId: string) {
  const context = await browser.newContext();
  await signIn(context, { username });
  const page = await newPage(context);
  await page.goto(`/room/${roomId}`);
  await expect(page.getByRole("button", { name: "Turn camera on" })).toBeEnabled();
  return { context, page };
}

test("toggling share in one browser shows the LIVE tile in another", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "media.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("media share") });
  const guest = await joinAs(browser, "media.guest", roomId);
  try {
    await expect(liveTile(guest.page)).toHaveCount(0);

    const share = page.getByRole("button", { name: "Share screen" });
    await expect(share).toBeEnabled();
    await share.click();
    await expect(page.getByRole("button", { name: "Stop sharing" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(liveTile(guest.page)).toHaveCount(1);
    await expect(liveTile(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Stop sharing" }).click();
    await expect(liveTile(guest.page)).toHaveCount(0);
  } finally {
    await guest.context.close();
  }
});

test("with 3 people sharing, everyone else's share button is disabled", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(90_000);
  await signIn(context, { username: "media.s1" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("media limit") });
  const others = [];
  try {
    for (const username of ["media.s2", "media.s3", "media.watcher"]) {
      others.push(await joinAs(browser, username, roomId));
    }
    const [s2, s3, watcher] = others.map((o) => o.page) as [Page, Page, Page];
    for (const streamer of [page, s2, s3]) {
      await streamer.getByRole("button", { name: "Share screen" }).click();
    }
    await expect(liveTile(watcher)).toHaveCount(3);

    const share = watcher.getByRole("button", { name: "Share screen" });
    await expect(share).toBeDisabled();
    await expect(share).toHaveAttribute("title", "3 people are already sharing");

    // One stops, and the button comes back.
    await s2.getByRole("button", { name: "Stop sharing" }).click();
    await expect(share).toBeEnabled();
    await share.click();
    await expect(liveTile(page)).toHaveCount(3);
  } finally {
    for (const other of others) await other.context.close();
  }
});
