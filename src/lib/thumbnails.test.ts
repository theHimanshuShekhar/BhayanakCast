import { afterEach, describe, expect, it, vi } from "vitest";
import { startThumbnailUploads } from "./thumbnail-capture.ts";
import {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_REFRESH_MIN_MS,
  THUMBNAIL_REFRESH_MS,
  THUMBNAIL_WIDTH,
  thumbnailLayout,
  thumbnailRefreshMs,
  thumbnailUrl,
} from "./thumbnails.ts";

describe("thumbnailLayout", () => {
  it("fills the thumbnail with a 16:9 frame", () => {
    expect(thumbnailLayout(1920, 1080)).toEqual({
      x: 0,
      y: 0,
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
    });
  });

  it("letterboxes a wider frame with bars above and below", () => {
    // 21:9 -> 480 wide, 206 tall, centred vertically.
    expect(thumbnailLayout(2560, 1097)).toEqual({ x: 0, y: 32, width: 480, height: 206 });
  });

  it("pillarboxes a narrower frame with bars left and right", () => {
    // 4:3 -> 360x270, centred horizontally.
    expect(thumbnailLayout(1024, 768)).toEqual({ x: 60, y: 0, width: 360, height: 270 });
  });

  it("scales a small frame up to fit, keeping its aspect ratio", () => {
    expect(thumbnailLayout(240, 135)).toEqual({ x: 0, y: 0, width: 480, height: 270 });
  });

  it("never leaves the canvas, even for extreme shapes", () => {
    for (const [w, h] of [
      [10000, 10],
      [10, 10000],
      [1, 1],
    ] as const) {
      const box = thumbnailLayout(w, h);
      expect(box).not.toBeNull();
      if (!box) continue;
      expect(box.width).toBeGreaterThanOrEqual(1);
      expect(box.height).toBeGreaterThanOrEqual(1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(THUMBNAIL_WIDTH);
      expect(box.y + box.height).toBeLessThanOrEqual(THUMBNAIL_HEIGHT);
    }
  });

  it("has no layout for a frame without a size", () => {
    expect(thumbnailLayout(0, 720)).toBeNull();
    expect(thumbnailLayout(1280, 0)).toBeNull();
    expect(thumbnailLayout(Number.NaN, 720)).toBeNull();
  });
});

describe("thumbnailUrl", () => {
  it("changes with the capture time so a new upload is a new URL", () => {
    const first = thumbnailUrl("r1", "u1", "2026-09-01T12:00:00.000Z");
    const next = thumbnailUrl("r1", "u1", "2026-09-01T12:03:00.000Z");
    expect(first).toMatch(/^\/api\/thumbnails\/r1\/u1\?t=\d+$/);
    expect(next).not.toBe(first);
  });
});

describe("thumbnailRefreshMs", () => {
  it("defaults to 3 minutes and ignores values that aren't positive numbers", () => {
    expect(THUMBNAIL_REFRESH_MS).toBe(180_000);
    for (const configured of [undefined, "", "abc", "-5000", "0", "NaN", "Infinity"]) {
      expect(thumbnailRefreshMs(configured)).toBe(THUMBNAIL_REFRESH_MS);
    }
  });

  it("takes a configured interval, but never below the floor", () => {
    expect(thumbnailRefreshMs("8000")).toBe(8000);
    expect(thumbnailRefreshMs("100")).toBe(THUMBNAIL_REFRESH_MIN_MS);
  });
});

describe("startThumbnailUploads", () => {
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    vi.useFakeTimers();
    const upload = vi.fn(async () => {});
    const track = { readyState: "live" } as MediaStreamTrack;
    const stop = startThumbnailUploads("r1", track, upload, 60_000);
    return { upload, track, stop };
  };

  it("uploads at once, then once per interval", () => {
    const { upload, track } = setup();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenLastCalledWith("r1", track);
    vi.advanceTimersByTime(59_999);
    expect(upload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(upload).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(120_000);
    expect(upload).toHaveBeenCalledTimes(4);
  });

  it("stops when told to", () => {
    const { upload, stop } = setup();
    vi.advanceTimersByTime(60_000);
    stop();
    vi.advanceTimersByTime(600_000);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("skips a track that has ended", () => {
    const { upload, track } = setup();
    (track as { readyState: string }).readyState = "ended";
    vi.advanceTimersByTime(600_000);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
