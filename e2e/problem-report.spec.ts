import type { Browser, BrowserContext } from "@playwright/test";
import { E2E_ADMIN_DISCORD_ID, signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// Report a problem from the room (#117, CONTEXT.md "Problem report"): a viewer reports "blurry"
// from a stream's quality modal, the server quietly asks the other browser for its snapshot, and
// an admin sees the report with the snapshots of both browsers in /admin's recent reports.
// Chromium shares its fake screen, Firefox a stand-in (e2e/fixtures.ts).

const THANKS = "thanks, we got your report";

/** A new signed-in context on `roomId`, entered through the lobby. */
async function joinAs(browser: Browser, username: string, roomId: string) {
  const context = await browser.newContext();
  await signIn(context, { username });
  const page = await newPage(context);
  await enterRoom(page, roomId);
  return { context, page };
}

/** An admin looking at /admin: reload until `ready` holds for the report row of `roomName`. */
async function adminSees(browser: Browser, roomName: string) {
  const context: BrowserContext = await browser.newContext();
  await signIn(context, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
  const page = await newPage(context);
  const row = () =>
    page.getByRole("table", { name: "recent reports" }).getByRole("row").filter({
      hasText: roomName,
    });
  const open = async () => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  };
  return { context, page, row, open };
}

test("a viewer reports 'blurry' from the quality modal, and an admin sees it with both browsers' snapshots", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180_000);
  await signIn(context, { username: "pr.streamer" });
  const roomName = uniqueRoomName("problem report");
  const roomId = await createRoomOnPage(page, { name: roomName });
  const viewer = await joinAs(browser, "pr.viewer", roomId);
  const admin = await adminSees(browser, roomName);
  try {
    await page.getByRole("button", { name: "Share screen" }).click();
    await expect(page.getByRole("button", { name: "Stop sharing" })).toBeEnabled();
    const tile = viewer.page.getByRole("group", { name: "pr.streamer", exact: true });
    await expect(tile.getByLabel("pr.streamer's screen")).toBeVisible({ timeout: 30_000 });
    await tile.hover();
    await tile.getByRole("button", { name: "Quality pr.streamer" }).click();
    const modal = viewer.page.getByRole("dialog", { name: /^quality/ });
    await expect(modal.getByTestId("quality-reason")).toBeVisible({ timeout: 40_000 });

    // The form: one tap sends once a category is picked, and not before.
    const open = modal.getByRole("button", { name: "report a problem" });
    await open.click();
    const form = modal.getByRole("form", { name: "report a problem" });
    const send = form.getByRole("button", { name: "send report" });
    // Focus moves into the form, to the first category; cancelling gives it back to the button.
    await expect(form.getByRole("radio", { name: "blurry" })).toBeFocused();
    await form.getByRole("button", { name: "cancel" }).click();
    await expect(form).toHaveCount(0);
    await expect(open).toBeFocused();
    await open.click();
    await expect(send).toBeDisabled();
    await form.getByText("blurry", { exact: true }).click();
    await expect(form.getByRole("radio", { name: "blurry" })).toBeChecked();
    await expect(send).toBeEnabled();
    await send.click();

    // The reporter hears thanks; the form is gone and a second report waits out the minute.
    await expect(viewer.page.getByText(THANKS)).toBeVisible();
    await expect(form).toHaveCount(0);
    // The button waits out the minute, and still holds focus (it is aria-disabled, not disabled).
    await expect(open).toBeDisabled();
    await expect(open).toBeFocused();

    // Silent to the room: the streamer sees nothing about it, in the room or its feed.
    await page.waitForTimeout(500);
    await expect(page.getByText(THANKS)).toHaveCount(0);
    await expect(page.getByText(/snapshot|reported|report a problem/i)).toHaveCount(0);

    // An admin sees it, with a snapshot from each browser (the batch waits about 3 s).
    await admin.open();
    await expect
      .poll(
        async () => {
          await admin.page.reload();
          const row = admin.row();
          if ((await row.count()) === 0) return "";
          return (await row.first().innerText()).replace(/\s+/g, " ");
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toMatch(/blurry.*pr\.streamer's screen.*2 snapshots.*pr\.viewer.*pr\.streamer/);
    const row = admin.row().first();
    await expect(row).toContainText("pr.viewer");
    // The numbers are in the snapshots, folded away until opened.
    await row.getByText(/2 snapshots/).click();
    // Names and the modal's own words for the reason, never ids or codes.
    await expect(row.getByText(/receiving from pr\.streamer:/)).toBeVisible();
    await expect(row.getByText(/sending to pr\.viewer:/)).toBeVisible();
    // One pairs line per browser, each naming the other person.
    await expect(row.getByText(/pairs: pr\.(viewer|streamer) (connected|relayed)/)).toHaveCount(2);
    await expect(
      row.getByText(
        /Best quality|upload is shared|The connection between you|computer|Getting started/,
      ),
    ).not.toHaveCount(0);
    // The room is linked to its incident on the room timeline (#118).
    await expect(row.getByRole("button", { name: `Incident in ${roomName}` })).toBeVisible();
    // No address, no device label.
    expect(await row.innerText()).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  } finally {
    await viewer.context.close();
    await admin.context.close();
  }
});

test("a general report from the room menu carries its note to the admin, and a user who isn't an admin has no list", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(context, { username: "pr.host" });
  const roomName = uniqueRoomName("general report");
  const roomId = await createRoomOnPage(page, { name: roomName });
  const guest = await joinAs(browser, "pr.guest", roomId);
  const admin = await adminSees(browser, roomName);
  try {
    await guest.page.getByRole("button", { name: "Room info" }).click();
    await guest.page.getByRole("menuitem", { name: "report a problem" }).click();
    const dialog = guest.page.getByRole("dialog", { name: "report a problem" });
    const note = dialog.getByLabel("note (optional)");
    await dialog.getByText("no audio", { exact: true }).click();
    // The note is bounded where it is typed.
    await note.fill("x".repeat(400));
    await expect(note).toHaveValue("x".repeat(280));
    await note.fill("can't hear pr.host");
    await dialog.getByRole("button", { name: "send report" }).click();
    await expect(guest.page.getByText(THANKS)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    // Nobody else in the room is told.
    await expect(page.getByText(THANKS)).toHaveCount(0);

    await admin.open();
    await expect
      .poll(
        async () => {
          await admin.page.reload();
          return (await admin.row().count()) > 0;
        },
        { timeout: 45_000, intervals: [2_000] },
      )
      .toBe(true);
    const row = admin.row().first();
    await expect(row).toContainText("no audio");
    await expect(row).toContainText("can't hear pr.host");
    await expect(row).toContainText("pr.guest");

    // A signed-in user who isn't an admin never gets the page.
    await guest.page.goto("/admin");
    await expect(guest.page).toHaveURL(/\/$/);
  } finally {
    await guest.context.close();
    await admin.context.close();
  }
});
