import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import {
  MAX_REFUSAL_KEYS,
  MAX_TIMELINE_DETAILS_BYTES,
  type TimelineEventRow,
} from "../lib/room-timeline.ts";
import { FakeClock } from "./clock.ts";
import { SLOW_WRITE_MS } from "./log-events.ts";
import { LOG_SAMPLE_LIMIT, redirectProcessLog } from "./logger.ts";
import {
  createTimelineRecorder,
  TIMELINE_CLOSE_TIMEOUT_MS,
  TimelineRecorder,
  type TimelineRecorderTuning,
} from "./room-timeline.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

let logs: CapturedLogs;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => logs.restore());

// The queue behind the room timeline (#115): events are batched and written off the caller's
// path, a write that is slow or fails never reaches the caller, and the queue is bounded.

const FLUSH_MS = 1_000;
const MINUTE = 60_000;

function setup(options: TimelineRecorderTuning = {}) {
  const clock = new FakeClock();
  const written: TimelineEventRow[][] = [];
  let write: (rows: TimelineEventRow[]) => Promise<unknown> = async (rows) => {
    written.push(rows);
  };
  const recorder = new TimelineRecorder({
    clock,
    write: (rows) => write(rows),
    options: { flushDelayMs: FLUSH_MS, ...options },
  });
  return {
    clock,
    recorder,
    written,
    rows: () => written.flat(),
    setWrite: (next: typeof write) => {
      write = next;
    },
  };
}

const event = (n: number, extra: Partial<TimelineEventRow> = {}): TimelineEventRow => ({
  roomId: "r1",
  at: new Date(Date.parse("2026-09-01T12:00:00Z") + n),
  kind: "join",
  actorUserId: `u${n}`,
  targetUserId: null,
  details: {},
  ...extra,
});

