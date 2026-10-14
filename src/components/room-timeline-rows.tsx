// The room timeline as a table of events: the incident's window of two minutes either side of a
// report, and the full timeline's events table, which reads what the swimlanes draw without
// looking at them (issue #114).
import { clockLabel, offsetLabel, zoneName } from "~/lib/timeline-axis";
import type { TimelineRow } from "~/lib/timeline-model";
import { Chip } from "./ui";

const th =
  "px-3.5 py-2 text-left text-[10px] tracking-[0.1em] uppercase text-subtle font-semibold bg-canvas border-b border-border-subtle sticky top-0";
const td = "px-3.5 py-1.5 border-b border-border-subtle text-fg-muted align-top";

const CATEGORY_CHIP = {
  presence: "",
  media: "",
  connection: "",
  moderation: "",
  refusals: "caution",
  reports: "caution",
} as const;

/**
 * `rows` as a table. `relativeTo` (a time) shows each row's time as "-1m 12s" or "+30s" from
 * it instead of the clock, the way an incident reads; the row with `highlight` as its report is
 * marked.
 */
export const RowsTable = ({
  label,
  rows,
  relativeTo,
  highlight,
  empty,
}: {
  label: string;
  rows: readonly TimelineRow[];
  relativeTo?: number;
  highlight?: string;
  empty: string;
}) => (
  <div className="max-h-[360px] overflow-auto">
    <table aria-label={label} className="w-full border-collapse text-[11.5px]">
      <thead>
        <tr>
          <th className={`${th} w-[120px] whitespace-nowrap`}>
            {relativeTo === undefined
              ? `time (${zoneName(rows[0]?.t ?? Date.now())})`
              : "from report"}
          </th>
          <th className={`${th} w-[112px]`}>category</th>
          <th className={th}>event</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isReport = highlight !== undefined && row.reportId === highlight;
          return (
            <tr
              key={row.id}
              aria-current={isReport ? "true" : undefined}
              className={
                isReport
                  ? "bg-[color-mix(in_oklch,var(--color-warning)_14%,var(--color-surface))]"
                  : ""
              }
            >
              <td className={`${td} whitespace-nowrap tabular-nums text-subtle`}>
                {relativeTo === undefined
                  ? clockLabel(row.t, true)
                  : isReport
                    ? "report"
                    : offsetLabel(row.t - relativeTo)}
              </td>
              <td className={td}>
                <Chip kind={CATEGORY_CHIP[row.category]}>{row.category}</Chip>
              </td>
              <td className={`${td} ${isReport ? "font-semibold text-fg" : ""}`}>
                {row.text}
                {row.detail && <span className="text-subtle"> · {row.detail}</span>}
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={3} className="text-center p-7 text-subtle text-[11.5px]">
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
