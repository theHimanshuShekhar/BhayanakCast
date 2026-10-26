import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Capture,
  chooseStartOrder,
  codecReasonOf,
  FIREFOX_START,
  HARDWARE_H264_START,
  HARDWARE_VP9_START,
  NORMAL_START,
  orderCodecs,
  SWITCHED_START,
  switchTarget,
  videoMimeTypes,
} from "./codecs";

const codec = (mimeType: string, sdpFmtpLine?: string) => ({ mimeType, sdpFmtpLine });
const types = (codecs: { mimeType: string }[]) => codecs.map((c) => c.mimeType);

// What each browser can send (and decode), as MIME types and in the order it reports them.
const CHROMIUM = [
  codec("video/VP8"),
  codec("video/VP9", "profile-id=0"),
  codec("video/VP9", "profile-id=2"),
  codec("video/AV1"),
  codec("video/H264", "profile-level-id=42e01f"),
  codec("video/H264", "profile-level-id=640c1f"),
  codec("video/rtx"),
  codec("video/red"),
  codec("video/ulpfec"),
];
const FIREFOX = [
  codec("video/VP8"),
  codec("video/VP9"),
  codec("video/H264", "profile-level-id=42e01f"),
  codec("video/rtx"),
];
const CHROMIUM_NO_AV1 = CHROMIUM.filter((c) => c.mimeType !== "video/AV1");

describe("orderCodecs", () => {
  it("prefers AV1, VP9, H.264, then VP8 between Chromium and Chromium", () => {
    expect(types(orderCodecs(CHROMIUM, videoMimeTypes(CHROMIUM)))).toEqual([
      "video/AV1",
      "video/VP9",
      "video/VP9",
      "video/H264",
      "video/H264",
      "video/VP8",
      "video/rtx",
      "video/red",
      "video/ulpfec",
    ]);
  });

  it("falls back to VP9 between Chromium and Firefox, in both directions", () => {
    const fromChromium = orderCodecs(CHROMIUM, videoMimeTypes(FIREFOX));
    expect(types(fromChromium).slice(0, 4)).toEqual([
      "video/VP9",
      "video/VP9",
      "video/H264",
      "video/H264",
    ]);
    expect(types(fromChromium)).not.toContain("video/AV1");
    expect(types(orderCodecs(FIREFOX, videoMimeTypes(CHROMIUM)))).toEqual([
      "video/VP9",
      "video/H264",
      "video/VP8",
      "video/rtx",
    ]);
  });

  it("handles a peer without AV1 on either side", () => {
    expect(types(orderCodecs(CHROMIUM, videoMimeTypes(CHROMIUM_NO_AV1)))[0]).toBe("video/VP9");
    expect(types(orderCodecs(CHROMIUM_NO_AV1, videoMimeTypes(CHROMIUM)))[0]).toBe("video/VP9");
    // A peer that only decodes VP8 and H.264 gets H.264.
    const basic = ["video/VP8", "video/H264"];
    expect(types(orderCodecs(CHROMIUM, basic)).slice(0, 3)).toEqual([
      "video/H264",
      "video/H264",
      "video/VP8",
    ]);
  });

  it("keeps a codec's variants in the browser's order, and matches MIME types ignoring case", () => {
    const ordered = orderCodecs(CHROMIUM, ["VIDEO/vp9"]);
    expect(ordered.slice(0, 2).map((c) => c.sdpFmtpLine)).toEqual(["profile-id=0", "profile-id=2"]);
  });

  it("puts codecs it doesn't rank after VP8, and retransmission formats last", () => {
    const local = [codec("video/rtx"), codec("video/H265"), codec("video/VP8"), codec("video/VP9")];
    expect(types(orderCodecs(local, ["video/H265", "video/VP8", "video/VP9"]))).toEqual([
      "video/VP9",
      "video/VP8",
      "video/H265",
      "video/rtx",
    ]);
  });

  it("leaves nothing out before the peer has said, or when nothing is in common", () => {
    expect(types(orderCodecs(FIREFOX))).toEqual([
      "video/VP9",
      "video/H264",
      "video/VP8",
      "video/rtx",
    ]);
    expect(types(orderCodecs(FIREFOX, []))).toEqual(types(orderCodecs(FIREFOX)));
    expect(types(orderCodecs(FIREFOX, ["video/AV1"]))).toEqual(types(orderCodecs(FIREFOX)));
  });
});

