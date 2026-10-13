/**
 * Problem reports (CONTEXT.md; ADR 4 addendum on problem reports), shared by the client and the
 * server: what a person fills in (`reportProblemInput`), and the snapshot every browser in the
 * room sends of its own connections when one is made (`ReportSnapshot`, `buildSnapshot`).
 *
 * A snapshot holds what the quality modal shows of each stream this browser sends or receives
 * (step, its cap, bitrate, resolution, fps, loss, round trip, path, reason), each pair's
 * connection state, and the browser's name and major version. Peers are user ids; there is no
 * device label, no address and no free text in it, and every field is bounded, because the server
 * stores what arrives (src/server/problem-report.ts, src/server/connection-events.ts).
 *
 * Free of browser and server code (relative imports with their extension), so the connection
 * events schema can include the snapshot.
 */
import { z } from "zod";
import type { QualityView } from "./mesh.ts";
import { STEP_REASONS } from "./quality-reason.ts";
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
/** The most a snapshot may take as a timeline row's details. A room's worth of streams and pairs. */
export const MAX_SNAPSHOT_DETAILS_BYTES = 8 * 1024;
/** The most a snapshot may hold: a full room's pairs, and the streams of the 3 sharers. */
export const SNAPSHOT_MAX_PAIRS = 16;
export const SNAPSHOT_MAX_STREAMS = 32;

const userId = z.string().min(1).max(64);
const pairState = z.enum(["connecting", "connected", "relayed", "failed"]);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const finite = z.number().min(0).max(1e12);

/** One stream between two people: what the quality modal shows of it, as far as it was known. */
const snapshotStream = z.strictObject({
  /** The streamer and the viewer. One of them is the browser that sends the snapshot. */
  from: userId,
  to: userId,
  /** The step the sender is on (`1080p30`), its `maxBitrate`, and why (the five reasons). */
  step: z.string().min(1).max(32).optional(),
  cap: count.optional(),
  reason: z.enum(STEP_REASONS).optional(),
  /** `direct`, or `relay · UDP`. */
  path: z.string().min(1).max(32).optional(),
  /** How old the numbers below are; absent with them when no reading was recent. */
  ageMs: count.optional(),
  bps: count.optional(),
  width: count.optional(),
  height: count.optional(),
  fps: finite.optional(),
  codec: z.string().min(1).max(24).optional(),
  loss: z.number().min(0).max(1).optional(),
  rttMs: finite.optional(),
  freezes: count.optional(),
});
export type SnapshotStream = z.infer<typeof snapshotStream>;

/** What a browser sends of itself when a problem is reported (see the module comment). */
export const reportSnapshot = z.strictObject({
  browser: z.strictObject({
    name: z.enum(["chrome", "edge", "firefox", "safari", "other"]),
    /** The major version, digits only; empty when unknown. */
    version: z.string().regex(/^\d{0,4}$/),
  }),
  streams: z.array(snapshotStream).max(SNAPSHOT_MAX_STREAMS),
  pairs: z.array(z.strictObject({ peerId: userId, state: pairState })).max(SNAPSHOT_MAX_PAIRS),
});
export type ReportSnapshot = z.infer<typeof reportSnapshot>;

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
  streamUserId: userId.optional(),
  /** The reporter's own snapshot, sent with the report. */
  snapshot: reportSnapshot,
});
export type ReportProblemInput = z.input<typeof reportProblemInput>;

// ---------------------------------------------------------------------------------------------
// The admin's "recent reports" (src/server/admin-reports.ts)

