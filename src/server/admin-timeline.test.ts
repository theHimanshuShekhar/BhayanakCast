import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import {
  hostIntervals,
  presenceIntervals,
  qualitySamples,
  rooms,
  roomTimelineEvents,
  streamIntervals,
  user,
} from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { getRoomTimeline } from "./admin-timeline.ts";
import { AdminRequiredError, type Caller } from "./caller.ts";

// The admin's room timeline (#115): the stored events, presence, stream and host intervals and
// quality step changes merged at read time and sorted. Admins only; intervals reach back 30
// days, events and quality steps 90; the size is bounded.

const NOW = new Date("2026-10-13T12:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.parse("2026-10-13T10:00:00Z");
/** `m` minutes after T0. */
const at = (m: number) => new Date(T0 + m * MIN);
const iso = (m: number) => at(m).toISOString();

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
  await db.insert(rooms).values({ id: "r1", name: "room one" });
});

afterEach(async () => {
  await close();
});

const read = (roomId = "r1", options: Parameters<typeof getRoomTimeline>[3] = {}) =>
  getRoomTimeline(db, admin, { roomId }, { now: NOW, ...options });

const event = (
  roomId: string,
  m: number,
  kind: typeof roomTimelineEvents.$inferInsert.kind,
  extra: Partial<typeof roomTimelineEvents.$inferInsert> = {},
): typeof roomTimelineEvents.$inferInsert => ({ roomId, at: at(m), kind, ...extra });

const rung = (
  roomId: string,
  m: number,
  extra: Partial<typeof qualitySamples.$inferInsert> = {},
): typeof qualitySamples.$inferInsert => ({
  roomId,
  roomKind: "gaming",
  at: at(m),
  windowMs: 4_000,
  reporterUserId: "ana",
  peerUserId: "bo",
  direction: "send",
  slot: "screen",
  trigger: "rung",
  browser: "chrome",
  browserMajor: 139,
  rung: "1080p30",
  toRung: "720p30",
  rungReason: "pressure",
  ...extra,
});

