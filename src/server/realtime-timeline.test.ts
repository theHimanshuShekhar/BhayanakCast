import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { rooms } from "../db/schema/index.ts";
import {
  CHAT_RATE_LIMIT,
  CONNECTION_MESSAGE_BUDGET,
  KNOCK_EXPIRY_MS,
  SIGNAL_RATE_LIMIT,
  type SignalPayload,
} from "../lib/realtime.ts";
import type { TimelineEventRow } from "../lib/room-timeline.ts";
import {
  type RealtimeHarness,
  type RealtimeHarnessOptions,
  startRealtimeHarness,
  type TestUser,
} from "./realtime-harness.ts";
import { EMPTY_ROOM_TIMEOUT_MS, HOST_GRACE_MS, RECONNECT_GRACE_MS } from "./room-hub.ts";

// The room timeline's events (#115): the hub reports what happens in a room, and the recorder
// writes it behind the hub's back. These drive the real protocol and read the stored rows.

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let cy: TestUser;
let roomId: string;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const T0 = Date.parse("2026-09-01T12:00:00.000Z");

async function start(options: RealtimeHarnessOptions = {}) {
  h = await startRealtimeHarness(options);
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  cy = await h.createUser("cy");
  roomId = await h.createRoom(ana, { name: "ana's room" });
}

beforeEach(() => start());

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

const nameOf = (id: string | null) => [ana, bo, cy].find((u) => u.id === id)?.username ?? id;

/** [kind, actor, target] of the room's events, oldest first. */
async function kinds(room = roomId, without: string[] = []) {
  const events = await h.timelineEvents(room);
  return events
    .filter((e) => !without.includes(e.kind))
    .map((e) => [e.kind, nameOf(e.actorUserId), nameOf(e.targetUserId)]);
}

async function eventsOf(kind: string, room = roomId): Promise<TimelineEventRow[]> {
  return (await h.timelineEvents(room)).filter((e) => e.kind === kind);
}

/** `ana` and `bo` are connected and in the room; returns both clients. */
async function twoInRoom() {
  const a = await h.connectAs(ana);
  await a.join(roomId);
  const b = await h.connectAs(bo);
  await b.join(roomId);
  await a.waitForEvent("joined");
  return { a, b };
}

describe("presence", () => {
  it("records joins and leaves, the leave with how it came about", async () => {
    const { a, b } = await twoInRoom();
    await h.advance(5 * SECOND);
    b.send({ type: "room.leave" });
    await a.waitForEvent("left");

    expect(await kinds()).toEqual([
      ["join", "ana", null],
      ["join", "bo", null],
      ["leave", "bo", null],
    ]);
    const [leave] = await eventsOf("leave");
    expect(leave).toMatchObject({ at: new Date(T0 + 5 * SECOND), details: { reason: "left" } });
    expect((await eventsOf("join")).map((e) => e.at)).toEqual([new Date(T0), new Date(T0)]);
  });

  it("keeps events apart by room", async () => {
    const other = await h.createRoom(bo, { name: "bo's room" });
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(other);
    expect(await kinds(roomId)).toEqual([["join", "ana", null]]);
    expect(await kinds(other)).toEqual([["join", "bo", null]]);
  });
});

describe("a socket that goes away", () => {
  it("records the disconnect and the grace starting, then the return resuming the presence", async () => {
    const { b } = await twoInRoom();
    await b.close();
    await h.settled();
    await h.advance(10 * SECOND);

    const b2 = await h.connectAs(bo);
    await b2.join(roomId);

    expect(await kinds()).toEqual([
      ["join", "ana", null],
      ["join", "bo", null],
      ["disconnect", "bo", null],
      ["grace_start", "bo", null],
      ["grace_resume", "bo", null],
    ]);
    const [resume] = await eventsOf("grace_resume");
    expect(resume).toMatchObject({ at: new Date(T0 + 10 * SECOND), details: { awayMs: 10_000 } });
    const [start] = await eventsOf("grace_start");
    expect(start?.details).toMatchObject({ graceMs: RECONNECT_GRACE_MS });
  });

  it("records the grace running out, and the leave that follows, at the time they were last here", async () => {
    const { a, b } = await twoInRoom();
    await b.close();
    await h.settled();
    await h.advance(RECONNECT_GRACE_MS);
    await a.waitForEvent("left");

    expect(await kinds(roomId, ["join"])).toEqual([
      ["disconnect", "bo", null],
      ["grace_start", "bo", null],
      ["grace_expire", "bo", null],
      ["leave", "bo", null],
    ]);
    const [expire] = await eventsOf("grace_expire");
    expect(expire?.at).toEqual(new Date(T0 + RECONNECT_GRACE_MS));
    // Both stamped when the grace ran out, so the leave sorts after the expiry.
    const [leave] = await eventsOf("leave");
    expect(leave).toMatchObject({
      at: new Date(T0 + RECONNECT_GRACE_MS),
      details: { reason: "grace_expired" },
    });
  });
});

