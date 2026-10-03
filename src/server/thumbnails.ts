/**
 * Room thumbnails, server half (ADR 10): the latest still per streamer per room, stored in
 * Postgres. The upload and read functions take the database and the caller explicitly, so the
 * routes in src/routes/api.thumbnails.*.ts stay thin and tests call these against PGlite. The
 * uploader is always the caller, never an id the client sends.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { rooms, streamIntervals, thumbnails } from "../db/schema/index.ts";
import {
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MAX_HEIGHT,
  THUMBNAIL_MAX_WIDTH,
  THUMBNAIL_MIME_TYPES,
  type ThumbnailMime,
} from "../lib/thumbnails.ts";
import { type Caller, requireSignedIn } from "./caller.ts";
import { declaredImageSize } from "./image-size.ts";
import { withinRateLimit } from "./rate-limit.ts";
import { endedWithinRetention } from "./rooms.ts";
import { roomVisibleTo } from "./visibility.ts";

/** Thrown when the caller isn't streaming in the room they upload to. */
export class NotStreamingError extends Error {
  constructor() {
    super("Only someone sharing their screen in this room can upload its thumbnail");
    this.name = "NotStreamingError";
  }
}

/** Thrown for an upload that isn't a WebP or JPEG within the byte and pixel limits. */
export class InvalidThumbnailError extends Error {
  readonly reason: "type" | "size";

  // Not a parameter property: Node's type stripping can't run those (erasableSyntaxOnly).
  constructor(message: string, reason: "type" | "size") {
    super(message);
    this.reason = reason;
    this.name = "InvalidThumbnailError";
  }
}

/** The media type of `contentType` (parameters dropped) if thumbnails may use it. */
export function thumbnailMime(contentType: string | null): ThumbnailMime | null {
  const mime = contentType?.split(";")[0]?.trim().toLowerCase();
  return THUMBNAIL_MIME_TYPES.find((allowed) => allowed === mime) ?? null;
}

export interface UploadThumbnailInput {
  roomId: string;
  /** The request's Content-Type. */
  contentType: string | null;
  bytes: Uint8Array;
}

/**
 * Store `bytes` as the caller's latest thumbnail in `roomId`, replacing the previous one, and
 * stamp the room's `lastThumbnailAt`. Refused unless the caller is signed in and has an open
 * stream interval in the room, and the upload is a WebP or JPEG of at most 100 KB whose header
 * declares no more than twice the capture's size (the header is read, not taken on trust).
 */
export async function uploadThumbnail(
  db: Db,
  caller: Caller,
  input: UploadThumbnailInput,
  now: Date = new Date(),
): Promise<{ capturedAt: string }> {
  requireSignedIn(caller);
  const userId = caller.user.id;
  const [streaming] = await db
    .select({ id: streamIntervals.id })
    .from(streamIntervals)
    .where(
      and(
        eq(streamIntervals.roomId, input.roomId),
        eq(streamIntervals.userId, userId),
        isNull(streamIntervals.endedAt),
      ),
    );
  if (!streaming) throw new NotStreamingError();
  const mime = thumbnailMime(input.contentType);
  if (!mime) throw new InvalidThumbnailError("Thumbnails are WebP or JPEG images", "type");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > THUMBNAIL_MAX_BYTES) {
    throw new InvalidThumbnailError(
      `Thumbnails are at most ${THUMBNAIL_MAX_BYTES / 1024} KB`,
      "size",
    );
  }
  const size = declaredImageSize(mime, input.bytes);
  if (!size) throw new InvalidThumbnailError("The image doesn't match its type", "type");
  if (size.width > THUMBNAIL_MAX_WIDTH || size.height > THUMBNAIL_MAX_HEIGHT) {
    throw new InvalidThumbnailError(
      `Thumbnails are at most ${THUMBNAIL_MAX_WIDTH}x${THUMBNAIL_MAX_HEIGHT} pixels`,
      "size",
    );
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(thumbnails)
      .values({ roomId: input.roomId, userId, capturedAt: now, image: input.bytes, mime })
      .onConflictDoUpdate({
        target: [thumbnails.roomId, thumbnails.userId],
        set: { capturedAt: now, image: input.bytes, mime },
      });
    await tx.update(rooms).set({ lastThumbnailAt: now }).where(eq(rooms.id, input.roomId));
  });
  return { capturedAt: now.toISOString() };
}

/**
 * `userId`'s latest thumbnail in `roomId`, or null if they have none, the room is hidden from
 * the caller (a private room's screens are for the people allowed in, ADR 16) or it ended more
 * than 30 days ago (ADR 11: about to be purged, so already gone). A past stream's last
 * thumbnails are served like a live room's.
 */
export async function getThumbnail(
  db: Db,
  caller: Caller,
  roomId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ image: Uint8Array; mime: string; capturedAt: Date } | null> {
  const [row] = await db
    .select({ image: thumbnails.image, mime: thumbnails.mime, capturedAt: thumbnails.capturedAt })
    .from(thumbnails)
    .innerJoin(rooms, eq(rooms.id, thumbnails.roomId))
    .where(
      and(
        eq(thumbnails.roomId, roomId),
        eq(thumbnails.userId, userId),
        roomVisibleTo(caller),
        or(isNull(rooms.endedAt), endedWithinRetention(now)),
      ),
    );
  return row ?? null;
}

/** The entity tag of a thumbnail: its capture time, which changes with every upload. */
export const thumbnailEtag = (capturedAt: Date): string => `"${capturedAt.getTime()}"`;

/**
 * The route's answer for a thumbnail: 304 when `ifNoneMatch` lists its ETag, else the image.
 * `private`, because who may see it depends on the caller (ADR 16).
 */
export function thumbnailResponse(
  thumbnail: { image: Uint8Array; mime: string; capturedAt: Date },
  ifNoneMatch: string | null,
): Response {
  const etag = thumbnailEtag(thumbnail.capturedAt);
  const headers = {
    etag,
    "cache-control": "private, max-age=60",
    "x-content-type-options": "nosniff",
  };
  const tags = ifNoneMatch?.split(",").map((tag) => tag.trim().replace(/^W\//, ""));
  if (tags?.includes(etag) || tags?.includes("*")) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(new Uint8Array(thumbnail.image), {
    headers: { ...headers, "content-type": thumbnail.mime },
  });
}

/** Uploads a user may make: a share refreshes every ~3 minutes, so this is generous. */
const UPLOADS_PER_WINDOW = 20;
const UPLOAD_WINDOW_MS = 10 * 60_000;
const defaultUploads = new Map<string, number[]>();

/**
 * Whether `userId` may upload now under the per-user rate limit, recording the attempt if so.
 * `uploads` is the limiter's state (tests pass their own).
 */
export function mayUpload(
  userId: string,
  now: Date = new Date(),
  uploads: Map<string, number[]> = defaultUploads,
): boolean {
  return withinRateLimit(uploads, userId, UPLOADS_PER_WINDOW, UPLOAD_WINDOW_MS, now);
}

/**
 * Whether a browser request came from this site. Browsers send `Origin` on every POST and
 * cookies ride along cross-site, so refuse other origins; non-browser clients send none.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

/**
 * The request body, or null once it passes `max` bytes (a client can't make the server buffer
 * more than the limit, whatever its Content-Length says).
 */
export async function readBodyCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
