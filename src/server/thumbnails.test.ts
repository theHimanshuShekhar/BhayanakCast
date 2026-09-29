import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { roomMembers, rooms, streamIntervals, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { THUMBNAIL_MAX_BYTES } from "../lib/thumbnails.ts";
import type { Caller } from "./caller.ts";
import { SignInRequiredError } from "./caller.ts";
import { getRecap } from "./recaps.ts";
import { listLiveRooms, listPastRooms } from "./rooms.ts";
import {
  getThumbnail,
  InvalidThumbnailError,
  isSameOrigin,
  mayUpload,
  NotStreamingError,
  readBodyCapped,
  thumbnailEtag,
  thumbnailResponse,
  uploadThumbnail,
} from "./thumbnails.ts";

const T0 = new Date("2026-09-01T12:00:00Z");
const MIN = 60_000;

let db: Db;
let close: () => Promise<void>;

const visitor: Caller = { user: null, role: "visitor" };
const asUser = (id: string): Caller => ({ user: { id, username: id, image: null }, role: "user" });

/** A file that starts like a WebP, `size` bytes long. */
const webp = (size = 64, fill = 1) => {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set(
    [..."RIFF"].map((c) => c.charCodeAt(0)),
    0,
  );
  bytes.set(
    [..."WEBP"].map((c) => c.charCodeAt(0)),
    8,
  );
  return bytes;
};
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values(
    ["a", "b", "c", "d", "admin"].map((id) => ({
      id,
      name: id,
      email: `${id}@discord.invalid`,
      discordUsername: `${id}.discord`,
    })),
  );
  await db.insert(rooms).values([
    { id: "r1", name: "one", hostUserId: "a", createdBy: "a", createdAt: T0 },
    { id: "r2", name: "two", hostUserId: "a", createdBy: "a", createdAt: T0 },
  ]);
  // "a" streams in r1 only; "b" streams nowhere.
  await db.insert(streamIntervals).values({
    roomId: "r1",
    userId: "a",
    startedAt: T0,
    lastSeenAt: T0,
  });
});

afterEach(async () => {
  await close();
});

const upload = (
  caller: Caller,
  input: Partial<Parameters<typeof uploadThumbnail>[2]> = {},
  now = T0,
) =>
  uploadThumbnail(
    db,
    caller,
    { roomId: "r1", contentType: "image/webp", bytes: webp(), ...input },
    now,
  );

describe("uploadThumbnail", () => {
  it("stores the streamer's thumbnail and stamps the room", async () => {
    const stored = await upload(asUser("a"));
    expect(stored.capturedAt).toBe(T0.toISOString());
    const thumbnail = await getThumbnail(db, visitor, "r1", "a");
    expect(thumbnail?.mime).toBe("image/webp");
    expect(thumbnail?.capturedAt).toEqual(T0);
    expect(Array.from(thumbnail?.image ?? [])).toEqual(Array.from(webp()));
    const [room] = await db.select().from(rooms).where(eq(rooms.id, "r1"));
    expect(room?.lastThumbnailAt).toEqual(T0);
  });

  it("accepts a JPEG and a content type with parameters", async () => {
    await upload(asUser("a"), { contentType: "image/jpeg", bytes: jpeg() });
    expect((await getThumbnail(db, visitor, "r1", "a"))?.mime).toBe("image/jpeg");
    await upload(asUser("a"), { contentType: "image/WebP; charset=binary" });
    expect((await getThumbnail(db, visitor, "r1", "a"))?.mime).toBe("image/webp");
  });

  it("refuses visitors", async () => {
    await expect(upload(visitor)).rejects.toBeInstanceOf(SignInRequiredError);
  });

  it("refuses someone who isn't streaming in the room", async () => {
    // Signed in but not sharing anywhere, sharing in another room, and a share that ended.
    await expect(upload(asUser("b"))).rejects.toBeInstanceOf(NotStreamingError);
    await expect(upload(asUser("a"), { roomId: "r2" })).rejects.toBeInstanceOf(NotStreamingError);
    await db.update(streamIntervals).set({ endedAt: new Date(T0.getTime() + MIN) });
    await expect(upload(asUser("a"))).rejects.toBeInstanceOf(NotStreamingError);
    expect(await getThumbnail(db, visitor, "r1", "a")).toBeNull();
  });

  it("refuses other media types", async () => {
    for (const contentType of ["image/png", "image/gif", "text/html", "", null]) {
      await expect(upload(asUser("a"), { contentType })).rejects.toMatchObject({ reason: "type" });
    }
  });

  it("refuses bytes that aren't the image their type says", async () => {
    await expect(upload(asUser("a"), { bytes: jpeg() })).rejects.toBeInstanceOf(
      InvalidThumbnailError,
    );
    await expect(
      upload(asUser("a"), { contentType: "image/jpeg", bytes: webp() }),
    ).rejects.toBeInstanceOf(InvalidThumbnailError);
  });

  it("refuses an empty or oversized upload, and takes exactly the limit", async () => {
    await expect(upload(asUser("a"), { bytes: new Uint8Array() })).rejects.toMatchObject({
      reason: "size",
    });
    await expect(
      upload(asUser("a"), { bytes: webp(THUMBNAIL_MAX_BYTES + 1) }),
    ).rejects.toMatchObject({ reason: "size" });
    expect(await getThumbnail(db, visitor, "r1", "a")).toBeNull();
    await upload(asUser("a"), { bytes: webp(THUMBNAIL_MAX_BYTES) });
    expect((await getThumbnail(db, visitor, "r1", "a"))?.image.byteLength).toBe(
      THUMBNAIL_MAX_BYTES,
    );
  });

  it("keeps only the latest upload per streamer per room", async () => {
    await upload(asUser("a"), { bytes: webp(64, 1) });
    await upload(asUser("a"), { bytes: webp(80, 2) }, new Date(T0.getTime() + 3 * MIN));
    const thumbnail = await getThumbnail(db, visitor, "r1", "a");
    expect(thumbnail?.image.byteLength).toBe(80);
    expect(thumbnail?.capturedAt).toEqual(new Date(T0.getTime() + 3 * MIN));
    const [room] = await db.select().from(rooms).where(eq(rooms.id, "r1"));
    expect(room?.lastThumbnailAt).toEqual(new Date(T0.getTime() + 3 * MIN));
  });

  it("gives each streamer their own thumbnail", async () => {
    await db.insert(streamIntervals).values({
      roomId: "r1",
      userId: "b",
      startedAt: T0,
      lastSeenAt: T0,
    });
    await upload(asUser("a"), { bytes: webp(64) });
    await upload(asUser("b"), { bytes: webp(70) });
    expect((await getThumbnail(db, visitor, "r1", "a"))?.image.byteLength).toBe(64);
    expect((await getThumbnail(db, visitor, "r1", "b"))?.image.byteLength).toBe(70);
  });
});

