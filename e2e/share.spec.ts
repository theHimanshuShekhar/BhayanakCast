import type { Browser, BrowserContext, Page } from "@playwright/test";
import { MAX_CLIENT_MESSAGE_BYTES } from "../src/lib/realtime";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// Screen shares over the Mesh (#36): Chromium shares its fake screen and tab audio; Firefox,
// which can't capture a screen headless, a stand-in (e2e/fixtures.ts).

type Instrumented = {
  __pcs: RTCPeerConnection[];
  /** What happened, in order: `ack:<userId>` (the server accepted their share), `capture`. */
  __log: string[];
  /** Every track `getDisplayMedia` gave the page. */
  __captured: MediaStreamTrack[];
  __largestSent: number;
};

/**
 * Record the page's peer connections, its screen captures, when the server accepted a share
 * relative to them, and its largest message to the server.
 */
async function instrument(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as Instrumented;
    w.__pcs = [];
    w.__log = [];
    w.__captured = [];
    w.__largestSent = 0;
    const NativePC = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePC {
      constructor(config?: RTCConfiguration) {
        super(config);
        w.__pcs.push(this);
      }
    };
    const NativeWS = window.WebSocket;
    window.WebSocket = class extends NativeWS {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener("message", (e: MessageEvent<string>) => {
          const m = JSON.parse(e.data);
          if (m.type === "room.event" && m.event.kind === "stateChanged" && m.event.media.share) {
            w.__log.push(`ack:${m.event.userId}`);
          }
        });
      }
    };
    const send = NativeWS.prototype.send;
    NativeWS.prototype.send = function (data) {
      const bytes = typeof data === "string" ? new Blob([data]).size : 0;
      w.__largestSent = Math.max(w.__largestSent, bytes);
      return send.call(this, data);
    };
    const capture = MediaDevices.prototype.getDisplayMedia;
    if (!capture) return;
    MediaDevices.prototype.getDisplayMedia = async function (options) {
      w.__log.push("capture");
      const stream = await capture.call(this, options);
      w.__captured.push(...stream.getTracks());
      return stream;
    };
  });
}

/** A new instrumented, signed-in context on `roomId`, entered through the lobby. */
async function joinAs(browser: Browser, username: string, roomId: string) {
  const context = await browser.newContext();
  await instrument(context);
  const userId = await signIn(context, { username });
  const page = await newPage(context);
  await enterRoom(page, roomId);
  return { context, page, userId };
}

/** Whether `userId`'s screen plays on `page`: it has a size and its time moves on. */
const screenPlays = (page: Page, userId: string) =>
  page.evaluate(async (id) => {
    const video = document.querySelector<HTMLVideoElement>(`video[data-screen="${id}"]`);
    if (!video || video.videoWidth === 0) return false;
    const before = video.currentTime;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return video.currentTime > before;
  }, userId);

/** Whether `userId`'s share audio plays on `page`, from a live track that receives sound. */
const shareAudioPlays = (page: Page, userId: string) =>
  page.evaluate((id) => {
    const audio = document.querySelector<HTMLAudioElement>(`audio[data-share="${id}"]`);
    const track = (audio?.srcObject as MediaStream | null)?.getAudioTracks()[0];
    return !!audio && !audio.paused && track?.readyState === "live" && !track.muted;
  }, userId);

/**
 * How the page's open connections send its share: each screen sender's content hint and
 * degradation preference, and each share-audio sender's bitrate cap and Opus parameters.
 */