describe("a sharer going away", () => {
  /** bo is sharing in the room with ana. */
  async function sharing() {
    const { a, b } = await twoInRoom();
    b.send({ type: "media.state", mic: false, cam: false, share: true });
    await a.waitForEvent("stateChanged");
    await h.advance(3 * SECOND);
    return { a, b };
  }

  it("records the share stopping when the sharer leaves, before the leave", async () => {
    const { a, b } = await sharing();
    b.send({ type: "room.leave" });
    await a.waitForEvent("left");
    expect(await kinds(roomId, ["join"])).toEqual([
      ["share_start", "bo", null],
      ["share_stop", "bo", null],
      ["leave", "bo", null],
    ]);
    const [stop] = await eventsOf("share_stop");
    expect(stop?.at).toEqual(new Date(T0 + 3 * SECOND));
  });

  it("records it when they are kicked", async () => {
    const { a } = await sharing();
    a.send({ type: "mod.kick", userId: bo.id });
    await a.waitForEvent("kicked");
    expect(await kinds(roomId, ["join"])).toEqual([
      ["share_start", "bo", null],
      ["share_stop", "bo", null],
      ["kick", "ana", "bo"],
    ]);
  });

  it("records it when they are banned", async () => {
    const { a } = await sharing();
    await h.hub.disconnectUser(bo.id, "Reason: spam.");
    await a.waitForEvent("left");
    expect(await kinds(roomId, ["join"])).toEqual([
      ["share_start", "bo", null],
      ["share_stop", "bo", null],
      ["ban", null, "bo"],
    ]);
  });

  it("records it when their reconnect grace runs out", async () => {
    const { a, b } = await sharing();
    await b.close();
    await h.settled();
    await h.advance(RECONNECT_GRACE_MS);
    await a.waitForEvent("left");
    expect(await kinds(roomId, ["join"])).toEqual([
      ["share_start", "bo", null],
      ["disconnect", "bo", null],
      ["grace_start", "bo", null],
      ["grace_expire", "bo", null],
      ["share_stop", "bo", null],
      ["leave", "bo", null],
    ]);
    // The share ended when their socket was lost.
    const [stop] = await eventsOf("share_stop");
    expect(stop?.at).toEqual(new Date(T0 + 3 * SECOND));
  });

  it("records it when an admin ends the room", async () => {
    const { a } = await sharing();
    await h.hub.endRoomByAdmin(roomId);
    await a.waitForEvent("ended");
    const stops = await eventsOf("share_stop");
    expect(stops.map((e) => e.actorUserId)).toEqual([bo.id]);
  });
});

