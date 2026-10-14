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

const two = (n: number) => String(n).padStart(2, "0");
/** UTC, like the rest of the dashboard: `22:35` or, with seconds, `22:35:04`. */
export function clockLabel(t: number, seconds: boolean): string {
  const d = new Date(t);
  const hm = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  return seconds ? `${hm}:${two(d.getUTCSeconds())}` : hm;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "10 Oct 22:35:04 UTC": a moment in full, in the UTC the dashboard uses, whatever the browser's locale. */
export function dateTimeLabel(t: number): string {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${clockLabel(t, true)} UTC`;
}

/**
 * Up to `count` ticks along `view`, on round times (every 2 minutes, every 5 seconds...). The
 * step is the finest that gives no more than `count`, so labels never crowd; the labels carry
 * seconds only when the step is under a minute, so none reads the same as another.
 */
export function axisTicks(view: Range, count: number): { t: number; label: string }[] {
  const span = view.t1 - view.t0;
  const step = STEPS.find((s) => span / s <= count) ?? (STEPS.at(-1) as number);
  const seconds = step < MINUTE;
  const ticks: { t: number; label: string }[] = [];
  for (let t = Math.ceil(view.t0 / step) * step; t <= view.t1; t += step) {
    ticks.push({ t, label: clockLabel(t, seconds) });
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
