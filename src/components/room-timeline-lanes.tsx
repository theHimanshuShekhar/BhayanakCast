// The swimlanes of the admin's room timeline (issue #114, variant B): a time axis, a lane for
// each person and each pair, and the problem reports as markers across all of them. Custom SVG
// like ./timeline-chart.tsx, whose rules it follows (dataviz): the viewBox is the chart's width
// in pixels so text is the same size at any layout, hairline grid, thin marks with a surface
// ring, text in ink tokens, and colour only for state (red is "live": the share track).
//
// What shows is `view`, a stretch of the model's domain (../lib/timeline-axis.ts). Ctrl or
// cmd with the wheel zooms about the pointer, shift with the wheel pans, dragging selects a
// stretch to zoom to, and `+` and `-` zoom from the keyboard; the buttons and the reset live
// with the panel (./room-timeline.tsx). Hovering or focusing an item reads it out below the
// chart, and the panel's events table holds the same things for reading without the chart.
//
// A lane is drawn by a memoised `LaneBody`, so a hover (which changes only the active item) draws
// the one lane it is on and not all of them, and what a lane draws is folded to what its pixels
// can show: marks of one kind in one column are one, and a run of sub-pixel bars is one
// (../lib/timeline-model.ts, `groupMarks` and `visibleSegments`).
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { fmtDuration } from "~/lib/format";
import { PROBLEM_CATEGORY_LABELS } from "~/lib/problem-report";
import {
  axisTicks,
  brushView,
  clockLabel,
  panView,
  type Range,
  viewFraction,
  zoneName,
  zoomView,
} from "~/lib/timeline-axis";
import {
  type DrawnSegment,
  groupMarks,
  type Lane,
  type Mark,
  type MarkGroup,
  type MarkKind,
  type ReportMarker,
  type Tone,
  type Track,
  visibleSegments,
} from "~/lib/timeline-model";

const FONT = 10;
const LABEL_FONT = 11;
const PAD_R = 14;
const AXIS_H = 56;
const CAPTION_H = 22;
const PERSON_H = 62;
const PAIR_H = 34;
/** A drag shorter than this is a click, not a selection. */
const BRUSH_MIN_PX = 5;
/** One wheel notch (about 100) zooms by this much. */
const WHEEL_ZOOM = 1.0025;
/** Marks of one kind this close are drawn as one. */
const MARK_COLUMN_PX = 9;

const TRACK_BOX: Record<Track, { y: number; h: number }> = {
  presence: { y: 20, h: 8 },
  host: { y: 29, h: 3 },
  share: { y: 35, h: 8 },
  cam: { y: 45, h: 5 },
  mic: { y: 52, h: 5 },
  state: { y: 20, h: 8 },
};

const mix = (color: string, pct: number) =>
  `color-mix(in oklch, var(${color}) ${pct}%, transparent)`;

/**
 * How a segment is painted, by what it says. Never a colour a reader must decode alone: the
 * track, the legend and the readout say it too. Amber is a fill too light to be seen on the
 * light theme's white, so it carries an outline in `warning-mark`.
 */
const TONE_PAINT: Record<Tone, { fill: string; stroke?: string }> = {
  present: { fill: mix("--color-success", 30), stroke: mix("--color-success-ink", 75) },
  host: { fill: "var(--color-primary)" },
  grace: { fill: "var(--color-warning)", stroke: "var(--color-warning-mark)" },
  share: { fill: "var(--color-live)" },
  cam: { fill: "var(--color-viz-1)" },
  mic: { fill: "var(--color-viz-2)" },
  connecting: { fill: "var(--color-surface-3)", stroke: "var(--color-border-strong)" },
  connected: { fill: mix("--color-success", 45), stroke: mix("--color-success-ink", 85) },
  disconnected: { fill: "var(--color-warning)", stroke: "var(--color-warning-mark)" },
  failed: { fill: "var(--color-warning)", stroke: "var(--color-warning-mark)" },
};

