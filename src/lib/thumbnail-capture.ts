/**
 * Capture a thumbnail of this browser's own screen share and upload it (ADR 10). Runs when a
 * share starts. Best effort: a room card keeps its placeholder if any step fails.
 */
import {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_WIDTH,
  thumbnailLayout,
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

/** Capture `track` and upload it as the caller's thumbnail for `roomId`. Never throws. */
export async function uploadShareThumbnail(roomId: string, track: MediaStreamTrack): Promise<void> {
  try {
    const blob = await captureThumbnail(track);
    if (!blob) return;
    await fetch(thumbnailUploadUrl(roomId), {
      method: "POST",
      headers: { "content-type": blob.type },
      body: blob,
      credentials: "same-origin",
    });
  } catch {
    // Best effort.
  }
}
