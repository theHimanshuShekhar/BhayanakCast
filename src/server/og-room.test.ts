import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client.ts";
import {
  presenceIntervals,
  roomMembers,
  rooms,
  streamIntervals,
  thumbnails,
  user,
} from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  CARD_CACHE_CONTROL,
  CardCache,
  cardResponse,
  fetchAvatar,
  roomCardPng,
  siteImageResponse,
} from "./og-room.ts";
import { pngSize, WEBP_64X36 } from "./test-images.ts";

const T0 = new Date("2026-10-03T12:00:00Z");
const noAvatar = async () => null;

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values(
    ["host", "viewer", "streamer"].map((id) => ({
      id,
      name: id,
      email: `${id}@discord.invalid`,
      discordUsername: `${id}.discord`,
    })),
  );
});

afterEach(async () => {
  await close();
});

interface SeedOptions {
  id: string;
  isPrivate?: boolean;
  endedAt?: Date | null;
  /** Users present now, and users streaming now. */
  present?: string[];
  streaming?: string[];
  thumbnailAt?: Date | null;
}

/** A room hosted by `host`, with the open intervals and the thumbnail described. */
async function seed({ id, isPrivate = false, endedAt = null, ...rest }: SeedOptions) {
  const { present = [], streaming = [], thumbnailAt = null } = rest;
  await db.insert(rooms).values({
    id,
    name: `${id} name`,
    hostUserId: "host",
    createdBy: "host",
    createdAt: T0,
    isPrivate,
    endedAt,
  });
  await db.insert(roomMembers).values({ roomId: id, userId: "host", role: "host" });
  const span = (userId: string) => ({ roomId: id, userId, startedAt: T0, lastSeenAt: T0 });
  if (present.length) await db.insert(presenceIntervals).values(present.map(span));
  if (streaming.length) await db.insert(streamIntervals).values(streaming.map(span));
  if (thumbnailAt) {
    await db.insert(thumbnails).values({
      roomId: id,
      userId: "streamer",
      capturedAt: thumbnailAt,
      image: WEBP_64X36,
      mime: "image/webp",
    });
  }
}

const bytes = (png: Uint8Array | null) => Buffer.from(png ?? []);

describe("roomCardPng", () => {
  it("draws a public live room as a 1200x630 PNG, thumbnail behind", async () => {
    await seed({
      id: "pub",
      present: ["host", "viewer"],
      streaming: ["streamer"],
      thumbnailAt: T0,
    });
    const png = await roomCardPng(db, "pub", { cache: new CardCache(), avatar: noAvatar });
    expect(pngSize(png ?? new Uint8Array())).toEqual({ width: 1200, height: 630 });
  });

  it("draws a room that has no thumbnail yet", async () => {
    await seed({ id: "bare", present: ["host"] });
    const png = await roomCardPng(db, "bare", { cache: new CardCache(), avatar: noAvatar });
    expect(pngSize(png ?? new Uint8Array())).toEqual({ width: 1200, height: 630 });
  });

  it("gives nothing for a private room, an ended one and an unknown one alike", async () => {
    await seed({
      id: "priv",
      isPrivate: true,
      present: ["host"],
      streaming: ["streamer"],
      thumbnailAt: T0,
    });
    await seed({ id: "gone", endedAt: new Date(T0.getTime() + 60_000) });
    const cache = new CardCache();
    for (const id of ["priv", "gone", "nope"]) {
      expect(await roomCardPng(db, id, { cache, avatar: noAvatar })).toBeNull();
    }
    // Nothing was drawn or kept for any of them, and the host's picture wasn't fetched.
    expect(cache.size).toBe(0);
  });

  it("never reads the host's picture for a room it won't draw", async () => {
    await seed({ id: "priv", isPrivate: true, present: ["host"] });
    const avatar = vi.fn(noAvatar);
    await roomCardPng(db, "priv", { cache: new CardCache(), avatar });
    expect(avatar).not.toHaveBeenCalled();
  });

  describe("caching", () => {
    it("serves the same card again until what it shows changes", async () => {
      await seed({ id: "pub", present: ["host"], streaming: ["streamer"], thumbnailAt: T0 });
      const options = { cache: new CardCache(), avatar: noAvatar };
      const first = await roomCardPng(db, "pub", options);
      expect(await roomCardPng(db, "pub", options)).toBe(first);
      expect(options.cache.size).toBe(1);
    });

    it("draws again for a new viewer count, a newer thumbnail and a rename", async () => {
      await seed({ id: "pub", present: ["host"], streaming: ["streamer"], thumbnailAt: T0 });
      const options = { cache: new CardCache(), avatar: noAvatar };
      const first = await roomCardPng(db, "pub", options);

      await db
        .insert(presenceIntervals)
        .values({ roomId: "pub", userId: "viewer", startedAt: T0, lastSeenAt: T0 });
      const moreViewers = await roomCardPng(db, "pub", options);
      expect(moreViewers).not.toBe(first);

      await db.update(thumbnails).set({ capturedAt: new Date(T0.getTime() + 180_000) });
      const newThumbnail = await roomCardPng(db, "pub", options);
      expect(newThumbnail).not.toBe(moreViewers);

      await db.update(rooms).set({ name: "renamed" });
      expect(await roomCardPng(db, "pub", options)).not.toBe(newThumbnail);
      expect(options.cache.size).toBe(4);
    });

    it("keeps the cards of different rooms apart", async () => {
      await seed({ id: "one", present: ["host"] });
      await seed({ id: "two", present: ["host"] });
      const options = { cache: new CardCache(), avatar: noAvatar };
      const one = await roomCardPng(db, "one", options);
      expect(await roomCardPng(db, "two", options)).not.toBe(one);
      expect(await roomCardPng(db, "one", options)).toBe(one);
    });
  });
});