describe("getRoomTimeline", () => {
  it("is for admins only, whoever asks", async () => {
    await db.insert(roomTimelineEvents).values(event("r1", 0, "join", { actorUserId: "ana" }));
    for (const caller of [visitor, plain]) {
      await expect(getRoomTimeline(db, caller, { roomId: "r1" })).rejects.toThrow(
        AdminRequiredError,
      );
    }
  });

  it("is empty for a room with nothing recorded", async () => {
    expect(await read("none")).toEqual({ entries: [], people: {}, truncated: false });
  });

  it("merges events, intervals and quality steps into one list, oldest first", async () => {
    await db
      .insert(roomTimelineEvents)
      .values([
        event("r1", 5, "mic_on", { actorUserId: "bo" }),
        event("r1", 0, "join", { actorUserId: "ana" }),
        event("r1", 2, "kick", { actorUserId: "ana", targetUserId: "bo", details: { x: 1 } }),
      ]);
    await db.insert(presenceIntervals).values([
      { roomId: "r1", userId: "ana", startedAt: at(0), endedAt: at(9), lastSeenAt: at(9) },
      { roomId: "r1", userId: "bo", startedAt: at(1), lastSeenAt: at(4) },
    ]);
    await db
      .insert(streamIntervals)
      .values({ roomId: "r1", userId: "ana", startedAt: at(3), endedAt: at(6), lastSeenAt: at(6) });
    await db
      .insert(hostIntervals)
      .values({ roomId: "r1", userId: "ana", startedAt: at(-1), endedAt: at(9) });
    await db.insert(qualitySamples).values([
      rung("r1", 4),
      // A plain window row isn't a step change.
      rung("r1", 4, { trigger: "window", toRung: null, rungReason: null }),
    ]);

    const { entries, truncated } = await read();
    expect(truncated).toBe(false);
    expect(entries.map((e) => [e.at, e.source, "kind" in e ? e.kind : null])).toEqual([
      [iso(-1), "host", null],
      [iso(0), "event", "join"],
      [iso(0), "presence", null],
      [iso(1), "presence", null],
      [iso(2), "event", "kick"],
      [iso(3), "stream", null],
      [iso(4), "quality", null],
      [iso(5), "event", "mic_on"],
    ]);
    expect(entries.find((e) => e.source === "event" && e.kind === "kick")).toEqual({
      source: "event",
      at: iso(2),
      kind: "kick",
      actorUserId: "ana",
      targetUserId: "bo",
      details: { x: 1 },
    });
    expect(entries.find((e) => e.source === "presence" && e.userId === "bo")).toEqual({
      source: "presence",
      at: iso(1),
      userId: "bo",
      endedAt: null,
    });
    expect(entries.find((e) => e.source === "stream")).toMatchObject({
      userId: "ana",
      endedAt: iso(6),
    });
    expect(entries.find((e) => e.source === "quality")).toEqual({
      source: "quality",
      at: iso(4),
      reporterUserId: "ana",
      peerUserId: "bo",
      direction: "send",
      slot: "screen",
      rung: "1080p30",
      toRung: "720p30",
      reason: "pressure",
    });
  });

  it("returns the connection events each browser reported, with reporter, peer and particulars", async () => {
    await db.insert(roomTimelineEvents).values([
      event("r1", 1, "pair_state", {
        actorUserId: "ana",
        targetUserId: "bo",
        details: { state: "connected" },
      }),
      event("r1", 2, "pair_path", {
        actorUserId: "ana",
        targetUserId: "bo",
        details: { change: "connect", path: "relay", local: { type: "relay", protocol: "udp" } },
      }),
      event("r1", 3, "device_error", {
        actorUserId: "bo",
        details: { device: "camera", name: "NotReadableError", message: "in use" },
      }),
      event("r1", 4, "events_dropped", { actorUserId: "ana", details: { count: 30 } }),
    ]);
    const { entries, people } = await read();
    expect(entries).toMatchObject([
      { source: "event", kind: "pair_state", actorUserId: "ana", targetUserId: "bo" },
      { source: "event", kind: "pair_path", details: { path: "relay" } },
      { source: "event", kind: "device_error", actorUserId: "bo", targetUserId: null },
      { source: "event", kind: "events_dropped", details: { count: 30 } },
    ]);
    expect(Object.keys(people).sort()).toEqual(["ana", "bo"]);
  });

  it("keeps events in the order they were recorded when they share a time", async () => {
    await db
      .insert(roomTimelineEvents)
      .values([
        event("r1", 0, "join", { actorUserId: "ana" }),
        event("r1", 0, "host_change", { targetUserId: "ana" }),
        event("r1", 0, "mic_on", { actorUserId: "ana" }),
      ]);
    const { entries } = await read();
    expect(entries.map((e) => ("kind" in e ? e.kind : e.source))).toEqual([
      "join",
      "host_change",
      "mic_on",
    ]);
  });

  it("names the people in it, by user id", async () => {
    await db
      .insert(roomTimelineEvents)
      .values(event("r1", 0, "kick", { actorUserId: "ana", targetUserId: "bo" }));
    await db.insert(qualitySamples).values(rung("r1", 1, { peerUserId: "gone-user" }));
    const { people } = await read();
    expect(people).toEqual({
      ana: { id: "ana", username: "ana_streams", image: null },
      bo: { id: "bo", username: "bo", image: null },
      "gone-user": { id: "gone-user", username: "gone-user", image: null },
    });
  });

  it("reads only the room asked for", async () => {
    await db
      .insert(roomTimelineEvents)
      .values([
        event("r1", 0, "join", { actorUserId: "ana" }),
        event("r2", 0, "join", { actorUserId: "bo" }),
      ]);
    await db
      .insert(presenceIntervals)
      .values({ roomId: "r1", userId: "ana", startedAt: at(0), lastSeenAt: at(1) });
    await db.insert(rooms).values({ id: "r2", name: "room two" });
    await db
      .insert(presenceIntervals)
      .values({ roomId: "r2", userId: "bo", startedAt: at(0), lastSeenAt: at(1) });
    await db.insert(qualitySamples).values(rung("r2", 1));
    const { entries } = await read("r1");
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.source !== "quality")).toBe(true);
  });

  it("reaches back 90 days for events and quality steps, but 30 for intervals", async () => {
    const back = (days: number) => new Date(NOW.getTime() - days * DAY);
    await db
      .insert(roomTimelineEvents)
      .values([{ roomId: "r1", at: back(60), kind: "join", actorUserId: "ana" }]);
    await db.insert(qualitySamples).values(rung("r1", 0, { at: back(60) }));
    await db.insert(presenceIntervals).values([
      // Over before the 30 days began: left out.
      { roomId: "r1", userId: "ana", startedAt: back(45), endedAt: back(40), lastSeenAt: back(40) },
      // Began before them but ran into them: in.
      { roomId: "r1", userId: "bo", startedAt: back(46), endedAt: back(10), lastSeenAt: back(10) },
      // Still open: in.
      { roomId: "r1", userId: "admin", startedAt: back(45), lastSeenAt: back(1) },
    ]);
    await db.insert(streamIntervals).values({
      roomId: "r1",
      userId: "ana",
      startedAt: back(45),
      endedAt: back(40),
      lastSeenAt: back(40),
    });
    await db
      .insert(hostIntervals)
      .values({ roomId: "r1", userId: "ana", startedAt: back(45), endedAt: back(40) });

    const { entries } = await read();
    expect(entries.map((e) => [e.source, "userId" in e ? e.userId : null])).toEqual([
      ["event", null],
      ["quality", null],
      ["presence", "bo"],
      ["presence", "admin"],
    ]);
  });

  it("reads the events of a room the 30-day purge has already deleted", async () => {
    await db.insert(roomTimelineEvents).values(event("r1", 0, "room_end"));
    await db.delete(rooms);
    expect((await read()).entries).toHaveLength(1);
  });

  it("keeps to its size bound, the latest stretch of it in order, and says older was left out", async () => {
    await db
      .insert(roomTimelineEvents)
      .values(
        Array.from({ length: 5 }, (_, m) => event("r1", m * 2, "mic_on", { actorUserId: "ana" })),
      );
    await db
      .insert(qualitySamples)
      .values(Array.from({ length: 5 }, (_, m) => rung("r1", m * 2 + 1)));
    const cut = await read("r1", { limit: 4 });
    expect(cut.truncated).toBe(true);
    expect(cut.entries.map((e) => e.at)).toEqual([iso(6), iso(7), iso(8), iso(9)]);
    // Exactly the limit isn't more than the limit.
    const exact = await read("r1", { limit: 10 });
    expect(exact.truncated).toBe(false);
    expect(exact.entries).toHaveLength(10);
  });

  it("says it was cut when one kind of entry alone passes the bound", async () => {
    await db
      .insert(roomTimelineEvents)
      .values(
        Array.from({ length: 6 }, (_, m) => event("r1", m, "mic_on", { actorUserId: "ana" })),
      );
    const cut = await read("r1", { limit: 5 });
    expect(cut.truncated).toBe(true);
    expect(cut.entries.map((e) => e.at)).toEqual([iso(1), iso(2), iso(3), iso(4), iso(5)]);
  });
});
