// Past stream recap — who joined, for how long, who streamed. No chat history (ADR 4).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Icon, type IconComponent } from "~/components/icons";
import { StreamMosaic } from "~/components/room-cards";
import { DOTS, SectionHead } from "~/components/section-head";
import { Avatar, Chip } from "~/components/ui";
import { fmtMins, parseMins, SCREEN_KINDS } from "~/lib/format";
import { PAST_ROOMS } from "~/lib/mock-data";
import type { PastRoom, ScreenKind } from "~/lib/types";

export const Route = createFileRoute("/past/$roomId")({
  component: PastStreamRoute,
});

const seeded = (str: string) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
};

type RecapPerson = {
  name: string;
  host: boolean;
  start: number;
  end: number;
  mins: number;
  stream: { start: number; end: number; screen: ScreenKind; mins: number } | null;
};

// Deterministic recap from the mock room record; replaced by presence/stream intervals (ADR 12).
const buildRecap = (room: PastRoom) => {
  const total = parseMins(room.started);
  const rnd = seeded(room.id + room.name);
  const names = [...new Set([room.streamer, ...room.members, ...room.streams.map((s) => s.user)])];
  const people: RecapPerson[] = names
    .map((name) => {
      const host = name === room.streamer;
      const start = host ? 0 : rnd() * 0.35;
      const end = host ? 1 : Math.min(1, start + (0.4 + rnd() * 0.6) * (1 - start));
      const st = room.streams.find((s) => s.user === name);
      let stream: RecapPerson["stream"] = null;
      if (st) {
        const len = end - start;
        const s0 = host ? start : start + rnd() * len * 0.3;
        const s1 = host ? end : Math.min(end, s0 + len * (0.4 + rnd() * 0.5));
        stream = { start: s0, end: s1, screen: st.screen, mins: (s1 - s0) * total };
      }
      return { name, host, start, end, mins: (end - start) * total, stream };
    })
    .sort((a, b) => Number(b.host) - Number(a.host) || a.start - b.start);
  const streamers = people
    .filter((p): p is RecapPerson & { stream: NonNullable<RecapPerson["stream"]> } => !!p.stream)
    .sort((a, b) => b.stream.mins - a.stream.mins);
  return { total, people, streamers };
};

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

const NameLink = ({ name, className = "" }: { name: string; className?: string }) => (
  <Link
    to="/profile/$username"
    params={{ username: name }}
    className={`text-left truncate !text-inherit hover:!text-primary-strong hover:underline underline-offset-2 ${className}`}
  >
    {name}
  </Link>
);

function PastStreamRoute() {
  const { roomId } = Route.useParams();
  const room = PAST_ROOMS.find((r) => r.id === roomId);
  if (!room) {
    return (
      <div className="px-10 py-20 text-center">
        <h1 className="m-0 mb-2 text-lg">recap not found</h1>
        <p className="m-0 mb-4 text-muted text-[12.5px]">
          past streams are kept for 30 days, then only stats remain.
        </p>
        <Link to="/" className="text-primary">
          back to rooms
        </Link>
      </div>
    );
  }
  return <PastStreamPage room={room} />;
}

function PastStreamPage({ room }: { room: PastRoom }) {
  const { total, people, streamers } = useMemo(() => buildRecap(room), [room]);
  const watchSum = people.reduce((s, p) => s + p.mins, 0);
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
          <span className="text-fg font-semibold">{room.name}</span>
        </nav>

        <div className="flex flex-wrap items-end justify-between gap-4 pb-5 mb-6 border-b border-border-subtle">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5">
              <h1 className="m-0 text-[20px] sm:text-[26px] font-extrabold tracking-[-0.02em] truncate">
                {room.name}
              </h1>
              <Chip>ended</Chip>
            </div>
            <div className="flex items-center gap-x-2 gap-y-1 text-xs text-muted flex-wrap [&>span]:whitespace-nowrap">
              <span>hosted by</span>
              <Avatar name={room.streamer} size="sm" />
              <NameLink name={room.streamer} className="text-fg-muted font-semibold" />
              <span className="w-[3px] h-[3px] rounded-full bg-subtle" />
              <span>lasted {fmtMins(total)}</span>
              <span className="w-[3px] h-[3px] rounded-full bg-subtle" />
              <span>ended {room.cachedAgo}</span>
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
          <StreamMosaic
            streams={room.streams}
            cached
            freshness={`last cached · ${room.cachedAgo}`}
          />
          <div className="grid grid-cols-2 gap-2.5 content-start">
            <RecapStat icon={Icon.Clock} label="duration" value={fmtMins(total)} accent />
            <RecapStat icon={Icon.Users} label="joined" value={people.length} />
            <RecapStat icon={Icon.Screen} label="streamers" value={streamers.length} />
            <RecapStat icon={Icon.Eye} label="watch time" value={fmtMins(watchSum)} />
          </div>
        </div>

        <section className="mt-8">
          <SectionHead title="who streamed" sub="screen share duration" dot="live" />
          <div className="flex flex-col bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
            {streamers.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-3 sm:gap-3.5 px-3 sm:px-4 py-3 border-b border-border-subtle last:border-b-0"
              >
                <Avatar name={p.name} size="md" ring={p.host} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <NameLink name={p.name} className="text-[13px] font-semibold" />
                    {p.host && (
                      <span className="text-[9.5px] px-[5px] py-px rounded tracking-[0.05em] uppercase bg-primary text-primary-ink">
                        host
                      </span>
                    )}
                  </div>
                  <div className="text-[10.5px] text-subtle tracking-[0.04em] truncate">
                    {SCREEN_KINDS[p.stream.screen].label}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 sm:min-w-[140px]">
                  <div className="text-[13px] font-bold text-primary-strong">
                    {fmtMins(p.stream.mins)}
                  </div>
                  <div className="w-20 sm:w-[120px] h-1 rounded-full bg-surface-3 overflow-hidden">
                    <span
                      className="block h-full rounded-full bg-live"
                      style={{ width: `${(p.stream.mins / total) * 100}%` }}
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
                    {t === 0 ? "0m" : fmtMins(t * total)}
                  </span>
                ))}
              </div>
              <span className="text-right">in room</span>
            </div>
            {people.map((p) => (
              <div
                key={p.name}
                className="grid grid-cols-[100px_minmax(0,1fr)_52px] sm:grid-cols-[180px_minmax(0,1fr)_72px] gap-3 sm:gap-4 items-center px-3 sm:px-4 py-2.5 border-b border-border-subtle last:border-b-0 hover:bg-surface-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar name={p.name} size="sm" />
                  <NameLink name={p.name} className="text-xs font-medium" />
                </div>
                <div className="relative h-2.5 rounded-full bg-surface-3">
                  <span
                    className="absolute inset-y-0 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_55%,transparent)]"
                    style={{ left: `${p.start * 100}%`, width: `${(p.end - p.start) * 100}%` }}
                  />
                  {p.stream && (
                    <span
                      className={`absolute inset-y-0 rounded-full ${DOTS.live}`}
                      title={`streamed ${fmtMins(p.stream.mins)}`}
                      style={{
                        left: `${p.stream.start * 100}%`,
                        width: `${(p.stream.end - p.stream.start) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <span className="text-right text-xs font-semibold tabular-nums">
                  {fmtMins(p.mins)}
                </span>
              </div>
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
