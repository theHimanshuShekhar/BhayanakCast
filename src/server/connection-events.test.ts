import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { ZodError } from "zod";
import type { Db } from "../db/client.ts";
import { presenceIntervals, rooms, roomTimelineEvents, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  audioBlockedEvent,
  CONNECTION_BATCH_MAX,
  type ConnectionEvent,
  deviceErrorEvent,
  MAX_ERROR_MESSAGE,
  MAX_EVENT_AGE_MS,
  negotiationEvent,
  pairStateEvent,
  pathEvent,
  type ReportConnectionEventsInput,
} from "../lib/connection-events.ts";
import { type Caller, type SignedInCaller, SignInRequiredError } from "./caller.ts";
import { FakeClock } from "./clock.ts";
import {
  BEACON_MAX_BYTES,
  CONNECTION_BATCH_RATE_LIMIT,
  CONNECTION_EVENT_CAP,
  ConnectionEventService,
  DROP_MARKER_DELAY_MS,
  readBeacon,
} from "./connection-events.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

// What a page may tell the room timeline about its connections (#116): only from a signed-in
// caller in the live room (or, for a device error in the pre-join, one who may enter it), about
// peers in that room too, dated by the server, bounded, rate-limited and capped.

const T0 = new Date("2026-10-13T12:00:00Z");

const asUser = (id: string): Caller => ({ user: { id, username: id, image: null }, role: "user" });
const visitor: Caller = { user: null, role: "visitor" };

let db: Db;
let close: () => Promise<void>;
let clock: FakeClock;
let mayEnter: Mock<(caller: SignedInCaller, roomId: string) => Promise<boolean>>;
let logs: CapturedLogs;
let service: ConnectionEventService;

beforeEach(async () => {
  logs = captureLogs();
  ({ db, close } = await createTestDb());
  clock = new FakeClock(T0);
  mayEnter = vi.fn(async () => false);
  service = new ConnectionEventService({ db, clock, mayEnter });
  await db
    .insert(user)
    .values(
      ["ana", "bo", "cy", "dee"].map((id) => ({ id, name: id, email: `${id}@discord.invalid` })),
    );
  // "r1": ana and bo are in it, cy left and dee never came. "r2" ended.
  await db.insert(rooms).values([
    { id: "r1", name: "live", kind: "gaming", createdAt: T0 },
    { id: "r2", name: "over", kind: "code", createdAt: T0, endedAt: T0 },
  ]);
  await db.insert(presenceIntervals).values([
    { roomId: "r1", userId: "ana", startedAt: T0, lastSeenAt: T0 },
    { roomId: "r1", userId: "bo", startedAt: T0, lastSeenAt: T0 },
    { roomId: "r1", userId: "cy", startedAt: T0, endedAt: T0, lastSeenAt: T0 },
    { roomId: "r2", userId: "ana", startedAt: T0, endedAt: T0, lastSeenAt: T0 },
  ]);
});

afterEach(async () => {
  logs.restore();
  await close();
});

/** `event` as a page reports it, `ageMs` old. */
const aged = (event: ConnectionEvent | undefined, ageMs = 0) =>
  ({ ...event, ageMs }) as ReportConnectionEventsInput["events"][number];
const pair = (peer: string, ageMs = 0) => aged(pairStateEvent(peer, "connected"), ageMs);
const report = (events: ReportConnectionEventsInput["events"], roomId = "r1") => ({
  roomId,
  events,
});
const stored = () => db.select().from(roomTimelineEvents).orderBy(asc(roomTimelineEvents.id));

