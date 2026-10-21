import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createUser, uniqueUsername } from "./profiles";
import { createRoomOnPage, uniqueRoomName } from "./rooms";

const HOUR = 3600;

// Every test shares one database, so other tests add rooms, users and stats concurrently:
// assert that the sidebar's lifetime numbers grow by at least what this test added, never
// exact totals. Live counts can drop at any moment as other tests' rooms end, so they are
// only checked against a room this test holds open.

/** A "Right Now" tile's number. */
async function rightNow(page: Page, label: string): Promise<number> {
  const tile = page
    .getByRole("region", { name: "Right Now" })
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::div");
  return Number(await tile.textContent());
}

/** A "Community" row's number (hours drop their "h"). */
async function community(page: Page, label: string): Promise<number> {
  const value = page
    .getByRole("region", { name: "Community" })
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::span");
  return Number((await value.textContent())?.replace(/h$/, ""));
}

test("the home sidebar counts real rooms, members and lifetime stats", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const membersBefore = await community(page, "Members");
  const watchedBefore = await community(page, "Hours Watched");
  const streamedBefore = await community(page, "Hours Streamed");
  const hostedBefore = await community(page, "Rooms Hosted");

  // The host stays in the room until the checks are done, so it can't end meanwhile.
  const host = await browser.newContext();
  try {
    await signIn(host, { username: uniqueUsername("sidebar.host") });
    const name = uniqueRoomName("sidebar room");
    await createRoomOnPage(await newPage(host), { name });
    await createUser(browser, uniqueUsername("sidebar.veteran"), {
      stats: { secondsWatched: 500 * HOUR, secondsStreamed: 200 * HOUR, roomsHosted: 40 },
    });

    await page.reload();
    await expect(page.getByRole("button", { name: `Join ${name}` })).toBeVisible();
    expect(await rightNow(page, "Watching")).toBeGreaterThanOrEqual(1);
    expect(await community(page, "Members")).toBeGreaterThanOrEqual(membersBefore + 2);
    expect(await community(page, "Hours Watched")).toBeGreaterThanOrEqual(watchedBefore + 499);
    expect(await community(page, "Hours Streamed")).toBeGreaterThanOrEqual(streamedBefore + 199);
    expect(await community(page, "Rooms Hosted")).toBeGreaterThanOrEqual(hostedBefore + 40);
  } finally {
    await host.close();
  }
});

test("every Right Now tile shows a number, the online count from the lobby socket", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Right Now" });
  await expect(panel.getByTitle("Connecting to the live count")).toHaveCount(0);
  for (const label of ["Online", "Watching", "Streaming"]) {
    expect(Number.isInteger(await rightNow(page, label)), label).toBe(true);
  }
});