type Shape = "up" | "down" | "diamond" | "ring" | "square" | "cross";
interface MarkLook {
  shape: Shape;
  /** Painted solid; else just the outline. */
  solid: boolean;
  color: string;
  meaning: string;
}
const MARK_LOOK: Record<MarkKind, MarkLook> = {
  moderation: { shape: "up", solid: true, color: "var(--color-muted)", meaning: "moderation" },
  refusal: {
    shape: "ring",
    solid: false,
    color: "var(--color-warning-mark)",
    meaning: "refusals",
  },
  error: { shape: "cross", solid: false, color: "var(--color-warning-mark)", meaning: "error" },
  takeover: { shape: "square", solid: true, color: "var(--color-muted)", meaning: "takeover" },
  path: { shape: "diamond", solid: false, color: "var(--color-primary)", meaning: "path (direct)" },
  restart: {
    shape: "down",
    solid: false,
    color: "var(--color-warning-mark)",
    meaning: "restart",
  },
  step: { shape: "down", solid: true, color: "var(--color-viz-2)", meaning: "quality step" },
  codec: { shape: "diamond", solid: true, color: "var(--color-viz-2)", meaning: "codec switch" },
};
const lookOf = (m: { kind: MarkKind; relay?: boolean }): MarkLook =>
  m.kind === "path" && m.relay
    ? { ...MARK_LOOK.path, solid: true, meaning: "path (relayed)" }
    : MARK_LOOK[m.kind];

const R = 5;
/** A mark's outline, centred on the origin. */
function shapePath(shape: Shape): string {
  switch (shape) {
    case "up":
      return `M0 ${-R} L${R} ${R - 1} L${-R} ${R - 1} Z`;
    case "down":
      return `M0 ${R} L${R} ${-R + 1} L${-R} ${-R + 1} Z`;
    case "diamond":
      return `M0 ${-R} L${R} 0 L0 ${R} L${-R} 0 Z`;
    case "square":
      return `M${-R + 1} ${-R + 1} H${R - 1} V${R - 1} H${-R + 1} Z`;
    case "cross":
      return `M${-R + 1} ${-R + 1} L${R - 1} ${R - 1} M${R - 1} ${-R + 1} L${-R + 1} ${R - 1}`;
    case "ring":
      return `M${-R + 1} 0 a${R - 1} ${R - 1} 0 1 0 ${2 * (R - 1)} 0 a${R - 1} ${R - 1} 0 1 0 ${-2 * (R - 1)} 0`;
  }
}

