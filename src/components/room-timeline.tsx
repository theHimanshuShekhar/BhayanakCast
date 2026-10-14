// The admin's view of one room's timeline (CONTEXT.md, Room timeline; issue #114): incident
// first, swimlanes as the full view. Opened on a report it shows the incident (everyone's
// snapshot, then two minutes either side); opened on a room, or on "full timeline", it shows the
// swimlanes with filter chips and zoom. The events table under the chart holds what the chart
// draws, for reading without it.
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { roomReportsQuery, roomTimelineQuery } from "~/lib/admin.queries";
import { fmtDuration } from "~/lib/format";
import { PROBLEM_CATEGORY_LABELS, type RecentReport } from "~/lib/problem-report";
import {
  brushView,
  clockLabel,
  dateTimeLabel,
  fullView,
  INCIDENT_WINDOW_MS,
  MIN_VIEW_MS,
  panView,
  type Range,
  windowAround,
  zoneName,
  zoomView,
} from "~/lib/timeline-axis";
import type { QualityFocus } from "~/lib/timeline-incident";
import {
  buildTimelineModel,
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  filterLanes,
  filterReports,
  filterRows,
  type ReportMarker,
  type TimelineFilter,
} from "~/lib/timeline-model";
import { SnapshotTable } from "./room-timeline-incident";
import { LanesLegend, RoomTimelineLanes } from "./room-timeline-lanes";
import { RowsTable } from "./room-timeline-rows";
import { Btn, Chip, MonoCaps } from "./ui";

/** A domain to hold the place of one that has not loaded. */
const NO_DOMAIN: Range = { t0: 0, t1: MIN_VIEW_MS };

/** The most rows the events table draws; a room can have 5,000 entries. */
const MAX_TABLE_ROWS = 500;

const card = "bg-surface border border-border rounded-[var(--radius)] shadow-card";
const reportTint =
  "bg-[color-mix(in_oklch,var(--color-warning)_13%,var(--color-surface))] border-[color-mix(in_oklch,var(--color-warning)_55%,transparent)]";
const bar =
  "flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 border-b border-border-subtle bg-canvas";

/** A chip that switches something on or off. */
const Toggle = ({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button type="button" aria-pressed={on} onClick={onClick} className="cursor-pointer">
    <Chip kind={on ? "accent" : ""} className={on ? "" : "opacity-70 hover:opacity-100"}>
      {children}
    </Chip>
  </button>
);

const flip = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
};

const ReportTitle = ({ report, marker }: { report?: RecentReport; marker?: ReportMarker }) => {
  const category = report?.category ?? marker?.category;
  const note = report ? report.note : marker?.note;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {category && (
        <Chip kind="caution" className="font-semibold uppercase">
          {PROBLEM_CATEGORY_LABELS[category]}
        </Chip>
      )}
      {report && <b className="font-medium text-fg">{report.reporter.username}</b>}
      {report?.stream && <span className="text-subtle">on {report.stream.username}'s screen</span>}
      {note && <span className="text-fg">“{note}”</span>}
    </span>
  );
};

/**
 * One room's timeline. `initialReportId` opens that report's incident first. `live` is a room
 * still going: its open intervals run to now. `onQuality` opens a pair in the quality panel.
 */
