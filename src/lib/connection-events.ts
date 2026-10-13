/**
 * Connection events (ADR 3 addendum on the room timeline, ADR 11 addendum), shared by the client
 * and the server: what a browser tells the room timeline about its own connections, and the
 * schema the server checks it against (`reportConnectionFn`).
 *
 * Per pair (this browser and one peer): each connection state change, each ICE restart or
 * start-over and whether it recovered, the path (direct or relay, and the transport) when the
 * pair connects and when it changes, and negotiation errors. Per browser: a mic, camera or
 * screen-share picker that was refused or failed, and audio the browser would not autoplay.
 *
 * An event says how old it is (`ageMs`), not when it happened: the server dates it by its own
 * clock (ADR 12). It keeps an error's name and its message trimmed to `MAX_ERROR_MESSAGE`
 * characters, and the kind of device, never a device's label or id (`describeError` removes the
 * ones the page knows, and the generic shapes of an id and of an address from the rest).
 */
import { z } from "zod";
import { CANDIDATE_TYPES, type IcePath, isRelayed, RELAY_PROTOCOLS } from "./ice.ts";
import { reportSnapshot } from "./problem-report.ts";

/** Events in one report: a full room's worth of pairs coming up, and some to spare. */
export const CONNECTION_BATCH_MAX = 50;
/** An error's message is kept to this many characters. */
export const MAX_ERROR_MESSAGE = 200;
/** The oldest an event may be when the server dates it: an older one is dated this far back. */
export const MAX_EVENT_AGE_MS = 30 * 60_000;
/** The kinds of device an error can be about. */
export const DEVICE_KINDS = ["camera", "mic", "screen"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** `RTCPeerConnection.connectionState` as far as the timeline records it. */
export const CONNECTION_STATES = ["connecting", "connected", "disconnected", "failed"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];
/** What a pair tries after it fails or stalls: ICE again on the same connection, or a new one. */
export const RESTART_KINDS = ["ice_restart", "start_over"] as const;
export type RestartKind = (typeof RESTART_KINDS)[number];
/**
 * What set a restart off: the connection failed, or took too long; TURN credentials arrived for
 * a pair that failed on STUN alone; the person pressed retry; or the peer started over.
 */
export const RESTART_REASONS = ["failed", "timeout", "turn", "retry", "peer"] as const;
export type RestartReason = (typeof RESTART_REASONS)[number];
/** Where a negotiation went wrong. `never_finished` is a pair that gave up before ICE began. */
export const NEGOTIATION_STEPS = [
  "offer",
  "answer",
  "remote_description",
  "candidate",
  "never_finished",
] as const;
export type NegotiationStep = (typeof NEGOTIATION_STEPS)[number];
export const PATHS = ["direct", "relay", "unknown"] as const;
export type PathKind = (typeof PATHS)[number];
/** Whether a path event is the pair's first or a switch. */
export const PATH_CHANGES = ["connect", "change"] as const;
export type PathChange = (typeof PATH_CHANGES)[number];
export const AUDIO_SOURCES = ["mic", "share"] as const;
export type AudioSource = (typeof AUDIO_SOURCES)[number];

const peerId = z.string().min(1).max(64);
const errorName = z.string().regex(/^[A-Za-z][\w.]{0,63}$/);
const message = z
  .string()
  .max(2_000)
  .transform((m) => cleanMessage(m));
const candidate = z.strictObject({
  type: z.enum(CANDIDATE_TYPES),
  protocol: z.enum(["udp", "tcp"]),
  relayProtocol: z.enum(RELAY_PROTOCOLS).optional(),
});
const ageMs = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** One event as a page reports it; `kind` is also the kind of timeline row it becomes. */
export const connectionEvent = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("pair_state"),
    peerId,
    ageMs,
    state: z.enum(CONNECTION_STATES),
  }),
  z.strictObject({
    kind: z.literal("pair_restart"),
    peerId,
    ageMs,
    how: z.enum(RESTART_KINDS),
    why: z.enum(RESTART_REASONS),
  }),
  z.strictObject({
    kind: z.literal("pair_recovery"),
    peerId,
    ageMs,
    how: z.enum(RESTART_KINDS),
    recovered: z.boolean(),
    /** How long after the restart began it connected, or gave up. */
    afterMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    kind: z.literal("pair_path"),
    peerId,
    ageMs,
    change: z.enum(PATH_CHANGES),
    path: z.enum(PATHS),
    local: candidate.optional(),
    remote: candidate.optional(),
  }),
  z.strictObject({
    kind: z.literal("negotiation_error"),
    peerId,
    ageMs,
    step: z.enum(NEGOTIATION_STEPS),
    name: errorName,
    message,
  }),
  z.strictObject({
    kind: z.literal("device_error"),
    ageMs,
    device: z.enum(DEVICE_KINDS),
    name: errorName,
    message,
  }),
  z.strictObject({
    kind: z.literal("audio_blocked"),
    peerId,
    ageMs,
    source: z.enum(AUDIO_SOURCES),
  }),
  /**
   * This browser's snapshot for a problem report (ADR 4 addendum on problem reports), asked for
   * by the room socket's `snapshot.request`; `reportId` ties it to the report. Not about one
   * pair, so it has no `peerId`.
   */
  z.strictObject({
    kind: z.literal("report_snapshot"),
    ageMs,
    reportId: z.string().min(1).max(64),
    ...reportSnapshot.shape,
  }),
]);
export type ConnectionEventInput = z.input<typeof connectionEvent>;
/** The event kinds a page reports. */
export type ConnectionEventKind = ConnectionEventInput["kind"];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before it is dated: what the Mesh and the devices make. */
export type ConnectionEvent = DistributiveOmit<ConnectionEventInput, "ageMs">;

