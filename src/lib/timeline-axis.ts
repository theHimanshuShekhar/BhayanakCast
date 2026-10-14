/**
 * The time axis of the admin's room timeline (CONTEXT.md, Room timeline): which stretch is in
 * view, how it zooms and pans, how a span is cut to it, where its ticks fall, and the window
 * around a problem report. Pure numbers (epoch milliseconds), so it is tested without a browser.
 *
 * The domain is the stretch the room's timeline covers; the view is the part of it on screen.
 * Short events (a 40 second share, a flap) are a few pixels wide at the full domain, hence zoom.
 */

/** The least a view may span: past this nothing new shows, and a sliver of a brush is a click. */
export const MIN_VIEW_MS = 5_000;
/** An incident shows what happened this long either side of the report (issue #114). */
export const INCIDENT_WINDOW_MS = 2 * 60_000;

/** A stretch of time. */
export interface Range {
  t0: number;
  t1: number;
}

/** The domain as a view: all of it, and never less than `MIN_VIEW_MS`. */
export function fullView(domain: Range): Range {
  return { t0: domain.t0, t1: Math.max(domain.t1, domain.t0 + MIN_VIEW_MS) };
}

/** Where `t` falls along `view`: 0 at its start, 1 at its end. */
export const viewFraction = (view: Range, t: number) => (t - view.t0) / (view.t1 - view.t0);

/** `view` moved so it lies inside `domain`, if it fits. */
function slideInside(view: Range, domain: Range): Range {
  const room = fullView(domain);
  const span = view.t1 - view.t0;
  const t0 = Math.min(Math.max(view.t0, room.t0), room.t1 - span);
  return { t0, t1: t0 + span };
}

/**
 * `view` scaled by `factor` (under 1 zooms in, over 1 out), keeping the time at `anchor` (a
 * fraction along the view, the middle by default) where it was on screen.
 */
export function zoomView(view: Range, domain: Range, factor: number, anchor = 0.5): Range {
  const room = fullView(domain);
  const span = Math.min(room.t1 - room.t0, Math.max(MIN_VIEW_MS, (view.t1 - view.t0) * factor));
  const fixed = view.t0 + (view.t1 - view.t0) * anchor;
  return slideInside({ t0: fixed - span * anchor, t1: fixed + span * (1 - anchor) }, domain);
}

/** `view` moved by `deltaMs`, stopping at the ends of the domain. */
export function panView(view: Range, domain: Range, deltaMs: number): Range {
  return slideInside({ t0: view.t0 + deltaMs, t1: view.t1 + deltaMs }, domain);
}

/** The view a brush from `a` to `b` (either way round) selects, at least `MIN_VIEW_MS` wide. */
export function brushView(domain: Range, a: number, b: number): Range {
  const room = fullView(domain);
  const clamp = (t: number) => Math.min(room.t1, Math.max(room.t0, t));
  const t0 = clamp(Math.min(a, b));
  const t1 = clamp(Math.max(a, b));
  if (t1 - t0 >= MIN_VIEW_MS) return { t0, t1 };
  const middle = (t0 + t1) / 2;
  return slideInside({ t0: middle - MIN_VIEW_MS / 2, t1: middle + MIN_VIEW_MS / 2 }, domain);
}

/** A span as drawn in a view. */
export interface ClippedSpan {
  from: number;
  to: number;
  /** It began before the view / runs on past it, so its edge there is not its own. */
  cutStart: boolean;
  cutEnd: boolean;
}

