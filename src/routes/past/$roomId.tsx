// Past stream recap: who joined, for how long, who streamed. No chat history (ADR 4).
// Built from the room's real presence and stream intervals (src/server/recaps.ts).
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Icon, type IconComponent } from "~/components/icons";
import {
  endedLabel,
  newestThumbnail,
  placeholderStreams,
  StreamMosaic,
} from "~/components/room-cards";
import { DOTS, SectionHead } from "~/components/section-head";
import { Avatar, Chip } from "~/components/ui";
import { fmtAgo, fmtMins } from "~/lib/format";
import type { Recap, RecapPerson, RecapSpan } from "~/lib/recaps";
import { recapQuery } from "~/lib/recaps.queries";
import type { RoomPerson } from "~/lib/rooms";

export const Route = createFileRoute("/past/$roomId")({
  loader: async ({ context, params }) => {
    const recap = await context.queryClient.ensureQueryData(recapQuery(params.roomId));
    if (!recap) throw notFound();
  },
  notFoundComponent: RecapNotFound,
  component: PastStreamRoute,
});

function RecapNotFound() {
  return (
    <div className="px-10 py-20 text-center">
      <h1 className="m-0 mb-2 text-lg">recap not found</h1>
      <p className="m-0 mb-4 text-muted text-[12.5px]">
        past streams are kept for 30 days, then only stats remain.
      </p>
      <Link to="/" className="text-primary-strong">
        back to rooms
      </Link>
    </div>
  );
}

const RecapStat = ({
  icon: I,
  label,
  value,
  accent,
}: {
  icon: IconComponent;
  label: string;
  value: string | number;
  accent?: boolean;
}) => (
  <div
    className={`bg-surface border rounded-[var(--radius)] px-4 py-3.5 shadow-card flex flex-col gap-2 ${accent ? "border-[color-mix(in_oklch,var(--color-primary)_45%,var(--color-border))] bg-[linear-gradient(135deg,var(--color-primary-soft),var(--color-surface)_65%)]" : "border-border"}`}
  >
    <div className="flex items-center gap-2">
      <span
        className={`w-[22px] h-[22px] grid place-items-center rounded-md ${accent ? "bg-primary text-primary-ink" : "bg-surface-2 text-fg-muted"}`}
      >
        <I size={12} />
      </span>
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">
        {label}
      </span>
    </div>
    <div className="text-2xl font-extrabold tracking-[-0.02em] leading-none">{value}</div>
  </div>
);

const NameLink = ({ person, className = "" }: { person: RoomPerson; className?: string }) => (
  <Link
    to="/profile/$userId"
    params={{ userId: person.id }}
    className={`text-left truncate !text-inherit hover:!text-primary-strong hover:underline underline-offset-2 ${className}`}
  >
    {person.username}
  </Link>
);

const HostBadge = () => (
  <span className="text-[9.5px] px-[5px] py-px rounded tracking-[0.05em] uppercase bg-primary text-primary-ink">
    host
  </span>
);

const EmptyRow = ({ children }: { children: string }) => (
  <div className="px-4 py-5 text-center text-subtle text-[11.5px]">{children}</div>
);

type Place = (span: RecapSpan) => { left: string; width: string };

/** Where a span sits on the room's timeline, as percentages of its duration. */
const placeOn = (recap: Recap): Place => {
  const start = Date.parse(recap.createdAt);
  const length = Math.max(1, Date.parse(recap.endedAt) - start);
  const at = (iso: string) => Math.min(1, Math.max(0, (Date.parse(iso) - start) / length));
  return (span) => {
    const left = at(span.start);
    return { left: `${left * 100}%`, width: `${(at(span.end) - left) * 100}%` };
  };
};

function PastStreamRoute() {
  const { roomId } = Route.useParams();
  const { data: recap } = useSuspenseQuery(recapQuery(roomId));
  // It can expire after load (a later refetch).
  if (!recap) return <RecapNotFound />;
  return <PastStreamPage recap={recap} />;
}

