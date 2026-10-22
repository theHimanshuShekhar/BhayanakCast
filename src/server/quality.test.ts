import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { presenceIntervals, qualitySamples, rooms, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { QUALITY_BATCH_MAX, type QualitySample } from "../lib/quality-telemetry.ts";
import { type Caller, SignInRequiredError } from "./caller.ts";
import { FakeClock } from "./clock.ts";
import { SLOW_WRITE_MS } from "./log-events.ts";
import {
  purgeExpiredQualitySamples,
  QUALITY_RETENTION_DAYS,
  QUALITY_ROW_RATE_LIMIT,
  QualityService,
} from "./quality.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

// What a page may report of its video quality (#94): only from a signed-in caller in the live
// room, about peers in it, dated by the server, bounded and rate-limited; and the 90-day purge.

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-10-11T12:00:00Z");
const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0";

const asUser = (id: string): Caller => ({ user: { id, username: id, image: null }, role: "user" });
const visitor: Caller = { user: null, role: "visitor" };

let db: Db;
let close: () => Promise<void>;
let clock: FakeClock;
let service: QualityService;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  clock = new FakeClock(T0);
  service = new QualityService({ db, clock });
  await db
    .insert(user)
    .values(
      ["ana", "bo", "cy", "dee"].map((id) => ({ id, name: id, email: `${id}@discord.invalid` })),
    );
  // "r1", a gaming room: ana and bo are in it, cy left and dee never came. "r2" ended.
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
  await close();
});

/** A sent row about `peerId`, as a page reports it. */
const sample = (peerId: string, extra: Partial<QualitySample> = {}): QualitySample => ({
  peerId,
  ageMs: 4_000,
  slot: "screen",
  direction: "send",
  trigger: "window",
  windowMs: 30_000,
  sinceStartMs: null,
  rung: "1080p30",
  toRung: null,
  reason: null,
  maxBitrate: 3_000_000,
  targetBitrate: 2_400_000,
  bitrate: 2_000_000,
  availableBitrate: 5_000_000,
  qp: 38.5,
  codec: "video/VP9",
  codecReason: "preferred",
  fromCodec: null,
  encoderImplementation: "libvpx",
  powerEfficientEncoder: false,
  encodeMs: 6.5,
  frameWidth: 1920,
  frameHeight: 1080,
  fps: 30,
  limitation: "none",
  loss: 0.002,
  rttMs: 21,
  plis: 1,
  firs: 0,
  nacks: 7,
  keyFrames: 2,
  freezes: null,
  freezeSeconds: null,
  localCandidate: "host",
  remoteCandidate: "srflx",
  relayProtocol: null,
  ...extra,
});

const report = (samples: QualitySample[], roomId = "r1") => ({ roomId, samples });
const stored = () => db.select().from(qualitySamples);

