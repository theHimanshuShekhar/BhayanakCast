// The incident's snapshot (issue #114): how everyone's connections looked when a problem was
// reported, one row per stream with the idle pairs behind a toggle, and a link from each stream
// to that pair's quality timeline. Folded from the browsers' snapshots by
// ../lib/timeline-incident.ts.
import { useState } from "react";
import type { RecentReport } from "~/lib/problem-report";
import { reasonText } from "~/lib/quality-reason";
import { clockLabel, zoneName } from "~/lib/timeline-axis";
import { type SnapshotRow, snapshotRows, TROUBLE_LOSS } from "~/lib/timeline-incident";
import { fmtMbps } from "./chart-parts";
import { Btn, Chip, MonoCaps } from "./ui";

const th =
  "px-3.5 py-2 text-left text-[10px] tracking-[0.1em] uppercase text-subtle font-semibold bg-canvas border-b border-border-subtle sticky top-0";
const td = "px-3.5 py-1.5 border-b border-border-subtle text-fg-muted whitespace-nowrap";
const dash = <span className="text-subtle">—</span>;

const PAIR_CHIP = {
  connected: "ok",
  relayed: "",
  connecting: "caution",
  failed: "caution",
} as const;

function reasonOf(row: SnapshotRow): string | null {
  if (!row.reason) return null;
  // An admin reads the stream from outside it, whichever end's browser said why.
  return reasonText(row.reason, { side: "admin", streamer: row.streamer, viewer: row.viewer })
    .label;
}

/** The snapshot table of `report`: a row per stream, idle pairs shown or hidden. */
export const SnapshotTable = ({
  report,
  onQuality,
}: {
  report: RecentReport;
  /** Open that stream's pair in the quality panel. */
  onQuality: (row: SnapshotRow) => void;
}) => {
  const [showIdle, setShowIdle] = useState(true);
  const all = snapshotRows(report);
  const streams = all.filter((r) => !r.idle);
  const idle = all.length - streams.length;
  const rows = showIdle ? all : streams;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 border-b border-border-subtle bg-canvas">
        <MonoCaps>
          everyone's connections at {clockLabel(Date.parse(report.at), true)}{" "}
          {zoneName(Date.parse(report.at))} · a row per stream
        </MonoCaps>
        {idle > 0 && (
          <Btn
            size="sm"
            variant="ghost"
            aria-pressed={showIdle}
            onClick={() => setShowIdle(!showIdle)}
          >
            {showIdle ? "hide" : "show"} {idle} idle {idle === 1 ? "pair" : "pairs"}
          </Btn>
        )}
      </div>
      <div className="overflow-x-auto">
        <table
          aria-label="snapshot of everyone's connections"
          className="w-full min-w-[860px] border-collapse text-[11.5px]"
        >
          <thead>
            <tr>
              <th className={th}>stream</th>
              <th className={th}>step</th>
              <th className={`${th} !text-right`}>Mbps</th>
              <th className={`${th} !text-right`}>fps</th>
              <th className={`${th} !text-right`}>loss</th>
              <th className={`${th} !text-right`}>rtt</th>
              <th className={th}>path</th>
              <th className={th}>reason</th>
              <th className={th}>pair</th>
              <th className={th}>
                <span className="sr-only">quality</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                data-trouble={r.trouble || undefined}
                className={
                  r.trouble ? "bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)]" : ""
                }
              >
                <td className={td}>
                  {r.idle ? (
                    <span className="text-subtle">
                      {r.streamer} ↔ {r.viewer} · idle
                    </span>
                  ) : (
                    <span className="text-fg">
                      {r.streamer} → {r.viewer}
                    </span>
                  )}
                </td>
                <td className={td}>
                  {r.step ? (
                    <>
                      {r.step}
                      {r.height !== undefined && (
                        <span className="text-subtle">
                          {" "}
                          {r.width ?? "?"}×{r.height}
                        </span>
                      )}
                    </>
                  ) : (
                    dash
                  )}
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {r.bps === undefined ? dash : fmtMbps(r.bps)}
                </td>
                <td className={`${td} text-right tabular-nums`}>{r.fps ?? dash}</td>
                <td
                  className={`${td} text-right tabular-nums ${(r.loss ?? 0) > TROUBLE_LOSS ? "!text-warning-ink font-semibold" : ""}`}
                >
                  {r.loss === undefined ? dash : `${(r.loss * 100).toFixed(1)}%`}
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {r.rttMs === undefined ? dash : `${Math.round(r.rttMs)} ms`}
                </td>
                <td className={td}>{r.path ?? dash}</td>
                <td className={td}>{reasonOf(r) ?? dash}</td>
                <td className={td}>
                  {r.pair ? <Chip kind={PAIR_CHIP[r.pair]}>{r.pair}</Chip> : dash}
                </td>
                <td className={td}>
                  {!r.idle && (
                    <Btn
                      size="sm"
                      aria-label={`Quality of ${r.streamer} to ${r.viewer}`}
                      onClick={() => onQuality(r)}
                    >
                      quality
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center p-7 text-subtle text-[11.5px]">
                  {report.snapshots.length === 0
                    ? "no snapshot came back for this report"
                    : "the snapshots hold no streams"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
