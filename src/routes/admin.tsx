// Admin dashboard — restricted to admins (ADR 6).
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { BarChart, LineChart } from "~/components/charts";
import { Icon } from "~/components/icons";
import { SectionHead } from "~/components/section-head";
import { Avatar, MonoCaps } from "~/components/ui";
import {
  ADMIN_WINDOW_DAYS,
  type AdminRoomRow,
  LEADERBOARD_SIZE,
  type LeaderboardEntry,
  percentChange,
  type WindowCount,
} from "~/lib/admin";
import {
  adminDailySeriesQuery,
  adminLeaderboardsQuery,
  adminLiveRoomsQuery,
  adminOverviewQuery,
  adminRecentRoomsQuery,
} from "~/lib/admin.queries";
import { fmtAgo, fmtMins } from "~/lib/format";
import type { LiveRoomCard } from "~/lib/rooms";

export const Route = createFileRoute("/admin")({
  // Visitors and non-admins go home. A UX guard only: admin server functions check the role themselves.
  beforeLoad: ({ context }) => {
    if (context.session.role !== "admin") throw redirect({ to: "/" });
  },
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.ensureQueryData(adminOverviewQuery()),
      queryClient.ensureQueryData(adminDailySeriesQuery()),
      queryClient.ensureQueryData(adminLiveRoomsQuery()),
      queryClient.ensureQueryData(adminRecentRoomsQuery()),
      queryClient.ensureQueryData(adminLeaderboardsQuery()),
    ]);
  },
  component: AdminPage,
});

const card = "bg-surface border border-border rounded-[var(--radius)] shadow-card";
const th =
  "px-3.5 py-2.5 text-left text-[10px] tracking-[0.1em] uppercase text-subtle font-semibold bg-canvas border-b border-border-subtle sticky top-0";
const td =
  "px-3.5 py-2.5 border-b border-border-subtle text-fg-muted group-last:border-b-0 group-hover:bg-surface-2";
const barFill =
  "block h-full rounded-full bg-[linear-gradient(90deg,var(--color-primary),color-mix(in_oklch,var(--color-primary)_40%,var(--color-success)))] shadow-[0_0_6px_var(--color-primary-glow)]";

const StatCard = ({
  label,
  value,
  unit,
  delta,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Percent change vs the previous 30 days; null when there's nothing to compare with. */
  delta?: number | null;
  tone?: "accent" | "live";
}) => {
  const toneCls =
    tone === "accent"
      ? "border-[color-mix(in_oklch,var(--color-primary)_40%,var(--color-border))] bg-[linear-gradient(135deg,var(--color-primary-soft),var(--color-surface)_70%)]"
      : tone === "live"
        ? "border-[color-mix(in_oklch,var(--color-live)_40%,var(--color-border))] bg-surface"
        : "border-border bg-surface";
  return (
    <section
      aria-label={label}
      className={`border rounded-[var(--radius)] px-4 py-3.5 shadow-card flex flex-col gap-1.5 ${toneCls}`}
    >
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">
        {label}
      </div>
      <div className="flex items-baseline gap-[3px] text-[22px] sm:text-[26px] font-extrabold tracking-[-0.02em] text-fg leading-none">
        {value}
        {unit && <span className="text-[13px] font-medium text-muted">{unit}</span>}
      </div>
      {delta === null && (
        <div className="text-[10.5px] tracking-[0.04em] text-subtle">no data for prev 30d</div>
      )}
      {delta !== undefined && delta !== null && (
        <div
          className={`inline-flex items-center gap-[5px] text-[10.5px] tracking-[0.04em] ${delta >= 0 ? "text-success" : "text-live"}`}
        >
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%{" "}
          <span className="text-subtle text-[9.5px]">vs prev 30d</span>
        </div>
      )}
    </section>
  );
};