describe("takeover", () => {
  it("records a second socket taking the presence over in the same room", async () => {
    const { b } = await twoInRoom();
    const b2 = await h.connectAs(bo);
    await b2.join(roomId);
    await b.waitFor("error", (e) => e.code === "taken_over");

    const [takeover] = await eventsOf("takeover");
    expect(takeover).toMatchObject({ actorUserId: bo.id, details: { sameRoom: true } });
    // Same presence: no leave and no second join.
    expect(await kinds(roomId, ["join", "disconnect"])).toEqual([["takeover", "bo", null]]);
  });

  it("records a join elsewhere taking the user out of the room they were in", async () => {
    const { a, b } = await twoInRoom();
    const other = await h.createRoom(cy, { name: "cy's room" });
    const b2 = await h.connectAs(bo);
    await b2.join(other);
    await a.waitForEvent("left");

    expect(await kinds(roomId, ["join"])).toEqual([
      ["takeover", "bo", null],
      ["leave", "bo", null],
    ]);
    const [takeover] = await eventsOf("takeover");
    expect(takeover?.details).toEqual({ toRoom: other });
    const [leave] = await eventsOf("leave");
    expect(leave?.details).toEqual({ reason: "taken_over" });
    expect(await kinds(other)).toEqual([["join", "bo", null]]);
    expect(b.isClosed).toBe(false);
  });
});

describe("host", () => {
  it("records host passing on when the grace runs out", async () => {
    const { a, b } = await twoInRoom();
    a.send({ type: "room.leave" });
    await b.waitForEvent("left");
    await h.advance(HOST_GRACE_MS);
    await b.waitForEvent("hostChanged", (m) => m.event.hostUserId === bo.id && !m.event.graceUntil);

    const [change] = await eventsOf("host_change");
    expect(change).toMatchObject({
      actorUserId: null,
      targetUserId: bo.id,
      details: { from: ana.id },
      at: new Date(T0 + HOST_GRACE_MS),
    });
    // Host coming back in time isn't a change.
    expect((await eventsOf("host_change")).length).toBe(1);
  });
});

describe("moderation", () => {
  it("records a kick with who kicked whom, and not as a leave", async () => {
    const { a, b } = await twoInRoom();
    a.send({ type: "mod.kick", userId: bo.id });
    await b.waitFor("error", (e) => e.code === "kicked");
    await h.settled();

    expect(await kinds(roomId, ["join"])).toEqual([["kick", "ana", "bo"]]);
  });

  it("records a mod stopping a share, and the share ending", async () => {
    const { a, b } = await twoInRoom();
    b.send({ type: "media.state", mic: false, cam: false, share: true });
    await a.waitForEvent("stateChanged");
    await h.advance(3 * SECOND);
    a.send({ type: "mod.stopShare", userId: bo.id });
    await a.waitForEvent("stateChanged");

    expect(await kinds(roomId, ["join"])).toEqual([
      ["share_start", "bo", null],
      ["share_stop", "bo", null],
      ["stop_share", "ana", "bo"],
    ]);
    const [stop] = await eventsOf("share_stop");
    expect(stop?.details).toEqual({ by: ana.id });
  });

  it("records a role change", async () => {
    const { a } = await twoInRoom();
    a.send({ type: "mod.setRole", userId: bo.id, role: "mod" });
    await a.waitForEvent("roleChanged");
    a.send({ type: "mod.setRole", userId: bo.id, role: "member" });
    await a.waitForEvent("roleChanged");

    const changes = await eventsOf("role_change");
    expect(changes.map((e) => [e.actorUserId, e.targetUserId, e.details])).toEqual([
      [ana.id, bo.id, { role: "mod" }],
      [ana.id, bo.id, { role: "member" }],
    ]);
  });

  it("records a rename, with the old and the new name", async () => {
    const { a } = await twoInRoom();
    a.send({ type: "room.rename", name: "the new name" });
    await a.waitForEvent("renamed");

    const [rename] = await eventsOf("rename");
    expect(rename).toMatchObject({
      actorUserId: ana.id,
      details: { from: "ana's room", to: "the new name" },
    });
  });

  it("records an admin's ban removing someone from the room, not as a leave", async () => {
    const { a } = await twoInRoom();
    await h.advance(2 * SECOND);
    await h.hub.disconnectUser(bo.id, "Reason: spam.");
    await a.waitForEvent("left");

    expect(await kinds(roomId, ["join"])).toEqual([["ban", null, "bo"]]);
    const [ban] = await eventsOf("ban");
    expect(ban?.at).toEqual(new Date(T0 + 2 * SECOND));
  });
});