describe("CardCache", () => {
  const card = (n: number) => Uint8Array.of(n);

  it("shares one render between callers that ask while it is running", async () => {
    const cache = new CardCache(4);
    const render = vi.fn(async () => card(1));
    const [a, b] = await Promise.all([cache.get("k", render), cache.get("k", render)]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("drops the least recently used card past its size", async () => {
    const cache = new CardCache(2);
    const render = vi.fn(async () => card(1));
    await cache.get("a", render);
    await cache.get("b", render);
    await cache.get("a", render); // a is now the more recent
    await cache.get("c", render); // evicts b
    expect(cache.size).toBe(2);
    expect(render).toHaveBeenCalledTimes(3);
    await cache.get("a", render);
    expect(render).toHaveBeenCalledTimes(3);
    await cache.get("b", render);
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("does not keep a render that failed", async () => {
    const cache = new CardCache(2);
    await expect(cache.get("k", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await Promise.resolve();
    expect(cache.size).toBe(0);
    expect(bytes(await cache.get("k", async () => card(7)))).toEqual(Buffer.from([7]));
  });
});

describe("fetchAvatar", () => {
  const pngBody = () =>
    new Response(Uint8Array.of(1, 2, 3), { headers: { "content-type": "image/png" } });

  afterEach(() => vi.restoreAllMocks());

  it("fetches only from Discord's CDN, and nothing for another host or no picture", async () => {
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async () => pngBody());
    expect(await fetchAvatar(null)).toBeNull();
    expect(await fetchAvatar("https://evil.example/a.png")).toBeNull();
    expect(await fetchAvatar("http://cdn.discordapp.com/avatars/1/a.png")).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });

  it("asks Discord for a small PNG (WebP and GIF are rewritten) and returns a data URI", async () => {
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async () => pngBody());
    const uri = await fetchAvatar("https://cdn.discordapp.com/avatars/1/a_hash.gif");
    expect(uri).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
    const [url, init] = fetched.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://cdn.discordapp.com/avatars/1/a_hash.png?size=128");
    expect(init?.redirect).toBe("error");
  });

  it("is null when Discord answers badly, with another type or too much, or the fetch fails", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    const url = "https://cdn.discordapp.com/avatars/1/a.png";
    fetched.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    expect(await fetchAvatar(url)).toBeNull();
    fetched.mockResolvedValueOnce(
      new Response(Uint8Array.of(1), { headers: { "content-type": "text/html" } }),
    );
    expect(await fetchAvatar(url)).toBeNull();
    fetched.mockResolvedValueOnce(
      new Response(new Uint8Array(300 * 1024), { headers: { "content-type": "image/png" } }),
    );
    expect(await fetchAvatar(url)).toBeNull();
    fetched.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchAvatar(url)).toBeNull();
  });
});

describe("the route's answers", () => {
  it("send a card as a PNG with a short public cache", async () => {
    const response = cardResponse(Uint8Array.of(1, 2, 3));
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(CARD_CACHE_CONTROL).toBe("public, max-age=60");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("send the committed site image when there is no card", () => {
    const response = siteImageResponse();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/og-image.png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });
});