/** The events about one pair, the ones that have a peer. */
export type PairEvent = Extract<ConnectionEvent, { peerId: string }>;

/**
 * A report's events, each judged on its own: one that is malformed (a state this version doesn't
 * know, a field it shouldn't have) is dropped and the rest are kept, where checking the whole
 * array would lose a page's report for one event. A report with no valid event is refused.
 */
const events = z
  .array(z.unknown())
  .min(1)
  .max(CONNECTION_BATCH_MAX)
  .transform((rows) =>
    rows.flatMap((row) => {
      const parsed = connectionEvent.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
  )
  .refine((rows) => rows.length > 0, "no valid event");

/**
 * What a page reports (`reportConnectionFn`, and the beacon route when the page closes): its
 * events about the room it is in, or, for a device error, the room it is joining.
 */
export const reportConnectionEventsInput = z.strictObject({
  roomId: z.string().min(1).max(64),
  events,
});
export type ReportConnectionEventsInput = {
  roomId: string;
  events: ConnectionEventInput[];
};

// -------------------------------------------------------------------------------------------

const DEVICE = "[device]";
// A device id: Chromium's is 64 hex digits, Firefox's a braced GUID.
const ID_LIKE = /[0-9a-f]{16,}|\{?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}?/gi;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
// Needs at least three groups, so a time like 12:30 is left alone.
const IPV6 = /(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{0,4}|(?:[0-9a-f]{1,4}:){1,6}:[0-9a-f]{0,4}/gi;

/**
 * `text` made fit for the timeline: the strings in `secrets` (device labels and ids the page
 * knows) replaced by `[device]`, then anything shaped like a device id or an IP address, on one
 * line, cut to `max` characters (`MAX_ERROR_MESSAGE`, or a problem report note's own limit).
 */
export function cleanMessage(
  text: string,
  secrets: readonly string[] = [],
  max: number = MAX_ERROR_MESSAGE,
): string {
  let out = text;
  // Longest first, so a label that contains another is replaced whole.
  for (const secret of [...secrets]
    .filter((s) => s.length > 0)
    .sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join(DEVICE);
  }
  return out
    .replace(IPV4, "[ip]")
    .replace(IPV6, "[ip]")
    .replace(ID_LIKE, "[id]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** An error's name and cleaned message; anything that isn't an `Error` is just `Error`. */
export function describeError(
  error: unknown,
  secrets: readonly string[] = [],
): { name: string; message: string } {
  const fields =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const named = typeof fields.name === "string" && errorName.safeParse(fields.name).success;
  const text = typeof error === "string" ? error : fields.message;
  return {
    name: named ? (fields.name as string) : "Error",
    message: typeof text === "string" ? cleanMessage(text, secrets) : "",
  };
}

/** The state change of a pair's connection, if it is one the timeline records. */
export function pairStateEvent(peer: string, state: string): ConnectionEvent | undefined {
  return (CONNECTION_STATES as readonly string[]).includes(state)
    ? { kind: "pair_state", peerId: peer, state: state as ConnectionState }
    : undefined;
}

export function restartEvent(peer: string, how: RestartKind, why: RestartReason): ConnectionEvent {
  return { kind: "pair_restart", peerId: peer, how, why };
}

/** The end of a restart: the pair connected again (`recovered`), or gave up, `afterMs` later. */
export function recoveryEvent(
  peer: string,
  how: RestartKind,
  recovered: boolean,
  afterMs: number,
): ConnectionEvent {
  return { kind: "pair_recovery", peerId: peer, how, recovered, afterMs };
}

/** The path a pair uses: relayed if either end is a relay candidate. */
export function pathEvent(peer: string, ice: IcePath, change: PathChange): ConnectionEvent {
  const { selected } = ice;
  if (!selected) return { kind: "pair_path", peerId: peer, change, path: "unknown" };
  const { local, remote } = selected;
  return {
    kind: "pair_path",
    peerId: peer,
    change,
    path: isRelayed(ice) ? "relay" : "direct",
    local,
    remote,
  };
}

/** What identifies a path for telling when it changed: direct or relay, and over what transport. */
export function pathKey(event: ConnectionEvent): string | undefined {
  if (event.kind !== "pair_path") return undefined;
  const { path, local } = event;
  return `${path}/${local?.relayProtocol ?? local?.protocol ?? ""}`;
}

/** A failed or unfinished negotiation step; `error` is absent for `never_finished`. */
export function negotiationEvent(
  peer: string,
  step: NegotiationStep,
  error?: unknown,
): ConnectionEvent {
  const { name, message } =
    error === undefined ? { name: "Timeout", message: "" } : describeError(error);
  return { kind: "negotiation_error", peerId: peer, step, name, message };
}

/**
 * A mic, camera or screen-share failure. `secrets` are the labels and ids of the devices the
 * page knows, which the error's message must not repeat.
 */
export function deviceErrorEvent(
  device: DeviceKind,
  error: unknown,
  secrets: readonly string[] = [],
): ConnectionEvent {
  return { kind: "device_error", device, ...describeError(error, secrets) };
}

/** The browser would not play `peer`'s mic, or their share's sound, before a click. */
export function audioBlockedEvent(peer: string, share: boolean): ConnectionEvent {
  return { kind: "audio_blocked", peerId: peer, source: share ? "share" : "mic" };
}
