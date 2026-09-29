import type { Browser, BrowserContext, Page } from "@playwright/test";
import { MAX_CLIENT_MESSAGE_BYTES } from "../src/lib/realtime";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// Cameras over the Mesh (#35): fake cameras in three browsers, each camera paused towards a
// viewer who isn't showing it.

/** Record every peer connection the page makes, and its largest message to the server. */
async function instrument(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __pcs: RTCPeerConnection[]; __largestSent: number };
    w.__pcs = [];
    w.__largestSent = 0;
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) {
        super(config);
        w.__pcs.push(this);
      }
    };
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      const bytes = typeof data === "string" ? new Blob([data]).size : 0;
      w.__largestSent = Math.max(w.__largestSent, bytes);
      return send.call(this, data);
    };
  });
}

/** A new instrumented, signed-in context on `roomId`, entered through the lobby. */
async function joinAs(browser: Browser, username: string, roomId: string) {
  const context = await browser.newContext();
  await instrument(context);
  await signIn(context, { username });
  const page = await newPage(context);
  await enterRoom(page, roomId);
  return { context, page };
}

/** Whether `userId`'s camera plays on `page`: it has a size and its time moves on. */
const cameraPlays = (page: Page, userId: string) =>
  page.evaluate(async (id) => {
    const video = document.querySelector<HTMLVideoElement>(`video[data-camera="${id}"]`);
    if (!video || video.videoWidth === 0) return false;
    const before = video.currentTime;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return video.currentTime > before;
  }, userId);

/** Open peer connections whose received video frames keep coming (over one second). */
const connectionsReceivingVideo = (page: Page) =>
  page.evaluate(async () => {
    const open = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.filter(
      (pc) => pc.connectionState !== "closed",
    );
    const frames = async (pc: RTCPeerConnection) => {
      let total = 0;
      (await pc.getStats()).forEach(
        (s: { type: string; kind?: string; framesDecoded?: number }) => {
          if (s.type === "inbound-rtp" && s.kind === "video") total += s.framesDecoded ?? 0;
        },
      );
      return total;
    };
    const before = await Promise.all(open.map(frames));
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const after = await Promise.all(open.map(frames));
    return after.filter((n, i) => n > (before[i] ?? 0)).length;
  });

const largestSent = (page: Page) =>
  page.evaluate(() => (window as unknown as { __largestSent: number }).__largestSent);

test("a camera plays for everyone, also over a share, and pauses towards a viewer hiding it", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(150_000);
  await instrument(context);
  const hostId = await signIn(context, { username: "cam.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("camera") });
  const others = [];
  try {
    for (const username of ["cam.two", "cam.three"]) {
      others.push(await joinAs(browser, username, roomId));
    }
    const [two, three] = others.map((o) => o.page) as [Page, Page];

    await page.getByRole("button", { name: "Turn camera on" }).click();
    await expect.poll(() => cameraPlays(page, hostId), { timeout: 15_000 }).toBe(true);
    for (const p of [two, three]) {
      const tile = p.getByRole("group", { name: "cam.host", exact: true });
      await expect(tile.getByLabel("cam.host's camera")).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => cameraPlays(p, hostId), { timeout: 30_000 }).toBe(true);
      await expect.poll(() => connectionsReceivingVideo(p), { timeout: 30_000 }).toBe(1);
    }

    // Two hides the viewers (everyone not sharing): the host stops sending two her camera,
    // and only two.
    const viewers = two.getByRole("button", { name: "viewers", exact: true });
    await viewers.click();
    await expect(two.locator("video[data-camera]")).toHaveCount(0);
    await expect.poll(() => connectionsReceivingVideo(two), { timeout: 15_000 }).toBe(0);
    expect(await connectionsReceivingVideo(three)).toBe(1);
    // Shown again: it resumes.
    await viewers.click();
    await expect.poll(() => cameraPlays(two, hostId), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => connectionsReceivingVideo(two), { timeout: 15_000 }).toBe(1);

    // Sharing too: the camera plays as a picture-in-picture over the share, and stays shown
    // while two hides the viewers (a streamer isn't one).
    await page.getByRole("button", { name: "Share screen" }).click();
    const hostTile = two.getByRole("group", { name: "cam.host", exact: true });
    await expect(hostTile.getByText("LIVE", { exact: true })).toBeVisible();
    await viewers.click();
    await expect(hostTile.getByLabel("cam.host's camera")).toBeVisible();
    await expect.poll(() => cameraPlays(two, hostId), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => connectionsReceivingVideo(two), { timeout: 15_000 }).toBe(1);

    // Camera off: gone from every tile, and no more frames to anyone.
    await page.getByRole("button", { name: "Turn camera off" }).click();
    for (const p of [page, two, three]) {
      await expect(p.locator("video[data-camera]")).toHaveCount(0);
    }
    for (const p of [two, three]) {
      await expect.poll(() => connectionsReceivingVideo(p), { timeout: 15_000 }).toBe(0);
    }

    // Everyone's mic and camera on every connection: the offers still fit in a client message.
    for (const p of [page, two, three]) {
      await p.getByRole("button", { name: "Unmute mic" }).click();
      await p.getByRole("button", { name: "Turn camera on" }).click();
    }
    await viewers.click();
    for (const p of [page, two, three]) {
      await expect.poll(() => connectionsReceivingVideo(p), { timeout: 30_000 }).toBe(2);
    }
    for (const p of [page, two, three]) {
      expect(await largestSent(p)).toBeLessThan(MAX_CLIENT_MESSAGE_BYTES);
    }
  } finally {
    for (const other of others) await other.context.close();
  }
});
