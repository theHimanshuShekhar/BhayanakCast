import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { ZodError } from "zod";
import type { Db } from "../db/client.ts";
import { presenceIntervals, rooms, roomTimelineEvents, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  PROBLEM_NOTE_MAX,
  REPORT_PERSON_WINDOW_MS,
  REPORT_SNAPSHOT_WINDOW_MS,
  type ReportProblemInput,
  type ReportSnapshot,
} from "../lib/problem-report.ts";
import { type Caller, SignInRequiredError } from "./caller.ts";
import { FakeClock } from "./clock.ts";
import { ProblemReportService } from "./problem-report.ts";
import { ReportSnapshots } from "./report-snapshots.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

// A problem report (#117) is taken only from someone in the live room, once a minute per person;
// it goes on the room timeline with the reporter's own snapshot, and the room is asked for theirs
// at most once a minute, a second report inside it pointing at the first.

const T0 = new Date("2026-10-14T12:00:00Z");
const asUser = (id: string): Caller => ({ user: { id, username: id, image: null }, role: "user" });
const visitor: Caller = { user: null, role: "visitor" };
const snapshot: ReportSnapshot = {
  browser: { name: "firefox", version: "130" },
  streams: [],
  pairs: [{ peerId: "bo", state: "connected" }],
};

let db: Db;
let close: () => Promise<void>;
let clock: FakeClock;
let logs: CapturedLogs;
let ask: Mock<(roomId: string, snapshotId: string, exceptUserId: string) => void>;
let ids: number;
let service: ProblemReportService;

beforeEach(async () => {
  logs = captureLogs();
  ({ db, close } = await createTestDb());
  clock = new FakeClock(T0);
  ask = vi.fn();
  ids = 0;
  service = new ProblemReportService({
    db,
    clock,
    snapshots: new ReportSnapshots(),
    ask,
    newId: () => `rep-${++ids}`,
  });
  await db
    .insert(user)
    .values(["ana", "bo", "cy", "dee"].map((id) => ({ id, name: id, email: `${id}@x.invalid` })));
  await db.insert(rooms).values([
    { id: "r1", name: "live", kind: "gaming", createdAt: T0 },
    { id: "r2", name: "other", kind: "gaming", createdAt: T0 },
    { id: "r3", name: "over", kind: "code", createdAt: T0, endedAt: T0 },
  ]);
  await db.insert(presenceIntervals).values([
    { roomId: "r1", userId: "ana", startedAt: T0, lastSeenAt: T0 },
    { roomId: "r1", userId: "bo", startedAt: T0, lastSeenAt: T0 },
    // Left: not in the room any more.
    { roomId: "r1", userId: "cy", startedAt: T0, endedAt: T0, lastSeenAt: T0 },
    { roomId: "r2", userId: "bo", startedAt: T0, lastSeenAt: T0 },
    { roomId: "r3", userId: "ana", startedAt: T0, endedAt: T0, lastSeenAt: T0 },
  ]);
});

afterEach(async () => {
  logs.restore();
  await close();
});

const input = (extra: Partial<ReportProblemInput> = {}): ReportProblemInput => ({
  roomId: "r1",
  category: "blurry",
  snapshot,
  ...extra,
});
const stored = () => db.select().from(roomTimelineEvents).orderBy(asc(roomTimelineEvents.id));
const ofKind = (kind: "problem_report" | "report_snapshot") =>
  db.select().from(roomTimelineEvents).where(eq(roomTimelineEvents.kind, kind));

describe("recording a report", () => {
  it("puts it on the room timeline: the reporter as actor, the stream's owner as target, with the category and note", async () => {
    const result = await service.report(
      asUser("ana"),
      input({ streamUserId: "bo", note: " too  soft " }),
    );
    expect(result).toEqual({ status: "sent", snapshotId: "rep-1", reused: false });
    const [report] = await ofKind("problem_report");
    expect(report).toMatchObject({
      roomId: "r1",
      kind: "problem_report",
      actorUserId: "ana",
      targetUserId: "bo",
      at: T0,
      details: { reportId: "rep-1", category: "blurry", note: "too soft", snapshot: "rep-1" },
    });
  });

  it("stores the reporter's own snapshot with it, tied to the report by id", async () => {
    await service.report(asUser("ana"), input());
    const [row] = await ofKind("report_snapshot");
    expect(row).toMatchObject({
      roomId: "r1",
      actorUserId: "ana",
      targetUserId: null,
      details: { reportId: "rep-1", ...snapshot },
    });
  });

  it("needs no stream and no note", async () => {
    await service.report(asUser("ana"), input());
    const [report] = await ofKind("problem_report");
    expect(report?.targetUserId).toBeNull();
    expect(report?.details).not.toHaveProperty("note");
  });

  it("cleans the note like any other detail: no address, no device id, on one line", async () => {
    await service.report(
      asUser("ana"),
      input({ note: "bo at 10.0.0.7 on 0123456789abcdef0123\nfroze" }),
    );
    const [report] = await ofKind("problem_report");
    expect(report?.details).toMatchObject({ note: "bo at [ip] on [id] froze" });
  });

  it("leaves the stream out when its owner isn't in the room", async () => {
    await service.report(asUser("ana"), input({ streamUserId: "cy" }));
    const [report] = await ofKind("problem_report");
    expect(report?.targetUserId).toBeNull();
  });

  it("logs the timeline row like the other events", async () => {
    await service.report(asUser("ana"), input());
    expect(logs.find("timeline.problem_report")).toMatchObject({ roomId: "r1", userId: "ana" });
  });
});