/** Let promise callbacks (a flush's writes) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TimelineRecorder queue", () => {
  it("writes nothing on the caller's path, then batches what queued after the flush delay", async () => {
    const { recorder, clock, written } = setup({ batchSize: 2 });
    for (let n = 0; n < 5; n++) recorder.record(event(n));
    expect(written).toEqual([]);
    expect(recorder.queued).toBe(5);

    clock.advance(FLUSH_MS);
    await recorder.flush();
    expect(written.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(written.flat().map((r) => r.actorUserId)).toEqual(["u0", "u1", "u2", "u3", "u4"]);
    expect(recorder.queued).toBe(0);
  });

  it("keeps taking events while a write is slow, and the caller never waits for it", async () => {
    const { recorder, clock, setWrite, rows } = setup({ batchSize: 10 });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: TimelineEventRow[] = [];
    setWrite(async (batch) => {
      await gate;
      seen.push(...batch);
    });
    recorder.record(event(0));
    clock.advance(FLUSH_MS);
    await settle();

    // The write is stuck; recording goes on and returns at once.
    recorder.record(event(1));
    recorder.record(event(2));
    expect(recorder.queued).toBe(2);

    release();
    await recorder.flush();
    expect(seen.map((r) => r.actorUserId)).toEqual(["u0", "u1", "u2"]);
    expect(rows()).toEqual([]);
  });

  it("logs a failed write, keeps its events and writes them, in order, once the database is back", async () => {
    const { recorder, clock, setWrite, rows } = setup();
    let healthy = false;
    const landed: TimelineEventRow[] = [];
    setWrite(async (batch) => {
      if (!healthy) throw new Error("db is down");
      landed.push(...batch);
    });
    recorder.record(event(0));
    recorder.record(event(1));
    clock.advance(FLUSH_MS);
    await recorder.flush();
    expect(logs.find("timeline.write_failed")).toMatchObject({
      level: "error",
      msg: expect.stringContaining("writing room timeline events failed"),
      tries: 1,
      kept: 2,
      err: { message: "db is down" },
    });
    expect(landed).toEqual([]);
    expect(recorder.queued).toBe(2);

    // Events recorded meanwhile queue behind the failed ones.
    recorder.record(event(2));
    healthy = true;
    clock.advance(60_000);
    await recorder.flush();
    expect(landed.map((r) => r.actorUserId)).toEqual(["u0", "u1", "u2"]);
    expect(recorder.queued).toBe(0);
    expect(rows()).toEqual([]);
  });

  it("retries a failed write by itself, after a doubling wait", async () => {
    const { recorder, clock, setWrite } = setup();
    const attempts: number[] = [];
    setWrite(async () => {
      attempts.push(clock.now().getTime() - Date.parse("2026-09-01T12:00:00Z"));
      throw new Error("db is down");
    });
    recorder.record(event(0));
    for (let ms = 0; ms < 16_000; ms += 250) {
      clock.advance(250);
      await settle();
    }
    // The flush delay, then 1 s, 2 s, 4 s and 8 s after each failure.
    expect(attempts).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
  });

  it("starts no second write while one hangs, holds its bound, and writes again once the db is back", async () => {
    // The write timeout is real time (how long the database took), here a fraction of a second.
    const { recorder, clock, setWrite } = setup({ maxQueued: 50, writeTimeoutMs: 200 });
    let calls = 0;
    setWrite(() => {
      calls++;
      return new Promise(() => {});
    });
    recorder.record(event(0));
    clock.advance(FLUSH_MS);
    await settle();
    expect(calls).toBe(1);

    // Minutes of traffic and timers while the write hangs: nothing piles up behind it.
    for (let n = 1; n <= 200; n++) {
      recorder.record(event(n));
      if (n % 10 === 0) clock.advance(FLUSH_MS / 4);
      void recorder.flush();
    }
    await settle();
    expect(calls).toBe(1);
    expect(recorder.queued).toBeLessThanOrEqual(50);
    expect(recorder.dropped).toBeGreaterThan(0);

    // The db comes back; the write that hangs is given up on, its rows requeued and written.
    const landed: TimelineEventRow[] = [];
    setWrite(async (batch) => {
      landed.push(...batch);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await recorder.flush();
    expect(logs.find("timeline.write_failed")).toMatchObject({
      level: "error",
      err: { message: expect.stringContaining("timed out") },
    });
    expect(landed.length).toBeGreaterThan(0);
    expect(landed.length).toBeLessThanOrEqual(50);
    expect(landed.at(-1)?.actorUserId).toBe("u200");
    expect(recorder.queued).toBe(0);

    // Back to normal: the next event is written after the usual delay.
    recorder.record(event(999));
    clock.advance(FLUSH_MS);
    await recorder.flush();
    expect(landed.at(-1)?.actorUserId).toBe("u999");
  });

  it("writes events soon even when a refusal had armed the timer for the end of the minute", async () => {
    const { recorder, clock, rows } = setup();
    recorder.refused("r1", "ana", "chat.send", "rate_limited", clock.now());
    // The only thing waiting is the open minute, 60 s away; an event now must not wait for it.
    recorder.record(event(0));
    clock.advance(FLUSH_MS);
    await settle();
    expect(rows().map((r) => r.kind)).toEqual(["join"]);

    // And the refusal row still comes when its minute is over.
    clock.advance(MINUTE);
    await settle();
    expect(rows().map((r) => r.kind)).toEqual(["join", "refusals"]);
  });

  it("drops the oldest events past its bound, counts them and logs it", async () => {
    const { recorder, clock, rows } = setup({ maxQueued: 3 });
    for (let n = 0; n < 5; n++) recorder.record(event(n));
    expect(recorder.queued).toBe(3);
    expect(recorder.dropped).toBe(2);
    // Logged when it starts, not once per dropped event.
    expect(logs.all("timeline.dropped")).toHaveLength(1);
    expect(logs.find("timeline.dropped")).toMatchObject({
      level: "warn",
      msg: expect.stringContaining("queue is full"),
      max: 3,
    });

    clock.advance(FLUSH_MS);
    await recorder.flush();
    expect(rows().map((r) => r.actorUserId)).toEqual(["u2", "u3", "u4"]);
  });

  it("holds to its bound while the database is down, dropping the oldest", async () => {
    const { recorder, clock, setWrite } = setup({ maxQueued: 4, batchSize: 4 });
    setWrite(async () => {
      throw new Error("db is down");
    });
    for (let n = 0; n < 4; n++) recorder.record(event(n));
    clock.advance(FLUSH_MS);
    await recorder.flush();
    expect(recorder.queued).toBe(4);
    recorder.record(event(4));
    recorder.record(event(5));
    expect(recorder.queued).toBe(4);
    expect(recorder.dropped).toBe(2);
    expect(logs.find("timeline.dropped")).toMatchObject({ max: 4 });
  });

  it("never throws into the caller, whatever the write does", async () => {
    const { recorder, setWrite, clock } = setup();
    setWrite(() => {
      throw new Error("sync failure");
    });
    expect(() => recorder.record(event(0))).not.toThrow();
    clock.advance(FLUSH_MS);
    await expect(recorder.flush()).resolves.toBeUndefined();
  });

  it("measures the details cap in bytes, not characters", async () => {
    const { recorder, rows } = setup();
    // 600 characters, 1,200 bytes.
    recorder.record(event(0, { details: { text: "é".repeat(600) } }));
    await recorder.flush();
    expect(rows().map((r) => r.details)).toEqual([{ truncated: true }]);
  });

  it("stores a details object that is too big as truncated", async () => {
    const { recorder, rows } = setup();
    recorder.record(event(0, { details: { blob: "x".repeat(MAX_TIMELINE_DETAILS_BYTES * 2) } }));
    recorder.record(event(1, { details: { small: 1 } }));
    await recorder.flush();
    expect(rows().map((r) => r.details)).toEqual([{ truncated: true }, { small: 1 }]);
  });

  it("writes everything on close, then writes nothing more by itself", async () => {
    const { recorder, clock, written } = setup();
    recorder.record(event(0));
    await recorder.close();
    expect(written.flat()).toHaveLength(1);
    recorder.record(event(1));
    clock.advance(FLUSH_MS * 10);
    await settle();
    expect(written.flat()).toHaveLength(1);
  });

  it("gives up on a write that never ends once closing has waited long enough", async () => {
    const { recorder, clock, setWrite } = setup();
    setWrite(() => new Promise(() => {}));
    recorder.record(event(0));
    const closing = recorder.close();
    clock.advance(TIMELINE_CLOSE_TIMEOUT_MS);
    await closing;
    expect(logs.find("timeline.write_failed")).toMatchObject({
      level: "error",
      msg: expect.stringContaining("timed out"),
    });
  });
});

describe("TimelineRecorder log lines (the server log, src/server/logger.ts)", () => {
  it("logs each recorded event at info as timeline.<kind>, with the room, the people and its details", () => {
    const { recorder } = setup();
    recorder.record(
      event(1, {
        kind: "kick",
        actorUserId: "host-1",
        targetUserId: "guest-2",
        details: { reason: "spam", by: "host" },
      }),
    );
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]).toMatchObject({
      level: "info",
      event: "timeline.kick",
      roomId: "r1",
      userId: "host-1",
      targetUserId: "guest-2",
      details: { reason: "spam", by: "host" },
      at: "2026-09-01T12:00:00.001Z",
    });
  });

  it("logs the event as stored: bounded, and without chat or addresses even if a caller slipped", () => {
    const { recorder } = setup();
    recorder.record(
      event(1, {
        details: { text: "a private sentence", ip: "203.0.113.5", note: "from 198.51.100.7" },
      }),
    );
    const text = logs.lines.join("");
    expect(text).not.toContain("a private sentence");
    expect(text).not.toContain("203.0.113.5");
    expect(text).not.toContain("198.51.100.7");
  });

  it("logs nothing for the refusal summaries, which socket.refused already covers", async () => {
    const { recorder, clock } = setup();
    recorder.refused("r1", "u1", "chat.send", "rate_limited", new Date());
    clock.advance(2 * MINUTE);
    await recorder.flush();
    expect(logs.all("timeline.refusals")).toEqual([]);
  });

  it("never throws into the caller when the log itself fails", () => {
    const { recorder } = setup();
    logs.restore();
    const restore = redirectProcessLog(() => {
      throw new Error("stdout is gone");
    });
    try {
      expect(() => recorder.record(event(1))).not.toThrow();
      expect(recorder.queued).toBe(1);
    } finally {
      restore();
    }
  });

  it("warns about a batch the database takes SLOW_WRITE_MS or longer to write", async () => {
    const slowDb = {
      insert: () => ({
        values: () => new Promise((resolve) => setTimeout(resolve, SLOW_WRITE_MS + 50)),
      }),
    } as unknown as Db;
    const recorder = createTimelineRecorder(slowDb, new FakeClock());
    recorder.record(event(1));
    recorder.record(event(2));
    await recorder.flush();
    expect(logs.find("db.slow_write")).toMatchObject({
      level: "warn",
      operation: "timeline.insert",
      rows: 2,
    });
  });

  it("is sampled per person, so one user can't flood the log", () => {
    const { recorder } = setup();
    for (let n = 0; n < 30; n++) recorder.record(event(n, { actorUserId: "same" }));
    expect(logs.all("timeline.join")).toHaveLength(LOG_SAMPLE_LIMIT);
    recorder.record(event(99, { actorUserId: "other" }));
    expect(logs.all("timeline.join")).toHaveLength(LOG_SAMPLE_LIMIT + 1);
  });
});

describe("TimelineRecorder refusal summaries", () => {
  const T0 = Date.parse("2026-09-01T12:00:00Z");

  it("sums a person's refusals in a minute into one row, counted by message type and reason", async () => {
    const { recorder, clock, rows } = setup();
    const at = (s: number) => new Date(T0 + s * 1_000);
    recorder.refused("r1", "ana", "chat.send", "rate_limited", at(1));
    recorder.refused("r1", "ana", "chat.send", "rate_limited", at(2));
    recorder.refused("r1", "ana", "chat.send", "bad_request", at(3));
    recorder.refused("r1", "ana", "signal", "rate_limited", at(40));
    expect(recorder.queued).toBe(0);

    clock.advance(MINUTE);
    await recorder.flush();
    expect(rows()).toEqual([
      {
        roomId: "r1",
        at: new Date(T0),
        kind: "refusals",
        actorUserId: "ana",
        targetUserId: null,
        details: {
          counts: {
            "chat.send:rate_limited": 2,
            "chat.send:bad_request": 1,
            "signal:rate_limited": 1,
          },
        },
      },
    ]);
  });

  it("keeps one row per person, per room and per minute", async () => {
    const { recorder, clock, rows } = setup();
    recorder.refused("r1", "ana", "chat.send", "rate_limited", new Date(T0 + 1_000));
    recorder.refused("r1", "bo", "chat.send", "rate_limited", new Date(T0 + 2_000));
    recorder.refused("r2", "ana", "chat.send", "rate_limited", new Date(T0 + 3_000));
    recorder.refused("r1", "ana", "chat.send", "rate_limited", new Date(T0 + MINUTE + 1_000));

    clock.advance(2 * MINUTE);
    await recorder.flush();
    const summary = rows().map((r) => [r.roomId, r.actorUserId, r.at.getTime() - T0]);
    expect(summary).toHaveLength(4);
    expect(summary).toEqual(
      expect.arrayContaining([
        ["r1", "ana", 0],
        ["r1", "bo", 0],
        ["r2", "ana", 0],
        ["r1", "ana", MINUTE],
      ]),
    );
  });

  it("holds a minute back until it is over, so it is written once", async () => {
    const { recorder, clock, rows } = setup();
    recorder.refused("r1", "ana", "chat.send", "rate_limited", clock.now());
    clock.advance(FLUSH_MS);
    await recorder.flush();
    expect(rows()).toEqual([]);

    recorder.refused("r1", "ana", "chat.send", "rate_limited", clock.now());
    clock.advance(MINUTE);
    await recorder.flush();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.details).toEqual({ counts: { "chat.send:rate_limited": 2 } });
  });

  it("writes the open minute too on close (shutdown)", async () => {
    const { recorder, clock, rows } = setup();
    recorder.refused("r1", "ana", "chat.send", "rate_limited", clock.now());
    await recorder.close();
    expect(rows()).toHaveLength(1);
  });

  it("folds message types beyond its limit into one `other` count", async () => {
    const { recorder, clock, rows } = setup();
    for (let n = 0; n < MAX_REFUSAL_KEYS + 5; n++) {
      recorder.refused("r1", "ana", `type${n}`, "bad_request", clock.now());
    }
    await recorder.close();
    const details = rows()[0]?.details as { counts: Record<string, number> };
    expect(Object.keys(details.counts)).toHaveLength(MAX_REFUSAL_KEYS + 1);
    expect(details.counts["other:bad_request"]).toBe(5);
  });
});
