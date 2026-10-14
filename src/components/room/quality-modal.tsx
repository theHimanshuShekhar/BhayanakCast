// The stream quality modal (ADR 2 addendum, #104): why a screen share looks the way it does.
// Read-only, no controls, updating about every second. A viewer sees what they receive and what
// the streamer says about their pair; a streamer sees how their upload is shared among viewers.
// Layout is the operator's pick from the #93 prototype (variant C, live history), with the reason
// on top and taller sparklines per viewer.
import { Dialog } from "@base-ui/react/dialog";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { fmtDuration } from "~/lib/format";
import type { QualityView, StreamerQuality, ViewerQuality, ViewerRow } from "~/lib/mesh";
import { HISTORY_MS, type QualityPoint, type StepChange } from "~/lib/quality-history";
import { causeText, reasonText, type StepReason } from "~/lib/quality-reason";
import { fmtMbps, Key, Panel } from "../chart-parts";
import { Sheet } from "../overlays";
import { TimelineChart, type TimelineSeries } from "../timeline-chart";
import { Btn, Chip, MonoCaps } from "../ui";
import { InlineReportForm, type ProblemReporter } from "./report-problem";

const VIZ = "var(--color-viz-1)";
/** How long after one refresh finishes the next starts. */
export const REFRESH_MS = 1_000;
/** A point older than this is not "now": the stream stopped, or the page is catching up. */
const FRESH_MS = 8_000;

const mbps = (bps: number, digits = 2) => `${(bps / 1_000_000).toFixed(digits)} Mbps`;
const percent = (fraction: number) => `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;

/**
 * The chip's look for each reason: green at the top (healthy), amber where the pair's own link or
 * the streamer's computer holds it (caution), and plain for the rest. A shared upload is how a
 * room with several viewers normally works, so it isn't a warning.
 */
const TONE: Record<StepReason, "ok" | "caution" | ""> = {
  best: "ok",
  shared: "",
  connection: "caution",
  computer: "caution",
  starting: "",
};

/** A box around one chart (the shared `Panel`) in the modal. */
const Card = ({ children }: { children: ReactNode }) => (
  <div className="p-3 min-w-0 rounded-[var(--radius-sm)] border border-border bg-canvas">
    {children}
  </div>
);

/**
 * The view of `userId`'s stream, read now and again every `REFRESH_MS` while it is open, each
 * time after one more `getStats` on that pair (`refresh`). Undefined while closed.
 */
function useQualityView(
  userId: string | null,
  read: (userId: string) => QualityView | undefined,
  refresh: (userId: string) => Promise<void>,
): QualityView | undefined {
  const [view, setView] = useState<QualityView | undefined>();
  useEffect(() => {
    if (!userId) {
      setView(undefined);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (!stopped) setView(read(userId));
    };
    // The next read is timed from the end of the last one, so a slow `getStats` never has two
    // of them running at once.
    const tick = () => {
      refresh(userId)
        .catch(() => {})
        .finally(() => {
          update();
          if (!stopped) timer = setTimeout(tick, REFRESH_MS);
        });
    };
    update();
    timer = setTimeout(tick, REFRESH_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [userId, read, refresh]);
  return view;
}

export function QualityModal({
  userId,
  meId,
  names,
  read,
  refresh,
  reporter,
  onClose,
}: {
  /** Whose stream (the streamer's user id), or null when closed. */
  userId: string | null;
  meId: string | null;
  /** Display names by user id. */
  names: Readonly<Record<string, string>>;
  read: (userId: string) => QualityView | undefined;
  refresh: (userId: string) => Promise<void>;
  /** Sends a problem report about this stream (#117); without it there is no report button. */
  reporter?: ProblemReporter;
  onClose: () => void;
}) {
  const view = useQualityView(userId, read, refresh);
  const [reporting, setReporting] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes the form for another stream
  useEffect(() => setReporting(false), [userId]);
  // The form replaces the button; when it closes (sent or cancelled) focus goes back to it, not
  // to the top of the dialog.
  const reportSection = useRef<HTMLElement>(null);
  const wasReporting = useRef(false);
  useEffect(() => {
    if (wasReporting.current && !reporting && userId !== null) {
      reportSection.current?.querySelector<HTMLElement>("[data-report-button]")?.focus();
    }
    wasReporting.current = reporting;
  }, [reporting, userId]);
  const yours = userId !== null && userId === meId;
  const name = (id: string) => names[id] ?? "someone";
  return (
    <Sheet
      open={userId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={yours ? "quality · your share" : `quality · ${userId ? name(userId) : ""}'s screen`}
      width="w-[min(640px,96vw)]"
      footer={
        <MonoCaps>
          <span aria-hidden="true">&#9679;</span> read-only &middot; updating every second
        </MonoCaps>
      }
    >
      <Dialog.Description className="sr-only">
        {yours
          ? "How your upload is shared among the people watching your screen. Read-only, updated every second."
          : "Why this screen looks the way it does. Read-only, updated every second."}
      </Dialog.Description>
      {view && <QualityBody view={view} name={name} />}
      {userId !== null && view === undefined && (
        <p className="m-0 text-[12.5px] text-muted">
          {yours ? "you're not sharing right now." : "not connected to them right now."}
        </p>
      )}
      {userId !== null && reporter && (
        <section
          ref={reportSection}
          aria-label="report a problem with this stream"
          className="flex flex-col gap-3"
        >
          {reporting ? (
            <InlineReportForm
              reporter={reporter}
              streamUserId={userId}
              onDone={() => setReporting(false)}
              onCancel={() => setReporting(false)}
            />
          ) : (
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-dashed border-border-subtle">
              <span className="text-[11.5px] text-muted">
                {reporter.blocked
                  ? "you just sent a report. try again in a minute."
                  : "does this look wrong?"}
              </span>
              {/* aria-disabled, not disabled: after a send it is where focus returns, and a
                  disabled button can't take it. */}
              <Btn
                data-report-button=""
                size="sm"
                aria-disabled={reporter.blocked}
                className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                onClick={() => !reporter.blocked && setReporting(true)}
              >
                report a problem
              </Btn>
            </div>
          )}
        </section>
      )}
    </Sheet>
  );
}