describe("media", () => {
  it("records mic, camera and share going on and off, once for each change", async () => {
    const { a, b } = await twoInRoom();
    b.send({ type: "media.state", mic: true, cam: true, share: false });
    await a.waitForEvent("stateChanged");
    // The same state again changes nothing.
    b.send({ type: "media.state", mic: true, cam: true, share: false });
    b.send({ type: "media.state", mic: false, cam: true, share: true });
    await a.waitForEvent("stateChanged");
    await h.advance(SECOND);
    b.send({ type: "media.state", mic: false, cam: false, share: false });
    await a.waitForEvent("stateChanged");
    await h.settled();

    expect(await kinds(roomId, ["join"])).toEqual([
      ["mic_on", "bo", null],
      ["cam_on", "bo", null],
      ["mic_off", "bo", null],
      ["share_start", "bo", null],
      ["cam_off", "bo", null],
      ["share_stop", "bo", null],
    ]);
  });
});

describe("knocks", () => {
  let secret: string;
  let token: string;

  beforeEach(async () => {
    secret = await h.createRoom(ana, { name: "ana's secret", isPrivate: true });
    const [row] = await h.db
      .select({ inviteToken: rooms.inviteToken })
      .from(rooms)
      .where(eq(rooms.id, secret));
    token = row?.inviteToken ?? "";
  });

  it("records a knock, and the host approving or denying it", async () => {
    const a = await h.connectAs(ana);
    await a.join(secret);
    const b = await h.connectAs(bo);
    b.send({ type: "knock.request", inviteToken: token });
    await a.waitFor("knock.pending");
    a.send({ type: "knock.decide", userId: bo.id, admit: true });
    await b.waitFor("knock.status", (m) => m.status === "approved");
    const c = await h.connectAs(cy);
    c.send({ type: "knock.request", inviteToken: token });
    await a.waitFor("knock.pending");
    a.send({ type: "knock.decide", userId: cy.id, admit: false });
    await c.waitFor("knock.status", (m) => m.status === "denied");

    expect(await kinds(secret, ["join"])).toEqual([
      ["knock_request", "bo", null],
      ["knock_approve", "ana", "bo"],
      ["knock_request", "cy", null],
      ["knock_deny", "ana", "cy"],
    ]);
  });

  it("records a knock withdrawn, its socket going away, and it expiring", async () => {
    const a = await h.connectAs(ana);
    await a.join(secret);
    const b = await h.connectAs(bo);
    b.send({ type: "knock.request", inviteToken: token });
    await a.waitFor("knock.pending");
    b.send({ type: "knock.cancel" });
    await a.waitFor("knock.resolved");

    const c = await h.connectAs(cy);
    c.send({ type: "knock.request", inviteToken: token });
    await a.waitFor("knock.pending");
    await c.close();
    await h.settled();
    await h.advance(RECONNECT_GRACE_MS);
    await a.waitFor("knock.resolved");

    const cancels = await eventsOf("knock_cancel", secret);
    expect(cancels.map((e) => [nameOf(e.actorUserId), e.details])).toEqual([
      ["bo", { why: "withdrawn" }],
      ["cy", { why: "disconnected" }],
    ]);

    const c2 = await h.connectAs(cy);
    c2.send({ type: "knock.request", inviteToken: token });
    await a.waitFor("knock.pending");
    await h.advance(KNOCK_EXPIRY_MS);
    await a.waitFor("knock.resolved");
    expect((await eventsOf("knock_cancel", secret)).at(-1)).toMatchObject({
      actorUserId: cy.id,
      details: { why: "expired" },
    });
  });
});

describe("room end", () => {
  it("records a room ending because it stayed empty, at the time it emptied", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.advance(4 * SECOND);
    a.send({ type: "room.leave" });
    await h.settled();
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);

    const [end] = await eventsOf("room_end");
    expect(end).toMatchObject({ at: new Date(T0 + 4 * SECOND), details: { by: "empty" } });
  });

  it("records an admin ending it, once", async () => {
    const { a } = await twoInRoom();
    await h.advance(7 * SECOND);
    expect(await h.hub.endRoomByAdmin(roomId)).toBe(true);
    await a.waitForEvent("ended");
    expect(await h.hub.endRoomByAdmin(roomId)).toBe(false);

    const ends = await eventsOf("room_end");
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ at: new Date(T0 + 7 * SECOND), details: { by: "admin" } });
  });
});

