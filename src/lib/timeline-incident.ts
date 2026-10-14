/**
 * The incident view's snapshot (CONTEXT.md, Problem report; issue #114): the browsers' snapshots
 * of a report folded into one row per stream, then one per pair nobody streams over. Each stream
 * is seen from two ends (the streamer's browser and the viewer's, and either may not have sent
 * one), so a row takes the streamer's word for the step it chose and why, and the viewer's for
 * what arrived. Pure; the table is components/room-timeline-incident.tsx.
 */
import type { NamedSnapshotStream, RecentReport } from "./problem-report";
import type { SnapshotPairState } from "./report-snapshot";

/** Loss over this, as a fraction, is trouble. The quality modal calls anything above it poor. */
export const TROUBLE_LOSS = 0.02;

/** A stream's pair, to open in the quality panel: the quality link of a snapshot row. */
export interface QualityFocus {
  streamerId: string;
  viewerId: string;
}

export interface SnapshotRow {
  /** `streamer>viewer`, or the two ids in order for an idle pair. */
  key: string;
  streamerId: string;
  viewerId: string;
  streamer: string;
  viewer: string;
  /** Nobody streams between these two: a pair that is only connected. */
  idle: boolean;
  step?: string;
  cap?: number;
  reason?: NamedSnapshotStream["reason"];
  path?: string;
  bps?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  /** A fraction. */
  loss?: number;
  rttMs?: number;
  freezes?: number;
  /** The worse of what the two ends say of the connection between them. */
  pair?: SnapshotPairState;
  /** The pair is not up, packets are being lost, or the picture is frozen. */
  trouble: boolean;
  /** How many browsers reported this stream. */
  reports: number;
}

const PAIR_RANK: Record<SnapshotPairState, number> = {
  connected: 0,
  relayed: 1,
  connecting: 2,
  failed: 3,
};

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const STREAMER_FIELDS = ["step", "cap", "reason"] as const;
const READING_FIELDS = [
  "path",
  "bps",
  "width",
  "height",
  "fps",
  "codec",
  "loss",
  "rttMs",
  "freezes",
] as const;

/** The rows of a report's snapshots: its streams first, then its idle pairs. */
export function snapshotRows(report: Pick<RecentReport, "snapshots">): SnapshotRow[] {
  const snapshots = report.snapshots.filter((s) => !s.truncated);

  // What each end says of the connection between each two people.
  const pairs = new Map<string, SnapshotPairState>();
  const names = new Map<string, string>();
  for (const s of snapshots) {
    names.set(s.user.id, s.user.username);
    for (const p of s.pairs) {
      names.set(p.peerId, p.name);
      const key = pairKey(s.user.id, p.peerId);
      const seen = pairs.get(key);
      if (seen === undefined || PAIR_RANK[p.state] > PAIR_RANK[seen]) pairs.set(key, p.state);
    }
  }

  const streams = new Map<
    string,
    { sent?: NamedSnapshotStream; received?: NamedSnapshotStream; n: number }
  >();
  for (const s of snapshots) {
    for (const st of s.streams) {
      const key = `${st.from}>${st.to}`;
      const seen = streams.get(key) ?? { n: 0 };
      // A snapshot of the streamer's own browser is the sender's end; the viewer's, the receiver's.
      if (s.user.id === st.from) seen.sent = st;
      else seen.received = st;
      seen.n++;
      streams.set(key, seen);
    }
  }

  const rows: SnapshotRow[] = [];
  for (const [key, { sent, received, n }] of streams) {
    const first = (sent ?? received) as NamedSnapshotStream;
    const row: SnapshotRow = {
      key,
      streamerId: first.from,
      viewerId: first.to,
      streamer: first.fromName,
      viewer: first.toName,
      idle: false,
      pair: pairs.get(pairKey(first.from, first.to)),
      trouble: false,
      reports: n,
    };
    for (const f of STREAMER_FIELDS) {
      const v = sent?.[f] ?? received?.[f];
      if (v !== undefined) Object.assign(row, { [f]: v });
    }
    for (const f of READING_FIELDS) {
      const v = received?.[f] ?? sent?.[f];
      if (v !== undefined) Object.assign(row, { [f]: v });
    }
    row.trouble =
      row.pair === "connecting" ||
      row.pair === "failed" ||
      (row.loss ?? 0) > TROUBLE_LOSS ||
      row.fps === 0;
    rows.push(row);
  }

  const streamed = new Set(rows.map((r) => pairKey(r.streamerId, r.viewerId)));
  for (const [key, pair] of pairs) {
    if (streamed.has(key)) continue;
    const [a, b] = key.split("|") as [string, string];
    rows.push({
      key,
      streamerId: a,
      viewerId: b,
      streamer: names.get(a) ?? a,
      viewer: names.get(b) ?? b,
      idle: true,
      pair,
      trouble: pair === "connecting" || pair === "failed",
      reports: 0,
    });
  }
  // Streams first, in the order they were reported; idle pairs after.
  return [...rows.filter((r) => !r.idle), ...rows.filter((r) => r.idle)];
}