const RoomCell = ({
  live,
  name,
  isPrivate,
}: {
  live: boolean;
  name: string;
  isPrivate: boolean;
}) => (
  <div className="inline-flex items-center gap-2 font-medium text-fg">
    <span
      className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${live ? "bg-live shadow-[0_0_8px_var(--color-live)] animate-bc-pulse" : "bg-subtle"}`}
    />
    <span>{name}</span>
    {isPrivate && <MonoCaps>private</MonoCaps>}
  </div>
);
/** A room's host; null once their account is gone. */
const UserCell = ({ name }: { name: string | null }) =>
  name ? (
    <div className="inline-flex items-center gap-2 text-fg-muted">
      <Avatar name={name} size="sm" /> {name}
    </div>
  ) : (
    <span className="text-subtle">—</span>
  );
const EmptyRow = ({ cols, children }: { cols: number; children: ReactNode }) => (
  <tr>
    <td colSpan={cols} className="text-center p-7 text-subtle text-[11.5px]">
      {children}
    </td>
  </tr>
);

const LiveRoomsTable = ({ rooms }: { rooms: LiveRoomCard[] }) => (
  <div className="overflow-x-auto">
    <table aria-label="live rooms" className="w-full min-w-[640px] border-collapse text-xs">
      <thead>
        <tr>
          <th className={th}>room</th>
          <th className={th}>host</th>
          <th className={`${th} !text-right`}>people</th>
          <th className={`${th} !text-right`}>streams</th>
          <th className={`${th} !text-right`}>duration</th>
          <th className={`${th} w-[60px]`}>
            <span className="sr-only">actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rooms.map((r) => (
          <tr key={r.id} className="group">
            <td className={td}>
              <RoomCell live name={r.name} isPrivate={r.isPrivate} />
            </td>
            <td className={td}>
              <UserCell name={r.host?.username ?? null} />
            </td>
            <td className={`${td} text-right`}>
              <b>{r.participantCount}</b>
              <span className="text-subtle">/{r.capacity}</span>
            </td>
            <td className={`${td} text-right`}>{r.streamCount}</td>
            <td className={`${td} text-right`}>
              {fmtMins((Date.now() - Date.parse(r.createdAt)) / 60_000)}
            </td>
            <td className={td}>
              <Link
                to="/room/$roomId"
                params={{ roomId: r.id }}
                className="inline-flex items-center h-7 px-2.5 text-[11.5px] border rounded-[var(--radius-sm)] bg-surface border-border !text-fg shadow-card hover:bg-surface-2 hover:no-underline"
              >
                open
              </Link>
            </td>
          </tr>
        ))}
        {rooms.length === 0 && <EmptyRow cols={6}>no live rooms</EmptyRow>}
      </tbody>
    </table>
  </div>
);

type RecentRoom = AdminRoomRow & { hostName: string };
type SortKey = keyof Pick<
  RecentRoom,
  "name" | "hostName" | "status" | "peak" | "joined" | "durationMinutes" | "endedAt"
>;
type Sort = { key: SortKey; dir: "asc" | "desc" };

const SortHeader = ({
  label,
  sortKey,
  sort,
  setSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  setSort: (s: Sort) => void;
  align?: "left" | "right";
}) => {
  const active = sort.key === sortKey;
  return (
    <th
      className={`${th} ${active ? "!text-primary" : ""}`}
      style={{ textAlign: align }}
      aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        className="uppercase tracking-[inherit] cursor-pointer hover:text-fg-muted"
        onClick={() =>
          setSort({ key: sortKey, dir: active && sort.dir === "desc" ? "asc" : "desc" })
        }
      >
        {label}
        <span className="ml-1 text-[9px] opacity-70">
          {active ? (sort.dir === "desc" ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
};

const RecentRoomsTable = ({ rooms: rows }: { rooms: AdminRoomRow[] }) => {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "endedAt", dir: "desc" });
  const rooms: RecentRoom[] = rows.map((r) => ({ ...r, hostName: r.host?.username ?? "" }));
  const term = q.trim().toLowerCase();
  const sorted = rooms
    .filter((r) => r.name.toLowerCase().includes(term) || r.hostName.toLowerCase().includes(term))
    .sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number")
        return sort.dir === "desc" ? bv - av : av - bv;
      return sort.dir === "desc"
        ? String(bv).localeCompare(String(av))
        : String(av).localeCompare(String(bv));
    });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 border-b border-border-subtle bg-canvas">
        <div className="flex items-center gap-2 h-[30px] px-2.5 flex-1 min-w-0 sm:flex-none sm:min-w-[280px] bg-surface border border-border rounded-lg text-muted focus-within:border-primary">
          <Icon.Search size={12} />
          <input
            aria-label="Search rooms or hosts"
            className="flex-1 min-w-0 bg-transparent border-0 outline-0 text-fg text-xs"
            placeholder="search rooms or hosts…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <MonoCaps>
          {sorted.length} of {rooms.length} rooms
        </MonoCaps>
      </div>
      <div className="overflow-x-auto">
        <table aria-label="recent rooms" className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr>
              <SortHeader label="room" sortKey="name" sort={sort} setSort={setSort} />
              <SortHeader label="host" sortKey="hostName" sort={sort} setSort={setSort} />
              <SortHeader label="status" sortKey="status" sort={sort} setSort={setSort} />
              <SortHeader label="peak" sortKey="peak" sort={sort} setSort={setSort} align="right" />
              <SortHeader
                label="joined"
                sortKey="joined"
                sort={sort}
                setSort={setSort}
                align="right"
              />
              <SortHeader
                label="duration"
                sortKey="durationMinutes"
                sort={sort}
                setSort={setSort}
                align="right"
              />
              <SortHeader
                label="ended"
                sortKey="endedAt"
                sort={sort}
                setSort={setSort}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="group">
                <td className={td}>
                  <RoomCell live={r.status === "live"} name={r.name} isPrivate={r.isPrivate} />
                </td>
                <td className={td}>
                  <UserCell name={r.host?.username ?? null} />
                </td>
                <td className={td}>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] tracking-[0.08em] font-semibold uppercase border ${r.status === "live" ? "bg-[color-mix(in_oklch,var(--color-live)_22%,transparent)] text-live-ink border-[color-mix(in_oklch,var(--color-live)_50%,transparent)]" : "bg-surface-2 text-muted border-border"}`}
                  >
                    {r.status === "live" ? "LIVE" : "ended"}
                  </span>
                </td>
                <td className={`${td} text-right`}>
                  <b>{r.peak}</b>
                </td>
                <td className={`${td} text-right`}>{r.joined}</td>
                <td className={`${td} text-right !text-subtle`}>{fmtMins(r.durationMinutes)}</td>
                <td className={`${td} text-right !text-subtle`}>
                  {r.endedAt ? fmtAgo(r.endedAt) : "—"}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && <EmptyRow cols={7}>no matches</EmptyRow>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TopUsersTable = ({ users, label }: { users: LeaderboardEntry[]; label: string }) => {
  const max = users[0]?.hours || 1;
  return (
    <section aria-label={`top users by ${label}`} className={`${card} overflow-hidden`}>
      <div className="flex items-baseline justify-between px-4 py-3 border-b border-border-subtle bg-canvas">
        <h3 className="m-0 text-xs font-bold tracking-[-0.005em]">{label}</h3>
        <MonoCaps>top {LEADERBOARD_SIZE}</MonoCaps>
      </div>
      <div className="flex flex-col">
        {users.map((u, i) => (
          <Link
            key={u.id}
            to="/profile/$userId"
            params={{ userId: u.id }}
            className="group grid grid-cols-[28px_28px_1fr_auto] grid-rows-[auto_auto] gap-x-3 items-center px-4 py-2.5 border-b border-border-subtle last:border-b-0 text-left !text-fg transition-colors hover:bg-surface-2 hover:no-underline"
          >
            <span className="row-span-2 text-[10.5px] font-bold text-subtle tracking-[0.05em] group-hover:text-primary">
              #{i + 1}
            </span>
            <Avatar name={u.username} size="sm" ring={i === 0} className="row-span-2" />
            <span className="col-start-3 text-[12.5px] font-semibold text-fg">{u.username}</span>
            <span className="col-start-4 row-start-1 text-[13px] font-bold text-primary tracking-[-0.01em]">
              {u.hours.toFixed(1)}
              <span className="text-subtle font-medium text-[11px]">h</span>
            </span>
            <span className="col-start-3 col-span-2 row-start-2 h-[3px] mt-1 rounded-full bg-surface-3 overflow-hidden">
              <span className={barFill} style={{ width: `${(u.hours / max) * 100}%` }} />
            </span>
          </Link>
        ))}
        {users.length === 0 && (
          <div className="text-center p-7 text-subtle text-[11.5px]">no hours yet</div>
        )}
      </div>
    </section>
  );
};

