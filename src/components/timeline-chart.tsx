// A session over time, for the admin's quality view: custom SVG like ./charts.tsx, whose axis and
// grid styles it shares. Built to the dataviz rules: one axis per chart, 2px lines, an end dot
// ringed in the surface color, hairline grid, text in ink tokens, and a hover readout of every
// series at the nearest time.
//
// Unlike ./charts.tsx, whose fixed viewBox scales with its column, the viewBox here is the
// chart's own width in pixels, so its text is the same size on screen whatever the layout.
import { useEffect, useRef, useState } from "react";
import { fmtDuration } from "~/lib/format";
import { chartFrame } from "./charts";

const { axisText, gridLine } = chartFrame;
/** Wider on the left than the other charts: a tick may be a rung's name. */
const pad = { ...chartFrame.pad, l: 52 };
/** Axis text, in pixels (the viewBox is in pixels). */
const FONT = 10;
/** Used until the chart has been measured (and where nothing can be). */
const FALLBACK_WIDTH = 440;
/** Height of a chart's frame (padding), and of one band per line of a stepped axis, in pixels. */
export const CHART_PAD_Y = pad.t + pad.b;
export const RUNG_BAND = 24;

/** One line of a `TimelineChart`: its points are (time in ms, value), oldest first. */
export interface TimelineSeries {
  key: string;
  label: string;
  /** A CSS color, a `--color-viz-*` variable. Ignored for a `context` line. */
  color: string;
  points: { t: number; v: number }[];
  /** Hold each value until the next one (a rung, a ceiling) rather than draw between them. */
  step?: boolean;
  /** A reference line (a ceiling): muted ink and dashed, not a data color. */
  context?: boolean;
}

/** A round number at or above `value` (1, 2 or 5 times a power of ten). */
const niceMax = (value: number) => {
  if (value <= 0) return 1;
  const unit = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / unit;
  return unit * (mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10);
};

/** The point of `series` nearest in time to `t`. */
const nearest = (series: TimelineSeries, t: number) => {
  let best: { t: number; v: number } | undefined;
  for (const point of series.points) {
    if (!best || Math.abs(point.t - t) < Math.abs(best.t - t)) best = point;
  }
  return best;
};

const lineColor = (s: TimelineSeries) => (s.context ? "var(--color-subtle)" : s.color);

/**
 * The ticks of a time axis from `t0` to `t1` (ms): up to five, fewer on a narrow chart, and never
 * two that read the same (a span of a second shows "0s" once, not five times).
 */
export function timeTicks(t0: number, t1: number, width: number): { t: number; label: string }[] {
  const steps = width >= 360 ? 4 : 2;
  const seen = new Set<string>();
  const ticks: { t: number; label: string }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const label = fmtDuration((t - t0) / 1_000);
    if (seen.has(label)) continue;
    seen.add(label);
    ticks.push({ t, label });
  }
  return ticks;
}

/** The width of `ref`'s element in pixels, as it changes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * The lines of one measure on one axis (never two measures on two). `domain` is the span of the
 * whole session, so a pair's charts line up. Hovering or focusing reads every line at the nearest
 * time (arrow keys move it); the table beside the charts holds the same numbers.
 */
