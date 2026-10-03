import { afterEach, describe, expect, it, vi } from "vitest";
import {
  postThumbnail,
  RETRY_DELAYS_MS,
  startThumbnailUploads,
  UPLOAD_TIMEOUT_MS,
} from "./thumbnail-capture.ts";
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

  /** `results` are what the uploads answer in turn (true: uploaded); then true. */
  const setup = (results: boolean[] = [], intervalMs = 60_000) => {
    vi.useFakeTimers();
    const queue = [...results];
    const upload = vi.fn(async () => queue.shift() ?? true);
    const track = { readyState: "live" } as MediaStreamTrack;
    const stop = startThumbnailUploads("r1", track, upload, intervalMs);
    return { upload, track, stop };
  };

  it("uploads at once, then once per interval", async () => {
    const { upload, track } = setup();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenLastCalledWith("r1", track);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(upload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(upload).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(upload).toHaveBeenCalledTimes(4);
  });

  it("stops when told to", async () => {
    const { upload, stop } = setup();
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("skips a track that has ended", async () => {
    const { upload, track } = setup();
    (track as { readyState: string }).readyState = "ended";
    await vi.advanceTimersByTimeAsync(600_000);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("retries a failed first upload after 10 s, 30 s and 60 s, then keeps the interval", async () => {
    const { upload } = setup([false, false, false, false], 180_000);
    expect(RETRY_DELAYS_MS).toEqual([10_000, 30_000, 60_000]);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(upload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(upload).toHaveBeenCalledTimes(2);
    // The next wait runs from the failed retry.
    await vi.advanceTimersByTimeAsync(29_999);
    expect(upload).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(upload).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(upload).toHaveBeenCalledTimes(4);
    // Capped: nothing more until the interval fires (3 min from the start).
    await vi.advanceTimersByTimeAsync(79_999);
    expect(upload).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(upload).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(upload).toHaveBeenCalledTimes(6);
  });

  it("stops retrying once an upload works", async () => {
    const { upload } = setup([false, true], 180_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(upload).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(170_000 - 1);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry after a first upload that worked", async () => {
    const { upload } = setup([true], 180_000);
    await vi.advanceTimersByTimeAsync(179_999);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("drops a pending retry when stopped, or when the track has ended", async () => {
    const stopped = setup([false], 180_000);
    await vi.advanceTimersByTimeAsync(1);
    stopped.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(stopped.upload).toHaveBeenCalledTimes(1);

    const ended = setup([false], 180_000);
    await vi.advanceTimersByTimeAsync(1);
    (ended.track as { readyState: string }).readyState = "ended";
    await vi.advanceTimersByTimeAsync(600_000);
    expect(ended.upload).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer or upload behind when stopped during an in-flight retry", async () => {
    vi.useFakeTimers();
    // The first upload fails at once; the retry's upload hangs until we settle it.
    let settle: (ok: boolean) => void = () => {};
    const upload = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (settle = resolve)))
      .mockResolvedValue(true);
    const track = { readyState: "live" } as MediaStreamTrack;
    const stop = startThumbnailUploads("r1", track, upload, 180_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(upload).toHaveBeenCalledTimes(2);
    stop();
    settle(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("doesn't upload on the interval while a retry is pending", async () => {
    // Retries at 10 s, 40 s and 100 s (all failing) fall past a 30 s interval: its ticks wait.
    const { upload } = setup([false, false, false, false], 30_000);
    await vi.advanceTimersByTimeAsync(99_999);
    expect(upload).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(upload).toHaveBeenCalledTimes(4);
    // The chain is done: the interval takes over again.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(upload).toHaveBeenCalledTimes(5);
  });

  it("doesn't start an interval upload while one is still in flight", async () => {
    vi.useFakeTimers();
    let settle: (ok: boolean) => void = () => {};
    const upload = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (settle = resolve)))
      .mockResolvedValue(true);
    const track = { readyState: "live" } as MediaStreamTrack;
    startThumbnailUploads("r1", track, upload, 60_000);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(upload).toHaveBeenCalledTimes(1);
    settle(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(upload).toHaveBeenCalledTimes(2);
  });
});

describe("postThumbnail", () => {
  const blob = new Blob(["x"], { type: "image/webp" });

  it("posts with a timeout signal and answers whether the server took it", async () => {
    const send = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await postThumbnail("r 1", blob, send as typeof fetch)).toBe(true);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/thumbnails/r%201");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("counts a non-2xx answer and a network error as failures", async () => {
    const refused = vi.fn(async () => new Response(null, { status: 429 }));
    expect(await postThumbnail("r1", blob, refused as typeof fetch)).toBe(false);
    const down = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await postThumbnail("r1", blob, down as typeof fetch)).toBe(false);
  });

  it("gives up on a request that hangs once its timeout signal fires", async () => {
    // Node's own timer backs `AbortSignal.timeout`, which fake timers don't move: hand the
    // upload a signal of ours, and check it was asked for `UPLOAD_TIMEOUT_MS`.
    const timeout = new AbortController();
    const timeoutSignal = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    try {
      // Never answers, but rejects when its signal aborts, as fetch does.
      const hung = vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      );
      const result = postThumbnail("r1", blob, hung as typeof fetch);
      expect(timeoutSignal).toHaveBeenCalledWith(UPLOAD_TIMEOUT_MS);
      timeout.abort(new DOMException("timed out", "TimeoutError"));
      expect(await result).toBe(false);
    } finally {
      timeoutSignal.mockRestore();
    }
  });
});
