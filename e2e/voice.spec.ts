import type { Browser, BrowserContext, Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// Voice over the Mesh (#34): fake mics in three browsers, one peer connection per pair.

/** Record every track the page gets from `getUserMedia` and every peer connection it makes. */
async function instrument(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[]; __pcs: RTCPeerConnection[] };
    w.__tracks = [];
    w.__pcs = [];
    const devices = navigator.mediaDevices;
    const getUserMedia = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      w.__tracks.push(...stream.getTracks());
      return stream;
    };
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) {
        super(config);
        w.__pcs.push(this);
      }
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

/** Peers whose audio this page plays with a live track that is receiving sound. */
const liveRemoteAudio = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLAudioElement>("audio[data-peer]")].filter(
        (audio) =>
          !audio.paused &&
          (audio.srcObject as MediaStream | null)
            ?.getAudioTracks()
            .some((track) => track.readyState === "live" && !track.muted),
      ).length,
  );

/** Open peer connections whose received audio packets keep coming (over one second). */
const connectionsReceivingAudio = (page: Page) =>
  page.evaluate(async () => {
    const open = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.filter(
      (pc) => pc.connectionState !== "closed",
    );
    const packets = async (pc: RTCPeerConnection) => {
      let total = 0;
      (await pc.getStats()).forEach(
        (s: { type: string; kind?: string; packetsReceived?: number }) => {
          if (s.type === "inbound-rtp" && s.kind === "audio") total += s.packetsReceived ?? 0;
        },
      );
      return total;
    };
    const before = await Promise.all(open.map(packets));
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const after = await Promise.all(open.map(packets));
    return after.filter((n, i) => n > (before[i] ?? 0)).length;
  });

/** What `page` still holds: live mic tracks, open peer connections, peers' audio playing. */
const held = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[]; __pcs: RTCPeerConnection[] };
    return {
      liveTracks: w.__tracks.filter((t) => t.readyState === "live").length,
      openConnections: w.__pcs.filter((pc) => pc.connectionState !== "closed").length,
      audio: document.querySelectorAll("audio[data-peer]").length,
    };
  });

test("three people unmute and each hears the other two; leaving releases everything", async ({
  page,
  context,
  browser,
  browserName,
}) => {
  test.setTimeout(120_000);
  await instrument(context);
  await signIn(context, { username: "voice.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("voice") });
  const others = [];
  try {
    for (const username of ["voice.two", "voice.three"]) {
      others.push(await joinAs(browser, username, roomId));
    }
    const [two, three] = others.map((o) => o.page) as [Page, Page];
    const twoId = others[0]?.userId;
    const everyone = [page, two, three];

    for (const p of everyone) {
      await p.getByRole("button", { name: "Unmute mic" }).click();
      await expect(p.getByRole("button", { name: "Mute mic" })).toBeVisible();
    }
    for (const p of everyone) {
      await expect.poll(() => liveRemoteAudio(p), { timeout: 30_000 }).toBe(2);
      await expect.poll(() => connectionsReceivingAudio(p), { timeout: 30_000 }).toBe(2);
    }

    // Speaking comes from the received audio (the fake mic beeps): a wave on their tile.
    // Headless Firefox without a sound device never runs an AudioContext, so Chromium only.
    const twoTile = page.getByRole("group", { name: "voice.two", exact: true });
    if (browserName === "chromium") {
      await expect(twoTile.locator(".animate-bc-wave")).not.toHaveCount(0, { timeout: 15_000 });
    }
    // Their volume and mute here are this viewer's own.
    await twoTile.getByRole("slider", { name: "Volume for voice.two" }).fill("0.5");
    await twoTile.getByRole("button", { name: "Mute for me" }).click();
    const twoAudio = page.locator(`audio[data-peer="${twoId}"]`);
    await expect(twoAudio).toHaveJSProperty("volume", 0.5);
    await expect(twoAudio).toHaveJSProperty("muted", true);
    await twoTile.getByRole("button", { name: "Unmute for me" }).click();
    await expect(twoAudio).toHaveJSProperty("muted", false);

    // Muting stops sending to everyone; unmuting starts again.
    await page.getByRole("button", { name: "Mute mic" }).click();
    for (const p of [two, three]) await expect.poll(() => connectionsReceivingAudio(p)).toBe(1);
    await page.getByRole("button", { name: "Unmute mic" }).click();
    for (const p of [two, three]) await expect.poll(() => connectionsReceivingAudio(p)).toBe(2);

    // The third leaves: their mic and connections are released, and the others stop playing them.
    await three.getByRole("button", { name: /^leave$/ }).click();
    await expect(three).toHaveURL(/\/$/);
    await expect.poll(() => held(three)).toEqual({ liveTracks: 0, openConnections: 0, audio: 0 });
    for (const p of [page, two]) await expect.poll(() => liveRemoteAudio(p)).toBe(1);
  } finally {
    for (const other of others) await other.context.close();
  }
});

test("being kicked or taken over releases the mic and every connection", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  await instrument(context);
  await signIn(context, { username: "voice.kicker" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("voice teardown") });
  const kicked = await joinAs(browser, "voice.kicked", roomId);
  const moved = await joinAs(browser, "voice.moved", roomId);
  try {
    for (const p of [kicked.page, moved.page]) {
      await p.getByRole("button", { name: "Unmute mic" }).click();
      await expect
        .poll(() => held(p), { timeout: 30_000 })
        .toEqual({ liveTracks: 1, openConnections: 2, audio: 2 });
    }

    await page.getByRole("button", { name: "Moderate voice.kicked" }).click();
    await page.getByRole("menuitem", { name: "kick from room" }).click();
    await expect(
      kicked.page.getByRole("heading", { name: "you were removed from this room" }),
    ).toBeVisible();
    await expect
      .poll(() => held(kicked.page))
      .toEqual({ liveTracks: 0, openConnections: 0, audio: 0 });

    // The same user enters from a second tab: the first lets go of everything.
    const second = await newPage(moved.context);
    await enterRoom(second, roomId);
    await expect(
      moved.page.getByRole("alert").filter({ hasText: "you joined from elsewhere" }),
    ).toBeVisible();
    await expect
      .poll(() => held(moved.page))
      .toEqual({ liveTracks: 0, openConnections: 0, audio: 0 });
    // The new tab connects to the host afresh, and the host's old connection to it is replaced.
    await expect
      .poll(() => held(second), { timeout: 30_000 })
      .toMatchObject({
        openConnections: 1,
      });
    await expect.poll(() => connectionsReceivingAudio(second), { timeout: 30_000 }).toBe(0);
    await page.getByRole("button", { name: "Unmute mic" }).click();
    await expect.poll(() => connectionsReceivingAudio(second), { timeout: 30_000 }).toBe(1);
  } finally {
    await kicked.context.close();
    await moved.context.close();
  }
});