/** One browser's snapshot for a report. */
export type ReportSnapshotEntry = ReportSnapshot & {
  user: RoomPerson;
  /** ISO time the browser took it. */
  at: string;
  /** The reporter's own, sent with the report, as against the answer to the ask. */
  own: boolean;
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

// ---------------------------------------------------------------------------------------------
// The snapshot builder

/** A reading older than this is not "now": the stream stopped, or the page is catching up. */
export const SNAPSHOT_FRESH_MS = 8_000;

/** What `buildSnapshot` reads. */
export interface SnapshotSource {
  meId: string;
  /** The quality modal's views (`Mesh.streamQuality`): one per peer's share, and this page's own. */
  views: readonly QualityView[];
  /** Every pair this browser has, with its state (`Mesh.peers`). */
  peers: readonly { userId: string; state: z.infer<typeof pairState> }[];
  browser: z.infer<typeof reportSnapshot>["browser"];
  /** Epoch milliseconds, on the clock of the readings. */
  now: number;
}

/**
 * The snapshot of this browser: each stream it sends or receives that has a step from the
 * streamer or a recent reading (the numbers only while the reading is recent, as the modal does),
 * and each pair's state.
 */
export function buildSnapshot({
  meId,
  views,
  peers,
  browser,
  now,
}: SnapshotSource): ReportSnapshot {
  const streams: SnapshotStream[] = [];
  for (const view of views) {
    if (view.side === "viewer") {
      const stream = streamOf(view.userId, meId, view.note, view.path, view.points, now);
      if (stream) streams.push(stream);
    } else {
      for (const row of view.viewers) {
        const stream = streamOf(meId, row.userId, row.note, row.path, row.points, now);
        if (stream) streams.push(stream);
      }
    }
  }
  return {
    browser,
    streams: streams.slice(0, SNAPSHOT_MAX_STREAMS),
    pairs: peers
      .slice(0, SNAPSHOT_MAX_PAIRS)
      .map(({ userId: peerId, state }) => ({ peerId, state })),
  };
}

type Points = Extract<QualityView, { side: "viewer" }>["points"];

function streamOf(
  from: string,
  to: string,
  note: { step: string; maxBitrate: number; reason: (typeof STEP_REASONS)[number] } | undefined,
  path: string | undefined,
  points: Points,
  now: number,
): SnapshotStream | undefined {
  const last = points.at(-1);
  const recent = last && now - last.at <= SNAPSHOT_FRESH_MS ? last : undefined;
  if (!note && !recent) return undefined;
  return {
    from,
    to,
    ...(note && { step: note.step, cap: note.maxBitrate, reason: note.reason }),
    ...(path && { path }),
    ...(recent && {
      ageMs: Math.max(0, Math.round(now - recent.at)),
      ...(recent.bps !== undefined && { bps: Math.round(recent.bps) }),
      ...(recent.width !== undefined && { width: recent.width }),
      ...(recent.height !== undefined && { height: recent.height }),
      ...(recent.fps !== undefined && { fps: Math.round(recent.fps) }),
      ...(recent.codec && { codec: recent.codec.replace(/^video\//i, "").slice(0, 24) }),
      ...(recent.loss !== undefined && { loss: Math.round(recent.loss * 10_000) / 10_000 }),
      ...(recent.rttMs !== undefined && { rttMs: Math.round(recent.rttMs) }),
      ...(recent.freezes !== undefined && { freezes: recent.freezes }),
    }),
  };
}

/** The browser's name and major version from its user agent; anything unknown is `other`. */
export function browserOf(userAgent: string): ReportSnapshot["browser"] {
  const find = (re: RegExp) => re.exec(userAgent)?.[1] ?? "";
  if (/Edg(?:e|A|iOS)?\//.test(userAgent)) {
    return { name: "edge", version: find(/Edg(?:e|A|iOS)?\/(\d+)/) };
  }
  if (/Firefox\//.test(userAgent)) return { name: "firefox", version: find(/Firefox\/(\d+)/) };
  if (/Chrome\//.test(userAgent)) return { name: "chrome", version: find(/Chrome\/(\d+)/) };
  if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) {
    return { name: "safari", version: find(/Version\/(\d+)/) };
  }
  return { name: "other", version: "" };
}