/** `from`..`to` cut to `view`; null if no part of it is in view. A span of no length is an instant. */
export function clipSpan(view: Range, from: number, to: number): ClippedSpan | null {
  if (to < view.t0 || from > view.t1) return null;
  return {
    from: Math.max(from, view.t0),
    to: Math.min(to, view.t1),
    cutStart: from < view.t0,
    cutEnd: to > view.t1,
  };
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** Steps a tick may be apart, finest first. */
const STEPS = [
  SECOND,
  2 * SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
];

// ---------------------------------------------------------------------------------------------
// Clock times
//
// The admin reads times in their browser's own time zone, with the zone named (an IANA name such
// as "Asia/Kolkata"; undefined is the browser's). Every function takes the zone last, so a test
// can pin one. These run in the browser after a click (the panel is not server-rendered), so the
// zone is never the server's.

/** The browser's own time zone, as an IANA name. */
export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone: constructing one is the costly part, and a chart asks for hundreds of labels. */
function formatter(zone: string | undefined): Intl.DateTimeFormat {
  const key = zone ?? "";
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      // Digits and calendar are fixed: only the zone's name follows the browser's language.
      numberingSystem: "latn",
      calendar: "gregory",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
    formatters.set(key, f);
  }
  return f;
}

interface ClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** "IST", or "GMT+5:30" where the browser's language has no short name for it. */
  zone: string;
}

function clockParts(t: number, zone: string | undefined): ClockParts {
  const got: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(t)) got[part.type] = part.value;
  const n = (type: string) => Number(got[type]);
  return {
    year: n("year"),
    month: n("month"),
    day: n("day"),
    hour: n("hour"),
    minute: n("minute"),
    second: n("second"),
    zone: got.timeZoneName ?? "",
  };
}

/** How far the zone's clock is ahead of UTC at `t`, in ms (+5:30 in Kolkata). */
function offsetMs(t: number, zone: string | undefined): number {
  const p = clockParts(t, zone);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1_000) * 1_000
  );
}

const two = (n: number) => String(n).padStart(2, "0");

/** `22:35` or, with seconds, `22:35:04`, on the zone's clock. */
export function clockLabel(t: number, seconds: boolean, zone?: string): string {
  const p = clockParts(t, zone);
  const hm = `${two(p.hour)}:${two(p.minute)}`;
  return seconds ? `${hm}:${two(p.second)}` : hm;
}

/** "-1m 12s", "+30s", "0s": how far a moment is from another, `ms` after it (negative: before). */
export function offsetLabel(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1_000);
  if (s === 0) return "0s";
  const text = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}`;
  return `${ms < 0 ? "-" : "+"}${text}`;
}

/** The zone's name at `t` ("IST", "CEST"): daylight saving changes it. */
export const zoneName = (t: number, zone?: string): string => clockParts(t, zone).zone;

/** "10 Oct 22:35:04 IST": a moment in full, with the zone it is in. */
export function dateTimeLabel(t: number, zone?: string): string {
  const p = clockParts(t, zone);
  return `${p.day} ${MONTHS[p.month - 1]} ${clockLabel(t, true, zone)} ${p.zone}`;
}

/**
 * Up to `count` ticks along `view`, on round times of the zone's clock (every 2 minutes, every
 * 5 seconds, every 2 hours on the local hour even where the zone is a half hour off UTC). The
 * step is the finest that gives no more than `count`, so labels never crowd; the labels carry
 * seconds only when the step is under a minute, so none reads the same as another.
 */
export function axisTicks(
  view: Range,
  count: number,
  zone?: string,
): { t: number; label: string }[] {
  const span = view.t1 - view.t0;
  const step = STEPS.find((s) => span / s <= count) ?? (STEPS.at(-1) as number);
  const seconds = step < MINUTE;
  // Round on the zone's clock, then put the result back on the UTC one. The offset is taken at
  // the start of the view, so a daylight saving change inside a view of hours drifts a tick.
  const offset = offsetMs(view.t0, zone);
  const ticks: { t: number; label: string }[] = [];
  for (let t = Math.ceil((view.t0 + offset) / step) * step - offset; t <= view.t1; t += step) {
    ticks.push({ t, label: clockLabel(t, seconds, zone) });
  }
  return ticks;
}

/** What is within `ms` either side of `at`, in the order given (anything with a time `t`). */
export function windowAround<T extends { t: number }>(
  items: readonly T[],
  at: number,
  ms = INCIDENT_WINDOW_MS,
): T[] {
  return items.filter((item) => Math.abs(item.t - at) <= ms);
}
