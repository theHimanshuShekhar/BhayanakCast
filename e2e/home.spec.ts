import { expect, type Page, test } from "@playwright/test";
import { createUser, uniqueUsername } from "./profiles";
import { createRoomAs, uniqueRoomName } from "./rooms";

const HOUR = 3600;

// Every test shares one database, so other tests add rooms, users and stats concurrently:
// assert that the sidebar's numbers grow by at least what this test added, never exact totals.

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
  const liveBefore = await rightNow(page, "Live Rooms");
  const membersBefore = await community(page, "Members");
  const watchedBefore = await community(page, "Hours Watched");
  const streamedBefore = await community(page, "Hours Streamed");
  const hostedBefore = await community(page, "Rooms Hosted");

  await createRoomAs(browser, uniqueUsername("sidebar.host"), {
    name: uniqueRoomName("sidebar room"),
  });
  await createUser(browser, uniqueUsername("sidebar.veteran"), {
    stats: { secondsWatched: 500 * HOUR, secondsStreamed: 200 * HOUR, roomsHosted: 40 },
  });

  await page.reload();
  expect(await rightNow(page, "Live Rooms")).toBeGreaterThanOrEqual(liveBefore + 1);
  expect(await community(page, "Members")).toBeGreaterThanOrEqual(membersBefore + 2);
  expect(await community(page, "Hours Watched")).toBeGreaterThanOrEqual(watchedBefore + 499);
  expect(await community(page, "Hours Streamed")).toBeGreaterThanOrEqual(streamedBefore + 199);
  expect(await community(page, "Rooms Hosted")).toBeGreaterThanOrEqual(hostedBefore + 40);
});

test("the online tile waits for the realtime server", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Right Now" });
  await expect(panel.getByTitle("Live online count coming soon")).toContainText("—");
  // The other tiles show numbers.
  expect(Number.isInteger(await rightNow(page, "Watching"))).toBe(true);
  expect(Number.isInteger(await rightNow(page, "Streaming"))).toBe(true);
});