describe("recording connection events", () => {
  it("stores a pair's event as a timeline row: the reporter as actor, the peer as target, dated by the server", async () => {
    const result = await service.record(asUser("ana"), report([pair("bo", 4_000)]));
    expect(result).toEqual({ stored: 1, dropped: 0 });
    const [row] = await stored();
    expect(row).toMatchObject({
      roomId: "r1",
      kind: "pair_state",
      actorUserId: "ana",
      targetUserId: "bo",
      // What the event says, without the fields that became columns.
      details: { state: "connected" },
    });
    expect(row?.at).toEqual(new Date(T0.getTime() - 4_000));
  });

  it("keeps each kind's particulars in its details, and a device error has no target", async () => {
    const ice = { local: [], remote: [] };
    const events = [
      aged(pathEvent("bo", ice, "connect")),
      aged(negotiationEvent("bo", "answer", new Error("boom"))),
      aged(audioBlockedEvent("bo", true)),
      aged(
        deviceErrorEvent(
          "camera",
          Object.assign(new Error("in use"), { name: "NotReadableError" }),
        ),
      ),
    ];
    await service.record(asUser("ana"), report(events));
    expect((await stored()).map((r) => [r.kind, r.targetUserId, r.details])).toEqual([
      ["pair_path", "bo", { change: "connect", path: "unknown" }],
      ["negotiation_error", "bo", { step: "answer", name: "Error", message: "boom" }],
      ["audio_blocked", "bo", { source: "share" }],
      ["device_error", null, { device: "camera", name: "NotReadableError", message: "in use" }],
    ]);
  });

  it("refuses a visitor", async () => {
    await expect(service.record(visitor, report([pair("bo")]))).rejects.toThrow(
      SignInRequiredError,
    );
    expect(await stored()).toEqual([]);
  });

  it("dates an event no further back than the clamp, and never into the future", async () => {
    await service.record(asUser("ana"), report([pair("bo", 10 * 24 * 3_600_000), pair("bo", 0)]));
    const rows = await stored();
    expect(rows.map((r) => r.at)).toEqual([new Date(T0.getTime() - MAX_EVENT_AGE_MS), T0]);
  });

  it("trims a long message, whatever the page sent", async () => {
    const long = Object.assign(new Error("m".repeat(1_500)), { name: "NotReadableError" });
    // A page that didn't trim: the server does it.
    const event = { ...deviceErrorEvent("mic", long), message: "m".repeat(1_500) };
    await service.record(asUser("ana"), report([aged(event as ConnectionEvent)]));
    const [row] = await stored();
    expect(row?.details).toMatchObject({ message: "m".repeat(MAX_ERROR_MESSAGE) });
  });
});

describe("who may report", () => {
  it("stores nothing from someone who isn't in the live room, or about a room that ended", async () => {
    expect(await service.record(asUser("cy"), report([pair("bo")]))).toEqual({
      stored: 0,
      dropped: 0,
    });
    expect(await service.record(asUser("dee"), report([pair("bo")]))).toEqual({
      stored: 0,
      dropped: 0,
    });
    expect(await service.record(asUser("ana"), report([pair("bo")], "r2"))).toEqual({
      stored: 0,
      dropped: 0,
    });
    expect(await service.record(asUser("ana"), report([pair("bo")], "nope"))).toEqual({
      stored: 0,
      dropped: 0,
    });
    expect(await stored()).toEqual([]);
  });

  it("drops the events about a peer who isn't in the room, or is the reporter, and keeps the rest", async () => {
    const result = await service.record(
      asUser("ana"),
      report([pair("cy"), pair("dee"), pair("ana"), pair("bo")]),
    );
    expect(result.stored).toBe(1);
    expect((await stored()).map((r) => r.targetUserId)).toEqual(["bo"]);
  });

  it("takes a device error from someone in the room without asking whether they may enter", async () => {
    await service.record(asUser("ana"), report([aged(deviceErrorEvent("mic", new Error("x")))]));
    expect(await stored()).toHaveLength(1);
    expect(mayEnter).not.toHaveBeenCalled();
  });

  it("takes a device error from the pre-join of a room the caller may enter, against that room", async () => {
    mayEnter.mockResolvedValue(true);
    const result = await service.record(
      asUser("dee"),
      report([
        aged(
          deviceErrorEvent("screen", Object.assign(new Error("no"), { name: "NotAllowedError" })),
        ),
      ]),
    );
    expect(result.stored).toBe(1);
    expect(mayEnter).toHaveBeenCalledWith(asUser("dee"), "r1");
    expect(await stored()).toMatchObject([
      { roomId: "r1", kind: "device_error", actorUserId: "dee", targetUserId: null },
    ]);
  });

  it("refuses a device error from someone who may not enter the room (full, private, kicked)", async () => {
    mayEnter.mockResolvedValue(false);
    const result = await service.record(
      asUser("dee"),
      report([aged(deviceErrorEvent("camera", new Error("x")))]),
    );
    expect(result.stored).toBe(0);
    expect(await stored()).toEqual([]);
  });

  it("takes nothing but device errors from the pre-join: a pair needs the caller in the room", async () => {
    mayEnter.mockResolvedValue(true);
    const result = await service.record(
      asUser("dee"),
      report([
        pair("bo"),
        aged(audioBlockedEvent("bo", false)),
        aged(deviceErrorEvent("mic", new Error("x"))),
      ]),
    );
    expect(result.stored).toBe(1);
    expect((await stored()).map((r) => r.kind)).toEqual(["device_error"]);
  });
});

