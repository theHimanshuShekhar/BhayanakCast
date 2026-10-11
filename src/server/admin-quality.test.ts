import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { qualitySamples, rooms, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { getPairTimeline, getRoomQuality } from "./admin-quality.ts";
import { AdminRequiredError, type Caller } from "./caller.ts";

// The admin's quality view (#94): admins only, pairs by name, and reachable by room id alone
// after the room's own 30 days are gone.

const T0 = Date.parse("2026-10-11T12:00:00Z");
const admin: Caller = { user: { id: "admin", username: "admin_jpg", image: null }, role: "admin" };
const plain: Caller = { user: { id: "ana", username: "ana", image: null }, role: "user" };
const visitor: Caller = { user: null, role: "visitor" };

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values([
    { id: "admin", name: "admin", email: "admin@discord.invalid" },
    { id: "ana", name: "ana", discordUsername: "ana_streams", email: "ana@discord.invalid" },
    { id: "bo", name: "bo", email: "bo@discord.invalid" },
  ]);
});

afterEach(async () => {
  await close();
});

const row = (
  roomId: string,
  seconds: number,
  extra: Partial<typeof qualitySamples.$inferInsert> = {},
): typeof qualitySamples.$inferInsert => ({
  roomId,
  roomKind: "gaming",
  at: new Date(T0 + seconds * 1_000),
  windowMs: 30_000,
  reporterUserId: "ana",
  peerUserId: "bo",
  direction: "send",
  slot: "screen",
  trigger: "window",
  browser: "chrome",
  browserMajor: 139,
  rung: "1080p30",
  maxBitrate: 3_000_000,
  targetBitrate: 2_000_000,
  bitrate: 1_900_000,
  qp: 31,
  codec: "video/VP9",
  localCandidate: "host",
  remoteCandidate: "host",
  ...extra,
});

describe("getRoomQuality", () => {
  it("is for admins only, whoever asks", async () => {
    await db.insert(qualitySamples).values(row("r1", 30));
    for (const caller of [visitor, plain]) {
      await expect(getRoomQuality(db, caller, { roomId: "r1" })).rejects.toThrow(
        AdminRequiredError,
      );
    }
  });

  it("lists the room's pairs with both people named, and only that room's", async () => {
    await db.insert(qualitySamples).values([
      row("r1", 30),
      row("r1", 30, {
        reporterUserId: "bo",
        peerUserId: "ana",
        direction: "recv",
        browser: "firefox",
        browserMajor: 142,
        rung: null,
        maxBitrate: null,
        targetBitrate: null,
      }),
      row("r2", 30, { reporterUserId: "bo", peerUserId: "ana" }),
    ]);
    const result = await getRoomQuality(db, admin, { roomId: "r1" });
    expect(result).toMatchObject({ roomKind: "gaming", samples: 2, truncated: false });
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({
      streamer: { id: "ana", username: "ana_streams" },
      viewer: { id: "bo", username: "bo" },
      slot: "screen",
      viewerBrowser: "firefox 142",
      codec: "video/VP9",
    });
  });

  it("reads samples of a room the 30-day purge has already deleted", async () => {
    await db.insert(rooms).values({ id: "gone", name: "gone" });
    await db.insert(qualitySamples).values(row("gone", 30));
    await db.delete(rooms);
    const result = await getRoomQuality(db, admin, { roomId: "gone" });
    expect(result.pairs).toHaveLength(1);
  });

  it("is empty for a room without samples", async () => {
    expect(await getRoomQuality(db, admin, { roomId: "none" })).toEqual({
      roomKind: null,
      pairs: [],
      samples: 0,
      truncated: false,
    });
  });
});

describe("getPairTimeline", () => {
  const pair = { roomId: "r1", streamerId: "ana", viewerId: "bo", slot: "screen" } as const;

  it("is for admins only", async () => {
    for (const caller of [visitor, plain]) {
      await expect(getPairTimeline(db, caller, pair)).rejects.toThrow(AdminRequiredError);
    }
  });

  it("says when the session had more windows than were read", async () => {
    await db.insert(qualitySamples).values([row("r1", 30), row("r1", 60), row("r1", 90)]);
    const all = await getPairTimeline(db, admin, pair);
    expect(all.truncated).toBe(false);
    expect(all.sent).toHaveLength(3);
    // Reading two of three: the first two windows, and the flag.
    const cut = await getPairTimeline(db, admin, pair, 2);
    expect(cut.truncated).toBe(true);
    expect(cut.sent.map((p) => p.t)).toEqual([T0 + 30_000, T0 + 60_000]);
    // Exactly the limit isn't more than the limit.
    expect((await getPairTimeline(db, admin, pair, 3)).truncated).toBe(false);
  });

  it("reads the pair's sender and receiver rows, not another pair's or slot's", async () => {
    await db.insert(qualitySamples).values([
      row("r1", 30, { bitrate: 1_000_000 }),
      row("r1", 60, { bitrate: 2_000_000 }),
      row("r1", 90, { slot: "cam", bitrate: 5 }),
      row("r1", 90, { peerUserId: "admin", bitrate: 6 }),
      row("r2", 90, { bitrate: 7 }),
      row("r1", 45, {
        reporterUserId: "bo",
        peerUserId: "ana",
        direction: "recv",
        rung: null,
        maxBitrate: null,
        qp: null,
        loss: 0.04,
      }),
    ]);
    const timeline = await getPairTimeline(db, admin, pair);
    expect(timeline.sent.map((p) => p.v)).toEqual([1_000_000, 2_000_000]);
    expect(timeline.loss.map((p) => p.v)).toEqual([0.04]);
    expect(timeline.rungs).toEqual(["1080p30"]);
  });
});
