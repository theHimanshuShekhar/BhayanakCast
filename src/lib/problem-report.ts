/**
 * Problem reports (CONTEXT.md; ADR 4 addendum on problem reports), shared by the client and the
 * server: what a person fills in (`reportProblemInput`), the limits, and what the admin's recent
 * reports list returns. The snapshot every browser sends is ./report-snapshot.ts, built by
 * ./snapshot-builder.ts.
 *
 * Free of browser and server code (relative imports with their extension).
 */
import { z } from "zod";
import { type ReportSnapshot, reportSnapshot, type SnapshotStream } from "./report-snapshot.ts";
import type { RoomPerson } from "./rooms.ts";

/** What can go wrong, as the form words it (`PROBLEM_CATEGORY_LABELS`). */
export const PROBLEM_CATEGORIES = [
  "blurry",
  "frozen",
  "no_audio",
  "cant_connect",
  "other",
] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];
export const PROBLEM_CATEGORY_LABELS: Record<ProblemCategory, string> = {
  blurry: "blurry",
  frozen: "frozen / stuttering",
  no_audio: "no audio",
  cant_connect: "can't connect",
  other: "other",
};

/** The longest note, after trimming, in UTF-16 code units (what an input's maxLength counts). */
export const PROBLEM_NOTE_MAX = 280;
/** One person's reports: at most one in this long (the server's clock). */
export const REPORT_PERSON_WINDOW_MS = 60_000;
/** The room's snapshot is taken at most once in this long; a report inside it reuses it. */
export const REPORT_SNAPSHOT_WINDOW_MS = 60_000;
/** A snapshot is taken for a report this long after it, at the latest (a slow or retried send). */
export const REPORT_SNAPSHOT_ACCEPT_MS = 2 * 60_000;

/**
 * The most a `problem_report` row's details may take as JSON. A cleaned note of 280 characters is
 * at most about 1 KB (three bytes a character, or two for a quote or backslash), and the ids and
 * category add 200 bytes, so this holds any report; if it is ever exceeded the row keeps
 * `PROBLEM_REPORT_KEEP` and loses the rest.
 */
export const MAX_REPORT_DETAILS_BYTES = 2 * 1024;
/** What ties a report to its snapshots and to the admin's list; it survives a cut. */
export const PROBLEM_REPORT_KEEP = ["reportId", "snapshot", "category", "reused"] as const;

/**
 * What the report form sends, and the server checks again. The note is trimmed, and a blank one
 * is none. The server also cleans it like any other detail (src/server/problem-report.ts).
 */
export const reportProblemInput = z.strictObject({
  roomId: z.string().min(1).max(64),
  category: z.enum(PROBLEM_CATEGORIES),
  note: z
    .string()
    .trim()
    .max(PROBLEM_NOTE_MAX)
    .transform((note) => note || undefined)
    .optional(),
  /** Whose stream it is about, when it was sent from that stream's quality modal. */
  streamUserId: z.string().min(1).max(64).optional(),
  /** The reporter's own snapshot, sent with the report. */
  snapshot: reportSnapshot,
});
export type ReportProblemInput = z.input<typeof reportProblemInput>;

// ---------------------------------------------------------------------------------------------
// The admin's "recent reports" (src/server/admin-reports.ts)

/** A stream of a snapshot with the two people named, as the admin reads it. */
export type NamedSnapshotStream = SnapshotStream & { fromName: string; toName: string };

/** One browser's snapshot for a report, with the people it names resolved. */
export type ReportSnapshotEntry = Omit<ReportSnapshot, "streams" | "pairs"> & {
  streams: NamedSnapshotStream[];
  pairs: { peerId: string; name: string; state: ReportSnapshot["pairs"][number]["state"] }[];
  user: RoomPerson;
  /** ISO time the browser took it. */
  at: string;
  /** The reporter's own, sent with the report, as against the answer to the ask. */
  own: boolean;
  /** The snapshot was too large to keep: only the browser's name is known. */
  truncated: boolean;
};

export interface RecentReport {
  /** The report's id (`details.reportId`). */
  id: string;
  /** ISO time. */
  at: string;
  roomId: string;
  /** Null once the room itself has been purged (its timeline is kept longer). */
  roomName: string | null;
  reporter: RoomPerson;
  /** Whose stream it is about, if it was sent from a stream's quality modal. */
  stream: RoomPerson | null;
  category: ProblemCategory;
  note: string | null;
  /** The snapshot it belongs to: its own id, or the earlier report's it reused. */
  snapshotId: string;
  reused: boolean;
  snapshots: ReportSnapshotEntry[];
}