const ChartCard = ({
  title,
  legend,
  children,
}: {
  title: string;
  legend: [string, string][];
  children: ReactNode;
}) => (
  <div className={`${card} px-[18px] py-4`}>
    <div className="flex items-center justify-between mb-2">
      <h3 className="m-0 text-[13px] font-bold">{title}</h3>
      <div className="flex gap-3 text-[10.5px] text-muted">
        {legend.map(([c, l]) => (
          <span key={l} className="inline-flex items-center gap-[5px]">
            <i className="inline-block w-2 h-2 rounded-[2px]" style={{ background: c }} /> {l}
          </span>
        ))}
      </div>
    </div>
    {children}
  </div>
);

const windowStat = (count: WindowCount) => ({
  value: count.current,
  delta: percentChange(count),
});

function AdminPage() {
  const { data: overview } = useSuspenseQuery(adminOverviewQuery());
  const { data: daily } = useSuspenseQuery(adminDailySeriesQuery());
  const { data: liveRooms } = useSuspenseQuery(adminLiveRoomsQuery());
  const { data: recentRooms } = useSuspenseQuery(adminRecentRoomsQuery());
  const { data: leaderboards } = useSuspenseQuery(adminLeaderboardsQuery());
  const { totals, window: last30 } = overview;
  const chartDays = daily.map((d) => ({
    date: d.day.slice(5),
    new_users: d.newUsers,
    cumulative: d.cumulativeUsers,
    created: d.roomsCreated,
    ended: d.roomsEnded,
  }));

  return (
    <div className="overflow-auto min-h-0 h-full">
      <div className="px-4 sm:px-8 pt-5 sm:pt-6 pb-[60px] max-w-[1400px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5 mb-6 border-b border-border-subtle">
          <div>
            <div className="mb-1">
              <MonoCaps>/admin</MonoCaps>
            </div>
            <h1 className="m-0 mb-1 text-[22px] sm:text-[26px] font-extrabold tracking-[-0.02em]">
              Dashboard
            </h1>
            <p className="m-0 text-xs text-muted">full platform overview · restricted to admins</p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_15%,var(--color-surface))] border border-[color-mix(in_oklch,var(--color-primary)_40%,transparent)] text-[11px] tracking-[0.06em] uppercase font-semibold text-primary shadow-[0_0_16px_var(--color-primary-glow)]">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary-glow)] animate-bc-pulse" />
            <span>admin access</span>
          </div>
        </div>

        <SectionHead title="platform stats" sub="all-time" size="sm" />
        <div className="grid grid-cols-2 min-[720px]:grid-cols-3 min-[1100px]:grid-cols-5 gap-2.5">
          <StatCard label="total users" value={totals.users} tone="accent" />
          <StatCard label="hours streamed" value={totals.hoursStreamed.toFixed(0)} unit="h" />
          <StatCard label="hours watched" value={totals.hoursWatched.toFixed(0)} unit="h" />
          <StatCard label="rooms hosted" value={totals.roomsHosted} />
          <StatCard label="live now" value={totals.liveRooms} tone="live" />
        </div>

        <SectionHead
          title="last 30 days"
          sub={`rolling ${ADMIN_WINDOW_DAYS} UTC days · vs the ${ADMIN_WINDOW_DAYS} before`}
          dot="success"
          size="sm"
          className="mt-6"
        />
        <div className="grid grid-cols-2 min-[900px]:grid-cols-3 gap-2.5">
          <StatCard label="new users (30d)" {...windowStat(last30.newUsers)} />
          <StatCard label="rooms created (30d)" {...windowStat(last30.roomsCreated)} />
          <StatCard label="rooms ended (30d)" {...windowStat(last30.roomsEnded)} />
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-3.5 mt-3.5">
          <ChartCard
            title="user growth"
            legend={[
              ["oklch(0.78 0.19 265)", "new users"],
              ["oklch(0.78 0.18 150)", "cumulative"],
            ]}
          >
            <LineChart
              label="New and cumulative users per day, last 30 days"
              data={chartDays}
              xKey="date"
              height={200}
              series={[
                { key: "new_users", color: "oklch(0.78 0.19 265)" },
                { key: "cumulative", color: "oklch(0.78 0.18 150)" },
              ]}
            />
          </ChartCard>
          <ChartCard
            title="room activity"
            legend={[
              ["oklch(0.72 0.18 220)", "created"],
              ["oklch(0.72 0.22 25)", "ended"],
            ]}
          >
            <BarChart
              label="Rooms created and ended per day, last 30 days"
              data={chartDays}
              xKey="date"
              height={200}
              series={[
                { key: "created", color: "oklch(0.72 0.18 220)" },
                { key: "ended", color: "oklch(0.72 0.22 25)" },
              ]}
            />
          </ChartCard>
        </div>

        <SectionHead
          title="live rooms"
          sub={`${liveRooms.length} live now`}
          dot="livePulse"
          size="sm"
          className="mt-6"
        />
        <div className={`${card} overflow-hidden`}>
          <LiveRoomsTable rooms={liveRooms} />
        </div>

        <SectionHead
          title="recent rooms"
          sub="last 30 days · sortable"
          dot="muted"
          size="sm"
          className="mt-6"
        />
        <div className={`${card} overflow-hidden`}>
          <RecentRoomsTable rooms={recentRooms} />
        </div>

        <SectionHead title="top users" sub="leaderboards" size="sm" className="mt-6" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-3.5">
          <TopUsersTable users={leaderboards.streamed} label="hours streamed" />
          <TopUsersTable users={leaderboards.watched} label="hours watched" />
        </div>
      </div>
    </div>
  );
}
