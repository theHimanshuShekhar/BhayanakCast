// The small pieces the admin's quality view (./admin-quality.tsx) and the room's quality modal
// (./room/quality-modal.tsx) put around a ./timeline-chart.tsx chart.
import type { ReactNode } from "react";

/** Megabits per second with one decimal, for an axis or a table cell: `10.7`. */
export const fmtMbps = (bps: number) => (bps / 1_000_000).toFixed(1);

/**
 * The line key of a legend: a short stroke of the series' color, dashed for a reference line
 * (a ceiling, a budget).
 */
export const Key = ({
  color,
  dashed = false,
  children,
}: {
  color: string;
  dashed?: boolean;
  children: ReactNode;
}) => (
  <span className="inline-flex items-center gap-[5px]">
    <i
      className={`inline-block w-3 ${dashed ? "h-0 border-t-2 border-dashed" : "h-0.5"}`}
      style={dashed ? { borderColor: color } : { background: color }}
    />{" "}
    {children}
  </span>
);

/**
 * A chart's title and legend above it. `value` (the number now, if the chart has one) goes under
 * the title in large type, with a dash while there is none.
 */
export const Panel = ({
  title,
  value,
  hasValue = false,
  legend,
  children,
}: {
  title: string;
  /** What the chart reads now; absent shows a dash, once `hasValue` is set. */
  value?: string;
  hasValue?: boolean;
  legend?: ReactNode;
  children: ReactNode;
}) => (
  <div className="min-w-0">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
      <h4 className="m-0 text-[11px] font-bold">{title}</h4>
      {legend && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">{legend}</div>
      )}
    </div>
    {hasValue && (
      <div className="mb-1 text-[20px] font-extrabold tracking-[-0.02em] tabular-nums min-h-[26px]">
        {value ?? <span className="text-muted">&ndash;</span>}
      </div>
    )}
    {children}
  </div>
);
