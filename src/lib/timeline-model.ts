/**
 * The admin's room timeline as something to draw (CONTEXT.md, Room timeline; issue #114): the
 * merged entries `getRoomTimeline` returns (./room-timeline.ts) turned into swimlanes, a flat
 * list of rows, and the problem report markers, and the filters that cut them. Pure, so it is
 * tested without a browser (./timeline-model.test.ts); the picture is
 * components/room-timeline-lanes.tsx.
 *
 * Lanes: one per person (in the room, host, sharing, camera, mic, and the reconnect grace) and
 * one per pair that has anything to show (its connection as segments, with path changes,
 * restarts, errors and quality steps on it). Intervals come from the stored intervals where the
 * room still has them (30 days), else from the events that mark their ends (90 days).
 *
 * Time is epoch milliseconds throughout.
 */
import { fmtDuration } from "./format";
import {
  PROBLEM_CATEGORIES,
  PROBLEM_CATEGORY_LABELS,
  type ProblemCategory,
} from "./problem-report";
import { codecLabel } from "./quality-reason";
import type {
  RoomTimeline,
  RoomTimelineEntry,
  TimelineDetails,
  TimelineEventKind,
  TimelineJson,
} from "./room-timeline";
import { MIN_VIEW_MS, type Range, viewFraction } from "./timeline-axis";

/** What the filter chips switch, and what colours and groups the lanes. */
export const CATEGORIES = [
  "presence",
  "media",
  "connection",
  "moderation",
  "refusals",
  "reports",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  presence: "presence",
  media: "media",
  connection: "connection",
  moderation: "moderation",
  refusals: "refusals",
  reports: "reports",
};

/** Every event kind in one category, so a new kind is a compile error until it has one. */
const EVENT_CATEGORY: Record<TimelineEventKind, Category> = {
  join: "presence",
  leave: "presence",
  disconnect: "presence",
  grace_start: "presence",
  grace_resume: "presence",
  grace_expire: "presence",
  takeover: "presence",
  host_change: "moderation",
  kick: "moderation",
  stop_share: "moderation",
  role_change: "moderation",
  knock_request: "moderation",
  knock_approve: "moderation",
  knock_deny: "moderation",
  knock_cancel: "moderation",
  rename: "moderation",
  room_end: "moderation",
  ban: "moderation",
  share_start: "media",
  share_stop: "media",
  cam_on: "media",
  cam_off: "media",
  mic_on: "media",
  mic_off: "media",
  device_error: "media",
  audio_blocked: "media",
  codec_switch: "media",
  refusals: "refusals",
  slow_client: "refusals",
  flood_close: "refusals",
  events_dropped: "refusals",
  pair_state: "connection",
  pair_restart: "connection",
  pair_recovery: "connection",
  pair_path: "connection",
  negotiation_error: "connection",
  problem_report: "reports",
  report_snapshot: "reports",
};

/**
 * Kinds whose target is who they happened to, and the actor who did it: a kick, a ban, a host
 * hand-over, a role, a refused knock. Every other kind is about its actor.
 */
const ABOUT_TARGET = new Set<TimelineEventKind>([
  "kick",
  "ban",
  "stop_share",
  "role_change",
  "host_change",
  "knock_approve",
  "knock_deny",
]);

/**
 * The person an event is about, whose lane it belongs on and whose presence, share or grace it
 * can end: the one kicked, not the kicker. Null for a room's own (a rename, the room ending).
 * One rule for every place that files an event under someone, so they can't disagree.
 */
export function subjectOf(
  e: Pick<EventEntry, "kind" | "actorUserId" | "targetUserId">,
): string | null {
  return ABOUT_TARGET.has(e.kind)
    ? (e.targetUserId ?? e.actorUserId)
    : (e.actorUserId ?? e.targetUserId);
}

export type Track = "presence" | "host" | "share" | "cam" | "mic" | "state";
export type Tone =
  | "present"
  | "host"
  | "grace"
  | "share"
  | "cam"
  | "mic"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed";

/** A stretch on a lane. */
export interface Segment {
  track: Track;
  from: number;
  to: number;
  tone: Tone;
  /** Still going: it runs to the end of what is known, not to an event that closed it. */
  open: boolean;
  label: string;
  category: Category;
  people: string[];
}

export type MarkKind =
  | "moderation"
  | "refusal"
  | "error"
  | "takeover"
  | "path"
  | "restart"
  | "step"
  | "codec";

