// The admin's view of a room's video quality (ADR 2 and ADR 11 addendums): a table with a row per
// streamer to viewer pair, and for each a timeline of bitrate, target, QP, loss and rung.
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { pairTimelineQuery, roomQualityQuery } from "~/lib/admin.queries";
import { fmtDuration } from "~/lib/format";
import {
  MAX_PAIR_SAMPLES,
  MAX_ROOM_SAMPLES,
  type PairTimeline,
  type QualityPair,
  type QualityPairRow,
  STARVED_MIN_SECONDS,
} from "~/lib/quality-admin";
import { CHART_PAD_Y, RUNG_BAND, TimelineChart, type TimelineSeries } from "./timeline-chart";
import { Avatar, Btn, Chip, MonoCaps } from "./ui";

const card = "bg-surface border border-border rounded-[var(--radius)] shadow-card";
const th =
  "px-3.5 py-2.5 text-left text-[10px] tracking-[0.1em] uppercase text-subtle font-semibold bg-canvas border-b border-border-subtle sticky top-0";
const td =
  "px-3.5 py-2.5 border-b border-border-subtle text-fg-muted group-last:border-b-0 group-hover:bg-surface-2";

const dash = <span className="text-subtle">—</span>;

const fmtMbps = (bps: number) => (bps / 1_000_000).toFixed(1);
const fmtPercent = (fraction: number) => `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;

const pathLabel = (path: QualityPair["path"]) =>
  path
    ? path.kind === "direct"
      ? "direct"
      : `relay${path.relayProtocol ? ` · ${path.relayProtocol}` : ""}`
    : null;

const pairKey = (p: QualityPair) => `${p.streamerId}/${p.viewerId}/${p.slot}`;

const Person = ({ person }: { person: QualityPairRow["streamer"] }) => (
  <div className="inline-flex items-center gap-2 text-fg-muted">
    <Avatar name={person.username} image={person.image} size="sm" /> {person.username}
  </div>
);

/** The line key of a legend: a short stroke of the series' color. */
const Key = ({ color, children }: { color: string; children: ReactNode }) => (
  <span className="inline-flex items-center gap-[5px]">
    <i className="inline-block h-0.5 w-3" style={{ background: color }} /> {children}
  </span>
);

const Panel = ({
  title,
  legend,
  children,
}: {
  title: string;
  legend?: ReactNode;
  children: ReactNode;
}) => (
  <div className="min-w-0">
    <div className="mb-1 flex items-center justify-between gap-2">
      <h4 className="m-0 text-[11px] font-bold">{title}</h4>
      {legend && <div className="flex gap-3 text-[10px] text-muted">{legend}</div>}
    </div>
    {children}
  </div>
);

const VIZ = ["var(--color-viz-1)", "var(--color-viz-2)"] as const;

/** One pair's charts, loaded when its row opens. */
const PairCharts = ({ roomId, pair }: { roomId: string; pair: QualityPairRow }) => {
  const { data, isError } = useQuery(
    pairTimelineQuery({
      roomId,
      streamerId: pair.streamerId,
      viewerId: pair.viewerId,
      slot: pair.slot,
    }),
  );
  if (isError) return <p className="m-0 text-xs text-live-ink">timeline unavailable</p>;
  if (!data) return <p className="m-0 text-xs text-subtle">loading…</p>;
  return <Timelines timeline={data} />;
};

function Timelines({ timeline }: { timeline: PairTimeline }) {
  const all = [
    timeline.sent,
    timeline.target,
    timeline.ceiling,
    timeline.qp,
    timeline.loss,
    timeline.rung,
  ];
  const times = all.flatMap((points) => points.map((p) => p.t));
  if (times.length === 0) return <p className="m-0 text-xs text-subtle">no windows reported</p>;
  const domain: [number, number] = [Math.min(...times), Math.max(...times)];
  const marks = timeline.changes.map((c) => c.t);
  const bitrate: TimelineSeries[] = [
    { key: "sent", label: "sent", color: VIZ[0], points: timeline.sent },
    { key: "target", label: "target", color: VIZ[1], points: timeline.target },
    {
      key: "ceiling",
      label: "rung max",
      color: VIZ[0],
      points: timeline.ceiling,
      step: true,
      context: true,
    },
  ].filter((s) => s.points.length > 0);
  const rungCount = Math.max(1, timeline.rungs.length);
  const rungName = (v: number) => timeline.rungs[Math.round(v)] ?? "";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))] gap-x-5 gap-y-4">
        <Panel
          title="bitrate (Mbps)"
          legend={bitrate.map((s) => (
            <Key key={s.key} color={s.context ? "var(--color-subtle)" : s.color}>
              {s.label}
            </Key>
          ))}
        >
          <TimelineChart
            label="Bitrate sent, the encoder's target and the rung's maximum, over the session"
            series={bitrate}
            domain={domain}
            marks={marks}
            format={fmtMbps}
          />
        </Panel>
        <Panel title="QP (lower is sharper; latest codec only)">
          <TimelineChart
            label="Average QP over the session"
            series={[{ key: "qp", label: "QP", color: VIZ[0], points: timeline.qp }]}
            domain={domain}
            marks={marks}
            format={(v) => v.toFixed(1)}
          />
        </Panel>
        <Panel title="packet loss">
          <TimelineChart
            label="Packet loss over the session"
            series={[{ key: "loss", label: "loss", color: VIZ[0], points: timeline.loss }]}
            domain={domain}
            marks={marks}
            yFloor={0.05}
            format={fmtPercent}
          />
        </Panel>
        <Panel title="rung">
          <TimelineChart
            label="The sender's quality rung over the session"
            series={[
              { key: "rung", label: "rung", color: VIZ[0], points: timeline.rung, step: true },
            ]}
            domain={domain}
            marks={marks}
            // One band per rung, and the line in the middle of its band.
            height={CHART_PAD_Y + RUNG_BAND * rungCount}
            yMin={-0.5}
            yMax={rungCount - 0.5}
            yTicks={[...Array(rungCount).keys()]}
            format={rungName}
          />
        </Panel>
      </div>
      {timeline.changes.length > 0 && (
        <p className="m-0 text-[10.5px] text-muted">
          rung changes:{" "}
          {timeline.changes
            .map(
              (c) => `${fmtDuration((c.t - domain[0]) / 1_000)} ${c.from} → ${c.to} (${c.reason})`,
            )
            .join(" · ")}
        </p>
      )}
      {timeline.truncated && (
        <p className="m-0 text-[10.5px] text-muted">
          the first {MAX_PAIR_SAMPLES} windows only: the session has more
        </p>
      )}
      <TimelineValues timeline={timeline} domain={domain} />
    </div>
  );
}

/** The numbers behind the charts, for reading them without hovering. */
function TimelineValues({
  timeline,
  domain,
}: {
  timeline: PairTimeline;
  domain: [number, number];
}) {
  const rows = new Map<number, Record<string, number>>();
  const put = (key: string, points: PairTimeline["sent"]) => {
    for (const { t, v } of points) rows.set(t, { ...rows.get(t), [key]: v });
  };
  put("sent", timeline.sent);
  put("target", timeline.target);
  put("qp", timeline.qp);
  put("loss", timeline.loss);
  put("rung", timeline.rung);
  const cell = (value: number | undefined, format: (v: number) => string) =>
    value === undefined ? dash : format(value);
  return (
    <details className="text-[11px]">
      <summary className="cursor-pointer text-muted">values</summary>
      <div className="mt-2 max-h-[240px] overflow-auto">
        <table aria-label="timeline values" className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className={th}>time</th>
              <th className={th}>rung</th>
              <th className={th}>sent (Mbps)</th>
              <th className={th}>target (Mbps)</th>
              <th className={th}>QP</th>
              <th className={th}>loss</th>
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => a[0] - b[0])
              .map(([t, row]) => (
                <tr key={t} className="group">
                  <td className={td}>{fmtDuration((t - domain[0]) / 1_000)}</td>
                  <td className={td}>
                    {row.rung === undefined ? dash : (timeline.rungs[row.rung] ?? dash)}
                  </td>
                  <td className={td}>{cell(row.sent, fmtMbps)}</td>
                  <td className={td}>{cell(row.target, fmtMbps)}</td>
                  <td className={td}>{cell(row.qp, (v) => v.toFixed(1))}</td>
                  <td className={td}>{cell(row.loss, fmtPercent)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Rung times as "1080p30 4m · 720p30 45s", lowest rung first. */
const RungTimes = ({ pair }: { pair: QualityPair }) =>
  pair.rungTimes.length === 0 ? (
    dash
  ) : (
    <span>{pair.rungTimes.map((r) => `${r.rung} ${fmtDuration(r.seconds)}`).join(" · ")}</span>
  );

const Starved = ({ pair }: { pair: QualityPair }) =>
  pair.starved ? (
    <Chip
      kind="caution"
      className="font-semibold uppercase"
      title={`target under half the step's maximum for ${Math.round(pair.starved.share * 100)}% of the time on steps at or above the one it started on (at least ${STARVED_MIN_SECONDS}s)`}
    >
      starved at {pair.starved.rung}
    </Chip>
  ) : (
    dash
  );