describe("getThumbnail visibility (ADR 16)", () => {
  beforeEach(async () => {
    await db
      .insert(rooms)
      .values({ id: "p1", name: "secret", hostUserId: "a", createdBy: "a", isPrivate: true });
    await db.insert(streamIntervals).values({
      roomId: "p1",
      userId: "a",
      startedAt: T0,
      lastSeenAt: T0,
    });
    await db.insert(roomMembers).values([
      { roomId: "p1", userId: "a", role: "host" },
      { roomId: "p1", userId: "c", approved: true },
      { roomId: "p1", userId: "d" },
    ]);
    await upload(asUser("a"), { roomId: "p1" });
    await upload(asUser("a"));
  });

  it("serves a private room's thumbnail only to the host, approved members and admins", async () => {
    const admin: Caller = { user: { id: "admin", username: "admin", image: null }, role: "admin" };
    for (const caller of [asUser("a"), asUser("c"), admin]) {
      expect(await getThumbnail(db, caller, "p1", "a")).not.toBeNull();
    }
    // A visitor, a signed-in non-member, and someone who knocked but wasn't approved.
    for (const caller of [visitor, asUser("b"), asUser("d")]) {
      expect(await getThumbnail(db, caller, "p1", "a")).toBeNull();
    }
  });

  it("still serves a public room's thumbnail to everyone", async () => {
    for (const caller of [visitor, asUser("b")]) {
      expect(await getThumbnail(db, caller, "r1", "a")).not.toBeNull();
    }
  });
});

describe("refresh and freshness", () => {
  it("replaces the thumbnail on each upload, and the card's time follows the newest capture", async () => {
    const card = async () => (await listLiveRooms(db, visitor)).find((r) => r.id === "r1");
    await upload(asUser("a"), { bytes: webp(64) }, T0);
    const later = new Date(T0.getTime() + 3 * MIN);
    await upload(asUser("a"), { bytes: webp(80) }, later);
    const thumbnail = await getThumbnail(db, visitor, "r1", "a");
    expect(thumbnail?.image.byteLength).toBe(80);
    expect(thumbnail?.capturedAt).toEqual(later);
    expect((await card())?.streamers[0]?.thumbnailAt).toBe(later.toISOString());
  });
});