describe("orderCodecs with the streamer's own order", () => {
  it("puts VP9 before AV1 for a streamer on hardware VP9, and a viewer without VP9 gets AV1", () => {
    expect(
      types(orderCodecs(CHROMIUM, videoMimeTypes(CHROMIUM), HARDWARE_VP9_START)).slice(0, 5),
    ).toEqual(["video/VP9", "video/VP9", "video/AV1", "video/H264", "video/H264"]);
    expect(
      types(orderCodecs(CHROMIUM, videoMimeTypes(CHROMIUM_NO_AV1), HARDWARE_VP9_START))[0],
    ).toBe("video/VP9");
    const noVp9 = ["video/AV1", "video/H264", "video/VP8"];
    expect(types(orderCodecs(CHROMIUM, noVp9, HARDWARE_VP9_START)).slice(0, 3)).toEqual([
      "video/AV1",
      "video/H264",
      "video/H264",
    ]);
  });

  it("puts H.264 first for a streamer on hardware H.264, and a viewer without H.264 gets AV1", () => {
    expect(
      types(orderCodecs(CHROMIUM, videoMimeTypes(CHROMIUM), HARDWARE_H264_START)).slice(0, 2),
    ).toEqual(["video/H264", "video/H264"]);
    const noH264 = ["video/AV1", "video/VP9", "video/VP8"];
    expect(types(orderCodecs(CHROMIUM, noH264, HARDWARE_H264_START))[0]).toBe("video/AV1");
  });

  it("sends only H.264 and VP8 from Firefox, H.264 first", () => {
    expect(types(orderCodecs(CHROMIUM, videoMimeTypes(CHROMIUM), FIREFOX_START))).toEqual([
      "video/H264",
      "video/H264",
      "video/VP8",
      "video/rtx",
      "video/red",
      "video/ulpfec",
    ]);
  });

  it("gives a Firefox streamer VP8 where H.264 isn't on both sides", () => {
    expect(types(orderCodecs(FIREFOX, ["video/VP8", "video/VP9"], FIREFOX_START))).toEqual([
      "video/VP8",
      "video/rtx",
    ]);
    const noH264 = CHROMIUM.filter((c) => c.mimeType !== "video/H264");
    expect(types(orderCodecs(noH264, videoMimeTypes(CHROMIUM), FIREFOX_START))[0]).toBe(
      "video/VP8",
    );
  });

  it("keeps VP9 out even when it is all the viewer decodes, and offers what it has if nothing else", () => {
    expect(types(orderCodecs(FIREFOX, ["video/VP9"], FIREFOX_START))).toEqual([
      "video/H264",
      "video/VP8",
      "video/rtx",
    ]);
    // A browser with none of the codecs it keeps offers what it has.
    const av1Only = [codec("video/AV1"), codec("video/rtx")];
    expect(types(orderCodecs(av1Only, undefined, FIREFOX_START))).toEqual([
      "video/AV1",
      "video/rtx",
    ]);
  });

  it("is the normal order with the normal start", () => {
    expect(orderCodecs(CHROMIUM, videoMimeTypes(CHROMIUM), NORMAL_START)).toEqual(
      orderCodecs(CHROMIUM, videoMimeTypes(CHROMIUM)),
    );
  });
});

