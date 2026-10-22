import type { Browser, BrowserContext, Page } from "@playwright/test";
import { fitRung, MAX_CAPTURE_PIXELS, screenSteps } from "../src/lib/quality";
import { MAX_CLIENT_MESSAGE_BYTES } from "../src/lib/realtime";
import { E2E_ADMIN_DISCORD_ID, signIn } from "./auth";
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

/**
 * In every page of `context`, `getDisplayMedia` shares an animated 3440x1440 canvas: an ultrawide
 * screen at its native size, which neither browser's fake screen can be (Chromium's is 16:9).
 * Add it before `instrument`, which wraps `getDisplayMedia` as it finds it.
 */
async function ultrawideScreen(context: BrowserContext) {
  await context.addInitScript(() => {
    MediaDevices.prototype.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 3440;
      canvas.height = 1440;
      const g = canvas.getContext("2d");
      let frame = 0;
      const draw = () => {
        if (!g) return;
        g.fillStyle = `hsl(${(frame++ * 7) % 360} 60% 45%)`;
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.fillStyle = "#fff";
        for (let i = 0; i < 40; i++) g.fillRect((i * 97 + frame * 13) % 3400, i * 35, 40, 8);
      };
      draw();
      setInterval(draw, 66);
      return canvas.captureStream(60);
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

/**
 * How the page's open connections encode its share (ADR 2): each screen sender's encoding
 * (bitrate and frame rate cap, from its quality rung) and the codec it sends with, next to the
 * best codec this browser offers by the ladder AV1 > VP9 > H.264 > VP8.
 */
const screenEncodings = (page: Page) =>
  page.evaluate(async () => {
    const w = window as unknown as Instrumented;
    const open = w.__pcs.filter((pc) => pc.connectionState !== "closed");
    const senders: {
      maxBitrate?: number;
      maxFramerate?: number;
      codec?: string;
      frameWidth?: number;
      frameHeight?: number;
    }[] = [];
    for (const pc of open) {
      for (const sender of pc.getSenders()) {
        const track = sender.track;
        if (track?.kind !== "video" || !w.__captured.includes(track)) continue;
        const { maxBitrate, maxFramerate } = sender.getParameters().encodings[0] ?? {};
        let codec: string | undefined;
        let frameWidth: number | undefined;
        let frameHeight: number | undefined;
        const report = await sender.getStats();
        report.forEach(
          (s: { type: string; codecId?: string; frameWidth?: number; frameHeight?: number }) => {
            if (s.type !== "outbound-rtp") return;
            frameWidth = s.frameWidth;
            frameHeight = s.frameHeight;
            if (s.codecId) {
              codec = (report.get(s.codecId) as { mimeType?: string } | undefined)?.mimeType;
            }
          },
        );
        senders.push({ maxBitrate, maxFramerate, codec, frameWidth, frameHeight });
      }
    }
    const settings = w.__captured.find((track) => track.kind === "video")?.getSettings() ?? {};
    const capture = {
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
    };
    const offered = (RTCRtpSender.getCapabilities("video")?.codecs ?? []).map((c) =>
      c.mimeType.toLowerCase(),
    );
    const best = ["video/av1", "video/vp9", "video/h264", "video/vp8"].find((m) =>
      offered.includes(m),
    );
    return { senders, best, capture };
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
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("share"), kind: "gaming" });
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

    // Each viewer's copy is on the steps built from the capture, and goes out in the best codec
    // this browser offers (both ends are the same browser here). Each starts at the highest step
    // that fits its share of the 23 Mbps budget (two viewers: 11.5 Mbps each), the top step here,
    // and a gaming room gives up size before frames.
    const steps = screenSteps((await screenEncodings(streamer.page)).capture, "size");
    const start = steps[fitRung(steps, 23_000_000 / 2)];
    const started = async () =>
      (await screenEncodings(streamer.page)).senders.map(
        (s) =>
          s.maxBitrate === start?.maxBitrate && s.maxFramerate === start?.frameRate && !!s.codec,
      );
    await expect.poll(started, { timeout: 15_000 }).toEqual([true, true]);
    const { senders, best, capture } = await screenEncodings(streamer.page);
    for (const sender of senders) expect(sender.codec?.toLowerCase()).toBe(best);

    // What goes out keeps the capture's shape, however wide, and stays within the pixel cap.
    // (The encoder may sit below the step while it adapts, but never above it.) The capture
    // itself is the size the box asked for; the steps scale it by pixel count, not by width.
    const captured = (capture.width ?? 0) * (capture.height ?? 0);
    expect(captured).toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (await screenEncodings(streamer.page)).senders.map((s) => {
            if (!s.frameWidth || !s.frameHeight) return false;
            const aspect =
              s.frameWidth / s.frameHeight / ((capture.width ?? 1) / (capture.height ?? 1));
            return (
              Math.abs(aspect - 1) < 0.03 &&
              s.frameWidth * s.frameHeight <= Math.min(captured, MAX_CAPTURE_PIXELS) * 1.02 &&
              s.frameHeight <= (start?.height ?? 0) + 2
            );
          }),
        { timeout: 20_000 },
      )
      .toEqual([true, true]);

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

test("an ultrawide share is encoded in its own shape, not pinned to a 720p ceiling", async ({
  page,
  context,
  browser,
  browserName,
}) => {
  test.setTimeout(150_000);
  await ultrawideScreen(context);
  await instrument(context);
  const streamerId = await signIn(context, { username: "share.wide" });
  // A code room: a step down gives up frames before size.
  const roomId = await createRoomOnPage(page, {
    name: uniqueRoomName("share wide"),
    kind: "coding",
  });
  const viewer = await joinAs(browser, "share.wideviewer", roomId);
  try {
    await page.getByRole("button", { name: "Share screen" }).click();
    await expect(page.getByRole("button", { name: "Stop sharing" })).toBeEnabled();
    await expect.poll(() => screenPlays(viewer.page, streamerId), { timeout: 30_000 }).toBe(true);

    const { capture } = await screenEncodings(page);
    // 21:9 whatever the browser did to it. Chromium resizes the track to the pixel cap's box
    // for this shape (`fitScreenCapture`); Firefox is left at the size it was given.
    expect((capture.width ?? 0) / (capture.height ?? 1)).toBeCloseTo(3440 / 1440, 1);
    if (browserName === "chromium") {
      expect((capture.width ?? 0) * (capture.height ?? 0)).toBeLessThanOrEqual(
        MAX_CAPTURE_PIXELS * 1.01,
      );
    } else {
      expect(capture).toMatchObject({ width: 3440, height: 1440 });
    }
    // The steps are the capture's shape, topping out at the pixel cap (about 2968x1242, 10.67
    // Mbps at 60 fps), and the only viewer is entitled to the whole budget: it starts there, not
    // at 1280x720 or the 1719x720 that the old ladder pinned this shape to.
    const steps = screenSteps(capture, "framerate");
    const top = steps.at(-1);
    expect(top?.label).toMatch(/^29[67]\d×12[34]\d@60$/);
    expect(top?.maxBitrate).toBe(10_670_000);
    await expect
      .poll(
        async () => {
          const [sender] = (await screenEncodings(page)).senders;
          return {
            maxBitrate: sender?.maxBitrate,
            maxFramerate: sender?.maxFramerate,
            wide: Math.abs((sender?.frameWidth ?? 0) - (top?.width ?? 0)) <= 4,
            tall: Math.abs((sender?.frameHeight ?? 0) - (top?.height ?? 0)) <= 4,
          };
        },
        { timeout: 30_000 },
      )
      .toEqual({ maxBitrate: 10_670_000, maxFramerate: 60, wide: true, tall: true });
  } finally {
    await viewer.context.close();
  }
});

test("a share in a two-person room records quality samples the admin view shows", async ({
  page,
  context,
  browser,
  browserName,
}) => {
  test.setTimeout(150_000);
  // An ultrawide screen: its steps are labelled by encoded size, which the server takes too.
  await ultrawideScreen(context);
  const streamerId = await signIn(context, { username: "quality.streamer" });
  const roomName = uniqueRoomName("quality");
  const roomId = await createRoomOnPage(page, { name: roomName, kind: "gaming" });
  const viewer = await joinAs(browser, "quality.viewer", roomId);
  const adminContext = await browser.newContext();
  try {
    await page.getByRole("button", { name: "Share screen" }).click();
    await expect(page.getByRole("button", { name: "Stop sharing" })).toBeEnabled();
    await expect.poll(() => screenPlays(viewer.page, streamerId), { timeout: 30_000 }).toBe(true);

    await signIn(adminContext, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
    const admin = await newPage(adminContext);
    // The sender's and the receiver's first windows (8s each in this build) are reported a few
    // seconds after they close. Open the room's quality from the live rooms table, until the
    // pair shows up.
    const pairs = admin.getByRole("table", { name: "quality pairs" });
    const row = pairs.getByRole("row", { name: /quality\.streamer.*quality\.viewer/ });
    await expect
      .poll(
        async () => {
          await admin.goto("/admin");
          await admin
            .getByRole("button", { name: `Quality of ${roomName}` })
            .first()
            .click();
          await expect(pairs).toBeVisible();
          return row.count();
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toBe(1);
    await expect(row.getByRole("cell", { name: "screen", exact: true })).toBeVisible();
    // How long the pair took to reach its first stable step: known once the sender's first window
    // without a step change has closed and been reported ("settled in", ADR 2 addendum).
    await expect(pairs.getByRole("columnheader", { name: "settled in" })).toBeVisible();
    await expect
      .poll(
        async () => {
          await admin.goto("/admin");
          await admin
            .getByRole("button", { name: `Quality of ${roomName}` })
            .first()
            .click();
          await expect(pairs).toBeVisible();
          // The cell under the "settled in" header, whichever column that is.
          const headers = await pairs.getByRole("columnheader").allTextContents();
          const column = headers.findIndex((header) => header.trim() === "settled in");
          return column < 0 ? null : await row.getByRole("cell").nth(column).textContent();
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toMatch(/^\d+(s|m)/);
    // The viewer's browser comes from their own report, and the codec from either end's.
    await expect(row).toContainText(browserName === "chromium" ? "chrome" : "firefox");
    await expect(row).toContainText(/video\/|AV1|VP9|VP8|H264/i);
    await expect(row).toContainText(/\d{4}×\d{3,4}@(30|60)/);

    // And its timeline: the charts are there, with the numbers behind them.
    await row.getByRole("button", { name: /^Timeline / }).click();
    await expect(admin.getByRole("img", { name: /^Bitrate sent/ })).toBeVisible();
    await expect(admin.getByRole("img", { name: /^Average QP/ })).toBeVisible();
    await expect(admin.getByRole("img", { name: /^Packet loss/ })).toBeVisible();
    await expect(admin.getByRole("img", { name: /^The sender's quality rung/ })).toBeVisible();
    await admin.getByText("values", { exact: true }).click();
    await expect(
      admin.getByRole("table", { name: "timeline values" }).getByRole("row"),
    ).not.toHaveCount(1);
  } finally {
    await adminContext.close();
    await viewer.context.close();
  }
});

/** A node of a server function's body, in seroval's JSON form: a value, a constant, or an object. */
type Node = { t: number; s?: unknown; p?: { k: string[]; v: Node[] }; a?: Node[] };
/** Seroval's constants, by the `s` of a `t: 2` node. */
const CONSTANTS = [null, undefined, true, false];

/** The quality rows in a server function's body, each as the plain object it was sent as. */
function qualityRowsIn(node: unknown): Record<string, unknown>[] {
  if (typeof node !== "object" || node === null) return [];
  const { p, a } = node as Node;
  if (p?.k.includes("codecReason")) {
    const value = ({ t, s }: Node) => (t === 2 ? CONSTANTS[s as number] : s);
    return [Object.fromEntries(p.k.map((key, i) => [key, value(p.v[i] as Node)]))];
  }
  return [...(p?.v ?? []), ...(a ?? [])].flatMap(qualityRowsIn);
}

/**
 * The quality rows `page` reports to the server, as they go out (`reportQualityFn`). They are
 * the only place a browser's own stats reach the server, so the request is what is read.
 */
function reportedRows(page: Page): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    const body = request.method() === "POST" ? request.postData() : null;
    if (body?.includes("codecReason")) rows.push(...qualityRowsIn(JSON.parse(body).t));
  });
  return rows;
}

test("a share's send rows say why it is on its codec, and how hard its encoder works", async ({
  page,
  context,
  browser,
  browserName,
}) => {
  test.setTimeout(90_000);
  await signIn(context, { username: "share.encoder" });
  const roomId = await createRoomOnPage(page, {
    name: uniqueRoomName("share encoder"),
    kind: "gaming",
  });
  const viewer = await joinAs(browser, "share.encoderviewer", roomId);
  const rows = reportedRows(page);
  try {
    await page.getByRole("button", { name: "Share screen" }).click();
    await expect(page.getByRole("button", { name: "Stop sharing" })).toBeEnabled();
    // A window runs 8 s in this build, and its report goes a few seconds after.
    await expect.poll(() => rows.some((row) => row.windowMs), { timeout: 45_000 }).toBe(true);

    for (const row of rows.filter((r) => r.direction === "send")) {
      // Every sender is on the normal order until the later codec picks land.
      expect(row.codecReason).toBe("preferred");
      expect(row.fromCodec).toBeNull();
    }
    const timed = rows.filter((row) => row.windowMs);
    // Encode time is Δ`totalEncodeTime` / Δ`framesEncoded`, which both browsers give.
    for (const row of timed) expect(row.encodeMs).toBeGreaterThan(0);
    for (const row of timed) {
      if (browserName === "chromium") {
        // The capture's track is a real one, so Chromium names the encoder it uses (a canvas
        // track doesn't: research #126). Hardware or software depends on the machine.
        expect(row.encoderImplementation).toEqual(expect.any(String));
        expect(row.powerEfficientEncoder).toEqual(expect.any(Boolean));
      } else {
        // Firefox doesn't say; its fields are null, not a guess.
        expect(row.encoderImplementation).toBeNull();
        expect(row.powerEfficientEncoder).toBeNull();
      }
    }
  } finally {
    await viewer.context.close();
  }
});

/**
 * In every page of `context`, record the text of each remote description its connections apply,
 * in `__remoteSdps`, as the browser took it (a description it refused would have thrown).
 */
async function recordRemoteDescriptions(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __remoteSdps: string[] };
    w.__remoteSdps = [];
    const set = RTCPeerConnection.prototype.setRemoteDescription as (
      this: RTCPeerConnection,
      description?: RTCSessionDescriptionInit,
    ) => Promise<void>;
    RTCPeerConnection.prototype.setRemoteDescription = async function (description) {
      await set.call(this, description);
      w.__remoteSdps.push(description?.sdp ?? "");
    };
  });
}

// The bandwidth estimate itself is not asserted. On localhost it reaches the share's bitrate in
// under a second without a seed too, a seeded reading lasts only a few dozen milliseconds, and one
// taken a moment later can race it (measured by hand in Chromium 153: ADR 2 addendum). What is
// exact, and what the unit tests can't show, is that the real browser takes the munged
// description, and which side's description carries the hint.
test("a viewer joining a live share seeds the sender's bandwidth estimate, only where it can hold", async ({
  page,
  context,
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Firefox ignores the start bitrate hint");
  test.setTimeout(150_000);
  await instrument(context);
  await recordRemoteDescriptions(context);
  const streamerId = await signIn(context, { username: "share.seed" });
  const roomId = await createRoomOnPage(page, {
    name: uniqueRoomName("share seed"),
    kind: "gaming",
  });
  // The share is on before anyone else is there, so the viewer's connection starts with it.
  await page.getByRole("button", { name: "Share screen" }).click();
  await expect(page.getByRole("button", { name: "Stop sharing" })).toBeEnabled();
  const viewer = await joinAs(browser, "share.seedviewer", roomId);
  try {
    await expect.poll(() => screenPlays(viewer.page, streamerId), { timeout: 30_000 }).toBe(true);
    // The only viewer is entitled to the whole budget, so the pair starts on the top step.
    const { capture } = await screenEncodings(page);
    const top = screenSteps(capture, "size").at(-1);
    const seed = Math.round(((top?.maxBitrate ?? 0) * 0.9) / 1_000);
    expect(seed).toBeGreaterThan(1_000);
    const remote = await page.evaluate(
      () => (window as unknown as { __remoteSdps: string[] }).__remoteSdps,
    );
    const hinted = remote.filter((sdp) => sdp.includes("x-google-start-bitrate="));
    // The side with the greater id is impolite: it offers first, with its screen in the offer,
    // and its first remote description is the viewer's answer to it. The polite side answers
    // first and sends in an offer of its own once ICE is connecting, which a seed would reset
    // rather than set (`Mesh#forSenders`): it asks for none.
    if (streamerId > viewer.userId) {
      expect(hinted).toHaveLength(1);
      expect(remote.indexOf(hinted[0] as string)).toBe(0);
      expect(hinted[0]).toContain(`x-google-start-bitrate=${seed}`);
      // On every video codec of the screen's section, and in no other.
      expect(hinted[0]?.match(/x-google-start-bitrate=/g)?.length).toBeGreaterThanOrEqual(2);
      const sections = hinted[0]?.split(/\r\n(?=m=)/) ?? [];
      expect(sections.filter((m) => m.includes("x-google-start-bitrate="))).toHaveLength(1);
    } else {
      expect(hinted).toHaveLength(0);
    }
  } finally {
    await viewer.context.close();
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
    kind: "coding",
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