describe("reporting quality samples", () => {
  it("keeps the rows of a report that has one unknown label, and labels in the size form", async () => {
    const odd = { ...sample("bo"), rung: "not a label" } as unknown as QualitySample;
    const wide = sample("bo", { rung: "2226×932@30", maxBitrate: 3_000_000 });
    const small = sample("bo", { rung: "96×54@30", maxBitrate: 50_000 });
    expect(await service.record(asUser("ana"), report([odd, wide, small]), CHROME)).toEqual({
      stored: 2,
    });
    expect((await stored()).map((row) => row.rung).sort()).toEqual(["2226×932@30", "96×54@30"]);
  });

  it("stores a row per sample, dated by the server's clock, with the room's kind and the browser", async () => {
    const result = await service.record(asUser("ana"), report([sample("bo")]), CHROME);
    expect(result).toEqual({ stored: 1 });
    const [row] = await stored();
    expect(row).toMatchObject({
      roomId: "r1",
      // The room's, not the page's.
      roomKind: "gaming",
      reporterUserId: "ana",
      peerUserId: "bo",
      direction: "send",
      slot: "screen",
      trigger: "window",
      windowMs: 30_000,
      browser: "chrome" as const,
      browserMajor: 139,
      rung: "1080p30",
      maxBitrate: 3_000_000,
      targetBitrate: 2_400_000,
      qp: 38.5,
      codec: "video/VP9",
      localCandidate: "host",
      remoteCandidate: "srflx",
    });
    expect(row?.at).toEqual(new Date(T0.getTime() - 4_000));
  });

  it("stores how long after its sender started a row ended, and null for a page that didn't say", async () => {
    const { sinceStartMs: _, ...older } = sample("bo");
    await service.record(
      asUser("ana"),
      report([sample("bo", { sinceStartMs: 12_500 }), older as QualitySample]),
      CHROME,
    );
    expect((await stored()).map((row) => row.sinceStartMs).sort()).toEqual([12_500, null]);
  });

  it("stores the codec reason and the encoder of a sent row, and none for a page that predates them", async () => {
    const {
      codecReason: _a,
      fromCodec: _b,
      encoderImplementation: _c,
      powerEfficientEncoder: _d,
      encodeMs: _e,
      ...older
    } = sample("bo");
    await service.record(
      asUser("ana"),
      report([sample("bo", { codecReason: "hardware" }), older as QualitySample]),
      CHROME,
    );
    const rows = (await stored()).sort((x, y) =>
      (x.codecReason ?? "").localeCompare(y.codecReason ?? ""),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      codecReason: null,
      fromCodec: null,
      encoderImplementation: null,
      powerEfficientEncoder: null,
      encodeMs: null,
    });
    expect(rows[1]).toMatchObject({
      codecReason: "hardware",
      fromCodec: null,
      encoderImplementation: "libvpx",
      powerEfficientEncoder: false,
      encodeMs: 6.5,
    });
  });

  it("stores a codec switch row with the codec it left", async () => {
    const result = await service.record(
      asUser("ana"),
      report([
        sample("bo", {
          trigger: "codec",
          codec: "video/H264",
          fromCodec: "video/AV1",
          codecReason: "cpu",
          qp: null,
        }),
      ]),
      CHROME,
    );
    expect(result).toEqual({ stored: 1 });
    expect((await stored())[0]).toMatchObject({
      trigger: "codec",
      codec: "video/H264",
      fromCodec: "video/AV1",
      codecReason: "cpu",
      toRung: null,
      rungReason: null,
    });
  });

  it("drops a row with a codec reason it doesn't know, and keeps the rest of the report", async () => {
    const odd = sample("bo", { codecReason: "gpu" as never });
    expect(await service.record(asUser("ana"), report([odd, sample("bo")]), CHROME)).toEqual({
      stored: 1,
    });
  });

  it("keeps a stat a browser lacked null, not 0", async () => {
    const firefox = sample("ana", {
      direction: "recv",
      rung: null,
      maxBitrate: null,
      targetBitrate: null,
      availableBitrate: null,
      qp: null,
      codecReason: null,
      encoderImplementation: null,
      powerEfficientEncoder: null,
      encodeMs: null,
      limitation: null,
      freezes: 0,
    });
    await service.record(asUser("bo"), report([firefox]), FIREFOX);
    const [row] = await stored();
    expect(row).toMatchObject({
      reporterUserId: "bo",
      peerUserId: "ana",
      direction: "recv",
      browser: "firefox",
      browserMajor: 142,
      freezes: 0,
      targetBitrate: null,
      availableBitrate: null,
      qp: null,
      limitation: null,
      rung: null,
    });
  });

  it("stores a browser major version it couldn't tell as null, not 0", async () => {
    await service.record(asUser("ana"), report([sample("bo")]), "curl/8.0");
    expect(await stored()).toMatchObject([{ browser: "other", browserMajor: null }]);
  });

  it("stores a rung change with where from, to and why", async () => {
    await service.record(
      asUser("ana"),
      report([sample("bo", { trigger: "rung", toRung: "900p30", reason: "pressure" })]),
      CHROME,
    );
    expect(await stored()).toMatchObject([
      { trigger: "rung", rung: "1080p30", toRung: "900p30", rungReason: "pressure" },
    ]);
  });

  it("is for signed-in callers only", async () => {
    await expect(service.record(visitor, report([sample("bo")]), CHROME)).rejects.toThrow(
      SignInRequiredError,
    );
    expect(await stored()).toEqual([]);
  });

  it("stores nothing for someone who isn't in the room", async () => {
    // Left (cy), never came (dee), and a room that ended.
    for (const [who, roomId] of [
      ["cy", "r1"],
      ["dee", "r1"],
      ["ana", "r2"],
      ["ana", "nope"],
    ] as const) {
      const result = await service.record(asUser(who), report([sample("bo")], roomId), CHROME);
      expect(result, `${who} in ${roomId}`).toEqual({ stored: 0 });
    }
    expect(await stored()).toEqual([]);
  });

  it("drops rows about a peer who isn't in the room, or about the reporter, and keeps the rest", async () => {
    const result = await service.record(
      asUser("ana"),
      report([sample("cy"), sample("dee"), sample("ana"), sample("ghost"), sample("bo")]),
      CHROME,
    );
    expect(result).toEqual({ stored: 1 });
    expect((await stored()).map((r) => r.peerUserId)).toEqual(["bo"]);
  });

  it("takes a peer who left the room since, once their interval closed, no more", async () => {
    await service.record(asUser("ana"), report([sample("bo")]), CHROME);
    await db
      .update(presenceIntervals)
      .set({ endedAt: T0 })
      .where(eq(presenceIntervals.userId, "bo"));
    expect(await service.record(asUser("ana"), report([sample("bo")]), CHROME)).toEqual({
      stored: 0,
    });
    expect(await stored()).toHaveLength(1);
  });

  it("refuses a malformed or oversized report", async () => {
    const tooMany = Array.from({ length: QUALITY_BATCH_MAX + 1 }, () => sample("bo"));
    await expect(service.record(asUser("ana"), report(tooMany), CHROME)).rejects.toThrow();
    await expect(service.record(asUser("ana"), report([]), CHROME)).rejects.toThrow();
    await expect(
      service.record(asUser("ana"), report([sample("bo", { loss: 7 })]), CHROME),
    ).rejects.toThrow();
    await expect(
      service.record(
        asUser("ana"),
        report([{ ...sample("bo"), roomKind: "chat" } as unknown as QualitySample]),
        CHROME,
      ),
    ).rejects.toThrow();
    await expect(
      service.record(asUser("ana"), report([sample("bo", { ageMs: 24 * 60 * 60_000 })]), CHROME),
    ).rejects.toThrow();
    expect(await stored()).toEqual([]);
  });

  it("takes a full batch", async () => {
    const full = Array.from({ length: QUALITY_BATCH_MAX }, () => sample("bo"));
    expect(await service.record(asUser("ana"), report(full), CHROME)).toEqual({
      stored: QUALITY_BATCH_MAX,
    });
  });

  it("stops taking a user's rows once they are over their allowance, until it clears", async () => {
    const { rows, windowMs } = QUALITY_ROW_RATE_LIMIT;
    const batches = Math.floor(rows / QUALITY_BATCH_MAX);
    const full = Array.from({ length: QUALITY_BATCH_MAX }, () => sample("bo"));
    for (let i = 0; i < batches; i++) {
      expect(await service.record(asUser("ana"), report(full), CHROME)).toEqual({
        stored: QUALITY_BATCH_MAX,
      });
    }
    expect(await service.record(asUser("ana"), report(full), CHROME)).toEqual({ stored: 0 });
    // Someone else has an allowance of their own.
    expect(await service.record(asUser("bo"), report([sample("ana")]), CHROME)).toEqual({
      stored: 1,
    });
    expect(await stored()).toHaveLength(batches * QUALITY_BATCH_MAX + 1);

    clock.advance(windowMs + 1);
    expect(await service.record(asUser("ana"), report(full), CHROME)).toEqual({
      stored: QUALITY_BATCH_MAX,
    });
  });
});