const Glyph = ({
  look,
  x,
  y,
  active = false,
}: {
  look: MarkLook;
  x: number;
  y: number;
  active?: boolean;
}) => (
  <g transform={`translate(${x} ${y})`} pointerEvents="none">
    {/* The surface ring that keeps a mark apart from the bar under it. */}
    <path
      d={shapePath(look.shape)}
      fill="none"
      style={{ stroke: "var(--color-surface)" }}
      strokeWidth={look.shape === "cross" ? 5 : 4}
      strokeLinejoin="round"
    />
    <path
      d={shapePath(look.shape)}
      style={{
        fill: look.solid ? look.color : "none",
        stroke: look.color,
      }}
      strokeWidth={look.shape === "cross" ? 2 : 1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    {active && (
      <circle r={R + 4} fill="none" style={{ stroke: "var(--color-primary)" }} strokeWidth={2} />
    )}
  </g>
);

/** The width of `ref`'s element, excluding its scrollbar, as it changes. */
function useClientWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(320, el.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** What hovering or focusing reads out. */
interface Item {
  key: string;
  t: number;
  /** Where it ends, for a stretch or a group of marks. */
  to?: number;
  open?: boolean;
  label: string;
  detail?: string;
}

const when = (item: Item) =>
  item.to === undefined || item.to === item.t
    ? clockLabel(item.t, true)
    : `${clockLabel(item.t, true)}–${clockLabel(item.to, true)}${item.open ? " and still going" : ""} (${fmtDuration((item.to - item.t) / 1_000)})`;

/** Truncate a lane label to what fits, by character count (the face is monospace). */
const clip = (text: string, width: number) => {
  const chars = Math.max(4, Math.floor(width / (LABEL_FONT * 0.62)));
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
};

/** A lane with what it draws at this view and width, and what can be read out of it. */
interface LaneDraw {
  lane: Lane;
  segments: DrawnSegment[];
  groups: MarkGroup[];
  items: Item[];
}

function drawLane(lane: Lane, view: Range, plotW: number): LaneDraw {
  const segments = visibleSegments(lane.segments, view, plotW);
  const groups = groupMarks(lane.marks, view, plotW, MARK_COLUMN_PX);
  const items: Item[] = [
    ...segments.map(({ segment, index, count, to }) => ({
      key: `${lane.id}:s${index}`,
      t: segment.from,
      to: count > 1 ? to : segment.to,
      open: count === 1 && segment.open,
      label:
        count > 1
          ? `${segment.label} (and ${count - 1} more here: zoom in to separate them)`
          : segment.label,
    })),
    ...groups.map((group, i) => {
      const first = group.marks[0] as Mark;
      const n = group.marks.length;
      return {
        key: `${lane.id}:m${i}`,
        t: group.t,
        ...(n > 1 && { to: group.to }),
        label:
          n > 1
            ? `${first.label} (and ${n - 1} more like it here: zoom in to separate them)`
            : first.label,
        ...(first.detail && { detail: first.detail }),
      };
    }),
  ].sort((a, b) => a.t - b.t);
  return { lane, segments, groups, items };
}

const LaneBody = memo(function LaneBody({
  draw,
  top,
  h,
  view,
  labelW,
  plotW,
  W,
  pattern,
  activeKey,
  cursor,
  onEnter,
  onLeave,
}: {
  draw: LaneDraw;
  top: number;
  h: number;
  view: Range;
  labelW: number;
  plotW: number;
  W: number;
  pattern: string;
  /** The key of the active item, if it is this lane's. */
  activeKey: string | null;
  /** The keyboard's lane. */
  cursor: boolean;
  onEnter: (key: string) => void;
  onLeave: (key: string) => void;
}) {
  const { lane } = draw;
  const x = (t: number) => labelW + plotW * viewFraction(view, t);
  const relay = [...lane.marks].reverse().find((m) => m.kind === "path")?.relay;
  const markY = top + (lane.kind === "person" ? 10 : 9);
  return (
    <g data-lane={lane.id}>
      {cursor && (
        <rect
          x={1}
          y={top + 1}
          width={W - 2}
          height={h - 2}
          rx={3}
          fill="none"
          style={{ stroke: "var(--color-primary)" }}
          strokeWidth={2}
          pointerEvents="none"
        />
      )}
      <line
        x1={0}
        x2={W}
        y1={top + h - 0.5}
        y2={top + h - 0.5}
        style={{ stroke: "var(--color-border-subtle)" }}
      />
      <text
        x={10}
        y={top + (lane.kind === "person" ? 14 : h / 2 + 4)}
        fontSize={LABEL_FONT}
        fontFamily="inherit"
        fontWeight={lane.kind === "person" ? 600 : 400}
        style={{ fill: lane.kind === "person" ? "var(--color-fg)" : "var(--color-fg-muted)" }}
      >
        <title>{lane.label}</title>
        {clip(lane.label, labelW - (relay ? 36 : 20))}
        {relay && (
          <tspan dx={5} fontSize={FONT} style={{ fill: "var(--color-primary-strong)" }}>
            relay
          </tspan>
        )}
      </text>
      {draw.segments.map(({ segment: s, index, count, to }) => {
        const box = TRACK_BOX[s.track];
        const from = Math.max(s.from, view.t0);
        const x0 = x(from);
        const w = Math.max(2, x(Math.min(count > 1 ? to : s.to, view.t1)) - x0);
        const paint = TONE_PAINT[s.tone];
        const key = `${lane.id}:s${index}`;
        return (
          <g key={key}>
            <rect
              data-track={s.track}
              data-tone={s.tone}
              x={x0}
              y={top + box.y}
              width={w}
              height={box.h}
              rx={2}
              style={{
                fill: s.tone === "failed" ? `url(#${pattern})` : paint.fill,
                stroke: paint.stroke ?? "var(--color-surface)",
              }}
              strokeWidth={paint.stroke ? 1 : 0.75}
              pointerEvents="none"
            />
            {activeKey === key && (
              <rect
                x={x0 - 2}
                y={top + box.y - 2}
                width={w + 4}
                height={box.h + 4}
                rx={3}
                fill="none"
                style={{ stroke: "var(--color-primary)" }}
                strokeWidth={2}
                pointerEvents="none"
              />
            )}
            {/* A target bigger than the bar: a 40 second share is a few pixels wide. */}
            <rect
              x={x0 - Math.max(0, (12 - w) / 2)}
              y={top + box.y - 3}
              width={Math.max(12, w)}
              height={box.h + 6}
              fill="transparent"
              onPointerEnter={() => onEnter(key)}
              onPointerLeave={() => onLeave(key)}
            />
          </g>
        );
      })}
      {draw.groups.map((group, i) => {
        const key = `${lane.id}:m${i}`;
        const n = group.marks.length;
        return (
          <g key={key} data-mark={group.kind} data-count={n}>
            <Glyph look={lookOf(group)} x={x(group.t)} y={markY} active={activeKey === key} />
            {n > 1 && (
              <text
                x={x(group.t) + R + 3}
                y={markY + 3.5}
                fontSize={FONT}
                fontFamily="inherit"
                className="tabular-nums"
                style={{ fill: "var(--color-muted)" }}
                pointerEvents="none"
              >
                {n}
              </text>
            )}
            <circle
              cx={x(group.t)}
              cy={markY}
              r={12}
              fill="transparent"
              onPointerEnter={() => onEnter(key)}
              onPointerLeave={() => onLeave(key)}
            />
          </g>
        );
      })}
    </g>
  );
});

export const RoomTimelineLanes = ({
  lanes,
  reports,
  domain,
  view,
  onView,
  onOpenReport,
  reportLabel,
}: {
  lanes: Lane[];
  reports: ReportMarker[];
  /** What a report reads as when hovered or focused: who reported what, with the note. */
  reportLabel: (report: ReportMarker) => string;
  /** The whole stretch the timeline covers: a view never goes outside it. */
  domain: Range;
  view: Range;
  onView: (view: Range) => void;
  onOpenReport: (id: string) => void;
}) => {
  const [wrapper, W] = useClientWidth();
  const patternId = useId();
  // Room for "name ↔ name" on a wide screen; the full label is in a tooltip when it is cut.
  const labelW = W >= 1000 ? 224 : W >= 720 ? 176 : 112;
  const plotW = Math.max(120, W - labelW - PAD_R);
  const x = (t: number) => labelW + plotW * viewFraction(view, t);
  const [active, setActive] = useState<string | null>(null);
  const [brush, setBrush] = useState<{ a: number; b: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const [cursorLane, setCursorLane] = useState<string | null>(null);
  const onEnter = useCallback((key: string) => setActive(key), []);
  const onLeave = useCallback((key: string) => setActive((a) => (a === key ? null : a)), []);

  // What each lane draws, and can be read out of, at this view: not redone on a hover.
  const draws = useMemo(
    () => lanes.map((lane) => drawLane(lane, view, plotW)),
    [lanes, view, plotW],
  );
  const people = draws.filter((d) => d.lane.kind === "person");
  const pairs = draws.filter((d) => d.lane.kind === "pair");
  const rows: { draw: LaneDraw; y: number; h: number }[] = [];
  let y = 0;
  if (people.length) y += CAPTION_H;
  for (const draw of people) {
    rows.push({ draw, y, h: PERSON_H });
    y += PERSON_H;
  }
  const pairsCaptionY = y;
  if (pairs.length) y += CAPTION_H;
  for (const draw of pairs) {
    rows.push({ draw, y, h: PAIR_H });
    y += PAIR_H;
  }
  const bodyH = Math.max(y, 1);

  const cursorId = rows.some((r) => r.draw.lane.id === cursorLane)
    ? cursorLane
    : (rows[0]?.draw.lane.id ?? null);
  const cursorDraw = draws.find((d) => d.lane.id === cursorId);
  const flagged = active?.startsWith("report:")
    ? reports.find((r) => `report:${r.id}` === active)
    : undefined;
  const current: Item | undefined = flagged
    ? { key: active as string, t: flagged.t, label: reportLabel(flagged) }
    : active
      ? draws.flatMap((d) => d.items).find((item) => item.key === active)
      : undefined;

  // ---- zoom and pan with the wheel
  const live = useRef({ view, domain, onView, labelW, plotW });
  live.current = { view, domain, onView, labelW, plotW };
  // Bound once (a wheel listener has to be non-passive, which React's onWheel is not); the
  // handler reads what changes through `live`, and the ref's element never does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { view, domain, onView, labelW, plotW } = live.current;
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (e.ctrlKey || e.metaKey) {
        // Zoom about the pointer. The page's own zoom is what ctrl + wheel would do otherwise.
        e.preventDefault();
        const px = e.clientX - el.getBoundingClientRect().left;
        const anchor = Math.min(1, Math.max(0, (px - labelW) / plotW));
        onView(zoomView(view, domain, WHEEL_ZOOM ** e.deltaY, anchor));
      } else if (horizontal) {
        e.preventDefault();
        const delta = e.deltaX || e.deltaY;
        onView(panView(view, domain, ((view.t1 - view.t0) * delta) / plotW));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- a drag selects a stretch to zoom to
  const timeAt = (clientX: number) => {
    const rect = wrapper.current?.getBoundingClientRect();
    const px = clientX - (rect?.left ?? 0);
    const f = Math.min(1, Math.max(0, (px - labelW) / plotW));
    return view.t0 + f * (view.t1 - view.t0);
  };
  const drag = useRef<{ startX: number; a: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest("[data-flag]")) return;
    if (e.clientX - (wrapper.current?.getBoundingClientRect().left ?? 0) < labelW) return;
    drag.current = { startX: e.clientX, a: timeAt(e.clientX) };
    wrapper.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && Math.abs(e.clientX - d.startX) >= BRUSH_MIN_PX)
      setBrush({ a: d.a, b: timeAt(e.clientX) });
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setBrush(null);
    if (wrapper.current?.hasPointerCapture(e.pointerId))
      wrapper.current.releasePointerCapture(e.pointerId);
    if (d && Math.abs(e.clientX - d.startX) >= BRUSH_MIN_PX)
      onView(brushView(domain, d.a, timeAt(e.clientX)));
  };

  // ---- keyboard: one tab stop; up and down choose a lane, left and right step through it
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!cursorDraw) return;
    const list = cursorDraw.items;
    const at = list.findIndex((i) => i.key === active);
    if (e.key === "ArrowRight") setActive(list[Math.min(list.length - 1, at + 1)]?.key ?? null);
    else if (e.key === "ArrowLeft") setActive(list[Math.max(0, at - 1)]?.key ?? null);
    else if (e.key === "Home") setActive(list[0]?.key ?? null);
    else if (e.key === "End") setActive(list.at(-1)?.key ?? null);
    else if (e.key === "Escape") setActive(null);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const order = rows.map((r) => r.draw.lane.id);
      const next = order[order.indexOf(cursorDraw.lane.id) + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) setCursorLane(next);
      setActive(null);
    } else if (e.key === "+" || e.key === "=" || e.key === "-") {
      onView(zoomView(view, domain, e.key === "-" ? 1.5 : 1 / 1.5));
      return;
    } else return;
    e.preventDefault();
  };

  const ticks = axisTicks(view, plotW >= 560 ? 8 : 4);
  const flags = reports.filter((r) => r.t >= view.t0 && r.t <= view.t1);
  const pattern = `${patternId}-hatch`;

  const brushRect = brush && (
    <rect
      x={x(Math.min(brush.a, brush.b))}
      width={Math.abs(x(brush.b) - x(brush.a))}
      y={0}
      height="100%"
      style={{
        fill: "var(--color-primary-soft)",
        stroke: "var(--color-primary)",
      }}
      strokeWidth={1}
      pointerEvents="none"
    />
  );

  return (
    <div>
      <div
        ref={wrapper}
        data-testid="timeline-lanes"
        className="relative max-h-[560px] touch-pan-y overflow-y-auto overflow-x-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: an SVG group; a fieldset can't be one */}
        <svg
          width={W}
          height={AXIS_H}
          viewBox={`0 0 ${W} ${AXIS_H}`}
          role="group"
          aria-label="time axis and problem reports"
          className="sticky top-0 z-10 block"
        >
          <rect width={W} height={AXIS_H} style={{ fill: "var(--color-surface)" }} />
          <text
            x={10}
            y={AXIS_H - 10}
            fontSize={FONT}
            style={{ fill: "var(--color-subtle)" }}
            fontFamily="inherit"
          >
            {zoneName(view.t0)}
          </text>
          <line
            x1={labelW}
            x2={W - PAD_R}
            y1={AXIS_H - 0.5}
            y2={AXIS_H - 0.5}
            style={{ stroke: "var(--color-border)" }}
          />
          {ticks.map((tick) => (
            <g key={tick.t}>
              <line
                x1={x(tick.t)}
                x2={x(tick.t)}
                y1={AXIS_H - 6}
                y2={AXIS_H}
                style={{ stroke: "var(--color-border-strong)" }}
              />
              <text
                x={x(tick.t)}
                y={AXIS_H - 10}
                textAnchor="middle"
                fontSize={FONT}
                fontFamily="inherit"
                style={{ fill: "var(--color-muted)" }}
                className="tabular-nums"
              >
                {tick.label}
              </text>
            </g>
          ))}
          {flags.map((r, i) => {
            const text = PROBLEM_CATEGORY_LABELS[r.category];
            const w = text.length * 6.3 + 22;
            const fx = Math.min(W - PAD_R - w, Math.max(labelW, x(r.t) - w / 2));
            const fy = 3 + (i % 2) * 17;
            const label = `open the ${text} report at ${clockLabel(r.t, true)}`;
            return (
              // biome-ignore lint/a11y/useSemanticElements: an SVG group; a <button> can't live here
              <g
                key={r.id}
                data-flag
                data-report={r.id}
                role="button"
                tabIndex={0}
                aria-label={label}
                className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-[var(--color-primary)] [&:focus-visible>rect]:stroke-2"
                onClick={() => onOpenReport(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenReport(r.id);
                  }
                }}
                onPointerEnter={() => setActive(`report:${r.id}`)}
                onPointerLeave={() => setActive((a) => (a === `report:${r.id}` ? null : a))}
                onFocus={() => setActive(`report:${r.id}`)}
                onBlur={() => setActive((a) => (a === `report:${r.id}` ? null : a))}
              >
                <title>{label}</title>
                {/* The whole box is the target, not just the painted label and hairline. */}
                <rect x={fx} y={fy} width={w} height={AXIS_H - fy} fill="transparent" />
                <rect
                  x={fx}
                  y={fy}
                  width={w}
                  height={15}
                  rx={3}
                  style={{ fill: "var(--color-warning)", stroke: "var(--color-warning-mark)" }}
                  strokeWidth={1.5}
                />
                <text
                  x={fx + 7}
                  y={fy + 11}
                  fontSize={FONT}
                  fontFamily="inherit"
                  fontWeight={600}
                  style={{ fill: "var(--color-primary-ink)" }}
                >
                  ⚑ {text}
                </text>
                <line
                  x1={x(r.t)}
                  x2={x(r.t)}
                  y1={fy + 15}
                  y2={AXIS_H}
                  style={{ stroke: "var(--color-warning-mark)" }}
                  strokeWidth={1.5}
                />
              </g>
            );
          })}
          {brushRect}
        </svg>

        {/* One tab stop for all the lanes (a full room has 65): the arrow keys move within it. */}
        <svg
          width={W}
          height={bodyH}
          viewBox={`0 0 ${W} ${bodyH}`}
          role="application"
          // The lanes are read with the arrow keys (one tab stop for all of them: a full room has
          // 65), and each item is read out in the status line below.
          // biome-ignore lint/a11y/noNoninteractiveTabindex: see above
          tabIndex={0}
          aria-label="swimlanes, a lane for each person and each pair. Up and down choose a lane, left and right step through what is in it, plus and minus zoom."
          className="block outline-none"
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setActive(null);
          }}
        >
          <defs>
            <pattern
              id={pattern}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="5" height="5" style={{ fill: "var(--color-surface)" }} />
              <rect width="2.5" height="5" style={{ fill: "var(--color-warning-mark)" }} />
            </pattern>
          </defs>
          {ticks.map((tick) => (
            <line
              key={tick.t}
              x1={x(tick.t)}
              x2={x(tick.t)}
              y1={0}
              y2={bodyH}
              style={{ stroke: "var(--color-border-subtle)" }}
            />
          ))}
          {flags.map((r) => (
            <line
              key={r.id}
              x1={x(r.t)}
              x2={x(r.t)}
              y1={0}
              y2={bodyH}
              style={{ stroke: "var(--color-warning-mark)" }}
              strokeWidth={1.5}
              pointerEvents="none"
            />
          ))}
          {people.length > 0 && <Caption y={0}>people</Caption>}
          {pairs.length > 0 && (
            <Caption y={pairsCaptionY}>connections · a lane for each pair</Caption>
          )}
          {rows.map(({ draw, y: top, h }) => (
            <LaneBody
              key={draw.lane.id}
              draw={draw}
              top={top}
              h={h}
              view={view}
              labelW={labelW}
              plotW={plotW}
              W={W}
              pattern={pattern}
              activeKey={active?.startsWith(`${draw.lane.id}:`) ? active : null}
              cursor={focused && draw.lane.id === cursorId}
              onEnter={onEnter}
              onLeave={onLeave}
            />
          ))}
          {brushRect}
        </svg>
      </div>
      <p
        role="status"
        aria-live="polite"
        data-testid="timeline-readout"
        className="m-0 mt-2 min-h-[34px] text-[11.5px] text-fg-muted"
      >
        {current ? (
          <>
            <b className="tabular-nums text-fg">{when(current)}</b> · {current.label}
            {current.detail && <span className="text-subtle"> · {current.detail}</span>}
          </>
        ) : focused && cursorDraw ? (
          <>
            <b className="text-fg">{cursorDraw.lane.label}</b> · {cursorDraw.items.length}{" "}
            {cursorDraw.items.length === 1 ? "item" : "items"} in view · left and right step through
            them
          </>
        ) : (
          <span className="text-subtle">
            hover or focus a bar or mark to read it · arrow keys step through a lane
          </span>
        )}
      </p>
    </div>
  );
};

