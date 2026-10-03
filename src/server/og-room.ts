/**
 * The room card behind `/api/og/room/<id>.png` (ADR 22), server half: what a visitor may see of
 * the room, drawn by ./og-card.ts and kept in a small in-memory cache. The route
 * (src/routes/api/og/room/$roomId.ts) stays thin; tests call these against PGlite.
 *
 * The room is read as a visitor, whoever asks: a private, ended or unknown room gives the site
 * card, indistinguishable from each other, and a private room's thumbnail is never read.
 */
import type { Db } from "../db/client.ts";
import { newestThumbnailMs } from "../lib/embed.ts";
import { discordAvatarUrl } from "../lib/format.ts";
import type { Caller } from "./caller.ts";
import { backdropDataUri } from "./og-backdrop.ts";
import { renderRoomCard } from "./og-card.ts";
import { getLiveRoom } from "./rooms.ts";
import { getThumbnail } from "./thumbnails.ts";

const VISITOR: Caller = { user: null, role: "visitor" };

/** Rendered cards kept: a few dozen rooms are live at once, and a card is about 200 KB. */
const CARD_CACHE_SIZE = 32;

/** An LRU of promises, so unfurls of one room arriving together share one render. */
export class CardCache {
  private readonly cards = new Map<string, Promise<Uint8Array>>();

  private readonly max: number;

  constructor(max = CARD_CACHE_SIZE) {
    this.max = max;
  }

  get size(): number {
    return this.cards.size;
  }

  /** The card for `key`, rendered by `render` unless cached. A failed render isn't kept. */
  get(key: string, render: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const cached = this.cards.get(key);
    if (cached) {
      // Most recently used goes last.
      this.cards.delete(key);
      this.cards.set(key, cached);
      return cached;
    }
    const card = render();
    this.cards.set(key, card);
    card.catch(() => this.cards.delete(key));
    const oldest = this.cards.keys().next().value;
    if (this.cards.size > this.max && oldest !== undefined) this.cards.delete(oldest);
    return card;
  }
}

/** The picture is fetched from Discord's CDN only (the stored URL is checked, as for the UI). */
const AVATAR_PX = 128;
const AVATAR_MAX_BYTES = 256 * 1024;
const AVATAR_TIMEOUT_MS = 2000;

/** The host's Discord picture as a `data:` URI, or null (none, not Discord's, slow, not PNG/JPEG). */
export async function fetchAvatar(image: string | null): Promise<string | null> {
  // PNG and JPEG only: resvg can't draw WebP. Discord serves either format by extension.
  const url = discordAvatarUrl(image?.replace(/\.(webp|gif)(\?|$)/, ".png$2") ?? null, AVATAR_PX);
  if (!url) return null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
      redirect: "error",
    });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (!response.ok || (type !== "image/png" && type !== "image/jpeg")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_MAX_BYTES) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

export interface RoomCardOptions {
  cache?: CardCache;
  /** The host's picture; tests stand in for the network. */
  avatar?: (image: string | null) => Promise<string | null>;
}

const defaultCache = new CardCache();

/**
 * The card for `roomId` as a PNG: its name, host, viewers and newest thumbnail. Null when a
 * visitor can't see the room (private, ended or unknown, which can't be told apart): the route
 * then sends the site image. Cached by the room, its newest thumbnail's time, who is in it and
 * its name and host, so a card is drawn again only when what it shows has changed. (The viewer
 * count is exact rather than bucketed, as it is printed on the card; a room holds at most ten
 * people.)
 */
export async function roomCardPng(
  db: Db,
  roomId: string,
  { cache = defaultCache, avatar = fetchAvatar }: RoomCardOptions = {},
): Promise<Uint8Array | null> {
  const room = await getLiveRoom(db, VISITOR, roomId);
  if (!room || room.isPrivate) return null;

  const thumbnailMs = newestThumbnailMs(room.streamers);
  const key = [room.id, thumbnailMs, room.participantCount, room.host?.id, room.name].join("|");
  return cache.get(key, async () => {
    // The streamer whose thumbnail is newest; their bytes are read only when drawing.
    const newest = room.streamers.find(
      (s) => s.thumbnailAt && Date.parse(s.thumbnailAt) === thumbnailMs,
    );
    const thumbnail = newest ? await getThumbnail(db, VISITOR, room.id, newest.id) : null;
    const [backdrop, hostAvatar] = await Promise.all([
      thumbnail ? backdropDataUri(thumbnail.image, thumbnail.mime) : null,
      room.host ? avatar(room.host.image) : null,
    ]);
    return renderRoomCard({
      name: room.name,
      hostName: room.host?.username ?? null,
      hostAvatar,
      watching: room.participantCount,
      backdrop,
    });
  });
}