describe("the rows allowance", () => {
  const { rows, windowMs } = QUALITY_ROW_RATE_LIMIT;
  const batch = (peer: string, length: number) =>
    report(Array.from({ length }, () => sample(peer)));

  it("doesn't count a refused report: what is left of the allowance can still be used", async () => {
    // 23 full reports, then one that would pass the allowance: refused whole.
    for (let i = 0; i < 23; i++) await service.record(asUser("ana"), batch("bo", 64), CHROME);
    const left = rows - 23 * 64;
    expect(await service.record(asUser("ana"), batch("bo", 64), CHROME)).toEqual({ stored: 0 });
    // The refused 64 weren't counted, so exactly what was left fits.
    expect(await service.record(asUser("ana"), batch("bo", left), CHROME)).toEqual({
      stored: left,
    });
    expect(await service.record(asUser("ana"), batch("bo", 1), CHROME)).toEqual({ stored: 0 });
    clock.advance(windowMs + 1);
    expect(await service.record(asUser("ana"), batch("bo", 1), CHROME)).toEqual({ stored: 1 });
  });

  it("counts the rows of a report within the allowance even when they aren't stored", async () => {
    // Rows about nobody in the room, and a caller who isn't in the room: nothing stored, all counted.
    for (let i = 0; i < 23; i++) {
      expect(await service.record(asUser("ana"), batch("dee", 64), CHROME)).toEqual({ stored: 0 });
      expect(await service.record(asUser("cy"), batch("bo", 64), CHROME)).toEqual({ stored: 0 });
    }
    const left = rows - 23 * 64;
    expect(await service.record(asUser("ana"), batch("bo", 64), CHROME)).toEqual({ stored: 0 });
    expect(await service.record(asUser("ana"), batch("bo", left), CHROME)).toEqual({
      stored: left,
    });
    // cy used their allowance on a room they weren't in, too.
    expect(await service.record(asUser("cy"), batch("bo", 64), CHROME)).toEqual({ stored: 0 });
  });
});