const shareSenders = (page: Page) =>
  page.evaluate(async () => {
    const w = window as unknown as Instrumented;
    const open = w.__pcs.filter((pc) => pc.connectionState !== "closed");
    const screens: { hint: string; degradation?: string }[] = [];
    const audio: { maxBitrate?: number; fmtp?: string }[] = [];
    for (const pc of open) {
      const stats = await pc.getStats();
      for (const sender of pc.getSenders()) {
        const track = sender.track;
        if (!track || !w.__captured.includes(track)) continue;
        const parameters = sender.getParameters();
        if (track.kind === "video") {
          screens.push({ hint: track.contentHint, degradation: parameters.degradationPreference });
          continue;
        }
        let fmtp: string | undefined;
        const report = await sender.getStats();
        report.forEach((s: { type: string; codecId?: string }) => {
          if (s.type === "outbound-rtp" && s.codecId) {
            fmtp = (stats.get(s.codecId) as { sdpFmtpLine?: string } | undefined)?.sdpFmtpLine;
          }
        });
        audio.push({ maxBitrate: parameters.encodings[0]?.maxBitrate, fmtp });
      }
    }
    return { screens, audio };
  });

const log = (page: Page) => page.evaluate(() => (window as unknown as Instrumented).__log);
const largestSent = (page: Page) =>
  page.evaluate(() => (window as unknown as Instrumented).__largestSent);
/** How many of the page's captured tracks are still live. */
const liveCaptures = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as Instrumented).__captured.filter((t) => t.readyState === "live").length,
  );

const liveChips = (page: Page) => page.getByText("LIVE", { exact: true });

test("a share plays with its audio for everyone, and a mod's force-stop removes it for all", async ({
  page,
  context,
  browser,
  browserName,
}) => {
  test.setTimeout(150_000);
  await instrument(context);
  await signIn(context, { username: "share.host" });
  // A gaming room: shares are tuned for motion.
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("share") });
  const others = [];
  try {
    for (const username of ["share.streamer", "share.viewer"]) {
      others.push(await joinAs(browser, username, roomId));
    }
    const [streamer, viewer] = others as [(typeof others)[0], (typeof others)[0]];
    const streamerId = streamer.userId;

    await streamer.page.getByRole("button", { name: "Share screen" }).click();
    await expect(streamer.page.getByRole("button", { name: "Stop sharing" })).toBeEnabled();
    for (const p of [viewer.page, page]) {
      const tile = p.getByRole("group", { name: "share.streamer", exact: true });
      await expect(tile.getByLabel("share.streamer's screen")).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => screenPlays(p, streamerId), { timeout: 30_000 }).toBe(true);
    }
    // The server accepted the share before the screen was captured.
    const events = await log(streamer.page);
    expect(events.indexOf(`ack:${streamerId}`)).toBeGreaterThanOrEqual(0);
    expect(events.indexOf(`ack:${streamerId}`)).toBeLessThan(events.indexOf("capture"));

    // Tuned for motion, to both viewers; its audio capped at 128 kbps, in stereo.
    await expect
      .poll(async () => (await shareSenders(streamer.page)).screens, { timeout: 15_000 })
      .toEqual([
        { hint: "motion", degradation: "maintain-framerate" },
        { hint: "motion", degradation: "maintain-framerate" },
      ]);
    await expect
      .poll(async () => (await shareSenders(streamer.page)).audio, { timeout: 15_000 })
      .toEqual([
        { maxBitrate: 128_000, fmtp: expect.stringContaining("stereo=1") },
        { maxBitrate: 128_000, fmtp: expect.stringContaining("stereo=1") },
      ]);

    // The viewer hears it, at their own volume for this share. (Headless Firefox runs no
    // AudioContext, so its stand-in share is silent there.)
    const shareAudio = viewer.page.locator(`audio[data-share="${streamerId}"]`);
    if (browserName === "chromium") {
      await expect
        .poll(() => shareAudioPlays(viewer.page, streamerId), { timeout: 30_000 })
        .toBe(true);
    }
    const tile = viewer.page.getByRole("group", { name: "share.streamer", exact: true });
    await tile.getByRole("slider", { name: "Share volume for share.streamer" }).fill("0.3");
    await expect(shareAudio).toHaveJSProperty("volume", 0.3);

    // Pin works with the real video.
    await tile.getByRole("button", { name: "Pin" }).click();
    await expect(tile.getByText("pinned")).toBeVisible();
    await expect.poll(() => screenPlays(viewer.page, streamerId), { timeout: 15_000 }).toBe(true);

    // The host stops it: the streamer's capture ends, and nobody shows or plays it any more.
    await page.getByRole("button", { name: "Moderate share.streamer" }).click();
    await page.getByRole("menuitem", { name: "stop their share" }).click();
    for (const p of [viewer.page, page]) {
      await expect(p.locator("video[data-screen]")).toHaveCount(0);
      await expect(p.locator("audio[data-share]")).toHaveCount(0);
      await expect(liveChips(p)).toHaveCount(0);
    }
    await expect(streamer.page.getByRole("button", { name: "Share screen" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect.poll(() => liveCaptures(streamer.page)).toBe(0);
  } finally {
    for (const other of others) await other.context.close();
  }
});

