/**
 * Video quality samples (ADR 2 and ADR 11 addendums): a browser's stats for each video sender
 * and receiver, one row per 30-second window and one per rung change. Kept 90 days,
 * longer than the 30 days of room data, so like the admin audit log they have no foreign keys,
 * to `rooms` or `user`: the 30-day room purge can't take them, and they hold the room's id and
 * kind (which decides how a share is tuned) themselves. Their own daily purge is
 * `purgeExpiredQualitySamples` (src/server/quality.ts).
 */
import { index, integer, pgEnum, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { CandidateType, RelayProtocol } from "../../lib/ice.ts";
import type { Limit } from "../../lib/quality.ts";
import {
  type BrowserName,
  QUALITY_DIRECTIONS,
  QUALITY_SLOTS,
  QUALITY_TRIGGERS,
  RUNG_REASONS,
} from "../../lib/quality-telemetry.ts";
import { roomKind } from "./rooms.ts";

export const qualityDirection = pgEnum("quality_direction", QUALITY_DIRECTIONS);
export const qualitySlot = pgEnum("quality_slot", QUALITY_SLOTS);
export const qualityTrigger = pgEnum("quality_trigger", QUALITY_TRIGGERS);
export const rungReason = pgEnum("quality_rung_reason", RUNG_REASONS);

/**
 * Every metric is null when the browser didn't say (Firefox senders lack several), never 0.
 * Text columns hold values checked on the way in (./lib/quality-telemetry.ts), so a new one
 * needs no migration.
 */
export const qualitySamples = pgTable(
  "quality_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: text("room_id").notNull(),
    roomKind: roomKind("room_kind").notNull(),
    /** When the window ended, by the server's clock. */
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** The window's length, milliseconds. */
    windowMs: integer("window_ms").notNull(),
    /**
     * A `send` row: how long after its sender started (a new share, or a new viewer of one) the
     * window ended, in milliseconds. Null for `recv` rows and rows from before it was recorded.
     * The first stable step's time is read from it (`settledOf`, src/lib/quality-admin.ts).
     */
    sinceStartMs: integer("since_start_ms"),
    /** Who measured it, and the other end: for `send` rows the viewer, for `recv` the streamer. */
    reporterUserId: text("reporter_user_id").notNull(),
    peerUserId: text("peer_user_id").notNull(),
    direction: qualityDirection("direction").notNull(),
    slot: qualitySlot("slot").notNull(),
    trigger: qualityTrigger("trigger").notNull(),
    /** The reporter's browser, from its user agent; the major version is null if it had none. */
    browser: text("browser").$type<BrowserName>().notNull(),
    browserMajor: integer("browser_major"),
    /** A sender's rung over the window (the one it left, for a rung change), like `1080p30`. */
    rung: text("rung"),
    /** The rung `maxBitrate`, bits per second. */
    maxBitrate: integer("max_bitrate"),
    toRung: text("to_rung"),
    rungReason: rungReason("rung_reason"),
    /** The encoder's target, and what was sent or received, averaged over the window (bps). */
    targetBitrate: integer("target_bitrate"),
    bitrate: integer("bitrate"),
    availableBitrate: integer("available_bitrate"),
    /** Δ`qpSum` / Δframes. Comparable only within one codec. */
    qp: real("qp"),
    codec: text("codec"),
    frameWidth: integer("frame_width"),
    frameHeight: integer("frame_height"),
    fps: real("fps"),
    /** `qualityLimitationReason`: the worst seen in the window. */
    limitation: text("limitation").$type<Limit>(),
    /** Fraction of packets lost, 0 to 1. */
    loss: real("loss"),
    rttMs: real("rtt_ms"),
    plis: integer("plis"),
    firs: integer("firs"),
    nacks: integer("nacks"),
    keyFrames: integer("key_frames"),
    freezes: integer("freezes"),
    freezeSeconds: real("freeze_seconds"),
    /** The selected candidate pair, and a relay's transport. */
    localCandidate: text("local_candidate").$type<CandidateType>(),
    remoteCandidate: text("remote_candidate").$type<CandidateType>(),
    relayProtocol: text("relay_protocol").$type<RelayProtocol>(),
  },
  (table) => [
    index("quality_samples_room_idx").on(table.roomId, table.at),
    index("quality_samples_at_idx").on(table.at),
  ],
);