describe("the order after the codec switch", () => {
  it("puts H.264, then VP8, first, and AV1 and VP9 after them, with nothing left out", () => {
    expect(types(orderCodecs(CHROMIUM, videoMimeTypes(CHROMIUM), SWITCHED_START))).toEqual([
      "video/H264",
      "video/H264",
      "video/VP8",
      "video/VP9",
      "video/VP9",
      "video/AV1",
      "video/rtx",
      "video/red",
      "video/ulpfec",
    ]);
  });

  it("is VP8 first where the viewer has no H.264, and never puts VP9 ahead of the cheaper two", () => {
    const noH264 = videoMimeTypes(CHROMIUM).filter((type) => type !== "video/H264");
    expect(types(orderCodecs(CHROMIUM, noH264, SWITCHED_START))[0]).toBe("video/VP8");
    // A viewer that decodes only AV1 and VP9 still gets a codec: AV1 and VP9, as the browser ranks them.
    expect(types(orderCodecs(CHROMIUM, ["video/VP9", "video/AV1"], SWITCHED_START))).toEqual([
      "video/VP9",
      "video/VP9",
      "video/AV1",
      "video/rtx",
      "video/red",
      "video/ulpfec",
    ]);
  });

  it("picks the pair's target among what it negotiated: H.264, else VP8, never VP9", () => {
    const negotiated = (...mimeTypes: string[]) => mimeTypes.map((type) => codec(type));
    expect(
      switchTarget(negotiated("video/AV1", "video/VP9", "video/H264", "video/VP8"))?.mimeType,
    ).toBe("video/H264");
    expect(switchTarget(negotiated("video/AV1", "video/VP9", "video/VP8"))?.mimeType).toBe(
      "video/VP8",
    );
    expect(switchTarget(negotiated("video/AV1", "video/VP9", "video/rtx"))).toBeUndefined();
    expect(switchTarget([])).toBeUndefined();
  });
});

const CAPTURE: Capture = { width: 1920, height: 1080, frameRate: 30, bitrate: 3_000_000 };

/** A `mediaCapabilities` that answers `powerEfficient` per codec (an Error rejects, a missing one hangs). */
function capabilities(answers: Record<string, boolean | Error | "hang">) {
  const encodingInfo = vi.fn(async (config: MediaEncodingConfiguration) => {
    const answer = answers[config.video?.contentType ?? ""];
    if (answer === "hang") return new Promise<never>(() => {});
    if (answer instanceof Error) throw answer;
    return { supported: true, smooth: true, powerEfficient: answer ?? false };
  });
  return { encodingInfo } as unknown as MediaCapabilities & { encodingInfo: typeof encodingInfo };
}

describe("codecReasonOf", () => {
  it("gives the reason of an order only while the codec sent is the one it is about", () => {
    expect(codecReasonOf("hardware", "video/VP9")).toBe("hardware");
    expect(codecReasonOf("hardware", "video/H264")).toBe("hardware");
    expect(codecReasonOf("hardware", "video/AV1")).toBe("preferred");
    expect(codecReasonOf("hardware", "video/VP8")).toBe("preferred");
    expect(codecReasonOf("browser", "video/H264")).toBe("browser");
    expect(codecReasonOf("browser", "video/vp8")).toBe("browser");
    expect(codecReasonOf("browser", "video/VP9")).toBe("preferred");
  });

  it("leaves the normal order's reason as it is", () => {
    expect(codecReasonOf("preferred", "video/AV1")).toBe("preferred");
  });

  it("gives the switch's reason (cpu) for the codec it moved to, not for a reading still on the one it left", () => {
    expect(codecReasonOf("cpu", "video/H264")).toBe("cpu");
    expect(codecReasonOf("cpu", "video/VP8")).toBe("cpu");
    expect(codecReasonOf("cpu", "video/AV1")).toBe("preferred");
    expect(codecReasonOf("cpu", "video/vp9")).toBe("preferred");
  });

  it("gives none of them for a codec not known yet", () => {
    expect(codecReasonOf("hardware")).toBe("preferred");
    expect(codecReasonOf("browser")).toBe("preferred");
  });
});