test("the browser's own stop ends a share; every slot both ways still fits a message", async ({
  page,
  context,
  browser,
  browserName,
}) => {
  test.setTimeout(150_000);
  await instrument(context);
  const hostId = await signIn(context, { username: "share.coder" });
  // A code room: shares are tuned for sharp text.
  const roomId = await createRoomOnPage(page, {
    name: uniqueRoomName("share code"),
    kind: "Coding",
  });
  const guest = await joinAs(browser, "share.pair", roomId);
  try {
    // Both send everything: mic, camera, screen and share audio, each way on one connection.
    for (const p of [page, guest.page]) {
      await p.getByRole("button", { name: "Unmute mic" }).click();
      await p.getByRole("button", { name: "Turn camera on" }).click();
      await p.getByRole("button", { name: "Share screen" }).click();
      await expect(p.getByRole("button", { name: "Stop sharing" })).toBeEnabled();
    }
    await expect.poll(() => screenPlays(guest.page, hostId), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => screenPlays(page, guest.userId), { timeout: 30_000 }).toBe(true);
    await expect
      .poll(async () => (await shareSenders(page)).screens, { timeout: 15_000 })
      .toEqual([{ hint: "text", degradation: "maintain-resolution" }]);
    for (const p of [page, guest.page]) {
      const bytes = await largestSent(p);
      test.info().annotations.push({ type: "largest client message", description: `${bytes} B` });
      expect(bytes).toBeLessThan(MAX_CLIENT_MESSAGE_BYTES);
    }

    // The browser's own "stop sharing" ends the capture's video: the share is off everywhere,
    // and the capture stopped. A test can only fire the `ended` event, which Firefox doesn't
    // pass to a track's listeners when a script fires it, so Chromium only.
    if (browserName !== "chromium") return;
    await page.evaluate(() => {
      const captured = (window as unknown as Instrumented).__captured;
      captured.find((track) => track.kind === "video")?.dispatchEvent(new Event("ended"));
    });
    await expect.poll(() => liveCaptures(page)).toBe(0);
    await expect(page.getByRole("button", { name: "Share screen" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(guest.page.locator(`video[data-screen="${hostId}"]`)).toHaveCount(0);
    await expect(liveChips(guest.page)).toHaveCount(1);
    await expect.poll(() => screenPlays(page, guest.userId), { timeout: 15_000 }).toBe(true);
  } finally {
    await guest.context.close();
  }
});

test("the share control is hidden where the browser can't share its screen", async ({
  page,
  context,
}) => {
  // Like a mobile browser (ADR 17).
  await context.addInitScript(() => {
    delete (MediaDevices.prototype as Partial<MediaDevices>).getDisplayMedia;
  });
  await signIn(context, { username: "share.mobile" });
  await createRoomOnPage(page, { name: uniqueRoomName("share mobile") });
  await expect(page.getByRole("button", { name: "Unmute mic" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Share screen" })).toHaveCount(0);
});