const Caption = ({ y, children }: { y: number; children: ReactNode }) => (
  <text
    x={10}
    y={y + 15}
    fontSize={FONT}
    fontFamily="inherit"
    letterSpacing="0.12em"
    style={{ fill: "var(--color-subtle)", textTransform: "uppercase" }}
  >
    {children}
  </text>
);

/** The key to the chart: each colour with the track it is on, and each mark with its shape. */
export const LanesLegend = () => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-muted">
    {(
      [
        ["in the room", "present"],
        ["host", "host"],
        ["sharing", "share"],
        ["camera", "cam"],
        ["mic", "mic"],
        ["reconnect grace", "grace"],
        ["connected", "connected"],
        ["connecting", "connecting"],
        ["disconnected", "disconnected"],
        ["failed", "failed"],
      ] as [string, Tone][]
    ).map(([text, tone]) => (
      <span key={tone} className="inline-flex items-center gap-1.5">
        <svg width="14" height="8" aria-hidden="true">
          <rect
            x="0.5"
            y="0.5"
            width="13"
            height="7"
            rx="2"
            style={{
              fill: TONE_PAINT[tone].fill,
              stroke: TONE_PAINT[tone].stroke ?? "none",
            }}
          />
          {tone === "failed" && (
            <path
              d="M0 8 L8 0 M6 8 L14 0"
              style={{ stroke: "var(--color-warning-mark)" }}
              strokeWidth="2"
            />
          )}
        </svg>
        {text}
      </span>
    ))}
    {(
      [
        ["moderation", MARK_LOOK.moderation],
        ["takeover", MARK_LOOK.takeover],
        ["refusals", MARK_LOOK.refusal],
        ["error", MARK_LOOK.error],
        ["path: direct", MARK_LOOK.path],
        ["path: relayed", { ...MARK_LOOK.path, solid: true }],
        ["restart", MARK_LOOK.restart],
        ["quality step", MARK_LOOK.step],
        ["codec switch", MARK_LOOK.codec],
      ] as [string, MarkLook][]
    ).map(([text, look]) => (
      <span key={text} className="inline-flex items-center gap-1.5">
        <svg width="12" height="12" aria-hidden="true">
          <Glyph look={look} x={6} y={6} />
        </svg>
        {text}
      </span>
    ))}
    <span className="inline-flex items-center gap-1.5">
      <svg width="14" height="12" aria-hidden="true">
        <rect
          x="0.5"
          y="0.5"
          width="13"
          height="11"
          rx="2"
          style={{ fill: "var(--color-warning)", stroke: "var(--color-warning-mark)" }}
        />
      </svg>
      problem report
    </span>
  </div>
);