/** An instant on a lane. */
export interface Mark {
  t: number;
  kind: MarkKind;
  category: Category;
  label: string;
  /** More about it, if there is (an error's message). */
  detail?: string;
  /** A path mark: the pair now goes through the TURN relay. */
  relay?: boolean;
  people: string[];
}

export interface Lane {
  /** `person:<id>` or `pair:<id>|<id>`. */
  id: string;
  kind: "person" | "pair";
  label: string;
  people: string[];
  segments: Segment[];
  marks: Mark[];
}

export type RowKind = TimelineEventKind | "quality_step";

/** One line of the events table. */
export interface TimelineRow {
  id: string;
  t: number;
  kind: RowKind;
  category: Category;
  text: string;
  detail?: string;
  /** The report, on a `problem_report` row. */
  reportId?: string;
  /** Who it involves, the actor first. Names are in `text`; these are for filtering. */
  people: string[];
}

export interface ReportMarker {
  id: string;
  t: number;
  category: ProblemCategory;
  reporterId: string | null;
  /** Whose screen it was about, if it was sent from that stream's quality modal. */
  streamUserId: string | null;
  note: string | null;
}

export interface TimelineModel {
  domain: Range;
  lanes: Lane[];
  rows: TimelineRow[];
  reports: ReportMarker[];
}

type EventEntry = Extract<RoomTimelineEntry, { source: "event" }>;
type IntervalEntry = Extract<RoomTimelineEntry, { source: "presence" | "stream" | "host" }>;
type QualityEntry = Extract<RoomTimelineEntry, { source: "quality" }>;

const isEvent = (e: RoomTimelineEntry): e is EventEntry => e.source === "event";
const isInterval = (e: RoomTimelineEntry): e is IntervalEntry =>
  e.source === "presence" || e.source === "stream" || e.source === "host";
const isQuality = (e: RoomTimelineEntry): e is QualityEntry => e.source === "quality";
const ms = (iso: string) => Date.parse(iso);

const str = (d: TimelineDetails, key: string): string | undefined => {
  const v = d[key];
  return typeof v === "string" ? v : undefined;
};
const num = (d: TimelineDetails, key: string): number | undefined => {
  const v = d[key];
  return typeof v === "number" ? v : undefined;
};
const obj = (v: TimelineJson | undefined): TimelineDetails | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v : undefined;

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------
// Words

const LEAVE_WORDS: Record<string, string> = {
  grace_expired: "did not come back",
  taken_over: "taken over by another tab",
  joined_elsewhere: "joined another room",
  banned: "banned",
};
/** Why a codec switch happened, by its `reason`: the streamer's computer is the only one so far. */
const SWITCH_WHY: Record<string, string> = {
  cpu: "the streamer's computer could not keep up",
};
const REFUSAL_WORDS: Record<string, string> = {
  rate_limited: "rate limited",
  bad_request: "bad request",
};

/** A pair's path as the quality panel words it: `direct`, or `relay · UDP`. */
function pathWords(d: TimelineDetails): string {
  const path = str(d, "path") ?? "unknown";
  if (path !== "relay") return path;
  const proto =
    str(obj(d.local) ?? {}, "relayProtocol") ?? str(obj(d.remote) ?? {}, "relayProtocol");
  return proto ? `relay · ${proto.toUpperCase()}` : "relay";
}