describe("chooseStartOrder", () => {
  afterEach(() => vi.useRealTimers());

  it("starts a Firefox streamer on H.264 without asking", async () => {
    const asked = capabilities({});
    expect(await chooseStartOrder("firefox", CAPTURE, asked)).toBe(FIREFOX_START);
    expect(FIREFOX_START).toMatchObject({ reason: "browser", order: ["video/h264", "video/vp8"] });
    expect(asked.encodingInfo).not.toHaveBeenCalled();
  });

  it("asks Chromium about AV1, VP9 and H.264 at the capture's size, frame rate and bitrate", async () => {
    const asked = capabilities({});
    await chooseStartOrder("chrome", CAPTURE, asked);
    expect(asked.encodingInfo.mock.calls.map(([config]) => config)).toEqual([
      {
        type: "webrtc",
        video: {
          contentType: "video/AV1",
          width: 1920,
          height: 1080,
          bitrate: 3_000_000,
          framerate: 30,
        },
      },
      {
        type: "webrtc",
        video: {
          contentType: "video/VP9",
          width: 1920,
          height: 1080,
          bitrate: 3_000_000,
          framerate: 30,
        },
      },
      {
        type: "webrtc",
        video: {
          contentType: "video/H264",
          width: 1920,
          height: 1080,
          bitrate: 3_000_000,
          framerate: 30,
        },
      },
    ]);
  });

  it.each([
    ["AV1 and VP9", { "video/AV1": true, "video/VP9": true }, NORMAL_START],
    ["AV1 only", { "video/AV1": true, "video/VP9": false }, NORMAL_START],
    ["VP9 only", { "video/AV1": false, "video/VP9": true }, HARDWARE_VP9_START],
    ["VP9 and H.264", { "video/VP9": true, "video/H264": true }, HARDWARE_VP9_START],
    ["AV1 and H.264", { "video/AV1": true, "video/H264": true }, NORMAL_START],
    ["H.264 only", { "video/H264": true }, HARDWARE_H264_START],
    ["none", { "video/AV1": false, "video/VP9": false, "video/H264": false }, NORMAL_START],
  ])("with hardware %s, picks the right order", async (_, answers, expected) => {
    for (const name of ["chrome", "edge", "opera"] as const) {
      expect(await chooseStartOrder(name, CAPTURE, capabilities(answers))).toBe(expected);
    }
  });

  it("names the reason for each order", () => {
    expect(NORMAL_START.reason).toBe("preferred");
    expect(HARDWARE_VP9_START.reason).toBe("hardware");
    expect(HARDWARE_VP9_START.order.slice(0, 2)).toEqual(["video/vp9", "video/av1"]);
    expect(HARDWARE_H264_START.reason).toBe("hardware");
    expect(HARDWARE_H264_START.order).toEqual([
      "video/h264",
      "video/av1",
      "video/vp9",
      "video/vp8",
    ]);
  });

  it("takes the normal order for Safari and others, and without mediaCapabilities", async () => {
    const asked = capabilities({ "video/VP9": true });
    expect(await chooseStartOrder("safari", CAPTURE, asked)).toBe(NORMAL_START);
    expect(await chooseStartOrder("other", CAPTURE, asked)).toBe(NORMAL_START);
    expect(asked.encodingInfo).not.toHaveBeenCalled();
    expect(await chooseStartOrder("chrome", CAPTURE, undefined)).toBe(NORMAL_START);
  });

  it("takes the normal order when either answer is an error", async () => {
    expect(
      await chooseStartOrder(
        "chrome",
        CAPTURE,
        capabilities({ "video/AV1": new Error("no"), "video/VP9": true }),
      ),
    ).toBe(NORMAL_START);
    expect(
      await chooseStartOrder(
        "chrome",
        CAPTURE,
        capabilities({ "video/AV1": false, "video/VP9": new Error("no") }),
      ),
    ).toBe(NORMAL_START);
    expect(
      await chooseStartOrder(
        "chrome",
        CAPTURE,
        capabilities({ "video/AV1": false, "video/VP9": false, "video/H264": new Error("no") }),
      ),
    ).toBe(NORMAL_START);
  });

  it("takes the normal order when an answer takes too long, and doesn't wait longer", async () => {
    vi.useFakeTimers();
    const chosen = chooseStartOrder(
      "chrome",
      CAPTURE,
      capabilities({ "video/AV1": false, "video/VP9": "hang" }),
      500,
    );
    await vi.advanceTimersByTimeAsync(499);
    let settled = false;
    void chosen.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await chosen).toBe(NORMAL_START);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind when the answers come in time", async () => {
    vi.useFakeTimers();
    const chosen = chooseStartOrder("chrome", CAPTURE, capabilities({ "video/VP9": true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(await chosen).toBe(HARDWARE_VP9_START);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("videoMimeTypes", () => {
  it("lists each codec once, without retransmission and redundancy formats", () => {
    expect(videoMimeTypes(CHROMIUM)).toEqual(["video/VP8", "video/VP9", "video/AV1", "video/H264"]);
  });
});
