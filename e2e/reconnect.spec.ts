import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

/** The room's people tab, opened. */
async function peopleTab(page: Page) {
  await page.getByRole("tab", { name: /people/ }).click();
  return page.getByRole("tabpanel", { name: /people/ });
}

interface RoomEventFrame {
  type: "room.event";
  event: { kind: string; userId?: string; participant?: { userId: string } };
}

/** Every `room.event` the page's realtime sockets receive, from now on. */
function recordRoomEvents(page: Page): RoomEventFrame[] {
  const events: RoomEventFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      const message = JSON.parse(payload) as { type?: string };
      if (message.type === "room.event") events.push(message as RoomEventFrame);
    });
  });
  return events;
}

/** Resolves once `page` receives a `room.snapshot` on a socket opened after this call. */
function nextSnapshot(page: Page) {
  return page
    .waitForEvent("websocket")
    .then((socket) =>
      socket.waitForEvent("framereceived", (frame) =>
        String(frame.payload).includes('"type":"room.snapshot"'),
      ),
    );
}

test("reloading the room page is not a leave and a join for everyone else", async ({
  page,
  context,
  browser,
}) => {
  const hostEvents = recordRoomEvents(page);
  await signIn(context, { username: "rc.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("reload hang") });
  const hostPeople = await peopleTab(page);

  const guestContext = await browser.newContext();
  try {
    const guestId = await signIn(guestContext, { username: "rc.guest" });
    const guest = await newPage(guestContext);
    await enterRoom(guest, roomId);
    await expect(hostPeople).toContainText("rc.guest");
    const guestEvents = () =>
      hostEvents.filter((e) => (e.event.userId ?? e.event.participant?.userId) === guestId);
    await expect
      .poll(guestEvents)
      .toEqual([expect.objectContaining({ event: expect.objectContaining({ kind: "joined" }) })]);

    // Reload: the guest's old socket closes and a new one rejoins within the grace.
    const rejoined = nextSnapshot(guest);
    // This tab was in the room, so the reload skips the lobby and rejoins at once.
    await guest.reload();
    await rejoined;
    await expect(await peopleTab(guest)).toContainText("rc.guest (you)");

    // Give any stray left/joined time to arrive: there must be none.
    await page.waitForTimeout(1_000);
    expect(guestEvents().map((e) => e.event.kind)).toEqual(["joined"]);
    await expect(hostPeople).toContainText("rc.guest");
    await expect(page.getByText("2/10")).toBeVisible();
  } finally {
    await guestContext.close();
  }
});
