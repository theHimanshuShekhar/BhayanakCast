import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { rooms, roomTimelineEvents, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import type { ReportSnapshot } from "../lib/report-snapshot.ts";
import { listRecentReports, RECENT_REPORTS_LIMIT } from "./admin-reports.ts";
import { AdminRequiredError, type Caller } from "./caller.ts";

// The admin's "recent reports" (#117): problem reports across rooms, newest first, each with the
// snapshots that belong to it. Admins only.

const MIN = 60_000;
const T0 = Date.parse("2026-10-14T10:00:00Z");
const at = (m: number) => new Date(T0 + m * MIN);

const admin: Caller = { user: { id: "admin", username: "admin_jpg", image: null }, role: "admin" };
const plain: Caller = { user: { id: "ana", username: "ana", image: null }, role: "user" };
const visitor: Caller = { user: null, role: "visitor" };

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db
    .insert(user)
    .values(
      ["admin", "ana", "bo", "cy"].map((id) => ({ id, name: id, email: `${id}@discord.invalid` })),
    );
  await db.insert(rooms).values([
    { id: "r1", name: "room one" },
    { id: "r2", name: "room two" },
  ]);
});

afterEach(async () => {
  await close();
});

const snap = (browser: string): ReportSnapshot => ({
  browser: { name: browser as "chrome", version: "126" },
  streams: [{ from: "bo", to: "ana", step: "720p30", reason: "shared" }],
  pairs: [{ peerId: "bo", state: "connected" }],
});

type Row = typeof roomTimelineEvents.$inferInsert;
const report = (
  roomId: string,
  m: number,
  by: string,
  reportId: string,
  extra: Record<string, unknown> = {},
  target: string | null = null,
): Row => ({
  roomId,
  at: at(m),
  kind: "problem_report",
  actorUserId: by,
  targetUserId: target,
  details: { reportId, category: "blurry", snapshot: reportId, ...extra },
});
const snapshot = (
  roomId: string,
  m: number,
  by: string,
  reportId: string,
  browser = "chrome",
): Row => ({
  roomId,
  at: at(m),
  kind: "report_snapshot",
  actorUserId: by,
  targetUserId: null,
  details: { reportId, ...snap(browser) },
});