describe("refusals", () => {
  it("sums a person's rate_limited and bad_request refusals into one row for the minute", async () => {
    const { a, b } = await twoInRoom();
    // Two empty chats: bad_request. Then more chat than the limit allows: rate_limited.
    b.send({ type: "chat.send", text: "  " });
    b.send({ type: "chat.send", text: "" });
    for (let i = 0; i < CHAT_RATE_LIMIT.messages + 3; i++) {
      b.send({ type: "chat.send", text: `message ${i}` });
    }
    b.sendRaw("this is not json");
    await h.settled();
    // Someone else's refusal goes on their own row.
    a.send({ type: "chat.send", text: "" });
    await h.settled();
    // Nothing is written for a minute that is still open.
    expect(await eventsOf("refusals")).toEqual([]);

    await h.advance(MINUTE);
    const rows = await eventsOf("refusals");
    expect(rows.map((r) => [nameOf(r.actorUserId), r.at, r.details])).toEqual([
      [
        "bo",
        new Date(T0),
        {
          counts: {
            "chat.send:bad_request": 2,
            "chat.send:rate_limited": 3,
            "unknown:bad_request": 1,
          },
        },
      ],
      ["ana", new Date(T0), { counts: { "chat.send:bad_request": 1 } }],
    ]);
  });

  it("stores `unknown` for a message type that isn't a real one, never what the client wrote", async () => {
    const { b } = await twoInRoom();
    b.sendRaw(JSON.stringify({ type: "definitely.not.a.real.type" }));
    b.sendRaw(JSON.stringify({ type: "chat.send" })); // a real type, missing its text
    await h.settled();
    await h.advance(MINUTE);

    const [row] = await eventsOf("refusals");
    expect(row?.details).toEqual({
      counts: { "unknown:bad_request": 1, "chat.send:bad_request": 1 },
    });
    expect(JSON.stringify(await h.timelineEvents())).not.toContain("definitely");
  });

  it("starts a new row for the next minute", async () => {
    const { b } = await twoInRoom();
    b.send({ type: "chat.send", text: "" });
    await h.settled();
    await h.advance(MINUTE);
    b.send({ type: "chat.send", text: "" });
    b.send({ type: "chat.send", text: "" });
    await h.settled();
    await h.advance(MINUTE);

    const rows = await eventsOf("refusals");
    expect(rows.map((r) => [r.at, r.details])).toEqual([
      [new Date(T0), { counts: { "chat.send:bad_request": 1 } }],
      [new Date(T0 + MINUTE), { counts: { "chat.send:bad_request": 2 } }],
    ]);
  });

  it("counts a signalling flood by its message type", async () => {
    const { a } = await twoInRoom();
    const offer: SignalPayload = { kind: "candidate", session: "pc-1", candidate: null };
    for (let i = 0; i < SIGNAL_RATE_LIMIT.messages + 4; i++) {
      a.send({ type: "signal", to: bo.id, payload: offer });
    }
    await h.settled();
    await h.advance(MINUTE);

    const [row] = await eventsOf("refusals");
    expect(row?.details).toEqual({ counts: { "signal:rate_limited": 4 } });
  });

  it("records a socket closed for flooding", async () => {
    const a = await h.connectAs(ana, { heartbeat: false });
    await a.join(roomId);
    const { messages } = CONNECTION_MESSAGE_BUDGET;
    // Up to the budget in batches, then a budget's worth of dropped frames more, then one more.
    for (let sent = 2; sent < messages; sent += 100) {
      const batch = Math.min(100, messages - sent);
      for (let i = 0; i < batch; i++) a.send({ type: "ping" });
      for (let i = 0; i < batch; i++) await a.waitFor("pong");
    }
    for (let i = 0; i < messages + 1; i++) a.send({ type: "ping" });
    await a.closed();
    await h.settled();

    const [flood] = await eventsOf("flood_close");
    expect(flood).toMatchObject({
      actorUserId: ana.id,
      details: { reason: "too many messages" },
    });

    // Every frame it sent past the budget counts, though the socket was told only twice.
    await h.advance(MINUTE);
    const [row] = await eventsOf("refusals");
    const details = row?.details as { counts: Record<string, number> };
    expect(details.counts["unknown:rate_limited"]).toBeGreaterThanOrEqual(messages);
  });
});