function PastStreamPage({ recap }: { recap: Recap }) {
  const total = recap.durationMinutes;
  const joined = recap.people.filter((p) => p.presence.length > 0);
  const streamers = recap.people
    .filter((p) => p.streams.length > 0)
    .sort((a, b) => b.streamMinutes - a.streamMinutes);
  const place = placeOn(recap);
  const endedAgo = fmtAgo(recap.endedAt);
  const newest = newestThumbnail(streamers);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="overflow-auto min-h-0 h-full">
      <div className="px-4 sm:px-8 pt-5 sm:pt-6 pb-12 max-w-[1100px] mx-auto">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 mb-3 text-[11.5px] text-muted whitespace-nowrap min-w-0 [&>span:last-child]:truncate"
        >
          <Link to="/" className="!text-muted hover:!text-fg hover:no-underline">
            home
          </Link>
          <span className="text-subtle">/</span>
          <span>past streams</span>
          <span className="text-subtle">/</span>
          <span className="text-fg font-semibold">{recap.name}</span>
        </nav>

        <div className="flex flex-wrap items-end justify-between gap-4 pb-5 mb-6 border-b border-border-subtle">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5">
              <h1 className="m-0 text-[20px] sm:text-[26px] font-extrabold tracking-[-0.02em] truncate">
                {recap.name}
              </h1>
              <Chip>ended</Chip>
            </div>
            <div className="flex items-center gap-x-2 gap-y-1 text-xs text-muted flex-wrap [&>span]:whitespace-nowrap">
              <span>hosted by</span>
              {recap.host ? (
                <>
                  <Avatar name={recap.host.username} image={recap.host.image} size="sm" />
                  <NameLink person={recap.host} className="text-fg-muted font-semibold" />
                </>
              ) : (
                <span>nobody</span>
              )}
              <span className="w-[3px] h-[3px] rounded-full bg-subtle" />
              <span>lasted {fmtMins(total)}</span>
              <span className="w-[3px] h-[3px] rounded-full bg-subtle" />
              {/* Relative times can tick between the server render and hydration. */}
              <span suppressHydrationWarning>ended {endedAgo}</span>
            </div>
          </div>
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 h-[34px] px-3.5 text-[12px] border rounded-[var(--radius-sm)] font-medium bg-surface border-border !text-fg shadow-card hover:bg-surface-2 hover:border-border-strong hover:no-underline"
          >
            back to rooms
          </Link>
        </div>

        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 max-[820px]:grid-cols-1">
          {/* The streamers' last thumbnails, or placeholders for those who have none. */}
          <StreamMosaic
            streams={placeholderStreams(streamers, recap.id, recap.kind)}
            cached
            freshness={endedLabel(newest, recap.endedAt)}
          />
          <div className="grid grid-cols-2 gap-2.5 content-start">
            <RecapStat icon={Icon.Clock} label="duration" value={fmtMins(total)} accent />
            <RecapStat icon={Icon.Users} label="joined" value={joined.length} />
            <RecapStat icon={Icon.Screen} label="streamers" value={streamers.length} />
            <RecapStat
              icon={Icon.Eye}
              label="watch time"
              value={fmtMins(recap.totalWatchMinutes)}
            />
          </div>
        </div>

        <section className="mt-8">
          <SectionHead title="who streamed" sub="screen share duration" dot="live" />
          <div className="flex flex-col bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
            {streamers.length === 0 && <EmptyRow>nobody shared their screen</EmptyRow>}
            {streamers.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 sm:gap-3.5 px-3 sm:px-4 py-3 border-b border-border-subtle last:border-b-0"
              >
                <Avatar name={p.username} image={p.image} size="md" ring={p.isHost} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <NameLink person={p} className="text-[13px] font-semibold" />
                    {p.isHost && <HostBadge />}
                  </div>
                  <div className="text-[10.5px] text-subtle tracking-[0.04em] truncate">
                    {p.streams.length} {p.streams.length === 1 ? "share" : "shares"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 sm:min-w-[140px]">
                  <div className="text-[13px] font-bold text-primary-strong">
                    {fmtMins(p.streamMinutes)}
                  </div>
                  <div className="w-20 sm:w-[120px] h-1 rounded-full bg-surface-3 overflow-hidden">
                    <span
                      className="block h-full rounded-full bg-live"
                      style={{ width: `${Math.min(1, p.streamMinutes / (total || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <SectionHead title="who joined" sub="time in room" dot="success" />
          <div className="bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
            <div className="grid grid-cols-[100px_minmax(0,1fr)_52px] sm:grid-cols-[180px_minmax(0,1fr)_72px] gap-3 sm:gap-4 items-center px-3 sm:px-4 py-2 bg-canvas border-b border-border-subtle text-[10px] uppercase tracking-[0.1em] text-subtle font-semibold">
              <span>user</span>
              <div className="relative h-3">
                {ticks.map((t) => (
                  <span
                    key={t}
                    className={`${t === 0.25 || t === 0.75 ? "max-sm:hidden " : ""}absolute top-0 -translate-x-1/2 normal-case tracking-normal first:translate-x-0 last:-translate-x-full`}
                    style={{ left: `${t * 100}%` }}
                  >
                    {fmtMins(t * total)}
                  </span>
                ))}
              </div>
              <span className="text-right">in room</span>
            </div>
            {joined.length === 0 && <EmptyRow>nobody joined</EmptyRow>}
            {joined.map((p) => (
              <PersonTimeline key={p.id} person={p} place={place} />
            ))}
            <div className="flex items-center gap-4 px-4 py-2 bg-canvas border-t border-border-subtle text-[10.5px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <i className="w-2.5 h-2.5 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_55%,transparent)]" />{" "}
                in room
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="w-2.5 h-2.5 rounded-full bg-live" /> streaming
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PersonTimeline({ person: p, place }: { person: RecapPerson; place: Place }) {
  return (
    <div
      data-testid="recap-person"
      className="grid grid-cols-[100px_minmax(0,1fr)_52px] sm:grid-cols-[180px_minmax(0,1fr)_72px] gap-3 sm:gap-4 items-center px-3 sm:px-4 py-2.5 border-b border-border-subtle last:border-b-0 hover:bg-surface-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Avatar name={p.username} image={p.image} size="sm" />
        <NameLink person={p} className="text-xs font-medium" />
      </div>
      <div className="relative h-2.5 rounded-full bg-surface-3">
        {p.presence.map((span) => (
          <span
            key={span.start}
            className="absolute inset-y-0 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_55%,transparent)]"
            style={place(span)}
          />
        ))}
        {p.streams.map((span) => (
          <span
            key={span.start}
            className={`absolute inset-y-0 rounded-full ${DOTS.live}`}
            title={`streamed ${fmtMins(p.streamMinutes)}`}
            style={place(span)}
          />
        ))}
      </div>
      <span className="text-right text-xs font-semibold tabular-nums">
        {fmtMins(p.presenceMinutes)}
      </span>
    </div>
  );
}
