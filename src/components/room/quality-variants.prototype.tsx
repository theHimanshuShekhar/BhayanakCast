// PROTOTYPE (ticket #93): three structurally different bodies for the stream-quality modal.
// A = verdict first, B = pipeline, C = live history. Each takes the same snapshot and has a
// viewer view and a streamer view. Throwaway; see quality-modal.prototype.tsx.
import type { ReactNode } from "react";
import { Chip, MonoCaps } from "../ui";
import {
  capOf,
  limitingLink,
  mbps,
  type Pair,
  pathLabel,
  type Snapshot,
  stepLabel,
  WHY,
  type Why,
} from "./quality-fake-data.prototype";

export type VariantProps = { snap: Snapshot };

const ago = (s: number) =>
  s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s ago`;
const quality = (h: number) => (h >= 900 ? "Sharp" : h >= 600 ? "Reduced" : "Low");
const whyLabel = (why: Why, streamerView: boolean, name: string) =>
  streamerView
    ? why === "shared"
      ? "Your upload is shared"
      : why === "connection"
        ? `The connection between you and ${name}`
        : why === "computer"
          ? "Your computer"
          : WHY[why].label
    : WHY[why].label;
const whySentence = (why: Why, streamerView: boolean) =>
  streamerView && why === "shared"
    ? "Held by your upload budget, or by this viewer's fair share of it."
    : streamerView && why === "computer"
      ? "Your encoder is CPU-limited."
      : WHY[why].sentence(!streamerView);
const WARN_BOX =
  "border-[color-mix(in_oklch,var(--color-warning)_60%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_14%,transparent)]";

const WhyChip = ({ why, label }: { why: Why; label?: string }) => (
  <Chip kind={WHY[why].tone} dot>
    {label ?? WHY[why].label}
  </Chip>
);

const Spark = ({
  values,
  cap,
  stepped = false,
  height = 52,
  max: maxIn,
}: {
  values: number[];
  cap?: number[];
  stepped?: boolean;
  height?: number;
  /** Fixed top of the scale. */
  max?: number;
}) => {
  const W = 280;
  const max = maxIn ?? Math.max(...values, ...(cap ?? [0])) * 1.08;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => height - (v / max) * height;
  const line = (vs: number[]) =>
    vs
      .map((v, i) =>
        stepped && i
          ? `H${x(i).toFixed(1)} V${y(v).toFixed(1)}`
          : `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`,
      )
      .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="w-full overflow-visible"
      style={{ height }}
      role="img"
      aria-label="last 60 seconds"
    >
      <path d={`${line(values)} V${height} H0 Z`} fill="var(--color-primary)" opacity={0.16} />
      {cap && (
        <path
          d={line(cap)}
          fill="none"
          stroke="var(--color-fg-muted)"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d={line(values)}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={1.8}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

const KV = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="flex flex-col gap-0.5 min-w-0">
    <MonoCaps>{k}</MonoCaps>
    <span className="text-[12.5px] font-semibold truncate">{children}</span>
  </div>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-2.5">
    <MonoCaps>{title}</MonoCaps>
    {children}
  </section>
);

const lossText = (p: Pair) => `${p.lossPct.toFixed(1)}%`;

/* ------------------------------------------------------------------------------------------ */
/* A: verdict first                                                                           */
/* ------------------------------------------------------------------------------------------ */

export const VariantA = ({ snap }: VariantProps) => {
  if (snap.role === "streamer") return <AStreamer snap={snap} />;
  const p = snap.pairs[0] as Pair;
  const short =
    p.why === "best"
      ? "the best this screen allows"
      : `held by ${whyLabel(p.why, false, snap.streamer).toLowerCase()}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="m-0 text-[17px] leading-snug font-bold">
          {quality(p.step.h)} &mdash; {p.step.w}&times;{p.step.h} at {p.step.fps} fps,{" "}
          <span className={p.why === "best" ? "text-success-ink" : "text-warning-ink"}>
            {short}
          </span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          <WhyChip why={p.why} />
          <Chip>{pathLabel(p.path)}</Chip>
        </div>
        <p className="m-0 text-[12px] text-muted leading-relaxed">{whySentence(p.why, false)}</p>
      </div>
      <Section title="what you receive">
        <div className="grid grid-cols-3 gap-x-4 gap-y-3 max-sm:grid-cols-2">
          <KV k="resolution">
            {p.recv.w}&times;{p.recv.h}
          </KV>
          <KV k="frame rate">{p.recv.fps} fps</KV>
          <KV k="bitrate">{mbps(p.recv.bps)}</KV>
          <KV k="codec">{p.recv.codec}</KV>
          <KV k="route">{pathLabel(p.path)}</KV>
          <KV k="round trip">{p.rttMs} ms</KV>
          <KV k="packet loss">{lossText(p)}</KV>
          <KV k="freezes (1 min)">{p.freezes}</KV>
        </div>
      </Section>
      <Section title={`${snap.streamer}'s side, for you`}>
        <div className="grid grid-cols-3 gap-x-4 gap-y-3 max-sm:grid-cols-2">
          <KV k="current step">{stepLabel(p.step)}</KV>
          <KV k="bitrate cap">{mbps(p.capBps)}</KV>
          <KV k="sending">{mbps(p.sentBps)}</KV>
        </div>
      </Section>
    </div>
  );
};