describe("ended rooms (ADR 11)", () => {
  const DAY = 24 * 60 * MIN;
  const endedAt = new Date(T0.getTime() + 10 * MIN);

  beforeEach(async () => {
    await upload(asUser("a"), {}, T0);
    await db.update(streamIntervals).set({ endedAt });
    await db.update(rooms).set({ endedAt }).where(eq(rooms.id, "r1"));
  });

  it("keep serving the last thumbnail for 30 days, then it is gone", async () => {
    const within = new Date(endedAt.getTime() + 30 * DAY - MIN);
    const past = new Date(endedAt.getTime() + 30 * DAY + MIN);
    for (const caller of [visitor, asUser("b")]) {
      expect(await getThumbnail(db, caller, "r1", "a", within)).not.toBeNull();
      expect(await getThumbnail(db, caller, "r1", "a", past)).toBeNull();
    }
  });

  it("stay private: an ended private room's thumbnail is for the people allowed in", async () => {
    await db.update(rooms).set({ isPrivate: true }).where(eq(rooms.id, "r1"));
    await db.insert(roomMembers).values({ roomId: "r1", userId: "c", approved: true });
    const now = new Date(endedAt.getTime() + DAY);
    expect(await getThumbnail(db, asUser("c"), "r1", "a", now)).not.toBeNull();
    for (const caller of [visitor, asUser("b")]) {
      expect(await getThumbnail(db, caller, "r1", "a", now)).toBeNull();
    }
  });

  it("show on past cards and the recap, for those who may see the room", async () => {
    const now = new Date(endedAt.getTime() + DAY);
    const [card] = await listPastRooms(db, visitor, {}, now);
    expect(card?.streamers.map((s) => [s.id, s.thumbnailAt])).toEqual([["a", T0.toISOString()]]);
    const recap = await getRecap(db, visitor, "r1", now);
    expect(recap?.people.find((p) => p.id === "a")?.thumbnailAt).toBe(T0.toISOString());
  });
});

describe("thumbnailResponse", () => {
  const thumbnail = { image: webp(), mime: "image/webp", capturedAt: T0 };

  it("serves the image with an ETag from the capture time", async () => {
    const response = thumbnailResponse(thumbnail, null);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(thumbnailEtag(T0));
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(webp());
  });

  it("answers 304 without a body when the ETag matches", async () => {
    const etag = thumbnailEtag(T0);
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const response = thumbnailResponse(thumbnail, header);
      expect(response.status).toBe(304);
      expect(response.headers.get("etag")).toBe(etag);
      expect(await response.text()).toBe("");
    }
  });

  it("serves the new image once the capture time changed", () => {
    const stale = thumbnailEtag(new Date(T0.getTime() - 3 * MIN));
    expect(thumbnailResponse(thumbnail, stale).status).toBe(200);
  });
});

describe("upload rate limit", () => {
  it("allows normal refreshes, refuses a loop, and counts per user and window", () => {
    const uploads = new Map<string, number[]>();
    // One every 3 minutes, for an hour, is fine.
    for (let i = 0; i < 20; i++) {
      expect(mayUpload("a", new Date(T0.getTime() + i * 3 * MIN), uploads)).toBe(true);
    }
    // A burst is not.
    const burst = (user: string, at: Date) =>
      Array.from({ length: 30 }, () => mayUpload(user, at, uploads)).filter(Boolean).length;
    const later = new Date(T0.getTime() + 24 * 60 * MIN);
    expect(burst("a", later)).toBe(20);
    expect(burst("b", later)).toBe(20);
    // The window slides on.
    expect(mayUpload("a", new Date(later.getTime() + 11 * MIN), uploads)).toBe(true);
  });
});

describe("isSameOrigin", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://app.test/api/thumbnails/r1", { method: "POST", headers });

  it("accepts this site's origin and requests without one", () => {
    expect(isSameOrigin(request({ origin: "http://app.test", host: "app.test" }))).toBe(true);
    expect(isSameOrigin(request({}))).toBe(true);
  });

  it("refuses another site's origin, and a malformed one", () => {
    expect(isSameOrigin(request({ origin: "https://evil.test", host: "app.test" }))).toBe(false);
    expect(isSameOrigin(request({ origin: "null", host: "app.test" }))).toBe(false);
  });
});

describe("live room cards", () => {
  it("carry each streamer's thumbnail time, null until they upload", async () => {
    await db.insert(streamIntervals).values({
      roomId: "r1",
      userId: "b",
      startedAt: new Date(T0.getTime() + MIN),
      lastSeenAt: T0,
    });
    const card = async () => (await listLiveRooms(db, visitor)).find((r) => r.id === "r1");
    expect((await card())?.streamers.map((s) => s.thumbnailAt)).toEqual([null, null]);
    await upload(asUser("a"));
    expect((await card())?.streamers.map((s) => [s.id, s.thumbnailAt])).toEqual([
      ["a", T0.toISOString()],
      ["b", null],
    ]);
  });
});

describe("readBodyCapped", () => {
  const post = (body: BodyInit | null) => new Request("http://x.test/", { method: "POST", body });

  it("reads a body within the cap", async () => {
    const bytes = await readBodyCapped(post(new Uint8Array(10)), 10);
    expect(bytes?.byteLength).toBe(10);
  });

  it("gives up on a body past the cap", async () => {
    expect(await readBodyCapped(post(new Uint8Array(11)), 10)).toBeNull();
  });

  it("reads an absent body as empty", async () => {
    expect((await readBodyCapped(post(null), 10))?.byteLength).toBe(0);
  });
});