function refusalWords(d: TimelineDetails): string {
  const counts = obj(d.counts) ?? {};
  const byReason = new Map<string, number>();
  for (const [key, n] of Object.entries(counts)) {
    if (typeof n !== "number") continue;
    const reason = key.split(":").at(-1) ?? key;
    byReason.set(reason, (byReason.get(reason) ?? 0) + n);
  }
  const total = [...byReason.values()].reduce((a, b) => a + b, 0);
  const parts = [...byReason]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${REFUSAL_WORDS[reason] ?? reason.replaceAll("_", " ")}`);
  return `${total} ${total === 1 ? "message" : "messages"} refused (${parts.join(", ")})`;
}

/** What an event says, in words, with names and not ids. `detail` is more, for a second line. */
function eventWords(
  e: EventEntry,
  name: (id: string) => string,
): { text: string; detail?: string } {
  const d = e.details;
  const a = e.actorUserId ? name(e.actorUserId) : "someone";
  const b = e.targetUserId ? name(e.targetUserId) : "someone";
  switch (e.kind) {
    case "join":
      return { text: `${a} joined` };
    case "leave": {
      const why = LEAVE_WORDS[str(d, "reason") ?? "left"];
      return { text: why ? `${a} left (${why})` : `${a} left` };
    }
    case "disconnect":
      return { text: `${a} lost their connection to the server` };
    case "grace_start":
      return {
        text: `${a} has ${fmtDuration((num(d, "graceMs") ?? 30_000) / 1_000)} to reconnect`,
      };
    case "grace_resume":
      return { text: `${a} reconnected after ${fmtDuration((num(d, "awayMs") ?? 0) / 1_000)}` };
    case "grace_expire":
      return { text: `${a} did not come back` };
    case "takeover":
      return {
        text: d.sameRoom
          ? `${a} opened the room in another tab`
          : d.toRoom
            ? `${a} joined another room`
            : `${a}'s place was taken over`,
      };
    case "host_change":
      return { text: `${b} became host` };
    case "kick":
      return { text: `${a} kicked ${b}` };
    case "ban":
      return { text: `${b} was banned` };
    case "stop_share":
      return { text: `${a} stopped ${b}'s share` };
    case "role_change":
      return { text: `${a} made ${b} ${str(d, "role") ?? "a different role"}` };
    case "knock_request":
      return { text: `${a} knocked` };
    case "knock_approve":
      return { text: `${a} let ${b} in` };
    case "knock_deny":
      return { text: `${a} turned ${b} away` };
    case "knock_cancel":
      return { text: `${a} withdrew their knock` };
    case "rename":
      return { text: `${a} renamed the room`, detail: str(d, "to") };
    case "room_end":
      return { text: `the room ended (${str(d, "by") ?? "unknown"})` };
    case "share_start":
      return { text: `${a} started sharing` };
    case "share_stop": {
      const by = str(d, "by");
      return {
        text: by ? `${a} stopped sharing (stopped by ${name(by)})` : `${a} stopped sharing`,
      };
    }
    case "cam_on":
      return { text: `${a} turned their camera on` };
    case "cam_off":
      return { text: `${a} turned their camera off` };
    case "mic_on":
      return { text: `${a} turned their mic on` };
    case "mic_off":
      return { text: `${a} turned their mic off` };
    case "device_error":
      return {
        text: `${a}: ${str(d, "device") ?? "device"} failed (${str(d, "name") ?? "error"})`,
        detail: str(d, "message"),
      };
    case "audio_blocked":
      return {
        text: `${a}: the browser blocked ${b}'s ${str(d, "source") ?? "audio"} until a click`,
      };
    case "codec_switch": {
      const from = str(d, "from");
      const to = str(d, "to");
      return {
        text: `${a}'s video switched ${from ? `from ${codecLabel(from)} ` : ""}to ${to ? codecLabel(to) : "another codec"}`,
        detail: SWITCH_WHY[str(d, "reason") ?? ""],
      };
    }
    case "refusals":
      return { text: `${a} had ${refusalWords(d)}` };
    case "slow_client":
      return { text: `the server dropped ${a}'s socket for not reading` };
    case "flood_close":
      return { text: `the server closed ${a}'s socket for flooding` };
    case "events_dropped":
      return { text: `${num(d, "count") ?? "some"} of ${a}'s events were not recorded` };
    case "pair_state":
      return { text: `${a}: connection to ${b} ${str(d, "state") ?? "changed"}` };
    case "pair_restart":
      return {
        text: `${a}: ${d.how === "start_over" ? "started over" : "ICE restart"} with ${b} (${str(d, "why") ?? "unknown"})`,
      };
    case "pair_recovery": {
      const how = d.how === "start_over" ? "starting over" : "ICE restart";
      const after = fmtDuration((num(d, "afterMs") ?? 0) / 1_000);
      return {
        text: `${a}: ${how} with ${b} ${d.recovered ? "recovered" : "gave up"} after ${after}`,
      };
    }
    case "pair_path":
      return {
        text: `${a}: ${d.change === "connect" ? "connected over" : "path changed to"} ${pathWords(d)}`,
      };
    case "negotiation_error":
      return {
        text: `${a}: ${(str(d, "step") ?? "negotiation").replaceAll("_", " ")} with ${b} failed (${str(d, "name") ?? "error"})`,
        detail: str(d, "message"),
      };
    case "problem_report": {
      const category = reportCategory(d);
      const note = str(d, "note");
      return {
        text: `${a} reported ${PROBLEM_CATEGORY_LABELS[category]}${e.targetUserId ? ` on ${b}'s screen` : ""}${note ? `: “${note}”` : ""}`,
      };
    }
    case "report_snapshot":
      return { text: `${a} sent a snapshot` };
  }
}