const AStreamer = ({ snap }: VariantProps) => {
  const held = snap.pairs.filter((p) => p.why === "shared").length;
  const used = snap.pairs.reduce((a, p) => a + p.sentBps, 0);
  const pct = Math.round((used / snap.upload.budgetBps) * 100);
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[17px] leading-snug font-bold">
        {held === 0 ? (
          "Your upload is not holding anyone back"
        ) : (
          <>
            Your upload is holding back{" "}
            <span className="text-warning-ink">
              {held} of {snap.pairs.length}
            </span>{" "}
            viewers
          </>
        )}
        <span className="block mt-1 text-[12px] font-normal text-muted">
          {mbps(used, 1)} of {mbps(snap.upload.budgetBps, 1)} budget in use ({pct}%).
        </span>
      </p>
      <ul className="m-0 p-0 list-none flex flex-col divide-y divide-[var(--color-border-subtle)] border-y border-border-subtle">
        {snap.pairs.map((p) => (
          <li key={p.id} className="py-2.5 flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12.5px] font-bold min-w-[48px]">{p.name}</span>
              <span className="text-[12px] font-semibold">{stepLabel(p.step)}</span>
              <span className="text-[11.5px] text-muted">
                {mbps(p.sentBps)} of {mbps(p.capBps)}
              </span>
              <span className="flex-1" />
              <Chip>{pathLabel(p.path)}</Chip>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <WhyChip why={p.why} label={whyLabel(p.why, true, p.name)} />
              <span className="text-[11.5px] text-muted">
                loss {lossText(p)} &middot; {p.rttMs} ms
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------ */
/* B: pipeline                                                                                */
/* ------------------------------------------------------------------------------------------ */

const Node = ({
  title,
  limit,
  ramp,
  children,
  className = "",
}: {
  title: string;
  limit?: boolean;
  ramp?: boolean;
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={`flex-1 min-w-0 flex flex-col gap-1 p-3 rounded-[var(--radius-sm)] border ${limit ? `${WARN_BOX} border-2` : ramp ? "border-dashed border-border-strong bg-canvas" : "border-border bg-canvas"} ${className}`}
  >
    <div className="flex items-center justify-between gap-2">
      <MonoCaps>{title}</MonoCaps>
      {limit && <Chip kind="caution">limit</Chip>}
    </div>
    {children}
  </div>
);

const Pipe = ({ label, bad }: { label: string; bad?: boolean }) => (
  <div className="flex md:flex-col items-center justify-center gap-1 md:w-[78px] shrink-0 text-[10.5px] text-muted">
    <span className={bad ? "text-warning-ink font-semibold" : ""}>{label}</span>
    <span
      className={`text-[18px] leading-none max-md:rotate-90 ${bad ? "text-warning-ink" : "text-subtle"}`}
    >
      &rarr;
    </span>
  </div>
);

const Bar = ({ value, max, warn = false }: { value: number; max: number; warn?: boolean }) => (
  <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
    <div
      className={`h-full rounded-full ${warn ? "bg-warning" : "bg-primary"}`}
      style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
    />
  </div>
);

export const VariantB = ({ snap }: VariantProps) => {
  if (snap.role === "streamer") return <BStreamer snap={snap} />;
  const p = snap.pairs[0] as Pair;
  const link = limitingLink(p.why);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row md:items-stretch gap-2">
        <Node
          title={`${snap.streamer}'s step`}
          limit={link === "upload" || link === "streamer"}
          ramp={p.why === "starting"}
        >
          <span className="text-[15px] font-bold">{stepLabel(p.step)}</span>
          <span className="text-[11.5px] text-muted">cap {mbps(p.capBps)}</span>
          <Bar value={p.sentBps} max={p.capBps} warn={link === "upload"} />
          <span className="text-[11px] text-muted">
            {link === "upload"
              ? "upload shared between viewers"
              : link === "streamer"
                ? "encoder is CPU-limited"
                : link === "connection"
                  ? "stepped down for the link"
                  : p.why === "starting"
                    ? "ramping or probing"
                    : "top step for this screen"}
          </span>
        </Node>
        <Pipe label={mbps(p.sentBps, 1)} />
        <Node title="the connection" limit={link === "connection"}>
          <span className="text-[15px] font-bold">{pathLabel(p.path)}</span>
          <span className="text-[11.5px] text-muted">loss {lossText(p)}</span>
          <span className="text-[11.5px] text-muted">round trip {p.rttMs} ms</span>
          <span className="text-[11px] text-muted">
            {link === "connection" ? "either end or the route between you" : "healthy"}
          </span>
        </Node>
        <Pipe label={mbps(p.recv.bps, 1)} bad={link === "connection"} />
        <Node title="you receive">
          <span className="text-[15px] font-bold">
            {p.recv.w}&times;{p.recv.h}
          </span>
          <span className="text-[11.5px] text-muted">
            {p.recv.fps} fps &middot; {p.recv.codec}
          </span>
          <span className="text-[11.5px] text-muted">{mbps(p.recv.bps)}</span>
          <span className="text-[11px] text-muted">{p.freezes} freezes in the last minute</span>
        </Node>
      </div>
      <div
        className={`flex flex-col gap-1 p-3 rounded-[var(--radius-sm)] border ${link ? WARN_BOX : "border-border bg-canvas"}`}
      >
        <WhyChip why={p.why} />
        <p className="m-0 text-[12px] leading-relaxed">{whySentence(p.why, false)}</p>
      </div>
    </div>
  );
};

const BStreamer = ({ snap }: VariantProps) => {
  const used = snap.pairs.reduce((a, p) => a + p.sentBps, 0);
  const hue = ["var(--color-primary)", "var(--color-viz-2)", "var(--color-success)"];
  return (
    <div className="flex flex-col gap-4">
      <Section title="your upload">
        <div className="flex h-3 rounded-full overflow-hidden bg-surface-3">
          {snap.pairs.map((p, i) => (
            <div
              key={p.id}
              title={`${p.name} ${mbps(p.sentBps, 1)}`}
              style={{
                width: `${(p.sentBps / snap.upload.measuredBps) * 100}%`,
                background: hue[i % hue.length],
              }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
          {snap.pairs.map((p, i) => (
            <span key={p.id} className="inline-flex items-center gap-1.5">
              <i className="w-2 h-2 rounded-full" style={{ background: hue[i % hue.length] }} />
              {p.name} {mbps(p.sentBps, 1)}
            </span>
          ))}
          <span className="ml-auto">
            {mbps(used, 1)} of {mbps(snap.upload.budgetBps, 1)} budget &middot; link{" "}
            {mbps(snap.upload.measuredBps, 1)}
          </span>
        </div>
      </Section>
      <div className="grid grid-cols-[64px_1fr_1fr_1fr] max-md:grid-cols-[56px_1fr_1fr] gap-x-2 gap-y-2 items-stretch">
        <span />
        <MonoCaps>your step</MonoCaps>
        <MonoCaps>connection</MonoCaps>
        <MonoCaps className="max-md:hidden">they receive</MonoCaps>
        {snap.pairs.flatMap((p) => {
          const link = limitingLink(p.why);
          const cell = (on: boolean) =>
            `flex flex-col gap-0.5 p-2 rounded-[var(--radius-sm)] border text-[11.5px] ${on ? `${WARN_BOX} border-2` : "border-border bg-canvas"}`;
          return [
            <span key={`${p.id}-n`} className="self-center text-[12.5px] font-bold">
              {p.name}
            </span>,
            <div key={`${p.id}-s`} className={cell(link === "upload" || link === "streamer")}>
              <b className="text-[12.5px]">{stepLabel(p.step)}</b>
              <span className="text-muted">cap {mbps(p.capBps, 1)}</span>
              <span className="text-muted">
                {link === "upload"
                  ? "your upload"
                  : link === "streamer"
                    ? "your computer"
                    : link === "connection"
                      ? "stepped down for the link"
                      : p.why === "starting"
                        ? "ramping"
                        : "top step"}
              </span>
            </div>,
            <div key={`${p.id}-c`} className={cell(link === "connection")}>
              <b className="text-[12.5px]">{pathLabel(p.path)}</b>
              <span className="text-muted">
                loss {lossText(p)} &middot; {p.rttMs} ms
              </span>
              <span className="text-muted">
                {link === "connection" ? "may be either end" : "healthy"}
              </span>
            </div>,
            <div key={`${p.id}-r`} className={`${cell(false)} max-md:hidden`}>
              <b className="text-[12.5px]">
                {p.recv.w}&times;{p.recv.h}
              </b>
              <span className="text-muted">
                {p.recv.fps} fps &middot; {mbps(p.recv.bps, 1)}
              </span>
              <span className="text-muted">{p.recv.codec}</span>
            </div>,
          ];
        })}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------ */
/* C: live history                                                                            */
/* ------------------------------------------------------------------------------------------ */

const Timeline = ({ pairs, showName }: { pairs: Pair[]; showName: boolean }) => {
  const rows = pairs
    .flatMap((p) => p.events.map((e) => ({ ...e, who: p.name, streamerView: showName })))
    .sort((a, b) => a.ageS - b.ageS)
    .slice(0, 6);
  return (
    <ol className="m-0 p-0 list-none flex flex-col gap-0 border-l border-border ml-1.5">
      {rows.map((e) => {
        const up = e.prev ? capOf(e.step) > capOf(e.prev) : true;
        return (
          <li
            key={`${e.who}-${e.at}`}
            className="relative pl-4 py-1.5 flex flex-wrap items-baseline gap-x-2"
          >
            <i
              className={`absolute -left-[4.5px] top-[11px] w-2 h-2 rounded-full ${e.why === "best" ? "bg-success" : e.why === "starting" ? "bg-subtle" : "bg-warning"}`}
            />
            <span className="w-[62px] text-[10.5px] text-muted shrink-0">{ago(e.ageS)}</span>
            {showName && <b className="text-[11.5px]">{e.who}</b>}
            <span className="text-[12px] font-semibold">
              {up ? "↑" : "↓"} {stepLabel(e.step)}
            </span>
            <span className="text-[11.5px] text-muted">
              {whyLabel(e.why, e.streamerView, e.who)}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

export const VariantC = ({
  snap,
  viewerId,
  onViewer,
}: VariantProps & { viewerId: string; onViewer: (id: string) => void }) => {
  if (snap.role === "streamer")
    return <CStreamer snap={snap} viewerId={viewerId} onViewer={onViewer} />;
  const p = snap.pairs[0] as Pair;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-3">
        <div className="flex flex-col gap-1 p-3 rounded-[var(--radius-sm)] border border-border bg-canvas">
          <MonoCaps>bitrate &middot; last minute</MonoCaps>
          <span className="text-[20px] font-extrabold tracking-[-0.02em]">{mbps(p.recv.bps)}</span>
          <Spark values={p.history.map((s) => s.bps)} cap={p.history.map((s) => s.capBps)} />
          <span className="text-[10.5px] text-muted">dashed: cap {mbps(p.capBps, 1)}</span>
        </div>
        <div className="flex flex-col gap-1 p-3 rounded-[var(--radius-sm)] border border-border bg-canvas">
          <MonoCaps>resolution &middot; last minute</MonoCaps>
          <span className="text-[20px] font-extrabold tracking-[-0.02em]">{stepLabel(p.step)}</span>
          <Spark values={p.history.map((s) => s.h)} stepped max={1400} />
          <span className="text-[10.5px] text-muted">height in pixels, steps as they happen</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <WhyChip why={p.why} />
        <Chip>{pathLabel(p.path)}</Chip>
        <Chip>loss {lossText(p)}</Chip>
        <Chip>{p.rttMs} ms</Chip>
        <Chip>{p.recv.codec}</Chip>
        <Chip>{p.recv.fps} fps</Chip>
        <Chip>{p.freezes} freezes</Chip>
      </div>
      <p className="m-0 text-[12px] text-muted leading-relaxed">{whySentence(p.why, false)}</p>
      <Section title="step changes">
        <Timeline pairs={[p]} showName={false} />
      </Section>
    </div>
  );
};

const CStreamer = ({
  snap,
  viewerId,
  onViewer,
}: VariantProps & { viewerId: string; onViewer: (id: string) => void }) => {
  const total = (snap.pairs[0] as Pair).history.map((_, i) =>
    snap.pairs.reduce((a, p) => a + (p.history[i]?.bps ?? 0), 0),
  );
  const sel = (snap.pairs.find((p) => p.id === viewerId) ?? snap.pairs[0]) as Pair;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 p-3 rounded-[var(--radius-sm)] border border-border bg-canvas">
        <MonoCaps>your upload, all viewers &middot; last minute</MonoCaps>
        <span className="text-[20px] font-extrabold tracking-[-0.02em]">
          {mbps(total.at(-1) ?? 0, 1)}
          <span className="text-[12px] font-medium text-muted">
            {" "}
            of {mbps(snap.upload.budgetBps, 1)} budget
          </span>
        </span>
        <Spark values={total} cap={total.map(() => snap.upload.budgetBps)} height={44} />
      </div>
      <Section title="viewers">
        <div className="flex flex-col gap-1.5">
          {snap.pairs.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === sel.id}
              onClick={() => onViewer(p.id)}
              className={`grid grid-cols-[56px_1fr_150px] max-sm:grid-cols-[56px_1fr] items-center gap-3 px-3 py-2 rounded-[var(--radius-sm)] border text-left cursor-pointer ${p.id === sel.id ? "border-border-strong bg-surface-2" : "border-border bg-canvas hover:bg-surface-2"}`}
            >
              <b className="text-[12.5px]">{p.name}</b>
              <Spark
                values={p.history.map((s) => s.bps)}
                cap={p.history.map((s) => s.capBps)}
                height={26}
                max={11_500_000}
              />
              <span className="flex flex-col gap-0.5 max-sm:hidden">
                <span className="text-[11.5px] font-semibold">{stepLabel(p.step)}</span>
                <span className="text-[10.5px] text-muted truncate">
                  {whyLabel(p.why, true, p.name)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </Section>
      <p className="m-0 text-[12px] text-muted leading-relaxed">
        <b className="text-fg">{sel.name}</b>: {whyLabel(sel.why, true, sel.name)}.{" "}
        {whySentence(sel.why, true)}
      </p>
      <Section title="step changes, all viewers">
        <Timeline pairs={snap.pairs} showName />
      </Section>
    </div>
  );
};
