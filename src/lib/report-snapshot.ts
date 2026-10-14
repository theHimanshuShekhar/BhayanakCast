/**
 * The snapshot a browser sends of its own connections when a problem is reported (CONTEXT.md,
 * Problem report; ADR 4 addendum on problem reports), as a schema shared by the client, the
 * server and the connection events (./connection-events.ts, which carries it as `report_snapshot`).
 *
 * It holds what the quality modal shows of each stream this browser sends or receives (step, its
 * cap, bitrate, resolution, fps, loss, round trip, path, reason), each pair's connection state,
 * and the browser's name and major version. Peers are user ids; there is no device label, no
 * address and no free text in it, and every field is bounded, because the server stores what
 * arrives. The browser side that fills it is ./snapshot-builder.ts.
 *
 * Free of browser and server code (relative imports with their extension).
 */
import { z } from "zod";
import { STEP_REASONS } from "./quality-reason.ts";

/** The most a snapshot may take as a timeline row's details. A room's worth of streams and pairs. */
export const MAX_SNAPSHOT_DETAILS_BYTES = 8 * 1024;
/** What a snapshot row keeps if it is cut: the report it answers and the browser. */
export const SNAPSHOT_KEEP = ["reportId", "browser"] as const;
/** The most a snapshot may hold: a full room's pairs, and the streams of the 3 sharers. */
export const SNAPSHOT_MAX_PAIRS = 16;
export const SNAPSHOT_MAX_STREAMS = 32;

/**
 * The id that ties a snapshot to its report: the `snapshot.request` the server sends names it,
 * and the browser's `report_snapshot` event and row carry it back.
 */
export const reportId = z.string().min(1).max(64);

const userId = z.string().min(1).max(64);
const pairState = z.enum(["connecting", "connected", "relayed", "failed"]);
export type SnapshotPairState = z.infer<typeof pairState>;
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