/** The room's pairs, streamer to viewer, with a timeline behind each row. */
export const RoomQualityPanel = ({ roomId }: { roomId: string }) => {
  const { data, isError } = useQuery(roomQualityQuery(roomId));
  const [open, setOpen] = useState<string | null>(null);
  if (isError)
    return <div className={`${card} p-5 text-xs text-live-ink`}>quality unavailable</div>;
  if (!data) return <div className={`${card} p-5 text-xs text-subtle`}>loading…</div>;
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 border-b border-border-subtle bg-canvas">
        <MonoCaps>
          {data.pairs.length} {data.pairs.length === 1 ? "pair" : "pairs"} · {data.samples}{" "}
          {data.samples === 1 ? "sample" : "samples"}
          {data.roomKind ? ` · ${data.roomKind} room` : ""}
        </MonoCaps>
        {data.truncated && <MonoCaps>first {MAX_ROOM_SAMPLES} samples only</MonoCaps>}
      </div>
      <div className="overflow-x-auto">
        <table aria-label="quality pairs" className="w-full min-w-[980px] border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>streamer</th>
              <th className={th}>viewer</th>
              <th className={th}>stream</th>
              <th className={th}>viewer browser</th>
              <th className={th}>codec</th>
              <th className={th}>path</th>
              <th className={th}>time on rung</th>
              <th
                className={`${th} !text-right`}
                title="Average QP over the windows on the pair's latest codec only: QP isn't comparable across codecs"
              >
                QP (latest codec)
              </th>
              <th className={`${th} !text-right`}>loss</th>
              <th className={`${th} !text-right`}>RTT</th>
              <th className={`${th} !text-right`}>freezes</th>
              <th className={th}>flag</th>
              <th className={th}>
                <span className="sr-only">timeline</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.pairs.map((pair) => {
              const key = pairKey(pair);
              const label = `${pair.streamer.username} to ${pair.viewer.username}, ${pair.slot}`;
              return (
                <PairRows
                  key={key}
                  pair={pair}
                  label={label}
                  open={open === key}
                  toggle={() => setOpen(open === key ? null : key)}
                  roomId={roomId}
                />
              );
            })}
            {data.pairs.length === 0 && (
              <tr>
                <td colSpan={13} className="text-center p-7 text-subtle text-[11.5px]">
                  no samples for this room
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const PairRows = ({
  pair,
  label,
  open,
  toggle,
  roomId,
}: {
  pair: QualityPairRow;
  label: string;
  open: boolean;
  toggle: () => void;
  roomId: string;
}) => (
  <>
    <tr className="group" data-pair={label}>
      <td className={td}>
        <Person person={pair.streamer} />
      </td>
      <td className={td}>
        <Person person={pair.viewer} />
      </td>
      <td className={td}>{pair.slot === "cam" ? "camera" : "screen"}</td>
      <td className={td}>{pair.viewerBrowser ?? dash}</td>
      <td className={td}>{pair.codec?.replace("video/", "") ?? dash}</td>
      <td className={td}>{pathLabel(pair.path) ?? dash}</td>
      <td className={td}>
        <RungTimes pair={pair} />
      </td>
      <td className={`${td} text-right`}>{pair.qp === null ? dash : pair.qp.toFixed(1)}</td>
      <td className={`${td} text-right`}>{pair.loss === null ? dash : fmtPercent(pair.loss)}</td>
      <td className={`${td} text-right whitespace-nowrap`}>
        {pair.rttMs === null ? dash : `${Math.round(pair.rttMs)} ms`}
      </td>
      <td className={`${td} text-right`}>
        {pair.freezes === null
          ? dash
          : `${pair.freezes}${pair.freezeSeconds ? ` · ${fmtDuration(pair.freezeSeconds)}` : ""}`}
      </td>
      <td className={td}>
        <Starved pair={pair} />
      </td>
      <td className={td}>
        <Btn size="sm" aria-expanded={open} aria-label={`Timeline ${label}`} onClick={toggle}>
          {open ? "hide" : "timeline"}
        </Btn>
      </td>
    </tr>
    {open && (
      <tr>
        <td colSpan={13} className="px-3.5 py-3 border-b border-border-subtle bg-canvas">
          <PairCharts roomId={roomId} pair={pair} />
        </td>
      </tr>
    )}
  </>
);
