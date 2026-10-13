// PROTOTYPE (#114), throwaway, "How should the room timeline look in /admin?"
//
// Three variants of the admin's room timeline, switchable with `?variant=A|B|C` (or the arrow
// keys) on the existing /admin route, dev builds only. They share only the small pieces at the
// top (a row, a chip, the snapshot table); each variant owns its layout:
//   A  filtered log: one dense chronological list, filter chips, problem reports pinned
//   B  swimlanes: a time axis, a lane per person and per pair, reports as vertical markers
//   C  incident first: the recent-reports list, then the +-2 minute window around one report
// All data is fake and in memory (./room-timeline-data.prototype.ts). Nothing here is wired to
// the backend. Fold the winner into the real page and leave this on its prototype branch.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { fmtDuration } from "~/lib/format";
import { fmtMbps } from "./chart-parts";
import { PrototypeSwitcher, usePrototypeParams } from "./prototype-switcher.prototype";
import {
  CATS,
  type Cat,
  EVENTS,
  fmtClock,
  nameOf,
  PAIR_SEGS,
  PAIRS,
  type PairState,
  PEOPLE,
  REPORT_LIST,
  type Report,
  ROOM,
  type SnapRow,
  SPANS,
  STEPS,
  type TlEvent,
} from "./room-timeline-data.prototype";
import { SectionHead } from "./section-head";
import { Avatar, Btn, Chip, MonoCaps, Seg } from "./ui";

const card = "bg-surface border border-border rounded-[var(--radius)] shadow-card";
const th =
  "px-3 py-2 text-left text-[10px] tracking-[0.1em] uppercase text-subtle font-semibold bg-canvas border-b border-border-subtle";
const td = "px-3 py-1 border-b border-border-subtle text-fg-muted whitespace-nowrap";
const dash = <span className="text-subtle">—</span>;
const reportTint =
  "bg-[color-mix(in_oklch,var(--color-warning)_13%,var(--color-surface))] border-[color-mix(in_oklch,var(--color-warning)_55%,transparent)]";

// ---------------------------------------------------------------- shared pieces

const Who = ({ id, strong = false }: { id: string; strong?: boolean }) =>
  id === "system" ? (
    <span className="text-subtle">system</span>
  ) : (
    <span
      className={`inline-flex items-center gap-1.5 min-w-0 ${strong ? "text-fg font-medium" : "text-fg-muted"}`}
    >
      <Avatar name={nameOf(id)} image={null} size="sm" />
      <span className="truncate">{nameOf(id)}</span>
    </span>
  );

const eventTime = (e: TlEvent) => (e.minute ? `${fmtClock(e.t).slice(0, 5)}·min` : fmtClock(e.t));

/** One line of the log. `children` is whatever opens under it (a report's snapshot). */
const EventRow = ({
  e,
  active = false,
  onClick,
  rel,
  children,
}: {
  e: TlEvent;
  active?: boolean;
  onClick?: () => void;
  /** Time relative to something (C's window) instead of the clock. */
  rel?: string;
  children?: ReactNode;
}) => {
  const isReport = e.cat === "reports";
  const Tag = onClick ? "button" : "div";
  return (
    <div
      id={`tl-ev-${e.id}`}
      className={`border-b border-border-subtle last:border-b-0 ${isReport ? `border-l-2 ${reportTint}` : ""} ${active ? "outline outline-2 -outline-offset-2 outline-primary" : ""}`}
    >
      <Tag
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={`grid w-full grid-cols-[72px_132px_84px_1fr] items-center gap-x-2.5 px-3 py-[5px] text-left text-[11.5px] ${onClick ? "cursor-pointer hover:bg-surface-2" : ""}`}
      >
        <span className="text-subtle tabular-nums">{rel ?? eventTime(e)}</span>
        <Who id={e.who} />
        <Chip kind={e.tone} className="justify-self-start">
          {e.kind}
        </Chip>
        <span className="min-w-0 text-fg-muted">
          {e.pair && e.peer && <b className="text-fg font-medium">↔ {nameOf(e.peer)} </b>}
          {e.peer && !e.pair && e.kind !== "mod" && e.kind !== "role" && e.kind !== "host" ? (
            <b className="text-fg font-medium">→ {nameOf(e.peer)} </b>
          ) : null}
          <span className={isReport ? "text-fg font-semibold" : ""}>{e.text}</span>
          {e.detail && <span className="text-subtle"> · {e.detail}</span>}
        </span>
      </Tag>
      {children}
    </div>
  );
};