describe("what is logged about a report", () => {
  let logs: CapturedLogs;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => logs.restore());

  /** `db` with `insert` replaced; everything else is the real database. */
  const withInsert = (insert: () => unknown) =>
    new QualityService({
      db: new Proxy(db, {
        get: (target, key, receiver) =>
          key === "insert" ? insert : Reflect.get(target, key, receiver),
      }),
      clock,
    });

  it("says nothing about a report that is stored", async () => {
    await service.record(asUser("ana"), report([sample("bo")]), CHROME);
    expect(logs.entries).toEqual([]);
  });

  it("warns, with why, about a report from someone who isn't in the room", async () => {
    await service.record(asUser("cy"), report([sample("bo")]), CHROME);
    expect(logs.find("quality.dropped")).toMatchObject({
      level: "warn",
      reason: "not_in_room",
      userId: "cy",
      roomId: "r1",
      rows: 1,
    });
  });

  it("warns about a report over the allowance", async () => {
    const full = Array.from({ length: QUALITY_BATCH_MAX }, () => sample("bo"));
    const batches = Math.floor(QUALITY_ROW_RATE_LIMIT.rows / QUALITY_BATCH_MAX);
    for (let i = 0; i < batches; i++) await service.record(asUser("ana"), report(full), CHROME);
    expect(logs.entries).toEqual([]);
    await service.record(asUser("ana"), report(full), CHROME);
    expect(logs.find("quality.dropped")).toMatchObject({
      level: "warn",
      reason: "over_limit",
      userId: "ana",
      roomId: "r1",
      rows: QUALITY_BATCH_MAX,
    });
  });

  it("warns about an invalid report, which still throws", async () => {
    await expect(service.record(asUser("ana"), report([]), CHROME)).rejects.toThrow();
    expect(logs.find("quality.dropped")).toMatchObject({
      level: "warn",
      reason: "invalid",
      userId: "ana",
      roomId: "r1",
    });
  });

  it("warns about the rows dropped for peers who aren't in the room, and counts them", async () => {
    await service.record(
      asUser("ana"),
      report([sample("cy"), sample("dee"), sample("ana"), sample("bo")]),
      CHROME,
    );
    expect(logs.find("quality.dropped")).toMatchObject({
      level: "warn",
      reason: "peer_not_in_room",
      userId: "ana",
      roomId: "r1",
      rows: 3,
    });
  });

  it("logs a failed write at error with the room and user, and still throws", async () => {
    const failing = withInsert(() => ({
      values: () => Promise.reject(new Error("disk full")),
    }));
    await expect(failing.record(asUser("ana"), report([sample("bo")]), CHROME)).rejects.toThrow(
      "disk full",
    );
    expect(logs.find("quality.write_failed")).toMatchObject({
      level: "error",
      roomId: "r1",
      userId: "ana",
      rows: 1,
      err: { message: "disk full" },
    });
  });

  it("warns about a write slower than the threshold", async () => {
    const slow = withInsert(() => ({
      values: () => new Promise((resolve) => setTimeout(resolve, SLOW_WRITE_MS + 100)),
    }));
    await slow.record(asUser("ana"), report([sample("bo")]), CHROME);
    expect(logs.find("db.slow_write")).toMatchObject({
      level: "warn",
      operation: "quality.insert",
      roomId: "r1",
      userId: "ana",
      thresholdMs: SLOW_WRITE_MS,
    });
  });
});

describe("purgeExpiredQualitySamples", () => {
  const row = (daysOld: number, roomId = "gone") => ({
    roomId,
    roomKind: "chat" as const,
    at: new Date(T0.getTime() - daysOld * DAY),
    windowMs: 30_000,
    reporterUserId: "ana",
    peerUserId: "bo",
    direction: "send" as const,
    slot: "screen" as const,
    trigger: "window" as const,
    browser: "chrome" as const,
    browserMajor: 139,
  });

  it("deletes samples older than 90 days and keeps the rest", async () => {
    expect(QUALITY_RETENTION_DAYS).toBe(90);
    await db.insert(qualitySamples).values([row(91), row(90.5), row(89.9), row(31), row(0)]);
    expect(await purgeExpiredQualitySamples(db, T0)).toBe(2);
    expect(
      (await stored())
        .map((r) => Math.round(((T0.getTime() - r.at.getTime()) / DAY) * 10) / 10)
        .sort(),
    ).toEqual([0, 31, 89.9]);
    expect(await purgeExpiredQualitySamples(db, T0)).toBe(0);
  });

  it("outlives the 30-day room purge: a sample of a room long gone stays for its 90 days", async () => {
    // No such room in `rooms` at all (purged at 30 days), and no foreign key to object.
    await db.insert(qualitySamples).values(row(45, "purged-room"));
    expect(await purgeExpiredQualitySamples(db, T0)).toBe(0);
    expect(await stored()).toHaveLength(1);
  });
});
