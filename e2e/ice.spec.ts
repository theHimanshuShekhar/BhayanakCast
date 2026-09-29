import type { BrowserContext, Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// "Can't connect" (#38, ADR 3): with ICE blocked, a pair gets its ICE restart, then each side's
// tile says it can't connect; once unblocked, retry connects them.

/**
 * Block ICE on every peer connection the page makes while `window.__blockIce`: no ICE servers
 * (so no server-reflexive or relay candidates) and no remote candidates, trickled or in SDP, so
 * no candidate pair can form. Records the connections in `window.__pcs`.
 */
async function blockIce(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __blockIce: boolean; __pcs: RTCPeerConnection[] };
    w.__blockIce = true;
    w.__pcs = [];
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) {
        super({ ...config, iceServers: [] });
        w.__pcs.push(this);
      }
      override setConfiguration(config?: RTCConfiguration) {
        super.setConfiguration({ ...config, iceServers: [] });
      }
      override addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void> {
        return w.__blockIce ? Promise.resolve() : super.addIceCandidate(candidate);
      }
      override setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
        const sdp = w.__blockIce
          ? description.sdp?.replace(/^a=candidate:.*\r?\n/gm, "")
          : undefined;
        return super.setRemoteDescription(
          sdp === undefined ? description : { ...description, sdp },
        );
      }
    };
  });
}

const unblockIce = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __blockIce: boolean }).__blockIce = false;
  });

const connected = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.filter(
        (pc) => pc.connectionState === "connected",
      ).length,
  );

test("a pair that can't connect says so on both tiles, and retry connects it once ICE works", async ({
  page,
  context,
  browser,
}) => {
  // Two connect timeouts (an ICE restart in between) before "can't connect".
  test.setTimeout(150_000);
  await blockIce(context);
  await signIn(context, { username: "ice.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("ice") });
  const otherContext = await browser.newContext();
  try {
    await blockIce(otherContext);
    await signIn(otherContext, { username: "ice.guest" });
    const guest = await newPage(otherContext);
    await enterRoom(guest, roomId);

    const guestTile = page.getByRole("group", { name: "ice.guest", exact: true });
    const hostTile = guest.getByRole("group", { name: "ice.host", exact: true });
    for (const tile of [guestTile, hostTile]) {
      await expect(tile.getByRole("alert")).toHaveText(/can't connect to ice\./, {
        timeout: 70_000,
      });
    }
    // Your own tile never says it.
    await expect(
      page.getByRole("group", { name: "ice.host (you)" }).getByRole("alert"),
    ).toHaveCount(0);

    await unblockIce(page);
    await unblockIce(guest);
    await guestTile.getByRole("button", { name: "retry" }).click();
    for (const tile of [guestTile, hostTile]) {
      await expect(tile.getByRole("alert")).toHaveCount(0, { timeout: 30_000 });
    }
    for (const p of [page, guest]) await expect.poll(() => connected(p)).toBe(1);
  } finally {
    await otherContext.close();
  }
});
