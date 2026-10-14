/**
 * The admin's "recent reports" (CONTEXT.md, Problem report; ADR 4 addendum on problem reports):
 * the problem reports across rooms, newest first, each with the snapshots that belong to it. Like
 * ./admin.ts it takes the database and the caller explicitly and refuses anyone without the admin
 * role before reading anything; the /admin route guard is UX only.
 *
 * A report belongs to a snapshot (`snapshotId`): its own id when it started one, else the earlier
 * report's it reused. Its snapshots are the `report_snapshot` rows under that id (everyone's
 * answer to the ask) and under its own id (the reporter's, sent with it); where one person has
 * both, their own is the one shown. The people a snapshot names are resolved here, so the page
 * shows names and not ids.
 *
 * `listRoomReports` is the same read for one room, for its incident view (CONTEXT.md, Incident):
 * the recent list holds only the newest across all rooms, so a quiet room's older reports are
 * not in it.
 *
 * Three indexes keep each read off a scan of the table (src/db/schema/timeline.ts): `(kind, at)`
 * for the newest reports, `(room_id, at)` for one room's, and the `reportId` of the snapshot rows
 * for their lookup.
 */
import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { rooms, roomTimelineEvents } from "../db/schema/index.ts";
import {
  PROBLEM_CATEGORIES,
  type RecentReport,
  type ReportSnapshotEntry,
} from "../lib/problem-report.ts";
import { type ReportSnapshot, reportSnapshot } from "../lib/report-snapshot.ts";
import { type RoomPerson, roomIdInput } from "../lib/rooms.ts";
import { peopleByIds } from "./admin-quality.ts";
import { type Caller, requireAdmin } from "./caller.ts";

/** The most reports listed. Older ones are on their rooms' timelines. */
export const RECENT_REPORTS_LIMIT = 50;

/** A stored snapshot: whole, or cut for size (then only the browser is left, see `snapshotDetails`). */
type Stored =
  | { snapshot: ReportSnapshot; truncated: false }
  | { snapshot: null; browser: ReportSnapshot["browser"]; truncated: true };

function readSnapshot(details: Record<string, unknown>): Stored | undefined {
  const { reportId: _, ...rest } = details;
  const whole = reportSnapshot.safeParse(rest);
  if (whole.success) return { snapshot: whole.data, truncated: false };
  const browser = reportSnapshot.shape.browser.safeParse(rest.browser);
  return rest.truncated === true && browser.success
    ? { snapshot: null, browser: browser.data, truncated: true }
    : undefined;
}

export async function listRecentReports(
  db: Db,
  caller: Caller,
  limit = RECENT_REPORTS_LIMIT,
): Promise<{ reports: RecentReport[] }> {
  requireAdmin(caller);
  return readReports(db, undefined, limit);
}

/**
 * One room's reports, newest first, for the room timeline's incidents: the recent list is the
 * newest across all rooms, and holds none of a quiet room's older reports.
 */
export async function listRoomReports(
  db: Db,
  caller: Caller,
  input: { roomId: string },
  limit = RECENT_REPORTS_LIMIT,
): Promise<{ reports: RecentReport[] }> {
  requireAdmin(caller);
  const { roomId } = roomIdInput.parse(input);
  return readReports(db, eq(roomTimelineEvents.roomId, roomId), limit);
}

async function readReports(
  db: Db,
  scope: SQL | undefined,
  limit: number,
): Promise<{ reports: RecentReport[] }> {
  const rows = await db
    .select()
    .from(roomTimelineEvents)
    .where(and(eq(roomTimelineEvents.kind, "problem_report"), scope))
    .orderBy(desc(roomTimelineEvents.at), desc(roomTimelineEvents.id))
    .limit(limit);
  const parsed = rows.flatMap((row) => {
    const d = row.details;
    const category = PROBLEM_CATEGORIES.find((c) => c === d.category);
    if (!category || typeof d.reportId !== "string") return [];
    return [
      {
        row,
        category,
        id: d.reportId,
        snapshotId: typeof d.snapshot === "string" ? d.snapshot : d.reportId,
        note: typeof d.note === "string" ? d.note : null,
        reused: d.reused === true,
      },
    ];
  });
  if (parsed.length === 0) return { reports: [] };

  const ids = [...new Set(parsed.flatMap((p) => [p.id, p.snapshotId]))];
  const [snapshotRows, roomRows] = await Promise.all([
    db
      .select()
      .from(roomTimelineEvents)
      .where(
        and(
          // A literal, so the planner can match the partial index on the snapshot rows.
          sql`${roomTimelineEvents.kind} = 'report_snapshot'`,
          inArray(sql<string>`${roomTimelineEvents.details}->>'reportId'`, ids),
        ),
      )
      .orderBy(roomTimelineEvents.at, roomTimelineEvents.id),
    db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(inArray(rooms.id, [...new Set(parsed.map((p) => p.row.roomId))])),
  ]);
  const taken = snapshotRows.flatMap((row) => {
    const stored = readSnapshot(row.details);
    const reportId = row.details.reportId;
    return stored && typeof reportId === "string" && row.actorUserId
      ? [{ row, reportId, userId: row.actorUserId, stored }]
      : [];
  });
  const people = await peopleByIds(
    db,
    [
      ...parsed.flatMap((p) => [p.row.actorUserId, p.row.targetUserId]),
      ...taken.flatMap((t) => [
        t.userId,
        ...(t.stored.snapshot?.streams.flatMap((s) => [s.from, s.to]) ?? []),
        ...(t.stored.snapshot?.pairs.map((p) => p.peerId) ?? []),
      ]),
    ].filter((id): id is string => id !== null),
  );
  const named = (id: string): RoomPerson => people.get(id) ?? { id, username: id, image: null };
  const nameOf = (id: string) => named(id).username;
  const roomNames = new Map(roomRows.map((r) => [r.id, r.name]));

  const entry = (t: (typeof taken)[number], own: boolean): ReportSnapshotEntry => {
    const base = { user: named(t.userId), at: t.row.at.toISOString(), own };
    if (!t.stored.snapshot) {
      return { ...base, browser: t.stored.browser, streams: [], pairs: [], truncated: true };
    }
    const { browser, streams, pairs } = t.stored.snapshot;
    return {
      ...base,
      browser,
      streams: streams.map((s) => ({ ...s, fromName: nameOf(s.from), toName: nameOf(s.to) })),
      pairs: pairs.map((p) => ({ ...p, name: nameOf(p.peerId) })),
      truncated: false,
    };
  };

  return {
    reports: parsed.map(({ row, category, id, snapshotId, note, reused }) => {
      // One per person: their own, if they sent one with this report, else their answer.
      const byUser = new Map<string, ReportSnapshotEntry>();
      for (const t of taken) {
        if (t.row.roomId !== row.roomId) continue;
        const own = t.reportId === id;
        if (!own && t.reportId !== snapshotId) continue;
        if (!own && byUser.get(t.userId)?.own) continue;
        byUser.set(t.userId, entry(t, own));
      }
      return {
        id,
        at: row.at.toISOString(),
        roomId: row.roomId,
        roomName: roomNames.get(row.roomId) ?? null,
        reporter: named(row.actorUserId ?? ""),
        stream: row.targetUserId ? named(row.targetUserId) : null,
        category,
        note,
        snapshotId,
        reused,
        snapshots: [...byUser.values()].sort((a, b) => a.at.localeCompare(b.at)),
      };
    }),
  };
}
