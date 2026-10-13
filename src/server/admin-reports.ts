/**
 * The admin's "recent reports" (CONTEXT.md, Problem report; ADR 4 addendum on problem reports):
 * the problem reports across rooms, newest first, each with the snapshots that belong to it. Like
 * ./admin.ts it takes the database and the caller explicitly and refuses anyone without the admin
 * role before reading anything; the /admin route guard is UX only.
 *
 * A report belongs to a snapshot (`snapshotId`): its own id when it started one, else the earlier
 * report's it reused. Its snapshots are the `report_snapshot` rows under that id (everyone's
 * answer to the ask) and under its own id (the reporter's, sent with it); where one person has
 * both, their own is the one shown.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { rooms, roomTimelineEvents } from "../db/schema/index.ts";
import {
  PROBLEM_CATEGORIES,
  type RecentReport,
  type ReportSnapshotEntry,
  reportSnapshot,
} from "../lib/problem-report.ts";
import type { RoomPerson } from "../lib/rooms.ts";
import { peopleByIds } from "./admin-quality.ts";
import { type Caller, requireAdmin } from "./caller.ts";

/** The most reports listed. Older ones are on their rooms' timelines. */
export const RECENT_REPORTS_LIMIT = 50;

export async function listRecentReports(
  db: Db,
  caller: Caller,
  limit = RECENT_REPORTS_LIMIT,
): Promise<{ reports: RecentReport[] }> {
  requireAdmin(caller);
  const rows = await db
    .select()
    .from(roomTimelineEvents)
    .where(eq(roomTimelineEvents.kind, "problem_report"))
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
          eq(roomTimelineEvents.kind, "report_snapshot"),
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
    const { reportId, ...rest } = row.details;
    const snapshot = reportSnapshot.safeParse(rest);
    return snapshot.success && typeof reportId === "string" && row.actorUserId
      ? [{ row, reportId, userId: row.actorUserId, snapshot: snapshot.data }]
      : [];
  });
  const people = await peopleByIds(
    db,
    [
      ...parsed.flatMap((p) => [p.row.actorUserId, p.row.targetUserId]),
      ...taken.map((t) => t.userId),
    ].filter((id): id is string => id !== null),
  );
  const named = (id: string): RoomPerson => people.get(id) ?? { id, username: id, image: null };
  const roomNames = new Map(roomRows.map((r) => [r.id, r.name]));

  return {
    reports: parsed.map(({ row, category, id, snapshotId, note, reused }) => {
      const reporterId = row.actorUserId ?? "";
      // One per person: their own, if they sent one with this report, else their answer.
      const byUser = new Map<string, ReportSnapshotEntry>();
      for (const t of taken) {
        if (t.row.roomId !== row.roomId) continue;
        const own = t.reportId === id;
        if (!own && t.reportId !== snapshotId) continue;
        if (!own && byUser.get(t.userId)?.own) continue;
        byUser.set(t.userId, {
          ...t.snapshot,
          user: named(t.userId),
          at: t.row.at.toISOString(),
          own,
        });
      }
      return {
        id,
        at: row.at.toISOString(),
        roomId: row.roomId,
        roomName: roomNames.get(row.roomId) ?? null,
        reporter: named(reporterId),
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