export const TimelineChart = ({
  series,
  domain,
  marks = [],
  height = 120,
  label,
  format,
  yMin = 0,
  yMax,
  yFloor = 0,
  yTicks: wantedTicks,
  yLabel,
}: {
  series: TimelineSeries[];
  /** First and last time shown, ms. */
  domain: [number, number];
  /** Times of events (rung changes), drawn as hairlines. */
  marks?: number[];
  /** In pixels, frame included. */
  height?: number;
  label: string;
  /** How a value reads in the readout. */
  format: (value: number) => string;
  /** The bottom of the axis (default 0). */
  yMin?: number;
  /** The top of the axis; defaults to a round number above the data. */
  yMax?: number;
  /** The least the top of the axis may be (a loss of 0.1% isn't drawn as the whole chart). */
  yFloor?: number;
  /** Where the axis has ticks; defaults to the bottom, the middle and the top. */
  yTicks?: number[];
  /** How an axis tick reads. Defaults to `format`. */
  yLabel?: (value: number) => string;
}) => {
  const [box, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const t0 = domain[0];
  const t1 = domain[1] > domain[0] ? domain[1] : domain[0] + 60_000;
  const w = W - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = yMax ?? niceMax(Math.max(yFloor, ...series.flatMap((s) => s.points.map((p) => p.v))));
  const scaleX = (t: number) => pad.l + (w * (t - t0)) / (t1 - t0);
  const scaleY = (v: number) => pad.t + h - (h * (Math.min(v, max) - yMin)) / (max - yMin);
  const yTicks = wantedTicks ?? [yMin, (yMin + max) / 2, max];
  const xTicks = timeTicks(t0, t1, W);
  const path = (s: TimelineSeries) =>
    s.points
      .map((p, i) => {
        const x = scaleX(p.t).toFixed(1);
        const y = scaleY(p.v).toFixed(1);
        const previous = s.points[i - 1];
        if (!previous) return `M ${x} ${y}`;
        return s.step ? `L ${x} ${scaleY(previous.v).toFixed(1)} L ${x} ${y}` : `L ${x} ${y}`;
      })
      .join(" ");
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
  const move = (from: number | null, by: number) => {
    const at = from === null ? (by > 0 ? -1 : times.length) : times.indexOf(from);
    return times[Math.min(times.length - 1, Math.max(0, at + by))] ?? null;
  };

  return (
    <div ref={box} className="relative">
      <svg
        className="w-full h-auto block"
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus reads the chart by keyboard, as the pointer does
        tabIndex={0}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          setHover(Math.min(t1, Math.max(t0, t0 + ((x - pad.l) / w) * (t1 - t0))));
        }}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            setHover(move(hover, e.key === "ArrowRight" ? 1 : -1));
          } else if (e.key === "Escape") setHover(null);
        }}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={pad.l}
              x2={pad.l + w}
              y1={scaleY(v)}
              y2={scaleY(v)}
              style={gridLine}
              strokeWidth="1"
            />
            <text
              x={pad.l - 6}
              y={scaleY(v)}
              dy="3.5"
              textAnchor="end"
              style={axisText}
              fontSize={FONT}
              fontFamily="inherit"
            >
              {(yLabel ?? format)(v)}
            </text>
          </g>
        ))}
        {xTicks.map(({ t, label: text }, i) => (
          <text
            key={t}
            x={scaleX(t)}
            y={pad.t + h + 15}
            // The first and last stay inside the frame.
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            style={axisText}
            fontSize={FONT}
            fontFamily="inherit"
          >
            {text}
          </text>
        ))}
        {marks.map((t) => (
          <line
            key={t}
            x1={scaleX(t)}
            x2={scaleX(t)}
            y1={pad.t}
            y2={pad.t + h}
            style={{ stroke: "var(--color-border-strong)" }}
            strokeWidth="1"
          />
        ))}
        {series.map((s) => {
          const last = s.points.at(-1);
          return (
            <g key={s.key}>
              <path
                d={path(s)}
                fill="none"
                style={{ stroke: lineColor(s) }}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.context ? "5 4" : undefined}
              />
              {last && !s.context && (
                <circle
                  cx={scaleX(last.t)}
                  cy={scaleY(last.v)}
                  r="4"
                  style={{ fill: lineColor(s), stroke: "var(--color-surface)" }}
                  strokeWidth="2"
                />
              )}
            </g>
          );
        })}
        {hover !== null && (
          <line
            x1={scaleX(hover)}
            x2={scaleX(hover)}
            y1={pad.t}
            y2={pad.t + h}
            style={{ stroke: "var(--color-muted)" }}
            strokeWidth="1"
          />
        )}
      </svg>
      {hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 min-w-[120px] -translate-x-1/2 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 py-1.5 text-[10.5px] shadow-pop"
          style={{ left: `${Math.min(80, Math.max(20, (scaleX(hover) / W) * 100))}%` }}
        >
          <div className="text-muted">{fmtDuration((hover - t0) / 1_000)} in</div>
          {series.map((s) => {
            const p = nearest(s, hover);
            return (
              <div key={s.key} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-fg-muted">
                  <i className="inline-block h-0.5 w-3" style={{ background: lineColor(s) }} />
                  {s.label}
                </span>
                <b className="text-fg">{p ? format(p.v) : "—"}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