describe("recent reports", () => {
  it("lists reports across rooms, newest first, with the room, reporter, stream, category, note and time", async () => {
    await db
      .insert(roomTimelineEvents)
      .values([
        report("r1", 0, "ana", "rep-1", { category: "frozen", note: "stuck at 3 fps" }, "bo"),
        report("r2", 5, "bo", "rep-2", { category: "no_audio" }),
      ]);
    const { reports } = await listRecentReports(db, admin);
    expect(reports.map((r) => r.id)).toEqual(["rep-2", "rep-1"]);
    expect(reports[1]).toMatchObject({
      id: "rep-1",
      at: at(0).toISOString(),
      roomId: "r1",
      roomName: "room one",
      reporter: { id: "ana", username: "ana" },
      stream: { id: "bo", username: "bo" },
      category: "frozen",
      note: "stuck at 3 fps",
      reused: false,
    });
    expect(reports[0]).toMatchObject({ roomName: "room two", stream: null, note: null });
  });

  it("brings each report the snapshots from both browsers", async () => {
    await db.insert(roomTimelineEvents).values([
      report("r1", 0, "ana", "rep-1"),
      snapshot("r1", 0, "ana", "rep-1", "chrome"),
      snapshot("r1", 0.1, "bo", "rep-1", "firefox"),
      // Another report's snapshot, and another room's, are not this report's.
      snapshot("r1", 0.1, "cy", "rep-9"),
    ]);
    const [only] = (await listRecentReports(db, admin)).reports;
    expect(only?.snapshots.map((s) => [s.user.username, s.browser.name])).toEqual([
      ["ana", "chrome"],
      ["bo", "firefox"],
    ]);
    expect(only?.snapshots[1]).toMatchObject({
      streams: [{ from: "bo", to: "ana", step: "720p30" }],
      pairs: [{ peerId: "bo", state: "connected" }],
    });
  });

  it("names the people a snapshot mentions, so the page shows names and not ids", async () => {
    await db
      .insert(roomTimelineEvents)
      .values([report("r1", 0, "ana", "rep-1"), snapshot("r1", 0, "ana", "rep-1", "chrome")]);
    const [only] = (await listRecentReports(db, admin)).reports;
    expect(only?.snapshots[0]).toMatchObject({
      streams: [{ from: "bo", fromName: "bo", to: "ana", toName: "ana" }],
      pairs: [{ peerId: "bo", name: "bo", state: "connected" }],
    });
  });

  it("falls back to the id for an account that has since been deleted", async () => {
    await db.insert(roomTimelineEvents).values([
      report("r1", 0, "ana", "rep-1"),
      {
        ...snapshot("r1", 0, "ana", "rep-1"),
        details: {
          reportId: "rep-1",
          ...snap("chrome"),
          pairs: [{ peerId: "gone-user", state: "failed" }],
        },
      },
    ]);
    const [only] = (await listRecentReports(db, admin)).reports;
    expect(only?.snapshots[0]?.pairs).toEqual([
      { peerId: "gone-user", name: "gone-user", state: "failed" },
    ]);
  });

  it("lists a snapshot cut for size by its browser alone, marked as cut", async () => {
    await db.insert(roomTimelineEvents).values([
      report("r1", 0, "ana", "rep-1"),
      {
        roomId: "r1",
        at: at(0),
        kind: "report_snapshot",
        actorUserId: "bo",
        targetUserId: null,
        details: {
          truncated: true,
          reportId: "rep-1",
          browser: { name: "firefox", version: "130" },
        },
      },
    ]);
    const [only] = (await listRecentReports(db, admin)).reports;
    expect(only?.snapshots).toMatchObject([
      {
        user: { username: "bo" },
        browser: { name: "firefox" },
        streams: [],
        pairs: [],
        truncated: true,
      },
    ]);
  });

  it("still lists a report whose row was cut for size, by the ids it kept", async () => {
    await db.insert(roomTimelineEvents).values({
      roomId: "r1",
      at: at(0),
      kind: "problem_report",
      actorUserId: "ana",
      targetUserId: null,
      details: { truncated: true, reportId: "rep-1", snapshot: "rep-1", category: "frozen" },
    });
    const [only] = (await listRecentReports(db, admin)).reports;
    expect(only).toMatchObject({ id: "rep-1", category: "frozen", note: null });
  });

  it("points a report that reused the room's snapshot at the earlier one, and keeps the reporter's own", async () => {
    await db
      .insert(roomTimelineEvents)
      .values([
        report("r1", 0, "ana", "rep-1"),
        snapshot("r1", 0, "ana", "rep-1", "chrome"),
        snapshot("r1", 0.1, "bo", "rep-1", "firefox"),
        report("r1", 0.5, "bo", "rep-2", { snapshot: "rep-1", reused: true, category: "other" }),
        snapshot("r1", 0.5, "bo", "rep-2", "firefox"),
      ]);
    const { reports } = await listRecentReports(db, admin);
    const second = reports.find((r) => r.id === "rep-2");
    expect(second).toMatchObject({ snapshotId: "rep-1", reused: true });
    // The earlier snapshot's browsers, with bo's own (at the time of his report) in place of his
    // answer to the ask.
    expect(second?.snapshots.map((s) => [s.user.username, s.own])).toEqual([
      ["ana", false],
      ["bo", true],
    ]);
  });

  it("lists a report with no snapshots at all, and leaves out a snapshot that isn't valid", async () => {
    await db.insert(roomTimelineEvents).values([
      report("r1", 0, "ana", "rep-1"),
      {
        roomId: "r1",
        at: at(0),
        kind: "report_snapshot",
        actorUserId: "bo",
        targetUserId: null,
        details: { reportId: "rep-1", browser: "not an object" },
      },
    ]);
    const [only] = (await listRecentReports(db, admin)).reports;
    expect(only).toMatchObject({ id: "rep-1", snapshots: [] });
  });

  it("is bounded", async () => {
    await db
      .insert(roomTimelineEvents)
      .values(
        Array.from({ length: RECENT_REPORTS_LIMIT + 5 }, (_, i) =>
          report("r1", i, "ana", `rep-${i}`),
        ),
      );
    const { reports } = await listRecentReports(db, admin);
    expect(reports).toHaveLength(RECENT_REPORTS_LIMIT);
    expect(reports[0]?.id).toBe(`rep-${RECENT_REPORTS_LIMIT + 4}`);
  });

  it("is backed by indexes, so each poll doesn't scan the whole timeline table", async () => {
    const found = (await db.execute(
      sql`select indexname, indexdef from pg_indexes where tablename = 'room_timeline_events'`,
    )) as unknown as { rows: { indexname: string; indexdef: string }[] };
    const defs = Object.fromEntries(found.rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs.room_timeline_events_kind_at_idx).toContain("(kind, at)");
    expect(defs.room_timeline_events_snapshot_report_idx).toMatch(/\(details ->> 'reportId'/);
    expect(defs.room_timeline_events_snapshot_report_idx).toContain("report_snapshot");
  });

  it("lists nothing when there are no reports", async () => {
    expect((await listRecentReports(db, admin)).reports).toEqual([]);
  });

  it("is for admins only: a user and a visitor are refused before anything is read", async () => {
    await db.insert(roomTimelineEvents).values(report("r1", 0, "ana", "rep-1"));
    await expect(listRecentReports(db, plain)).rejects.toBeInstanceOf(AdminRequiredError);
    await expect(listRecentReports(db, visitor)).rejects.toBeInstanceOf(AdminRequiredError);
  });
});
