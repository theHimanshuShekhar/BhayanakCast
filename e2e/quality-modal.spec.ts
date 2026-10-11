import type { Browser, Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// The stream quality modal (#104, ADR 2 addendum): a viewer opens it on a share's tile and sees
// why the stream looks the way it does; the streamer opens theirs on their own share and sees
// the viewer's row. Chromium shares its fake screen, Firefox a stand-in (e2e/fixtures.ts).

/** The five reasons a viewer is shown (src/lib/quality-reason.ts). */
const REASON =
  /^(Best quality|Streamer's upload is shared|The connection between you|Streamer's computer|Getting started \/ trying higher)$/;

/** A new signed-in context on `roomId`, entered through the lobby. */
async function joinAs(browser: Browser, username: string, roomId: string) {
  const context = await browser.newContext();
  await signIn(context, { username });
  const page = await newPage(context);
  await enterRoom(page, roomId);
  return { context, page };
}

/** Open the quality modal from `name`'s tile: the controls show on hover. */
async function openQuality(page: Page, tileName: string, person: string) {
  const tile = page.getByRole("group", { name: tileName, exact: true });
  await tile.hover();
  await tile.getByRole("button", { name: `Quality ${person}` }).click();
  return page.getByRole("dialog", { name: /^quality/ });
}

test("a viewer sees why a stream looks as it does, and the streamer how the upload is shared", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(150_000);
  await signIn(context, { username: "qm.streamer" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("quality modal") });
  const viewer = await joinAs(browser, "qm.viewer", roomId);
  try {
    // Nothing is shared yet: no quality button anywhere.
    await expect(viewer.page.getByRole("button", { name: /^Quality / })).toHaveCount(0);

    await page.getByRole("button", { name: "Share screen" }).click();
    await expect(page.getByRole("button", { name: "Stop sharing" })).toBeEnabled();
    const tile = viewer.page.getByRole("group", { name: "qm.streamer", exact: true });
    await expect(tile.getByLabel("qm.streamer's screen")).toBeVisible({ timeout: 30_000 });

    // The viewer's modal: the reason first, then the step, both graphs, the chips.
    const modal = await openQuality(viewer.page, "qm.streamer", "qm.streamer");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAccessibleName("quality · qm.streamer's screen");
    // The streamer's word reaches the viewer over the signalling relay.
    const reason = modal.getByTestId("quality-reason");
    await expect(reason).toHaveText(REASON, { timeout: 40_000 });
    await expect(modal.getByTestId("quality-step")).toHaveText(/\d+p\d+|\d+×\d+@\d+/);
    await expect(modal.getByTestId("quality-step")).toContainText("up to");
    // Both graphs, and what the pair is doing.
    await expect(
      modal.getByRole("img", { name: /^Bitrate received from qm\.streamer/ }),
    ).toBeVisible();
    await expect(modal.getByRole("img", { name: /^Resolution of qm\.streamer/ })).toBeVisible();
    await expect(modal.getByText(/^(direct|relay)/)).toBeVisible({ timeout: 30_000 });
    await expect(modal.getByText(/^loss /)).toBeVisible();
    await expect(modal.getByText(/ fps$/)).toBeVisible();
    await expect(modal.getByText(/ freezes$/)).toBeVisible();
    // The bitrate fills in from the readings, once a second.
    await expect(modal.getByRole("img", { name: /Bitrate received.*Mbps now$/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(modal.getByRole("list", { name: /step changes/ })).toBeVisible();

    // Focus stays in the dialog however far one tabs (it passes a focus guard on the way round,
    // so each press is given a moment to settle), and Escape closes it.
    const focusInDialog = () =>
      viewer.page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    for (let i = 0; i < 8; i++) {
      await viewer.page.keyboard.press("Tab");
      await expect.poll(focusInDialog).toBe(true);
    }
    await viewer.page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);

    // The streamer's own: the viewer's row, a sparkline, a step and a reason from their side.
    const own = await openQuality(page, "qm.streamer (you)", "qm.streamer");
    await expect(own).toHaveAccessibleName("quality · your share");
    await expect(
      own.getByRole("img", { name: /^Your total upload against the video budget/ }),
    ).toBeVisible();
    // Nothing has strained the uplink, so the budget is still the starting estimate.
    await expect(own.getByText("video budget (estimate)")).toBeVisible();
    // The footer says it is updating, and doesn't call itself live (red means live).
    await expect(own.getByText(/updating every second/)).toBeVisible();
    await expect(own.getByText(/\blive\b/i)).toHaveCount(0);
    const rows = own.getByRole("list", { name: "viewers" }).getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("qm.viewer");
    await expect(rows.first().getByRole("img", { name: /^qm\.viewer: / })).toBeVisible();
    await expect(rows.first()).toContainText(/\d+p\d+|\d+×\d+@\d+/, { timeout: 30_000 });
    await expect(rows.first()).toContainText(
      /Best quality|Your upload is shared|The connection between you and qm\.viewer|Your computer|Getting started/,
    );
    await page.keyboard.press("Escape");
    await expect(own).toHaveCount(0);

    // The modal goes with the share.
    await openQuality(viewer.page, "qm.streamer", "qm.streamer");
    await page.getByRole("button", { name: "Stop sharing" }).click();
    await expect(viewer.page.getByRole("dialog", { name: /^quality/ })).toHaveCount(0);
  } finally {
    await viewer.context.close();
  }
});
