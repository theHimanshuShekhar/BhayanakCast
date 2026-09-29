import { describe, expect, it } from "vitest";
import { orderCodecs, videoMimeTypes } from "./codecs";

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

describe("videoMimeTypes", () => {
  it("lists each codec once, without retransmission and redundancy formats", () => {
    expect(videoMimeTypes(CHROMIUM)).toEqual(["video/VP8", "video/VP9", "video/AV1", "video/H264"]);
  });
});