describe("bounds", () => {
  it("refuses a report over the batch size, or with nothing valid in it, storing nothing", async () => {
    const many = Array.from({ length: CONNECTION_BATCH_MAX + 1 }, () => pair("bo"));
    await expect(service.record(asUser("ana"), report(many))).rejects.toThrow(ZodError);
    await expect(service.record(asUser("ana"), report([{} as never]))).rejects.toThrow(ZodError);
    expect(await stored()).toEqual([]);
  });

  it("drops an event that is malformed and keeps the others in its report", async () => {
    const odd = { ...pair("bo"), state: "exploded" } as never;
    const result = await service.record(asUser("ana"), report([odd, pair("bo")]));
    expect(result.stored).toBe(1);
  });

  it("rate-limits reports per person, refusing a report over the limit whole until the window passes", async () => {
    const { batches, windowMs } = CONNECTION_BATCH_RATE_LIMIT;
    for (let i = 0; i < batches; i++) {
      await service.record(asUser("ana"), report([pair("bo")]));
    }
    // Different people don't share it.
    expect((await service.record(asUser("bo"), report([pair("ana")]))).stored).toBe(1);
    const before = (await stored()).length;
    expect(await service.record(asUser("ana"), report([pair("bo")]))).toEqual({
      stored: 0,
      dropped: 0,
    });
    expect(await stored()).toHaveLength(before);
    clock.advance(windowMs + 1);
    expect((await service.record(asUser("ana"), report([pair("bo")]))).stored).toBe(1);
  });
});

describe("the cap on a person's events", () => {
  const { events: cap, windowMs } = CONNECTION_EVENT_CAP;
  /** `n` events, in reports of the batch size. */
  const send = async (who: string, peer: string, n: number) => {
    let stored = 0;
    let dropped = 0;
    for (let sent = 0; sent < n; sent += CONNECTION_BATCH_MAX) {
      const size = Math.min(CONNECTION_BATCH_MAX, n - sent);
      const result = await service.record(
        asUser(who),
        report(Array.from({ length: size }, () => pair(peer))),
      );
      stored += result.stored;
      dropped += result.dropped;
    }
    return { stored, dropped };
  };
  const markers = () =>
    db.select().from(roomTimelineEvents).where(eq(roomTimelineEvents.kind, "events_dropped"));

  it("stores the first events up to the cap and drops the rest, counting them", async () => {
    expect(await send("ana", "bo", cap + 30)).toEqual({ stored: cap, dropped: 30 });
    expect((await stored()).filter((r) => r.kind === "pair_state")).toHaveLength(cap);
  });

  it("records one marker of how many were dropped, once the run of drops has settled", async () => {
    await send("ana", "bo", cap + 30);
    // Not at once: more may follow, and they all go in the one marker.
    expect(await markers()).toEqual([]);
    clock.advance(DROP_MARKER_DELAY_MS / 2);
    await send("ana", "bo", 12);
    clock.advance(DROP_MARKER_DELAY_MS);
    await service.settled();
    const rows = await markers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      roomId: "r1",
      actorUserId: "ana",
      targetUserId: null,
      details: { count: 42 },
    });
    // At the first drop, which is where the gap begins.
    expect(rows[0]?.at).toEqual(T0);
  });

  it("counts per person, and lets someone report again once the window has passed", async () => {
    await send("ana", "bo", cap + 5);
    expect(await send("bo", "ana", 10)).toEqual({ stored: 10, dropped: 0 });
    clock.advance(windowMs + 1);
    expect(await send("ana", "bo", 10)).toEqual({ stored: 10, dropped: 0 });
  });

  it("doesn't let events refused for who they name use up the cap", async () => {
    await send("ana", "cy", cap + 20);
    expect(await send("ana", "bo", 5)).toEqual({ stored: 5, dropped: 0 });
  });

  it("gives the allowance back for events it failed to store, so the page's retry fits", async () => {
    await send("ana", "bo", cap - 1);
    const failing = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await expect(service.record(asUser("ana"), report([pair("bo")]))).rejects.toThrow("db down");
    failing.mockRestore();
    // The cap's last place is still free.
    expect(await send("ana", "bo", 1)).toEqual({ stored: 1, dropped: 0 });
  });

  it("logs a marker it could not write, and carries on", async () => {
    await send("ana", "bo", cap + 1);
    await db.delete(roomTimelineEvents);
    const failing = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    clock.advance(DROP_MARKER_DELAY_MS);
    await service.settled();
    failing.mockRestore();
    expect(logs.find("timeline.write_failed")).toMatchObject({
      level: "error",
      msg: expect.stringContaining("marker"),
      roomId: "r1",
      userId: "ana",
    });
  });
});