describe("who may report", () => {
  it("refuses a visitor", async () => {
    await expect(service.report(visitor, input())).rejects.toBeInstanceOf(SignInRequiredError);
    expect(await stored()).toEqual([]);
  });

  it("refuses someone who isn't in the room, who has left it, and a room that ended", async () => {
    for (const [who, roomId] of [
      ["dee", "r1"],
      ["cy", "r1"],
      ["ana", "r2"],
      ["ana", "r3"],
    ] as const) {
      expect(await service.report(asUser(who), input({ roomId }))).toEqual({
        status: "not_in_room",
      });
    }
    expect(await stored()).toEqual([]);
    expect(ask).not.toHaveBeenCalled();
    expect(logs.all("problem.dropped").map((l) => [l.reason, l.userId])).toEqual([
      ["not_in_room", "dee"],
      ["not_in_room", "cy"],
      ["not_in_room", "ana"],
      ["not_in_room", "ana"],
    ]);
  });

  it("refuses an oversized note, and a category that isn't one of the five", async () => {
    const tooLong = "x".repeat(PROBLEM_NOTE_MAX + 1);
    await expect(service.report(asUser("ana"), input({ note: tooLong }))).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      service.report(asUser("ana"), input({ category: "laggy" as "blurry" })),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await stored()).toEqual([]);
    expect(logs.all("problem.dropped").map((l) => l.reason)).toEqual(["invalid", "invalid"]);
  });

  it("takes a note of exactly the limit", async () => {
    const note = "x".repeat(PROBLEM_NOTE_MAX);
    await service.report(asUser("ana"), input({ note }));
    const [report] = await ofKind("problem_report");
    expect(report?.details).toMatchObject({ note });
  });
});

describe("one report per person per minute", () => {
  it("refuses a second inside the minute, says how long to wait, and stores nothing for it", async () => {
    await service.report(asUser("ana"), input());
    clock.advance(20_000);
    expect(await service.report(asUser("ana"), input({ category: "frozen" }))).toEqual({
      status: "too_soon",
      retryInMs: REPORT_PERSON_WINDOW_MS - 20_000,
    });
    expect(await ofKind("problem_report")).toHaveLength(1);
    expect(logs.find("problem.dropped")).toMatchObject({ reason: "over_limit", userId: "ana" });
  });

  it("takes the next one once the minute is over, and counts each person on their own", async () => {
    await service.report(asUser("ana"), input());
    expect((await service.report(asUser("bo"), input())).status).toBe("sent");
    clock.advance(REPORT_PERSON_WINDOW_MS);
    expect((await service.report(asUser("ana"), input())).status).toBe("sent");
    expect(await ofKind("problem_report")).toHaveLength(3);
  });

  it("counts across rooms: it is the person's limit", async () => {
    await service.report(asUser("bo"), input({ roomId: "r1" }));
    expect((await service.report(asUser("bo"), input({ roomId: "r2" }))).status).toBe("too_soon");
  });

  it("is not used up by a refusal for not being in the room, or by an invalid form", async () => {
    await service.report(asUser("dee"), input());
    await expect(
      service.report(asUser("ana"), input({ category: "x" as "blurry" })),
    ).rejects.toThrow();
    expect((await service.report(asUser("ana"), input())).status).toBe("sent");
    expect((await service.report(asUser("dee"), input())).status).toBe("not_in_room");
  });

  it("gives the allowance back when the write fails, so the retry goes through", async () => {
    const failing = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await expect(service.report(asUser("ana"), input())).rejects.toThrow("db down");
    failing.mockRestore();
    expect(logs.find("timeline.write_failed")).toMatchObject({ roomId: "r1", userId: "ana" });
    expect((await service.report(asUser("ana"), input())).status).toBe("sent");
  });
});

describe("the everyone-snapshot", () => {
  it("is asked for once, from everyone but the reporter, for the first report", async () => {
    await service.report(asUser("ana"), input());
    expect(ask).toHaveBeenCalledExactlyOnceWith("r1", "rep-1", "ana");
  });

  it("is not asked for again inside the minute: a second report is recorded and points at the first", async () => {
    await service.report(asUser("ana"), input());
    clock.advance(REPORT_SNAPSHOT_WINDOW_MS - 1);
    const second = await service.report(asUser("bo"), input({ category: "no_audio" }));
    expect(second).toEqual({ status: "sent", snapshotId: "rep-1", reused: true });
    expect(ask).toHaveBeenCalledTimes(1);
    const reports = await ofKind("problem_report");
    expect(reports.map((r) => r.details)).toMatchObject([
      { reportId: "rep-1", category: "blurry", snapshot: "rep-1" },
      { reportId: "rep-2", category: "no_audio", snapshot: "rep-1", reused: true },
    ]);
    // The second reporter's own snapshot is still theirs, under their report.
    const own = (await ofKind("report_snapshot")).map((r) => [r.actorUserId, r.details.reportId]);
    expect(own).toEqual([
      ["ana", "rep-1"],
      ["bo", "rep-2"],
    ]);
  });

  it("is asked for again for a report after the minute, and not for another room's report's sake", async () => {
    await service.report(asUser("ana"), input());
    await service.report(asUser("bo"), input({ roomId: "r2" }));
    expect(ask.mock.calls).toEqual([
      ["r1", "rep-1", "ana"],
      ["r2", "rep-2", "bo"],
    ]);
    clock.advance(REPORT_SNAPSHOT_WINDOW_MS);
    await service.report(asUser("ana"), input());
    expect(ask).toHaveBeenLastCalledWith("r1", "rep-3", "ana");
  });

  it("is not asked for by a report that is refused", async () => {
    await service.report(asUser("dee"), input());
    await service.report(asUser("ana"), input());
    await service.report(asUser("ana"), input());
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
