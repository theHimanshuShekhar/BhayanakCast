/**
 * The browser's half of a problem report's snapshot (./report-snapshot.ts): what this page's Mesh
 * shows now, as the schema holds it. Pure, so it is tested without a browser.
 */
import type { QualityView } from "./mesh.ts";
import type { STEP_REASONS } from "./quality-reason.ts";
import {
  type ReportSnapshot,
  SNAPSHOT_MAX_PAIRS,
  SNAPSHOT_MAX_STREAMS,
  type SnapshotPairState,
  type SnapshotStream,
} from "./report-snapshot.ts";

/** A reading older than this is not "now": the stream stopped, or the page is catching up. */
export const SNAPSHOT_FRESH_MS = 8_000;

/** What `buildSnapshot` reads. */
export interface SnapshotSource {
  meId: string;
  /** The quality modal's views (`Mesh.streamQuality`): one per peer's share, and this page's own. */
  views: readonly QualityView[];
  /** Every pair this browser has, with its state (`Mesh.peers`). */
  peers: readonly { userId: string; state: SnapshotPairState }[];
  browser: ReportSnapshot["browser"];
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

/**
 * Answer the server's `snapshot.request` for `reportId`: build the snapshot and hand it to `add`
 * (the connection events' queue). Nobody on this page asked for it, so whatever goes wrong is
 * swallowed: it must reach neither the console nor the UI, nor the socket listeners after this
 * one. The server just has one snapshot fewer for the report.
 */
export function answerSnapshotRequest(
  reportId: string,
  build: () => ReportSnapshot,
  add: (event: { kind: "report_snapshot"; reportId: string } & ReportSnapshot) => void,
): void {
  try {
    add({ kind: "report_snapshot", reportId, ...build() });
  } catch {
    // Silent by design.
  }
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