// Every report the server throws away is logged as `connection_event.dropped` with why (#119), so
// a missing event can be told from one that was never sent; what is stored is logged like the
// hub's own timeline events.
describe("logging", () => {
  const drops = () =>
    logs.all("connection_event.dropped").map((l) => [l.reason, l.userId, l.events]);

  it("logs why a report or some of its events were dropped", async () => {
    // Not in the room.
    await service.record(asUser("dee"), report([pair("bo")]));
    // A peer who left since, and the reporter themselves, alongside one that is kept.
    await service.record(asUser("ana"), report([pair("cy"), pair("ana"), pair("bo")]));
    // Invalid.
    await expect(service.record(asUser("ana"), report([{} as never]))).rejects.toThrow();
    expect(drops()).toEqual([
      ["not_in_room", "dee", 1],
      ["peer_not_in_room", "ana", 2],
      ["invalid", "ana", undefined],
    ]);
  });

  it("logs a report over the rate limit, and events over the cap", async () => {
    const { batches } = CONNECTION_BATCH_RATE_LIMIT;
    for (let i = 0; i < batches; i++) await service.record(asUser("bo"), report([pair("ana")]));
    await service.record(asUser("bo"), report([pair("ana")]));
    expect(drops().at(-1)).toEqual(["over_limit", "bo", 1]);

    const events = Array.from({ length: CONNECTION_EVENT_CAP.events + 5 }, () => pair("bo"));
    for (let i = 0; i < events.length; i += CONNECTION_BATCH_MAX) {
      await service.record(asUser("ana"), report(events.slice(i, i + CONNECTION_BATCH_MAX)));
    }
    expect(
      logs.all("connection_event.dropped").filter((l) => l.reason === "over_cap"),
    ).toHaveLength(1);
  });

  it("logs each stored event as a timeline event, with the reporter and the peer", async () => {
    await service.record(asUser("ana"), report([pair("bo")]));
    expect(logs.find("timeline.pair_state")).toMatchObject({
      level: "info",
      roomId: "r1",
      userId: "ana",
      targetUserId: "bo",
      details: { state: "connected" },
    });
  });
});

describe("reading a beacon", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/connection-events", { method: "POST", body, headers });

  it("reads a report sent as a JSON blob, however the browser labelled it", async () => {
    const body = JSON.stringify(report([pair("bo", 1_000)]));
    for (const type of ["application/json", "text/plain;charset=UTF-8"]) {
      const read = await readBeacon(post(body, { "content-type": type }));
      expect(read).toMatchObject({
        ok: true,
        input: { roomId: "r1", events: [{ kind: "pair_state" }] },
      });
    }
  });

  it("refuses a body that is too large, not JSON, or not a report", async () => {
    expect(await readBeacon(post("x".repeat(BEACON_MAX_BYTES + 1)))).toMatchObject({
      ok: false,
      status: 413,
    });
    expect(await readBeacon(post("{"))).toMatchObject({ ok: false, status: 400 });
    expect(await readBeacon(post(JSON.stringify({ roomId: "r1", events: [] })))).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("gives a report the service records like any other", async () => {
    const read = await readBeacon(post(JSON.stringify(report([pair("bo")]))));
    if (!read.ok) throw new Error(read.error);
    expect(await service.record(asUser("ana"), read.input)).toEqual({ stored: 1, dropped: 0 });
  });
});