/** What the modal says of `view`: a viewer's (someone else's share) or the streamer's own. */
export function QualityBody({
  view,
  name,
}: {
  view: QualityView;
  /** A person's display name by user id. */
  name: (userId: string) => string;
}) {
  return view.side === "viewer" ? (
    <ViewerBody view={view} streamer={name(view.userId)} />
  ) : (
    <StreamerBody view={view} name={name} />
  );
}

// ---------------------------------------------------------------------------------------------
// A viewer's view

function ViewerBody({ view, streamer }: { view: ViewerQuality; streamer: string }) {
  const now = Date.now();
  const domain: [number, number] = [now - HISTORY_MS, now];
  const last = fresh(view.points, now);
  const reason = view.note?.reason;
  const text = reasonText(reason, { side: "viewer" });
  const cap = view.note?.maxBitrate;
  return (
    <>
      <section className="flex flex-col gap-2" aria-label="why">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span data-testid="quality-reason">
            <Chip kind={reason ? TONE[reason] : ""} dot>
              {text.label}
            </Chip>
          </span>
          {view.note && (
            <span data-testid="quality-step" className="text-[12.5px] font-semibold tabular-nums">
              {view.note.step}
              <span className="font-normal text-muted"> &middot; up to {mbps(cap ?? 0)}</span>
            </span>
          )}
        </div>
        <p className="m-0 text-[12px] text-muted leading-relaxed">{text.explanation}</p>
      </section>

      <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-x-4 gap-y-4">
        <Card>
          <Panel
            title="bitrate (Mbps) · last minute"
            hasValue
            value={last?.bps === undefined ? undefined : mbps(last.bps)}
            legend={
              <>
                <Key color={VIZ}>received</Key>
                {cap !== undefined && (
                  <Key color="var(--color-subtle)" dashed>
                    step cap {mbps(cap, 1)}
                  </Key>
                )}
              </>
            }
          >
            <TimelineChart
              label={`Bitrate received from ${streamer}, last minute${last?.bps === undefined ? "" : `: ${mbps(last.bps)} now`}`}
              series={[
                series("received", "received", view.points, (p) => p.bps),
                ...(cap === undefined
                  ? []
                  : [series("cap", "step cap", view.points, (p) => p.capBps, true)]),
              ].filter((s) => s.points.length > 0)}
              domain={domain}
              marks={marksOf(view.changes, domain)}
              fromEnd
              format={fmtMbps}
            />
          </Panel>
        </Card>
        <Card>
          <Panel
            title="resolution (lines) · last minute"
            hasValue
            value={last?.height === undefined ? undefined : `${last.width ?? "?"}×${last.height}`}
          >
            <ResolutionChart
              label={`Resolution of ${streamer}'s screen, last minute${last?.height === undefined ? "" : `: ${last.height} lines now`}`}
              points={view.points}
              domain={domain}
              marks={marksOf(view.changes, domain)}
            />
          </Panel>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip title="how this pair connects">{view.path ?? "path unknown"}</Chip>
        <Chip title="packet loss">loss {last?.loss === undefined ? "–" : percent(last.loss)}</Chip>
        <Chip title="round trip">
          rtt {last?.rttMs === undefined ? "–" : `${Math.round(last.rttMs)} ms`}
        </Chip>
        <Chip title="video codec">{last?.codec?.replace(/^video\//i, "") ?? "codec –"}</Chip>
        <Chip title="frames per second">
          {last?.fps === undefined ? "–" : Math.round(last.fps)} fps
        </Chip>
        <Chip title="freezes since you started watching">{last?.freezes ?? "–"} freezes</Chip>
      </div>
      {view.points.length < 2 && (
        <p className="m-0 text-[11.5px] text-muted">
          {view.state === "failed"
            ? "can't connect to them, so there's nothing to show."
            : "collecting readings; the graphs fill in over the next few seconds."}
        </p>
      )}

      <Section title="step changes">
        <Timeline changes={view.changes} now={now} />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// A streamer's view of their own share

function StreamerBody({ view, name }: { view: StreamerQuality; name: (id: string) => string }) {
  const now = Date.now();
  const domain: [number, number] = [now - HISTORY_MS, now];
  const last = fresh(view.uplink, now);
  // The video budget starts as an estimate (ADR 2's 25 Mbps floor, less audio), and is said to be
  // one until the uplink has been measured under strain.
  const budgetName = `video budget${view.budgetMeasured ? "" : " (estimate)"}`;
  const budget = mbps(view.budget, 1);
  // One scale for every row, so a thin slice looks thin next to a thick one.
  const top = Math.max(
    1,
    ...view.viewers.flatMap((v) => v.points.flatMap((p) => [p.bps ?? 0, p.capBps ?? 0])),
  );
  return (
    <>
      <Card>
        <Panel
          title="your upload, all viewers (Mbps) · last minute"
          hasValue
          value={last?.bps === undefined ? undefined : `${mbps(last.bps, 1)} of ${budget}`}
          legend={
            <>
              <Key color={VIZ}>upload</Key>
              <Key color="var(--color-subtle)" dashed>
                {budgetName}
              </Key>
            </>
          }
        >
          <TimelineChart
            label={`Your total upload against the ${budgetName}, last minute${last?.bps === undefined ? "" : `: ${mbps(last.bps, 1)} of ${budget} now`}`}
            series={[
              series("upload", "upload", view.uplink, (p) => p.bps),
              series("budget", "budget", view.uplink, (p) => p.capBps, true),
            ].filter((s) => s.points.length > 0)}
            domain={domain}
            marks={marksOf(view.changes, domain)}
            fromEnd
            format={fmtMbps}
          />
        </Panel>
      </Card>

      <Section title="viewers">
        {view.viewers.length === 0 ? (
          <p className="m-0 text-[12px] text-muted">nobody else is here yet.</p>
        ) : (
          <ul aria-label="viewers" className="m-0 p-0 list-none flex flex-col gap-1.5">
            {view.viewers.map((row) => (
              <ViewerRowView
                key={row.userId}
                row={row}
                name={name(row.userId)}
                top={top}
                now={now}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="step changes, all viewers">
        <Timeline changes={view.changes} now={now} name={name} />
      </Section>
    </>
  );
}

function ViewerRowView({
  row,
  name,
  top,
  now,
}: {
  row: ViewerRow;
  name: string;
  top: number;
  now: number;
}) {
  const last = fresh(row.points, now);
  const text = reasonText(row.note?.reason, { side: "streamer", viewer: name });
  const connected = row.state === "connected" || row.state === "relayed";
  return (
    <li className="grid grid-cols-[88px_1fr_minmax(150px,200px)] max-sm:grid-cols-[72px_1fr] items-center gap-3 px-3 py-2 rounded-[var(--radius-sm)] border border-border bg-canvas">
      <b className="text-[12.5px] truncate" title={name}>
        {name}
      </b>
      <Sparkline
        points={row.points}
        top={top}
        now={now}
        label={`${name}: ${last?.bps === undefined ? "no reading yet" : `${mbps(last.bps)} now`}, last minute`}
      />
      <span className="flex flex-col gap-0.5 max-sm:col-span-2 min-w-0">
        {row.note ? (
          <>
            <span className="text-[12px] font-semibold tabular-nums">
              {row.note.step}
              <span className="font-normal text-muted">
                {" "}
                &middot; up to {mbps(row.note.maxBitrate)}
              </span>
            </span>
            <span className="text-[11px] text-fg-muted leading-snug">{text.label}</span>
          </>
        ) : (
          <span className="text-[11.5px] text-muted">
            {connected ? "no step yet" : row.state === "failed" ? "can't connect" : "connecting…"}
          </span>
        )}
        {row.path && <span className="text-[10.5px] text-muted">{row.path}</span>}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Pieces

/** The newest of `points`, if it is recent enough to be "now". */
function fresh<T extends QualityPoint>(points: T[], now: number): T | undefined {
  const last = points.at(-1);
  return last && now - last.at <= FRESH_MS ? last : undefined;
}

/** A line of `points` as chart points, those that have a value. `context`: a dashed reference. */
function series(
  key: string,
  label: string,
  points: QualityPoint[],
  pick: (point: QualityPoint) => number | undefined,
  context = false,
): TimelineSeries {
  return {
    key,
    label,
    color: VIZ,
    points: points.flatMap((p) => {
      const v = pick(p);
      return v === undefined ? [] : [{ t: p.at, v }];
    }),
    ...(context && { step: true, context: true }),
  };
}

/** Where steps changed within the window: a hairline each, so the graphs line up with the list. */
const marksOf = (changes: StepChange[], [from, to]: [number, number]) =>
  changes.map((c) => c.at).filter((t) => t > from && t < to);

function ResolutionChart({
  label,
  points,
  domain,
  marks,
}: {
  label: string;
  points: QualityPoint[];
  domain: [number, number];
  marks: number[];
}) {
  const tallest = Math.max(0, ...points.map((p) => p.height ?? 0));
  // A scale of round numbers of lines (360 apart), always a step above the tallest picture so
  // the line and its end dot aren't drawn on the top edge.
  const yMax = Math.max(720, (Math.floor(tallest / 360) + 1) * 360);
  return (
    <TimelineChart
      label={label}
      series={[series("height", "lines", points, (p) => p.height)].filter(
        (s) => s.points.length > 0,
      )}
      domain={domain}
      marks={marks}
      fromEnd
      yMax={yMax}
      yTicks={[0, yMax / 2, yMax]}
      format={(v) => `${Math.round(v)}p`}
    />
  );
}

const SPARK_W = 240;
const SPARK_H = 48;

/**
 * A viewer's bitrate over the last minute, no axes: a taller line than the old prototype's, with
 * the step's cap behind it, dashed. Every row shares `top`, so the rows compare. Decorative to
 * the eye only: the row's text says the same in words, and the label gives the number now.
 */
function Sparkline({
  points,
  top,
  now,
  label,
}: {
  points: QualityPoint[];
  top: number;
  now: number;
  label: string;
}) {
  const x = (at: number) => ((at - (now - HISTORY_MS)) / HISTORY_MS) * SPARK_W;
  const y = (v: number) => SPARK_H - 2 - (Math.min(v, top) / top) * (SPARK_H - 4);
  const line = (pick: (p: QualityPoint) => number | undefined, stepped: boolean) =>
    points
      .flatMap((p) => {
        const v = pick(p);
        return v === undefined ? [] : [{ at: p.at, v }];
      })
      .map((p, i, all) => {
        const prev = all[i - 1];
        if (!prev) return `M${x(p.at).toFixed(1)} ${y(p.v).toFixed(1)}`;
        return stepped
          ? `H${x(p.at).toFixed(1)} V${y(p.v).toFixed(1)}`
          : `L${x(p.at).toFixed(1)} ${y(p.v).toFixed(1)}`;
      })
      .join(" ");
  const bps = line((p) => p.bps, false);
  const cap = line((p) => p.capBps, true);
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className="w-full block"
      style={{ height: SPARK_H }}
      role="img"
      aria-label={label}
    >
      <line
        x1="0"
        x2={SPARK_W}
        y1={SPARK_H - 0.5}
        y2={SPARK_H - 0.5}
        style={{ stroke: "var(--color-border)" }}
        vectorEffect="non-scaling-stroke"
      />
      {cap && (
        <path
          d={cap}
          fill="none"
          style={{ stroke: "var(--color-subtle)" }}
          strokeWidth="1.5"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {bps && (
        <path
          d={bps}
          fill="none"
          style={{ stroke: VIZ }}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function Timeline({
  changes,
  now,
  name,
}: {
  /** A streamer's carry the viewer they are about (and then `name` says who). */
  changes: (StepChange & { userId?: string })[];
  now: number;
  name?: (userId: string) => string;
}) {
  if (changes.length === 0) {
    return <p className="m-0 text-[12px] text-muted">no step changes yet.</p>;
  }
  return (
    <ol
      aria-label="step changes, newest first"
      className="m-0 p-0 list-none flex flex-col gap-1 max-h-[148px] overflow-auto text-[11.5px]"
    >
      {[...changes].reverse().map((change) => {
        const who = name && change.userId ? name(change.userId) : "";
        // What made this change (not why the pair sits where it does now: that is the chip above).
        const why =
          change.cause &&
          causeText(change.cause, name ? { side: "streamer", viewer: who } : { side: "viewer" });
        const ago =
          now - change.at < 2_000 ? "just now" : `${fmtDuration((now - change.at) / 1_000)} ago`;
        return (
          <li
            key={`${change.at}-${who}-${change.to}`}
            className="grid grid-cols-[64px_1fr] gap-2 items-baseline"
          >
            <span className="text-muted tabular-nums">{ago}</span>
            <span className="min-w-0">
              {who && <b>{who} </b>}
              <span className="tabular-nums">
                {change.from ? `${change.from} → ${change.to}` : `started at ${change.to}`}
              </span>
              {why && <span className="text-muted"> &middot; {why}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-2">
    <MonoCaps>{title}</MonoCaps>
    {children}
  </section>
);