const StateChip = ({ state }: { state: PairState }) => (
  <Chip kind={state === "connected" ? "ok" : state === "disconnected" ? "caution" : ""}>
    {state}
  </Chip>
);

/**
 * Everyone's connections when a problem was reported: a row per stream, then (with `showIdle`) a
 * row for each pair nobody is streaming over.
 */
const SnapshotTable = ({
  report,
  showIdle = false,
  onQuality,
}: {
  report: Report;
  showIdle?: boolean;
  onQuality?: (row: SnapRow) => void;
}) => {
  const rows = report.rows.filter((r) => showIdle || r.slot !== null);
  const bad = (r: SnapRow) => r.state !== "connected" || (r.loss ?? 0) > 2 || r.fps === 0;
  return (
    <div className="overflow-x-auto">
      <table aria-label={`snapshot at ${fmtClock(report.t)}`} className="w-full text-[11.5px]">
        <thead>
          <tr>
            <th className={th}>stream</th>
            <th className={th}>step · res</th>
            <th className={`${th} !text-right`}>Mbps</th>
            <th className={`${th} !text-right`}>fps</th>
            <th className={`${th} !text-right`}>loss</th>
            <th className={`${th} !text-right`}>RTT</th>
            <th className={th}>path</th>
            <th className={th}>reason</th>
            <th className={th}>pair</th>
            {onQuality && (
              <th className={th}>
                <span className="sr-only">quality</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.from}>${r.to}`}
              className={
                bad(r) ? "bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)]" : ""
              }
            >
              <td className={td}>
                {r.slot ? (
                  <span className="text-fg">
                    {nameOf(r.from)} → {nameOf(r.to)}
                  </span>
                ) : (
                  <span className="text-subtle">
                    {nameOf(r.from)} ↔ {nameOf(r.to)} · idle
                  </span>
                )}
              </td>
              <td className={td}>
                {r.step ? (
                  <>
                    {r.step} <span className="text-subtle">{r.res}</span>
                  </>
                ) : (
                  dash
                )}
              </td>
              <td className={`${td} text-right`}>
                {r.kbps === null ? dash : fmtMbps(r.kbps * 1000)}
              </td>
              <td className={`${td} text-right`}>{r.fps ?? dash}</td>
              <td
                className={`${td} text-right ${(r.loss ?? 0) > 2 ? "!text-warning-ink font-semibold" : ""}`}
              >
                {r.loss === null ? dash : `${r.loss.toFixed(1)}%`}
              </td>
              <td className={`${td} text-right`}>{r.rttMs === null ? dash : `${r.rttMs} ms`}</td>
              <td className={td}>
                {r.path.kind === "relay" ? (
                  <Chip kind="accent">relay {r.path.proto}</Chip>
                ) : (
                  `direct ${r.path.proto}`
                )}
              </td>
              <td className={td}>{r.reason ?? dash}</td>
              <td className={td}>
                <StateChip state={r.state} />
              </td>
              {onQuality && (
                <td className={td}>
                  {r.slot && (
                    <Btn size="sm" onClick={() => onQuality(r)}>
                      quality
                    </Btn>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ReportTitle = ({ r }: { r: Report }) => (
  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
    <Chip kind="caution" className="font-semibold uppercase">
      {r.category}
    </Chip>
    <Who id={r.by} strong />
    {r.note && <span className="text-fg">“{r.note}”</span>}
  </span>
);

const Toggle = ({
  on,
  onClick,
  children,
  title,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) => (
  <button
    type="button"
    aria-pressed={on}
    title={title}
    onClick={onClick}
    className="cursor-pointer"
  >
    <Chip kind={on ? "accent" : ""} className={on ? "" : "opacity-70 hover:opacity-100"}>
      {children}
    </Chip>
  </button>
);

// ---------------------------------------------------------------- A: filtered log

function VariantA() {
  const [cats, setCats] = useState<Set<Cat>>(new Set(CATS.map((c) => c.key)));
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const shown = useMemo(
    () =>
      EVENTS.filter(
        (e) =>
          cats.has(e.cat) &&
          (people.size === 0 || people.has(e.who) || (e.peer !== undefined && people.has(e.peer))),
      ),
    [cats, people],
  );
  const count = (c: Cat) => EVENTS.filter((e) => e.cat === c).length;
  const flip = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (!next.delete(v)) next.add(v);
    return next;
  };

  const jump = (r: Report) => {
    // Show the moment even when the filters would hide it.
    setCats((c) => new Set(c).add("reports"));
    setPeople(new Set());
    setOpen(r.id);
    const target = EVENTS.find((e) => e.report === r.id);
    setFlash(target?.id ?? null);
    requestAnimationFrame(() => {
      const el = target && document.getElementById(`tl-ev-${target.id}`);
      if (el && box.current) box.current.scrollTo({ top: el.offsetTop - 120, behavior: "smooth" });
    });
  };

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="px-3.5 py-2.5 border-b border-border-subtle bg-canvas flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <MonoCaps>category</MonoCaps>
          {CATS.map((c) => (
            <Toggle key={c.key} on={cats.has(c.key)} onClick={() => setCats(flip(cats, c.key))}>
              {c.label} <span className="tabular-nums opacity-70">{count(c.key)}</span>
            </Toggle>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <MonoCaps>person</MonoCaps>
          {PEOPLE.map((p) => (
            <Toggle key={p.id} on={people.has(p.id)} onClick={() => setPeople(flip(people, p.id))}>
              {p.name}
            </Toggle>
          ))}
          {people.size > 0 && (
            <Btn size="sm" variant="ghost" onClick={() => setPeople(new Set())}>
              clear
            </Btn>
          )}
          <span className="ml-auto">
            <MonoCaps>
              {shown.length} of {EVENTS.length} events
            </MonoCaps>
          </span>
        </div>
      </div>

      <div className="px-3.5 py-2.5 border-b border-border-subtle flex flex-col gap-1.5">
        <MonoCaps>problem reports · pinned</MonoCaps>
        {REPORT_LIST.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => jump(r)}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-sm)] border px-3 py-2 text-left text-[11.5px] cursor-pointer hover:brightness-110 ${reportTint}`}
          >
            <span className="tabular-nums text-subtle">{fmtClock(r.t)}</span>
            <ReportTitle r={r} />
            <span className="ml-auto text-primary-strong">jump to this moment ↓</span>
          </button>
        ))}
      </div>

      <div ref={box} className="relative max-h-[430px] overflow-auto">
        {shown.map((e) => (
          <EventRow
            key={e.id}
            e={e}
            active={flash === e.id}
            onClick={
              e.report ? () => setOpen(open === e.report ? null : (e.report ?? null)) : undefined
            }
          >
            {e.report && open === e.report && (
              <div className="border-t border-border-subtle bg-canvas px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <MonoCaps>everyone’s connections at {fmtClock(e.t)}</MonoCaps>
                  <MonoCaps>click the row to close</MonoCaps>
                </div>
                {REPORT_LIST.filter((r) => r.id === e.report).map((r) => (
                  <SnapshotTable key={r.id} report={r} />
                ))}
              </div>
            )}
          </EventRow>
        ))}
        {shown.length === 0 && (
          <div className="p-7 text-center text-[11.5px] text-subtle">nothing matches</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- B: swimlanes

const D0 = ROOM.from - 10;
const D1 = ROOM.to;
const pct = (t: number) => `${(((t - D0) / (D1 - D0)) * 100).toFixed(3)}%`;
const widthPct = (a: number, b: number) => `${(((b - a) / (D1 - D0)) * 100).toFixed(3)}%`;
const LABEL_W = 200;
const MINUTES = Array.from({ length: 15 }, (_, i) => 31 * 60 + i * 60);

const segColor: Record<PairState, string> = {
  connecting: "bg-surface-3",
  connected: "bg-[color-mix(in_oklch,var(--color-success)_45%,transparent)]",
  disconnected: "bg-warning",
};

const Mark = ({
  t,
  top,
  glyph,
  title,
  className = "",
}: {
  t: number;
  top: number;
  glyph: string;
  title: string;
  className?: string;
}) => (
  <span
    title={title}
    className={`absolute z-[2] -translate-x-1/2 grid h-3 min-w-3 place-items-center rounded-[3px] text-[10px] font-bold leading-none ${className}`}
    style={{ left: pct(t), top }}
  >
    {glyph}
  </span>
);

const Lane = ({
  label,
  height,
  children,
  onlyLabel,
}: {
  label: ReactNode;
  height: number;
  children?: ReactNode;
  onlyLabel?: boolean;
}) => (
  <div className="flex border-b border-border-subtle last:border-b-0" style={{ height }}>
    <div
      className="sticky left-0 z-[3] flex shrink-0 items-center gap-2 border-r border-border-subtle bg-surface px-3 text-[11.5px]"
      style={{ width: LABEL_W }}
    >
      {label}
    </div>
    {!onlyLabel && (
      <div className="relative flex-1">
        {MINUTES.map((m) => (
          <i
            key={m}
            className="absolute inset-y-0 w-px bg-[var(--color-border-subtle)]"
            style={{ left: pct(m) }}
          />
        ))}
        {REPORT_LIST.map((r) => (
          <i
            key={r.id}
            className="absolute inset-y-0 z-[1] w-px bg-warning shadow-[0_0_6px_var(--color-warning)]"
            style={{ left: pct(r.t) }}
          />
        ))}
        {children}
      </div>
    )}
  </div>
);

const Bar = ({
  from,
  to,
  top,
  h,
  className,
  title,
}: {
  from: number;
  to: number;
  top: number;
  h: number;
  className: string;
  title: string;
}) => (
  <span
    title={title}
    className={`absolute rounded-[3px] ${className}`}
    style={{ left: pct(from), width: widthPct(from, to), top, height: h }}
  />
);

function VariantB() {
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const shownId = pinned ?? hover;
  const shown = REPORT_LIST.find((r) => r.id === shownId);
  const span = (s: { from: number; to: number }) => `${fmtClock(s.from)}–${fmtClock(s.to)}`;
  const lanePeople = PEOPLE.map((p) => ({
    p,
    events: EVENTS.filter(
      (e) =>
        e.who === p.id &&
        e.cat !== "reports" &&
        e.cat !== "connection" &&
        !["join", "leave", "share", "cam", "mic", "grace", "resume", "disconnect"].includes(e.kind),
    ),
    extra: EVENTS.filter((e) => e.who === p.id && ["disconnect", "resume"].includes(e.kind)),
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <MonoCaps>recent reports · pick one to pin its snapshot</MonoCaps>
        <div className="flex flex-wrap gap-2">
          {REPORT_LIST.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setPinned(pinned === r.id ? null : r.id)}
              className={`flex items-center gap-x-3 rounded-[var(--radius-sm)] border px-3 py-1.5 text-left text-[11.5px] cursor-pointer hover:brightness-110 ${reportTint} ${pinned === r.id ? "outline outline-2 outline-primary" : ""}`}
            >
              <span className="tabular-nums text-subtle">{fmtClock(r.t)}</span>
              <ReportTitle r={r} />
            </button>
          ))}
        </div>
      </div>

      <div className={`${card} relative overflow-x-auto`}>
        <div className="relative min-w-[1060px]">
          {/* the time axis, with the reports as flags */}
          <div className="flex h-[46px] border-b border-border bg-canvas">
            <div
              className="sticky left-0 z-[3] flex shrink-0 items-center border-r border-border-subtle bg-canvas px-3"
              style={{ width: LABEL_W }}
            >
              <MonoCaps>22:xx IST</MonoCaps>
            </div>
            <div className="relative flex-1">
              {MINUTES.map((m) => (
                <span
                  key={m}
                  className="absolute bottom-1.5 -translate-x-1/2 text-[10px] tabular-nums text-subtle"
                  style={{ left: pct(m) }}
                >
                  {fmtClock(m).slice(0, 5)}
                </span>
              ))}
              {REPORT_LIST.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-label={`${r.category} report at ${fmtClock(r.t)}`}
                  onMouseEnter={() => setHover(r.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setPinned(pinned === r.id ? null : r.id)}
                  className="absolute top-0.5 z-[4] -translate-x-1/2 cursor-pointer"
                  style={{ left: pct(r.t) }}
                >
                  <Chip kind="caution" className="font-semibold uppercase !px-1.5 !py-0">
                    ⚑ {r.category}
                  </Chip>
                </button>
              ))}
            </div>
          </div>

          <MonoCapsRow>people</MonoCapsRow>
          {lanePeople.map(({ p, events, extra }) => (
            <Lane
              key={p.id}
              height={58}
              label={
                <>
                  <Avatar name={p.name} image={null} size="sm" />
                  <span className="truncate text-fg font-medium">{p.name}</span>
                </>
              }
            >
              {SPANS.presence
                .filter((s) => s.who === p.id)
                .map((s) => (
                  <Bar
                    key={s.from}
                    from={s.from}
                    to={s.to}
                    top={20}
                    h={10}
                    title={`in the room ${span(s)}`}
                    className="border border-[color-mix(in_oklch,var(--color-success)_55%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_22%,transparent)]"
                  />
                ))}
              {SPANS.host
                .filter((s) => s.who === p.id)
                .map((s) => (
                  <Bar
                    key={s.from}
                    from={s.from}
                    to={s.to}
                    top={20}
                    h={4}
                    title={`host ${span(s)}`}
                    className="bg-primary shadow-[0_0_6px_var(--color-primary-glow)]"
                  />
                ))}
              {SPANS.grace
                .filter((s) => s.who === p.id)
                .map((s) => (
                  <Bar
                    key={s.from}
                    from={s.from}
                    to={s.to}
                    top={20}
                    h={10}
                    title={`socket down, reconnect grace ${span(s)}`}
                    className="bg-warning"
                  />
                ))}
              {SPANS.shares
                .filter((s) => s.who === p.id)
                .map((s) => (
                  <Bar
                    key={s.from}
                    from={s.from}
                    to={s.to}
                    top={33}
                    h={8}
                    title={`sharing ${span(s)} (${fmtDuration(s.to - s.from)})`}
                    className="bg-live shadow-[0_0_6px_var(--color-live)]"
                  />
                ))}
              {SPANS.cams
                .filter((s) => s.who === p.id)
                .map((s) => (
                  <Bar
                    key={s.from}
                    from={s.from}
                    to={s.to}
                    top={44}
                    h={4}
                    title={`camera ${span(s)}`}
                    className="bg-[var(--color-viz-1)]"
                  />
                ))}
              {SPANS.mics
                .filter((s) => s.who === p.id)
                .map((s) => (
                  <Bar
                    key={s.from}
                    from={s.from}
                    to={s.to}
                    top={50}
                    h={4}
                    title={`mic ${span(s)}`}
                    className="bg-[var(--color-viz-2)]"
                  />
                ))}
              {events.map((e) => (
                <Mark
                  key={e.id}
                  t={e.t}
                  top={3}
                  glyph={e.kind === "error" ? "!" : e.kind === "refused" ? "⊘" : "▲"}
                  title={`${fmtClock(e.t)} ${e.text}${e.detail ? ` · ${e.detail}` : ""}`}
                  className={
                    e.kind === "error" || e.kind === "refused"
                      ? "bg-warning text-[var(--color-primary-ink)]"
                      : "bg-surface-3 text-fg"
                  }
                />
              ))}
              {extra.map((e) => (
                <Mark
                  key={e.id}
                  t={e.t}
                  top={3}
                  glyph={e.kind === "disconnect" ? "↯" : "↻"}
                  title={`${fmtClock(e.t)} ${e.text}`}
                  className="bg-warning text-[var(--color-primary-ink)]"
                />
              ))}
            </Lane>
          ))}

          <MonoCapsRow>connections · one lane per pair</MonoCapsRow>
          {PAIRS.map((pair) => {
            const steps = STEPS.filter(
              (s) =>
                (s.streamer === pair.a && s.viewer === pair.b) ||
                (s.streamer === pair.b && s.viewer === pair.a),
            );
            const marks = EVENTS.filter(
              (e) => e.pair === pair.id && (e.kind === "path" || e.kind === "error"),
            );
            const relay = pair.id === "danee-thybumbum";
            return (
              <Lane
                key={pair.id}
                height={24}
                label={
                  <>
                    <span className="truncate text-fg-muted">
                      {nameOf(pair.a)} ↔ {nameOf(pair.b)}
                    </span>
                    {relay && (
                      <span title="relayed over TURN, UDP" className="text-primary-strong">
                        ◆
                      </span>
                    )}
                  </>
                }
              >
                {PAIR_SEGS.filter((s) => s.pair === pair.id).map((s) => (
                  <Bar
                    key={`${s.from}-${s.state}`}
                    from={s.from}
                    to={s.to}
                    top={7}
                    h={10}
                    title={`${s.state} ${span(s)}`}
                    className={segColor[s.state]}
                  />
                ))}
                {relay && (
                  <Mark
                    t={PAIR_SEGS.find((s) => s.pair === pair.id)?.from ?? D0}
                    top={6}
                    glyph="◆"
                    title="connected over TURN, UDP"
                    className="text-primary-strong"
                  />
                )}
                {marks.map((e) => (
                  <Mark
                    key={e.id}
                    t={e.t}
                    top={6}
                    glyph={e.kind === "path" ? "◆" : "✕"}
                    title={`${fmtClock(e.t)} ${e.text}${e.detail ? ` · ${e.detail}` : ""}`}
                    className={e.kind === "path" ? "text-primary-strong" : "text-fg bg-warning"}
                  />
                ))}
                {steps.map((s) => (
                  <Mark
                    key={s.t}
                    t={s.t}
                    top={-2}
                    glyph="▾"
                    title={`${fmtClock(s.t)} ${nameOf(s.streamer)} → ${nameOf(s.viewer)}: ${s.from} → ${s.to} (${s.reason})`}
                    className="text-[var(--color-viz-2)]"
                  />
                ))}
              </Lane>
            );
          })}

          {shown && (
            <div
              className={`absolute top-[50px] z-[5] w-[920px] ${reportTint} rounded-[var(--radius)] border bg-surface p-3 shadow-pop`}
              style={{
                // Starts at the marker, pulled left when it would run off the right edge.
                left: `clamp(${LABEL_W}px, calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${(shown.t - D0) / (D1 - D0)}), calc(100% - 930px))`,
              }}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[11.5px]">
                  <span className="tabular-nums text-subtle">{fmtClock(shown.t)}</span>
                  <ReportTitle r={shown} />
                </span>
                {pinned === shown.id ? (
                  <Btn size="sm" onClick={() => setPinned(null)}>
                    close
                  </Btn>
                ) : (
                  <MonoCaps>click the flag to pin</MonoCaps>
                )}
              </div>
              <div className="rounded-[var(--radius-sm)] bg-surface">
                <SnapshotTable report={shown} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-muted">
        <Legend swatch="bg-[color-mix(in_oklch,var(--color-success)_40%,transparent)]">
          in the room
        </Legend>
        <Legend swatch="bg-primary">host</Legend>
        <Legend swatch="bg-live">sharing</Legend>
        <Legend swatch="bg-[var(--color-viz-1)]">camera</Legend>
        <Legend swatch="bg-[var(--color-viz-2)]">mic</Legend>
        <Legend swatch="bg-warning">down / grace / problem</Legend>
        <span>
          ◆ path change · ✕ negotiation error · ▾ quality step · ! device error · ⊘ refusals · ▲
          moderation
        </span>
      </div>
    </div>
  );
}

const MonoCapsRow = ({ children }: { children: ReactNode }) => (
  <div className="border-b border-border-subtle bg-canvas px-3 py-1">
    <MonoCaps>{children}</MonoCaps>
  </div>
);

const Legend = ({ swatch, children }: { swatch: string; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1.5">
    <i className={`inline-block h-2 w-3.5 rounded-[2px] ${swatch}`} /> {children}
  </span>
);

// ---------------------------------------------------------------- C: incident first

/** Reports from other rooms, so the list reads as the admin's list and not a list of two. */
const OTHER_ROOMS = [
  { room: "friday night valorant", category: "no audio", by: "lunaris", when: "9 Oct 21:12" },
  { room: "ghibli marathon", category: "can't connect", by: "mothlight", when: "8 Oct 19:40" },
  { room: "ghibli marathon", category: "blurry", by: "mothlight", when: "8 Oct 19:58" },
];

function VariantC() {
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<"±2 min" | "full timeline">("±2 min");
  const [linked, setLinked] = useState<string | null>(null);
  const [idle, setIdle] = useState(true);
  const report = REPORT_LIST.find((r) => r.id === picked);
  const box = useRef<HTMLDivElement>(null);

  const window2 = report ? EVENTS.filter((e) => Math.abs(e.t - report.t) <= 120) : [];
  const events = mode === "±2 min" ? window2 : EVENTS;
  const rel = (e: TlEvent) =>
    report
      ? e.t === report.t
        ? "report"
        : `${e.t < report.t ? "−" : "+"}${fmtDuration(Math.abs(e.t - report.t))}`
      : undefined;

  useEffect(() => {
    if (!report || !box.current) return;
    // The report's own line sits in view, with what led up to it above.
    const target = EVENTS.find((e) => e.report === report.id);
    const el = target && document.getElementById(`tl-ev-${target.id}`);
    if (el) box.current.scrollTo({ top: el.offsetTop - 150 });
  }, [report]);

  return (
    <div>
      {!report && (
        <div className={`${card} max-w-[640px] overflow-hidden`}>
          <div className="border-b border-border-subtle bg-canvas px-3.5 py-2.5">
            <MonoCaps>recent reports</MonoCaps>
          </div>
          {REPORT_LIST.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={picked === r.id}
              onClick={() => {
                setPicked(r.id);
                setMode("±2 min");
                setLinked(null);
              }}
              className={`flex w-full flex-col gap-1 border-b border-border-subtle border-l-2 px-3.5 py-2.5 text-left text-[11.5px] cursor-pointer hover:bg-surface-2 ${picked === r.id ? `${reportTint}` : "border-l-transparent"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <Chip kind="caution" className="font-semibold uppercase">
                  {r.category}
                </Chip>
                <span className="tabular-nums text-subtle">10 Oct {fmtClock(r.t).slice(0, 5)}</span>
              </span>
              <span className="text-fg">
                {r.note ? `“${r.note}”` : <span className="text-subtle">no note</span>}
              </span>
              <span className="flex items-center justify-between text-subtle">
                <span>
                  by {nameOf(r.by)} · {ROOM.name}
                </span>
              </span>
            </button>
          ))}
          {OTHER_ROOMS.map((o) => (
            <div
              key={o.when}
              className="flex flex-col gap-1 border-b border-border-subtle border-l-2 border-l-transparent px-3.5 py-2.5 text-[11.5px] opacity-55 last:border-b-0"
            >
              <span className="flex items-center justify-between gap-2">
                <Chip kind="caution" className="uppercase">
                  {o.category}
                </Chip>
                <span className="tabular-nums text-subtle">{o.when}</span>
              </span>
              <span className="text-subtle">
                by {o.by} · {o.room}
              </span>
            </div>
          ))}
          <div className="px-3.5 py-2 text-[10.5px] text-subtle">
            the last three are other rooms: not part of the prototype
          </div>
        </div>
      )}

      {report && (
        <div className="flex min-w-0 flex-col gap-3.5">
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-border-subtle bg-canvas px-3.5 py-2.5">
              <span className="inline-flex items-center gap-3">
                <MonoCaps>
                  everyone’s connections at {fmtClock(report.t)} · a row per stream
                </MonoCaps>
                <Btn size="sm" variant="ghost" onClick={() => setIdle(!idle)}>
                  {idle ? "hide" : "show"} idle pairs
                </Btn>
              </span>
              {linked && (
                <span className="text-[10.5px] text-primary-strong">
                  → opens video quality · {linked}
                </span>
              )}
            </div>
            <SnapshotTable
              report={report}
              showIdle={idle}
              onQuality={(r) => setLinked(`${nameOf(r.from)} → ${nameOf(r.to)} pair timeline`)}
            />
          </div>

          <div className={`${card} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-canvas px-3.5 py-2.5">
              <span className="inline-flex flex-wrap items-center gap-2 text-[12px]">
                <Btn size="sm" onClick={() => setPicked(null)}>
                  ← recent reports
                </Btn>
                <span className="tabular-nums text-subtle">{fmtClock(report.t)}</span>
                <ReportTitle r={report} />
              </span>
              <div className="w-[230px]">
                <Seg value={mode} options={["±2 min", "full timeline"]} onChange={setMode} />
              </div>
            </div>
            <div className="border-b border-border-subtle px-3.5 py-1.5">
              <MonoCaps>
                {mode === "±2 min"
                  ? `${window2.length} events from ${fmtClock(report.t - 120)} to ${fmtClock(report.t + 120)}`
                  : `${EVENTS.length} events · the whole room`}
              </MonoCaps>
            </div>
            <div ref={box} className="relative max-h-[250px] overflow-auto">
              {events.map((e) => (
                <EventRow key={e.id} e={e} rel={mode === "±2 min" ? rel(e) : undefined} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the section on /admin

export function RoomTimelinePrototype() {
  const { variant, set } = usePrototypeParams();
  if (!variant) return null;
  return (
    <section aria-label="room timeline prototype" className="mb-6">
      <SectionHead
        title={`room timeline · ${ROOM.name}`}
        sub={`PROTOTYPE · fake data · ${ROOM.kind} room · 10 Oct 22:31–22:45 IST · kept 90 days`}
        dot="live"
        size="sm"
      />
      {variant === "A" && <VariantA />}
      {variant === "B" && <VariantB />}
      {variant === "C" && <VariantC />}
      <PrototypeSwitcher variant={variant} set={set} />
    </section>
  );
}