describe("a client that stops reading", () => {
  it("records the drop", async () => {
    await h.close();
    await start({ maxBufferedBytes: 64 * 1024 });
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo, { heartbeat: false });
    await b.join(roomId);
    await a.waitForEvent("joined");
    const offer: SignalPayload = {
      kind: "description",
      session: "pc-1",
      description: { type: "offer", sdp: "v".repeat(60_000) },
    };
    b.stopReading();
    for (let i = 0; i < SIGNAL_RATE_LIMIT.messages - 10; i++) {
      a.send({ type: "signal", to: bo.id, payload: offer });
    }
    await h.settled();
    b.resumeReading();
    await b.closed();

    const [drop] = await eventsOf("slow_client");
    expect(drop?.actorUserId).toBe(bo.id);
    const details = drop?.details as { bufferedBytes: number };
    expect(details.bufferedBytes).toBeGreaterThan(64 * 1024);
  }, 30_000);
});

describe("chat", () => {
  it("is never recorded, whatever happens to it", async () => {
    const { a, b } = await twoInRoom();
    const secret = "hunter2-the-secret-message";
    b.send({ type: "chat.send", text: secret });
    await a.waitFor("chat.message");
    for (let i = 0; i < CHAT_RATE_LIMIT.messages + 2; i++) {
      b.send({ type: "chat.send", text: `${secret} ${i}` });
    }
    b.send({ type: "chat.send", text: "x".repeat(5_000) });
    await h.settled();
    await h.advance(MINUTE);

    const everything = JSON.stringify(await h.timelineEvents());
    expect(everything).not.toContain("hunter2");
    expect(everything).not.toContain("xxxxx");
    expect(await eventsOf("refusals")).toHaveLength(1);
  });
});

describe("writes off the hub's path", () => {
  let error: MockInstance<typeof console.error>;
  /** While true, a timeline write fails. */
  let down: boolean;
  /** While set, a timeline write waits for it. */
  let gate: Promise<void> | null;
  let release: () => void;

  async function restartWithFlakyWrites() {
    await h.close();
    down = false;
    gate = null;
    release = () => {};
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    await start({
      wrapTimelineWrite: (write) => async (rows) => {
        await gate;
        if (down) throw new Error("timeline db is down");
        return write(rows);
      },
    });
  }

  afterEach(() => release());

  it("keeps the room working while the timeline can't be written, logs it, and catches up", async () => {
    await restartWithFlakyWrites();
    down = true;
    const { a, b } = await twoInRoom();
    b.send({ type: "chat.send", text: "still talking" });
    expect((await a.waitFor("chat.message")).message.text).toBe("still talking");
    await h.advance(5 * SECOND);
    await h.timeline.flush();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("writing room timeline events failed"),
      expect.any(Error),
    );
    expect(h.timeline.queued).toBeGreaterThanOrEqual(2);
    // The room goes on: a leave is told to the others, and the hub's queue is idle.
    b.send({ type: "room.leave" });
    await a.waitForEvent("left");
    expect(h.hub.queued).toBe(0);

    down = false;
    expect((await kinds()).map(([kind]) => kind)).toEqual(["join", "join", "leave"]);
  });

  it("is not held up by a write that is slow", async () => {
    await restartWithFlakyWrites();
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { a, b } = await twoInRoom();
    // The timer starts a write, which hangs on the gate; the room goes on regardless.
    await h.advance(5 * SECOND);
    b.send({ type: "chat.send", text: "no waiting" });
    expect((await a.waitFor("chat.message")).message.text).toBe("no waiting");
    b.send({ type: "room.leave" });
    await a.waitForEvent("left");
    expect(h.hub.queued).toBe(0);

    release();
    expect((await kinds()).map(([kind]) => kind)).toEqual(["join", "join", "leave"]);
  });
});
