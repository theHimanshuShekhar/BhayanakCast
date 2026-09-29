/**
 * Room thumbnails, client-safe half (ADR 10): the limits the upload route enforces, the pure
 * size calculation the browser's capture uses, and the URL cards load the image from.
 */

/** Every thumbnail is this size: the frame is scaled down to fit and letterboxed. */
export const THUMBNAIL_WIDTH = 480;
export const THUMBNAIL_HEIGHT = 270;
/** Upload limit, enforced on the server (a 480x270 WebP is about 30 KB). */
export const THUMBNAIL_MAX_BYTES = 100 * 1024;
export const THUMBNAIL_MIME_TYPES = ["image/webp", "image/jpeg"] as const;
export type ThumbnailMime = (typeof THUMBNAIL_MIME_TYPES)[number];

export interface ThumbnailLayout {
  /** Where the scaled frame is drawn on the 480x270 canvas; the rest is bars. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fit a `sourceWidth` x `sourceHeight` frame into the thumbnail, keeping its aspect ratio and
 * centring it (letterbox or pillarbox). Scales small frames up to fit too; null for a frame with
 * no size.
 */
export function thumbnailLayout(sourceWidth: number, sourceHeight: number): ThumbnailLayout | null {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;
  const scale = Math.min(THUMBNAIL_WIDTH / sourceWidth, THUMBNAIL_HEIGHT / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.floor((THUMBNAIL_WIDTH - width) / 2),
    y: Math.floor((THUMBNAIL_HEIGHT - height) / 2),
    width,
    height,
  };
}

/** Where a streamer's latest thumbnail is served; `capturedAt` busts the cache on a new upload. */
export const thumbnailUrl = (roomId: string, userId: string, capturedAt: string): string =>
  `/api/thumbnails/${encodeURIComponent(roomId)}/${encodeURIComponent(userId)}?t=${new Date(capturedAt).getTime()}`;

/** Where a streamer uploads their thumbnail for a room. */
export const thumbnailUploadUrl = (roomId: string): string =>
  `/api/thumbnails/${encodeURIComponent(roomId)}`;
