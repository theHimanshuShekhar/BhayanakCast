import type { BrowserContext } from "@playwright/test";
import { postTestAuth, signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// Browsers report their connections to the room timeline (#116). There is no admin view yet, so
// the tests read the merged timeline an admin would get (`getRoomTimeline`) through a test-only
// endpoint. Events are batched (about 3 s), so every read polls.

interface Entry {
  source: string;
  kind?: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
}

/** A room's timeline entries that are events, as an admin reads them. */
async function events(context: BrowserContext, roomId: string): Promise<Entry[]> {
  const response = await postTestAuth(context, "room-timeline", { roomId });
  expect(response.ok(), await response.text()).toBe(true);
  const { entries } = (await response.json()) as { entries: Entry[] };
  return entries.filter((e) => e.source === "event");
}

test("each side of a pair reports that it connected, and the path it connected over", async ({
  page,
  context,
  browser,
}) => {
  const hostId = await signIn(context, { username: "ce.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("connection events") });
  const guestContext = await browser.newContext();
  try {
    const guestId = await signIn(guestContext, { username: "ce.guest" });
    const guest = await newPage(guestContext);
    await enterRoom(guest, roomId);

    for (const [reporter, peer] of [
      [hostId, guestId],
      [guestId, hostId],
    ] as const) {
      const mine = (all: Entry[]) => all.filter((e) => e.actorUserId === reporter);
      await expect
        .poll(async () => mine(await events(context, roomId)).map((e) => e.kind), {
          timeout: 45_000,
        })
        .toEqual(expect.arrayContaining(["pair_state", "pair_path"]));
      const all = mine(await events(context, roomId));
      // The peer is the target, with their real user id.
      expect(
        all.filter((e) => e.kind?.startsWith("pair_")).every((e) => e.targetUserId === peer),
      ).toBe(true);
      expect(all.some((e) => e.kind === "pair_state" && e.details?.state === "connected")).toBe(
        true,
      );
      const path = all.find((e) => e.kind === "pair_path");
      expect(path?.details).toMatchObject({ change: "connect" });
      expect(["direct", "relay"]).toContain(path?.details?.path);
      // Candidate types and transports, never an address.
      expect(JSON.stringify(all)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
  } finally {
    await guestContext.close();
  }
});

test("a refused camera in the lobby is reported against the room being joined, even as the page closes", async ({
  page,
  context,
}) => {
  // The host makes the room; the guest only ever sees its lobby.
  await signIn(context, { username: "ce.lobby.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("lobby device error") });
  const guestContext = await (await page.context().browser())?.newContext();
  if (!guestContext) throw new Error("no browser");
  try {
    const guestId = await signIn(guestContext, { username: "ce.lobby.guest" });
    // The browser refuses the camera, naming a device id in its message.
    await guestContext.addInitScript(() => {
      const refuse = () =>
        Promise.reject(
          new DOMException(
            'Permission denied for "Fake Camera" (id 0123456789abcdef0123)',
            "NotAllowedError",
          ),
        );
      navigator.mediaDevices.getUserMedia = refuse;
    });
    const guest = await newPage(guestContext);
    await guest.goto(`/room/${roomId}`);
    await guest.getByRole("switch", { name: "Camera" }).click();
    await expect(
      guest.getByRole("alert").filter({ hasText: /camera access is blocked/ }),
    ).toBeVisible();

    // Leave at once: well inside the 3 s the report waits, so only the beacon can carry it.
    await guest.evaluate(() => location.assign("about:blank"));
    await guest.waitForURL("about:blank");
    await expect
      .poll(async () => (await events(context, roomId)).filter((e) => e.kind === "device_error"), {
        timeout: 20_000,
      })
      .toMatchObject([
        {
          actorUserId: guestId,
          targetUserId: null,
          details: { device: "camera", name: "NotAllowedError" },
        },
      ]);
    const [error] = (await events(context, roomId)).filter((e) => e.kind === "device_error");
    // A device id in the message is replaced. (Labels the page has listed are replaced too, which
    // the unit tests cover; before permission it has none, and browsers' messages carry none.)
    expect(JSON.stringify(error)).not.toContain("0123456789abcdef");
  } finally {
    await guestContext.close();
  }
});
