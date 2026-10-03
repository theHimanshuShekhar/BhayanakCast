/**
 * Capture a thumbnail of this browser's own screen share and upload it (ADR 10). Runs when a
 * share starts and every 3 minutes while it lasts. Best effort: a room card keeps its
 * placeholder (or its last thumbnail) if any step fails, but a failed first upload is retried
 * soon (10 s, 30 s, 60 s), so the card isn't left bare for a whole interval.
 */
import {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_WIDTH,
  thumbnailLayout,
  thumbnailRefreshMs,
  thumbnailUploadUrl,
} from "./thumbnails";

interface Frame {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/** `ImageCapture` isn't in every browser (nor in the DOM typings). */
type ImageCaptureCtor = new (track: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> };

async function grabWithImageCapture(track: MediaStreamTrack): Promise<Frame | null> {
  const Capture = (globalThis as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  if (!Capture) return null;
  try {
    const bitmap = await new Capture(track).grabFrame();
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    return null;
  }
}

/** Play the track in a detached `<video>` until it has a frame. */
async function grabWithVideo(track: MediaStreamTrack): Promise<Frame | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  const release = () => {
    video.pause();
    video.srcObject = null;
  };
  try {
    await video.play();
    for (let waited = 0; video.videoWidth === 0 && waited < 3000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch {
    release();
    return null;
  }
  if (video.videoWidth === 0) {
    release();
    return null;
  }
  return { source: video, width: video.videoWidth, height: video.videoHeight, release };
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * A 480x270 WebP (JPEG where the browser can't encode WebP) of the track's current frame,
 * letterboxed to keep its aspect ratio; null if no frame could be taken.
 */
export async function captureThumbnail(track: MediaStreamTrack): Promise<Blob | null> {
  const frame = (await grabWithImageCapture(track)) ?? (await grabWithVideo(track));
  if (!frame) return null;
  try {
    const layout = thumbnailLayout(frame.width, frame.height);
    const canvas = document.createElement("canvas");
    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = THUMBNAIL_HEIGHT;
    const context = canvas.getContext("2d");
    if (!layout || !context) return null;
    context.fillStyle = "#000";
    context.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    context.drawImage(frame.source, layout.x, layout.y, layout.width, layout.height);
    for (const quality of [0.8, 0.6, 0.4]) {
      let blob = await toBlob(canvas, "image/webp", quality);
      // A browser without a WebP encoder answers with a PNG, which the server refuses.
      if (blob?.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
      if (blob && blob.size <= THUMBNAIL_MAX_BYTES) return blob;
    }
    return null;
  } finally {
    frame.release();
  }
}

/** An upload that takes longer than this is given up on (a hung connection or server). */
export const UPLOAD_TIMEOUT_MS = 15_000;

/** POST `blob` as the caller's thumbnail for `roomId`. True if the server took it; never throws. */
export async function postThumbnail(
  roomId: string,
  blob: Blob,
  send: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await send(thumbnailUploadUrl(roomId), {
      method: "POST",
      headers: { "content-type": blob.type },
      body: blob,
      credentials: "same-origin",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Capture `track` and upload it as the caller's thumbnail for `roomId`. True if it was
 * uploaded; false if there was no frame to take or the upload failed. Never throws.
 */
export async function uploadShareThumbnail(
  roomId: string,
  track: MediaStreamTrack,
): Promise<boolean> {
  try {
    const blob = await captureThumbnail(track);
    return blob ? await postThumbnail(roomId, blob) : false;
  } catch {
    return false;
  }
}

/**
 * The longest a whole upload (capture and send) may take before it counts as failed: the
 * capture waits up to 3 s for a frame, the send up to `UPLOAD_TIMEOUT_MS`, and the rest is margin.
 */
export const UPLOAD_DEADLINE_MS = 30_000;

/**
 * When to try again after a failed first upload, each from the failure before it. Then it is the
 * normal cadence: capped, so a server that is down isn't hammered.
 */
export const RETRY_DELAYS_MS = [10_000, 30_000, 60_000] as const;

/** How often a share's thumbnail is captured again; an e2e build shortens it. */
const REFRESH_MS = thumbnailRefreshMs(import.meta.env.VITE_THUMBNAIL_REFRESH_MS);

/**
 * Upload a thumbnail of `track` now and then every `intervalMs` while the track is live, until
 * the returned function is called (the share stopped, or the page left the room). If the first
 * upload fails, it is retried after each of `RETRY_DELAYS_MS`, then left to the interval. The
 * interval skips its turn while the first upload or a retry is pending, or an upload is still
 * in flight, so uploads never overlap. `upload` is a seam for tests.
 */
export function startThumbnailUploads(
  roomId: string,
  track: MediaStreamTrack,
  upload: typeof uploadShareThumbnail = uploadShareThumbnail,
  intervalMs: number = REFRESH_MS,
): () => void {
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  // The first upload and its retries are still going, and an upload is in flight.
  let retrying = true;
  let inFlight = false;
  // One upload, capture and send: a capture that never settles (`grabFrame`, `video.play`) is a
  // failure too, instead of leaving `inFlight` and `retrying` set for the rest of the share.
  const run = async () => {
    inFlight = true;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        upload(roomId, track).catch(() => false),
        new Promise<boolean>((resolve) => {
          deadline = setTimeout(() => resolve(false), UPLOAD_DEADLINE_MS);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
      inFlight = false;
    }
  };
  const retry = (attempt: number) => {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      retrying = false;
      return;
    }
    retryTimer = setTimeout(async () => {
      if (stopped || track.readyState !== "live") return;
      if (!(await run()) && !stopped) retry(attempt + 1);
      else retrying = false;
    }, delay);
  };
  void run().then((ok) => {
    if (!ok && !stopped) retry(0);
    else retrying = false;
  });
  const timer = setInterval(() => {
    if (track.readyState === "live" && !retrying && !inFlight) void run();
  }, intervalMs);
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearInterval(timer);
  };
}