function qualityWords(q: QualityEntry, name: (id: string) => string): string {
  const streamer = q.direction === "send" ? q.reporterUserId : q.peerUserId;
  const viewer = q.direction === "send" ? q.peerUserId : q.reporterUserId;
  const step = `${q.rung ?? "?"} → ${q.toRung ?? "?"}`;
  return `${name(streamer)} → ${name(viewer)}: ${step}${q.reason ? ` (${q.reason})` : ""}`;
}

// ---------------------------------------------------------------------------------------------
// Problem reports

function reportCategory(d: TimelineDetails): ProblemCategory {
  return PROBLEM_CATEGORIES.find((c) => c === d.category) ?? "other";
}

/** The problem reports on the timeline, oldest first. A report with no id can't be opened, so is left out. */
export function reportMarkers(timeline: Pick<RoomTimeline, "entries">): ReportMarker[] {
  return timeline.entries.filter(isEvent).flatMap((e) => {
    const id = str(e.details, "reportId");
    if (e.kind !== "problem_report" || !id) return [];
    return [
      {
        id,
        t: ms(e.at),
        category: reportCategory(e.details),
        reporterId: e.actorUserId,
        streamUserId: e.targetUserId,
        note: str(e.details, "note") || null,
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// Rows

/**
 * The timeline as lines, oldest first: the events and the quality steps, plus the start and end
 * of any presence or share interval whose events are not on the timeline (they have been cut by
 * the size bound, or were never recorded). A snapshot row is data for the report, not an event.
 */
export function toRows(timeline: RoomTimeline): TimelineRow[] {
  const { entries, people } = timeline;
  const name = (id: string) => people[id]?.username ?? id;
  const events = entries.filter(isEvent);
  // Per person: whoever has any such event on the timeline has their intervals told by them.
  const told = (kinds: TimelineEventKind[]) =>
    new Set(events.filter((e) => kinds.includes(e.kind)).map(subjectOf));
  const joined = told(["join"]);
  const left = told(["leave", "kick", "ban"]);
  const shared = told(["share_start"]);
  const stopped = told(["share_stop"]);

  const rows: Omit<TimelineRow, "id">[] = [];
  for (const entry of entries) {
    if (isEvent(entry)) {
      if (entry.kind === "report_snapshot") continue;
      const { text, detail } = eventWords(entry, name);
      rows.push({
        t: ms(entry.at),
        kind: entry.kind,
        category: EVENT_CATEGORY[entry.kind],
        text,
        ...(detail && { detail }),
        ...(entry.kind === "problem_report" && { reportId: str(entry.details, "reportId") }),
        people: [entry.actorUserId, entry.targetUserId].filter((p): p is string => p !== null),
      });
    } else if (isQuality(entry)) {
      rows.push({
        t: ms(entry.at),
        kind: "quality_step",
        category: "connection",
        text: qualityWords(entry, name),
        people: [entry.reporterUserId, entry.peerUserId],
      });
    } else if (entry.source !== "host") {
      const presence = entry.source === "presence";
      const category = presence ? "presence" : "media";
      const who = name(entry.userId);
      const people = [entry.userId];
      if (!(presence ? joined : shared).has(entry.userId)) {
        rows.push({
          t: ms(entry.at),
          kind: presence ? "join" : "share_start",
          category,
          text: presence ? `${who} joined` : `${who} started sharing`,
          people,
        });
      }
      if (entry.endedAt && !(presence ? left : stopped).has(entry.userId)) {
        rows.push({
          t: ms(entry.endedAt),
          kind: presence ? "leave" : "share_stop",
          category,
          text: presence ? `${who} left` : `${who} stopped sharing`,
          people,
        });
      }
    }
  }
  return rows.sort((a, b) => a.t - b.t).map((row, i) => ({ ...row, id: `row-${i}` }));
}

// ---------------------------------------------------------------------------------------------
// Lanes

interface Interval {
  from: number;
  /** Null while open. */
  to: number | null;
}

const STATE_RANK = { connected: 0, connecting: 1, disconnected: 2, failed: 3 } as const;
type PairState = keyof typeof STATE_RANK;
const isPairState = (v: string | undefined): v is PairState => v !== undefined && v in STATE_RANK;

const pairId = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The timeline as swimlanes (see the module comment). `until` is how far an interval that is
 * still open runs: now, for a live room. Without it, or before the last thing recorded, open
 * intervals run to the last thing recorded.
 */
export function buildTimelineModel(timeline: RoomTimeline, until?: number): TimelineModel {
  const { entries, people } = timeline;
  const name = (id: string) => people[id]?.username ?? id;
  const events = entries.filter(isEvent);
  const intervals = entries.filter(isInterval);
  const quality = entries.filter(isQuality);

  let t0 = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const e of entries) {
    t0 = Math.min(t0, ms(e.at));
    latest = Math.max(latest, ms(e.at), "endedAt" in e && e.endedAt ? ms(e.endedAt) : latest);
  }
  const empty = entries.length === 0;
  const openEnd = empty ? (until ?? 0) : Math.max(latest, until ?? 0);

  const rows = toRows(timeline);
  const reports = reportMarkers(timeline);

  // Presence per person: the stored intervals, else what join, leave, kick and ban say.
  const presence = new Map<string, Interval[]>();
  for (const [user, list] of groupBy(
    intervals.filter((i) => i.source === "presence"),
    (i) => i.userId,
  )) {
    presence.set(
      user,
      list.map((i) => ({ from: ms(i.at), to: i.endedAt ? ms(i.endedAt) : null })),
    );
  }
  for (const [user, list] of groupBy(
    events.filter((e) => ["join", "leave", "kick", "ban"].includes(e.kind)),
    subjectOf,
  )) {
    if (presence.has(user)) continue;
    const spans: Interval[] = [];
    for (const e of list) {
      const open = spans.at(-1);
      if (e.kind === "join") {
        if (!open || open.to !== null) spans.push({ from: ms(e.at), to: null });
      } else if (open && open.to === null) open.to = ms(e.at);
    }
    presence.set(user, spans);
  }
  /** When the stretch of `user`'s presence that holds `t` ends: null if open, undefined if none is known. */
  const presenceEnd = (user: string, t: number) =>
    presence.get(user)?.find((i) => i.from <= t && (i.to === null || t <= i.to))?.to;
  /** Whether `user`'s presence is known at all (else they are taken to have been there throughout). */
  const knownPresence = (user: string) => presence.has(user);

  const persons = new Map<string, Lane>();
  const personLane = (id: string): Lane => {
    let lane = persons.get(id);
    if (!lane) {
      lane = {
        id: `person:${id}`,
        kind: "person",
        label: name(id),
        people: [id],
        segments: [],
        marks: [],
      };
      persons.set(id, lane);
    }
    return lane;
  };
  const push = (
    lane: Lane,
    track: Track,
    from: number,
    to: number | null,
    tone: Tone,
    label: string,
    category: Category,
  ) =>
    lane.segments.push({
      track,
      from,
      to: to ?? openEnd,
      tone,
      open: to === null,
      label,
      category,
      people: lane.people,
    });

  // Presence, host, shares.
  for (const [user, list] of presence) {
    for (const i of list)
      push(personLane(user), "presence", i.from, i.to, "present", "in the room", "presence");
  }
  for (const i of intervals.filter((e) => e.source === "host")) {
    push(
      personLane(i.userId),
      "host",
      ms(i.at),
      i.endedAt ? ms(i.endedAt) : null,
      "host",
      "host",
      "presence",
    );
  }

  // Where the host intervals are gone (they reach back 30 days, the events 90), the hand-overs
  // say who hosted when: from each `host_change` to the next, or to the host leaving.
  const hosted = new Set(intervals.filter((i) => i.source === "host").map((i) => i.userId));
  const handOvers = events.filter((e) => e.kind === "host_change");
  for (const [i, change] of handOvers.entries()) {
    const host = subjectOf(change);
    if (!host || hosted.has(host)) continue;
    const next = handOvers.slice(i + 1).find((e) => subjectOf(e) !== host);
    const from = ms(change.at);
    const left = presenceEnd(host, from);
    const stops = [next ? ms(next.at) : null, left].filter(
      (t): t is number => typeof t === "number",
    );
    push(
      personLane(host),
      "host",
      from,
      stops.length ? Math.min(...stops) : null,
      "host",
      "host",
      "presence",
    );
  }

  /**
   * Pair `on` and `off` events of each person into stretches. A stretch ends at its `off`, or
   * where the person's presence ended if that came first, and a stretch left open runs on. An
   * `off` with no `on` before it began before what was recorded.
   */
  const stretches = (
    track: "share" | "cam" | "mic",
    on: TimelineEventKind,
    off: TimelineEventKind,
    label: string,
    only?: (user: string) => boolean,
  ) => {
    const list = events.filter((e) => e.kind === on || e.kind === off);
    for (const [user, mine] of groupBy(list, (e) => e.actorUserId)) {
      if (only && !only(user)) continue;
      let startedAt: number | null = null;
      const close = (from: number, offAt: number | null) => {
        let end = offAt;
        const limit = presenceEnd(user, from);
        if (typeof limit === "number" && (end === null || limit < end)) end = limit;
        push(personLane(user), track, from, end, track, label, "media");
      };
      for (const [i, e] of mine.entries()) {
        if (e.kind === on) {
          // Left with it on and came back: that stretch ended where the presence did.
          if (startedAt !== null && typeof presenceEnd(user, startedAt) === "number") {
            const gone = presenceEnd(user, startedAt) as number;
            if (gone < ms(e.at)) {
              close(startedAt, null);
              startedAt = null;
            }
          }
          startedAt ??= ms(e.at);
        } else if (startedAt !== null) {
          close(startedAt, ms(e.at));
          startedAt = null;
        } else if (i === 0) {
          // The first thing recorded is it going off: it was on before the timeline began.
          close(t0, ms(e.at));
        }
      }
      if (startedAt !== null) close(startedAt, null);
    }
  };
  const streamed = new Set(intervals.filter((i) => i.source === "stream").map((i) => i.userId));
  for (const i of intervals.filter((e) => e.source === "stream")) {
    push(
      personLane(i.userId),
      "share",
      ms(i.at),
      i.endedAt ? ms(i.endedAt) : null,
      "share",
      "sharing",
      "media",
    );
  }
  stretches("share", "share_start", "share_stop", "sharing", (u) => !streamed.has(u));
  stretches("cam", "cam_on", "cam_off", "camera on");
  stretches("mic", "mic_on", "mic_off", "mic on");

  // The reconnect grace: from the socket dropping to what ended it.
  const ENDS_GRACE = new Set<TimelineEventKind>([
    "grace_resume",
    "grace_expire",
    "leave",
    "kick",
    "ban",
  ]);
  for (const [user, mine] of groupBy(
    events.filter((e) => e.kind === "grace_start" || ENDS_GRACE.has(e.kind)),
    subjectOf,
  )) {
    for (const [i, start] of mine.entries()) {
      if (start.kind !== "grace_start") continue;
      const end = mine.slice(i + 1).find((e) => ENDS_GRACE.has(e.kind));
      const from = ms(start.at);
      const away =
        end?.kind === "grace_resume" ? (num(end.details, "awayMs") ?? ms(end.at) - from) : 0;
      push(
        personLane(user),
        "presence",
        from,
        end ? ms(end.at) : null,
        "grace",
        !end
          ? "waiting for them to reconnect"
          : end.kind === "grace_resume"
            ? `reconnected after ${fmtDuration(away / 1_000)}`
            : "did not come back",
        "presence",
      );
    }
  }

  // Marks on a person's lane: what happened to them or that they did, that is not a stretch.
  for (const e of events) {
    const category = EVENT_CATEGORY[e.kind];
    const mark = (user: string | null, kind: MarkKind) => {
      if (!user) return;
      const { text, detail } = eventWords(e, name);
      personLane(user).marks.push({
        t: ms(e.at),
        kind,
        category,
        label: text,
        ...(detail && { detail }),
        people: [e.actorUserId, e.targetUserId].filter((p): p is string => p !== null),
      });
    };
    if (e.kind === "takeover") mark(e.actorUserId, "takeover");
    else if (category === "moderation") mark(subjectOf(e), "moderation");
    else if (e.kind === "device_error" || e.kind === "audio_blocked") mark(e.actorUserId, "error");
    else if (e.kind === "codec_switch") mark(e.actorUserId, "codec");
    else if (category === "refusals") mark(e.actorUserId, "refusal");
  }

  // Pairs.
  const pairs = new Map<string, Lane>();
  const pairLane = (a: string, b: string): Lane => {
    const id = pairId(a, b);
    let lane = pairs.get(id);
    if (!lane) {
      const [x, y] = id.split("|") as [string, string];
      lane = {
        id: `pair:${id}`,
        kind: "pair",
        label: `${name(x)} ↔ ${name(y)}`,
        people: [x, y],
        segments: [],
        marks: [],
      };
      pairs.set(id, lane);
    }
    return lane;
  };
  const pairMark = (lane: Lane, t: number, kind: MarkKind, label: string, detail?: string) =>
    lane.marks.push({
      t,
      kind,
      category: "connection",
      label,
      ...(detail && { detail }),
      people: lane.people,
    });

  const changes: { t: number; by: string; peer: string; state: PairState }[] = [];
  for (const e of events) {
    if (!e.actorUserId || !e.targetUserId || EVENT_CATEGORY[e.kind] !== "connection") continue;
    const lane = pairLane(e.actorUserId, e.targetUserId);
    const { text, detail } = eventWords(e, name);
    if (e.kind === "pair_state") {
      const state = str(e.details, "state");
      if (isPairState(state))
        changes.push({ t: ms(e.at), by: e.actorUserId, peer: e.targetUserId, state });
    } else if (e.kind === "pair_path") {
      pairMark(lane, ms(e.at), "path", text);
      if (str(e.details, "path") === "relay") (lane.marks.at(-1) as Mark).relay = true;
    } else if (e.kind === "pair_restart" || e.kind === "pair_recovery")
      pairMark(lane, ms(e.at), "restart", text);
    else if (e.kind === "negotiation_error") pairMark(lane, ms(e.at), "error", text, detail);
  }
  for (const q of quality) {
    pairMark(pairLane(q.reporterUserId, q.peerUserId), ms(q.at), "step", qualityWords(q, name));
  }

  // A pair's connection is the worse of what its two sides report, from each change to the next,
  // and stops where either person's stretch in the room ends.
  for (const [id, list] of groupBy(changes, (c) => pairId(c.by, c.peer))) {
    const lane = pairs.get(id) as Lane;
    const [x, y] = lane.people as [string, string];
    const latestBy = new Map<string, PairState>();
    const points: { t: number; state: PairState }[] = [];
    for (const c of list) {
      latestBy.set(c.by, c.state);
      const state = [...latestBy.values()].reduce((worst, s) =>
        STATE_RANK[s] > STATE_RANK[worst] ? s : worst,
      );
      const last = points.at(-1);
      if (last?.t === c.t) last.state = state;
      else if (last?.state !== state) points.push({ t: c.t, state });
    }
    for (const [i, p] of points.entries()) {
      const next = points[i + 1]?.t ?? null;
      const ends = [x, y].map((u) => (knownPresence(u) ? presenceEnd(u, p.t) : null));
      // A person whose presence is known but doesn't hold this moment was not there to connect.
      if (ends.includes(undefined)) continue;
      // Null is open: neither the next change nor anyone leaving ends it.
      const stops = [next, ...ends].filter((t): t is number => typeof t === "number");
      push(
        lane,
        "state",
        p.t,
        stops.length ? Math.min(...stops) : null,
        p.state,
        `connection ${p.state}`,
        "connection",
      );
    }
  }

  const byStart = (a: Lane, b: Lane) => start(a) - start(b) || a.label.localeCompare(b.label);
  const lanes = [...persons.values()].sort(byStart).concat([...pairs.values()].sort(byStart));
  for (const lane of lanes) {
    lane.marks.sort((a, b) => a.t - b.t);
  }

  const anyOpen = lanes.some((l) => l.segments.some((s) => s.open));
  const domain: Range = empty
    ? { t0: until ?? 0, t1: (until ?? 0) + MIN_VIEW_MS }
    : { t0, t1: anyOpen ? openEnd : latest };
  return { domain, lanes, rows, reports };
}

function start(lane: Lane): number {
  return Math.min(...lane.segments.map((s) => s.from), ...lane.marks.map((m) => m.t));
}

// ---------------------------------------------------------------------------------------------
// Drawing a crowded lane
//
// A lane of 5,000 entries is 800 pixels wide: most marks fall on one another, and a segment a
// fraction of a pixel wide is not there to see. Both are folded to what the screen can show, and
// what is folded away is still read out (a group says how many it holds), so zooming in is how
// to separate them, not how to find them.

/** Marks of one kind that fall in one column of pixels, drawn as one. */
export interface MarkGroup {
  /** The first one's time, and the last one's. */
  t: number;
  to: number;
  kind: MarkKind;
  relay: boolean;
  marks: Mark[];
}

/**
 * `marks` in `view` (a lane `plotWidth` pixels wide), with those of one kind in the same column
 * of `columnPx` pixels grouped. A relayed path is a kind of its own. Order is by first mark.
 */
export function groupMarks(
  marks: readonly Mark[],
  view: Range,
  plotWidth: number,
  columnPx: number,
): MarkGroup[] {
  const groups = new Map<string, MarkGroup>();
  for (const m of marks) {
    if (m.t < view.t0 || m.t > view.t1) continue;
    const column = Math.floor((viewFraction(view, m.t) * plotWidth) / columnPx);
    const relay = m.relay === true;
    const key = `${column}:${m.kind}:${relay}`;
    const group = groups.get(key);
    if (group) {
      group.marks.push(m);
      group.to = Math.max(group.to, m.t);
    } else groups.set(key, { t: m.t, to: m.t, kind: m.kind, relay, marks: [m] });
  }
  return [...groups.values()];
}

/** A segment to draw: the first of a run of thin ones folded together, with what they cover. */
export interface DrawnSegment {
  segment: Segment;
  /** Its place in the lane's segments, which is how it is keyed. */
  index: number;
  /** How many were folded into this one (1 for one drawn as it is). */
  count: number;
  /** Where the last of them ends. */
  to: number;
}

/** A segment this many pixels wide or more is always drawn as it is. */
const MIN_SEGMENT_PX = 2;

/**
 * The segments of a lane that touch `view`, as drawn. One that is at least `MIN_SEGMENT_PX`
 * wide is drawn as it is. Thinner ones of one track and tone that start in the same column of
 * `columnPx` pixels are one, from the first's start to the last's end.
 */
export function visibleSegments(
  segments: readonly Segment[],
  view: Range,
  plotWidth: number,
  columnPx = 4,
): DrawnSegment[] {
  const span = view.t1 - view.t0;
  const out: DrawnSegment[] = [];
  const thin = new Map<string, DrawnSegment>();
  segments.forEach((segment, index) => {
    if (segment.to < view.t0 || segment.from > view.t1) return;
    const from = Math.max(segment.from, view.t0);
    const to = Math.min(segment.to, view.t1);
    if (((to - from) / span) * plotWidth >= MIN_SEGMENT_PX) {
      out.push({ segment, index, count: 1, to: segment.to });
      return;
    }
    const column = Math.floor((viewFraction(view, from) * plotWidth) / columnPx);
    const key = `${column}:${segment.track}:${segment.tone}`;
    const group = thin.get(key);
    if (group) {
      group.count++;
      group.to = Math.max(group.to, segment.to);
    } else {
      const drawn = { segment, index, count: 1, to: segment.to };
      thin.set(key, drawn);
      out.push(drawn);
    }
  });
  return out.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------------------------
// Filters

export interface TimelineFilter {
  categories: ReadonlySet<Category>;
  /** Nobody picked shows everyone. */
  people: ReadonlySet<string>;
}

const involves = (filter: TimelineFilter, people: readonly string[]) =>
  filter.people.size === 0 || people.some((p) => filter.people.has(p));

export function filterRows(rows: readonly TimelineRow[], filter: TimelineFilter): TimelineRow[] {
  return rows.filter((r) => filter.categories.has(r.category) && involves(filter, r.people));
}

/** The lanes of the people picked (and the pairs they are in), without the categories that are off. */
export function filterLanes(lanes: readonly Lane[], filter: TimelineFilter): Lane[] {
  return lanes
    .filter((lane) => involves(filter, lane.people))
    .map((lane) => ({
      ...lane,
      segments: lane.segments.filter((s) => filter.categories.has(s.category)),
      marks: lane.marks.filter((m) => filter.categories.has(m.category)),
    }))
    .filter((lane) => lane.segments.length > 0 || lane.marks.length > 0);
}

export function filterReports(
  reports: readonly ReportMarker[],
  filter: TimelineFilter,
): ReportMarker[] {
  if (!filter.categories.has("reports")) return [];
  return reports.filter((r) =>
    involves(
      filter,
      [r.reporterId, r.streamUserId].filter((p): p is string => p !== null),
    ),
  );
}