export const RoomTimelinePanel = ({
  roomId,
  live,
  initialReportId,
  onQuality,
  focusHeading,
}: {
  roomId: string;
  live: boolean;
  initialReportId?: string;
  onQuality: (focus: QualityFocus) => void;
  /**
   * Put focus on this section's heading. Called when switching between the incident and the
   * swimlanes takes away the control that had it (a marker, a button), which would otherwise
   * drop focus to the page.
   */
  focusHeading: () => void;
}) => {
  const timelineQuery = useQuery(roomTimelineQuery(roomId));
  const reportsQuery = useQuery(roomReportsQuery(roomId));
  const timeline = timelineQuery.data;
  const reports = reportsQuery.data?.reports ?? [];

  const [reportId, setReportId] = useState<string | null>(initialReportId ?? null);
  const [mode, setMode] = useState<"incident" | "full">(initialReportId ? "incident" : "full");
  const [filter, setFilter] = useState<TimelineFilter>({
    categories: new Set(CATEGORIES),
    people: new Set(),
  });
  const [zoom, setZoom] = useState<Range | null>(null);

  const until = live ? timelineQuery.dataUpdatedAt : undefined;
  const model = useMemo(
    () => (timeline ? buildTimelineModel(timeline, until) : null),
    [timeline, until],
  );

  // What the filters leave, worked out when the model or the filters change and not on every
  // draw: a wheel turn or a hover redraws the panel, and none of this has moved.
  const domain = model?.domain ?? NO_DOMAIN;
  const full = fullView(domain);
  const view = zoom ?? full;
  const lanes = useMemo(() => (model ? filterLanes(model.lanes, filter) : []), [model, filter]);
  const shownReports = useMemo(
    () => (model ? filterReports(model.reports, filter) : []),
    [model, filter],
  );
  const filteredRows = useMemo(
    () => (model ? filterRows(model.rows, filter) : []),
    [model, filter],
  );
  const rowsInView = useMemo(
    () => filteredRows.filter((r) => r.t >= view.t0 && r.t <= view.t1),
    [filteredRows, view.t0, view.t1],
  );
  const counts = useMemo(() => {
    const byCategory = new Map<Category, number>();
    for (const r of model?.rows ?? [])
      byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
    return byCategory;
  }, [model]);
  const everyone = useMemo(() => model?.lanes.filter((l) => l.kind === "person") ?? [], [model]);

  if (timelineQuery.isError) {
    return <div className={`${card} p-5 text-xs text-live-ink`}>timeline unavailable</div>;
  }
  if (!timeline || !model) return <div className={`${card} p-5 text-xs text-subtle`}>loading…</div>;
  if (timeline.entries.length === 0) {
    return (
      <div className={`${card} p-5 text-xs text-subtle`}>
        nothing recorded for this room (events are kept 90 days, intervals 30)
      </div>
    );
  }

  const spanMs = view.t1 - view.t0;
  const zoomed = spanMs < full.t1 - full.t0 - 1;

  const marker = model.reports.find((r) => r.id === reportId);
  const report = reports.find((r) => r.id === reportId);
  // A report with neither a marker nor a stored row can't be placed.
  const incidentAt = marker?.t ?? (report ? Date.parse(report.at) : null);
  const inIncident = mode === "incident" && reportId !== null && incidentAt !== null;

  // Each of these takes away the control that was pressed, so focus goes to the heading.
  const open = (id: string) => {
    setReportId(id);
    setMode("incident");
    focusHeading();
  };
  const showOnTimeline = () => {
    if (incidentAt === null) return;
    setZoom(brushView(domain, incidentAt - INCIDENT_WINDOW_MS, incidentAt + INCIDENT_WINDOW_MS));
    setMode("full");
    focusHeading();
  };
  const showFullTimeline = () => {
    setMode("full");
    focusHeading();
  };

  const incidentRows = incidentAt === null ? [] : windowAround(model.rows, incidentAt);
  const countOf = (c: Category) => counts.get(c) ?? 0;
  const filtered = filter.people.size > 0 || filter.categories.size < CATEGORIES.length;

  const reportLabel = (m: ReportMarker) => {
    const full = reports.find((r) => r.id === m.id);
    const who =
      full?.reporter.username ?? timeline.people[m.reporterId ?? ""]?.username ?? "someone";
    return `${PROBLEM_CATEGORY_LABELS[m.category]} reported by ${who}${m.note ? `: “${m.note}”` : ""} · click to open the incident`;
  };

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      {timeline.truncated && (
        <p className="m-0 text-[11.5px] text-warning-ink">
          showing the latest {timeline.entries.length.toLocaleString("en-US")} entries: older ones
          are left out
        </p>
      )}

      {reports.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <MonoCaps>problem reports · pick one to see its incident</MonoCaps>
          <div className="flex flex-wrap gap-2">
            {reports.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={inIncident && reportId === r.id}
                onClick={() => open(r.id)}
                className={`flex cursor-pointer items-center gap-x-3 rounded-[var(--radius-sm)] border px-3 py-1.5 text-left text-[11.5px] hover:brightness-110 ${reportTint} ${inIncident && reportId === r.id ? "outline outline-2 outline-primary" : ""}`}
              >
                <span className="tabular-nums text-subtle">{dateTimeLabel(Date.parse(r.at))}</span>
                <ReportTitle report={r} />
              </button>
            ))}
          </div>
        </div>
      )}

      {inIncident && incidentAt !== null ? (
        <>
          <div className={`${card} overflow-hidden`}>
            <div className={bar}>
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                <span className="tabular-nums text-subtle">{dateTimeLabel(incidentAt)}</span>
                <ReportTitle report={report} marker={marker} />
              </span>
              <span className="inline-flex gap-2">
                <Btn size="sm" onClick={showOnTimeline}>
                  see it on the timeline
                </Btn>
                <Btn size="sm" onClick={showFullTimeline}>
                  full timeline
                </Btn>
              </span>
            </div>
            {report ? (
              <>
                <SnapshotTable
                  report={report}
                  onQuality={(row) =>
                    onQuality({ streamerId: row.streamerId, viewerId: row.viewerId })
                  }
                />
                <p className="m-0 border-t border-border-subtle px-3.5 py-2 text-[10.5px] text-subtle">
                  {report.snapshots.length === 0
                    ? "no browser sent a snapshot"
                    : `from ${report.snapshots
                        .map((s) => `${s.user.username} (${s.browser.name} ${s.browser.version})`)
                        .join(", ")}`}
                  {report.reused && " · the room's earlier snapshot, reused"}
                  {report.snapshots.some((s) => s.truncated) &&
                    " · some were too large to keep: only the browser is known"}
                </p>
              </>
            ) : (
              <p className="m-0 px-3.5 py-3 text-[11.5px] text-subtle">
                {reportsQuery.isError
                  ? "snapshots unavailable"
                  : reportsQuery.isPending
                    ? "loading snapshots…"
                    : "this report's snapshot is no longer listed"}
              </p>
            )}
          </div>

          <div className={`${card} overflow-hidden`}>
            <div className={bar}>
              <MonoCaps>
                {incidentRows.length} events from{" "}
                {clockLabel(incidentAt - INCIDENT_WINDOW_MS, true)} to{" "}
                {clockLabel(incidentAt + INCIDENT_WINDOW_MS, true)} {zoneName(incidentAt)}
              </MonoCaps>
            </div>
            <RowsTable
              label="events around the report"
              rows={incidentRows}
              relativeTo={incidentAt}
              highlight={reportId ?? undefined}
              empty="nothing was recorded within two minutes of the report"
            />
          </div>
        </>
      ) : (
        <div className={`${card} overflow-hidden`}>
          <div className={bar}>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <MonoCaps>category</MonoCaps>
                {CATEGORIES.map((c) => (
                  <Toggle
                    key={c}
                    on={filter.categories.has(c)}
                    onClick={() => setFilter({ ...filter, categories: flip(filter.categories, c) })}
                  >
                    {CATEGORY_LABELS[c]}{" "}
                    <span className="tabular-nums opacity-70">{countOf(c)}</span>
                  </Toggle>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <MonoCaps>person</MonoCaps>
                {everyone.map((l) => {
                  const id = l.people[0] as string;
                  return (
                    <Toggle
                      key={id}
                      on={filter.people.has(id)}
                      onClick={() => setFilter({ ...filter, people: flip(filter.people, id) })}
                    >
                      {l.label}
                    </Toggle>
                  );
                })}
                {filtered && (
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setFilter({ categories: new Set(CATEGORIES), people: new Set() })
                    }
                  >
                    clear filters
                  </Btn>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <fieldset
                className="m-0 flex min-w-0 flex-wrap items-center justify-end gap-1.5 border-0 p-0"
                aria-label="zoom the time axis"
              >
                <Btn
                  size="sm"
                  aria-label="Pan earlier"
                  disabled={view.t0 <= full.t0}
                  onClick={() => setZoom(panView(view, domain, -spanMs / 2))}
                >
                  ◀
                </Btn>
                <Btn
                  size="sm"
                  aria-label="Pan later"
                  disabled={view.t1 >= full.t1}
                  onClick={() => setZoom(panView(view, domain, spanMs / 2))}
                >
                  ▶
                </Btn>
                <Btn
                  size="sm"
                  aria-label="Zoom in"
                  disabled={spanMs <= MIN_VIEW_MS}
                  onClick={() => setZoom(zoomView(view, domain, 0.5))}
                >
                  zoom in
                </Btn>
                <Btn
                  size="sm"
                  aria-label="Zoom out"
                  disabled={!zoomed}
                  onClick={() => setZoom(zoomView(view, domain, 2))}
                >
                  zoom out
                </Btn>
                <Btn
                  size="sm"
                  aria-label="Reset zoom"
                  disabled={!zoomed}
                  onClick={() => setZoom(null)}
                >
                  reset
                </Btn>
              </fieldset>
              <MonoCaps>
                <span data-testid="timeline-view" className="normal-case">
                  {clockLabel(view.t0, true)}–{clockLabel(view.t1, true)} {zoneName(view.t0)} ·{" "}
                  {fmtDuration(spanMs / 1_000)}
                </span>
              </MonoCaps>
            </div>
          </div>
          <div className="px-3.5 py-3">
            {lanes.length > 0 ? (
              <RoomTimelineLanes
                lanes={lanes}
                reports={shownReports}
                domain={domain}
                view={view}
                onView={setZoom}
                onOpenReport={open}
                reportLabel={reportLabel}
              />
            ) : (
              <p className="m-0 p-7 text-center text-[11.5px] text-subtle">nothing matches</p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border-subtle px-3.5 py-2.5">
            <LanesLegend />
            <span className="text-[10.5px] text-subtle">
              ctrl + scroll zooms · shift + scroll pans · drag selects a stretch · arrow keys step
              through a lane
            </span>
          </div>
          <details open className="border-t border-border-subtle">
            <summary className="cursor-pointer px-3.5 py-2.5 text-[11px] text-muted">
              events table · {rowsInView.length} {rowsInView.length === 1 ? "event" : "events"} in
              view
              {rowsInView.length > MAX_TABLE_ROWS &&
                ` · the first ${MAX_TABLE_ROWS} shown: zoom in or filter for the rest`}
            </summary>
            <RowsTable
              label="events in view"
              rows={rowsInView.slice(0, MAX_TABLE_ROWS)}
              empty="no events in this stretch with these filters"
            />
          </details>
        </div>
      )}
    </div>
  );
};
