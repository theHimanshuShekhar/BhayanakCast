// Admin dashboard — restricted to admins (ADR 6).
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { BarChart, LineChart } from "~/components/charts";
import { Icon } from "~/components/icons";
import { SectionHead } from "~/components/section-head";
import { Avatar, MonoCaps } from "~/components/ui";
import {
  ALLTIME_ROOMS,
  CURRENT_USER_ADMIN,
  ROOM_ACTIVITY,
  USER_GROWTH,
  USER_PROFILES,
} from "~/lib/mock-data";
import { useLiveRooms } from "~/lib/rooms-store";
import type { AllTimeRoom, LiveRoom, UserStats } from "~/lib/types";

export const Route = createFileRoute("/admin")({
  // TODO(ADR 7): check the Better Auth session role server-side.
  beforeLoad: () => {
    if (!CURRENT_USER_ADMIN) throw redirect({ to: "/" });
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
  delta?: number;
  tone?: "accent" | "live";
}) => {
  const toneCls =
    tone === "accent"
      ? "border-[color-mix(in_oklch,var(--color-primary)_40%,var(--color-border))] bg-[linear-gradient(135deg,var(--color-primary-soft),var(--color-surface)_70%)]"
      : tone === "live"
        ? "border-[color-mix(in_oklch,var(--color-live)_40%,var(--color-border))] bg-surface"
        : "border-border bg-surface";
  return (
    <div
      className={`border rounded-[var(--radius)] px-4 py-3.5 shadow-card flex flex-col gap-1.5 ${toneCls}`}
    >
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">
        {label}
      </div>
      <div className="flex items-baseline gap-[3px] text-[22px] sm:text-[26px] font-extrabold tracking-[-0.02em] text-fg leading-none">
        {value}
        {unit && <span className="text-[13px] font-medium text-muted">{unit}</span>}
      </div>
      {delta !== undefined && (
        <div
          className={`inline-flex items-center gap-[5px] text-[10.5px] tracking-[0.04em] ${delta >= 0 ? "text-success" : "text-live"}`}
        >
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%{" "}
          <span className="text-subtle text-[9.5px]">vs prev 30d</span>
        </div>
      )}
    </div>
  );
};

const RoomCell = ({ live, name }: { live: boolean; name: string }) => (
  <div className="inline-flex items-center gap-2 font-medium text-fg">
    <span
      className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${live ? "bg-live shadow-[0_0_8px_var(--color-live)] animate-bc-pulse" : "bg-subtle"}`}
    />
    <span>{name}</span>
  </div>
);
const UserCell = ({ name }: { name: string }) => (
  <div className="inline-flex items-center gap-2 text-fg-muted">
    <Avatar name={name} size="sm" /> {name}
  </div>
);
const EmptyRow = ({ cols, children }: { cols: number; children: ReactNode }) => (
  <tr>
    <td colSpan={cols} className="text-center p-7 text-subtle text-[11.5px]">
      {children}
    </td>
  </tr>
);

const LiveRoomsTable = ({ rooms }: { rooms: LiveRoom[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[640px] border-collapse text-xs">
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
              <RoomCell live name={r.name} />
            </td>
            <td className={td}>
              <UserCell name={r.streamer} />
            </td>
            <td className={`${td} text-right`}>
              <b>{r.viewers}</b>
              <span className="text-subtle">/{r.capacity}</span>
            </td>
            <td className={`${td} text-right`}>{r.streams.length}</td>
            <td className={`${td} text-right`}>{r.started}</td>
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

type SortKey = keyof Pick<
  AllTimeRoom,
  "name" | "streamer" | "status" | "peak" | "joined" | "duration" | "ended"
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

const AllTimeRoomsTable = ({ rooms }: { rooms: AllTimeRoom[] }) => {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "ended", dir: "desc" });
  const term = q.toLowerCase();
  const sorted = rooms
    .filter((r) => r.name.toLowerCase().includes(term) || r.streamer.toLowerCase().includes(term))
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
        <table className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr>
              <SortHeader label="room" sortKey="name" sort={sort} setSort={setSort} />
              <SortHeader label="host" sortKey="streamer" sort={sort} setSort={setSort} />
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
                sortKey="duration"
                sort={sort}
                setSort={setSort}
                align="right"
              />
              <SortHeader
                label="ended"
                sortKey="ended"
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
                  <RoomCell live={r.status === "live"} name={r.name} />
                </td>
                <td className={td}>
                  <UserCell name={r.streamer} />
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
                <td className={`${td} text-right !text-subtle`}>{r.duration}</td>
                <td className={`${td} text-right !text-subtle`}>{r.ended ?? "—"}</td>
              </tr>
            ))}
            {sorted.length === 0 && <EmptyRow cols={7}>no matches</EmptyRow>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TopUsersTable = ({
  users,
  label,
}: {
  users: { username: string; value: number; pct: number }[];
  label: string;
}) => (
  <div className={`${card} overflow-hidden`}>
    <div className="flex items-baseline justify-between px-4 py-3 border-b border-border-subtle bg-canvas">
      <h3 className="m-0 text-xs font-bold tracking-[-0.005em]">{label}</h3>
      <MonoCaps>top 6</MonoCaps>
    </div>
    <div className="flex flex-col">
      {users.map((u, i) => (
        <Link
          key={u.username}
          to="/profile/$username"
          params={{ username: u.username }}
          className="group grid grid-cols-[28px_28px_1fr_auto] grid-rows-[auto_auto] gap-x-3 items-center px-4 py-2.5 border-b border-border-subtle last:border-b-0 text-left !text-fg transition-colors hover:bg-surface-2 hover:no-underline"
        >
          <span className="row-span-2 text-[10.5px] font-bold text-subtle tracking-[0.05em] group-hover:text-primary">
            #{i + 1}
          </span>
          <Avatar name={u.username} size="sm" ring={i === 0} className="row-span-2" />
          <span className="col-start-3 text-[12.5px] font-semibold text-fg">{u.username}</span>
          <span className="col-start-4 row-start-1 text-[13px] font-bold text-primary tracking-[-0.01em]">
            {u.value.toFixed(1)}
            <span className="text-subtle font-medium text-[11px]">h</span>
          </span>
          <span className="col-start-3 col-span-2 row-start-2 h-[3px] mt-1 rounded-full bg-surface-3 overflow-hidden">
            <span className={barFill} style={{ width: `${u.pct * 100}%` }} />
          </span>
        </Link>
      ))}
    </div>
  </div>
);

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

function AdminPage() {
  const liveRooms = useLiveRooms();
  const P = Object.values(USER_PROFILES);
  const sum = (key: keyof UserStats) => P.reduce((s, p) => s + p.stats[key], 0);
  const top = (key: keyof UserStats) => {
    const list = P.map((p) => ({ username: p.username, value: p.stats[key] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    const max = list[0]?.value || 1;
    return list.map((u) => ({ ...u, pct: u.value / max }));
  };

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
          <StatCard label="total users" value={P.length} delta={12} tone="accent" />
          <StatCard
            label="hours streamed"
            value={sum("hoursStreamed").toFixed(0)}
            unit="h"
            delta={18}
          />
          <StatCard
            label="hours watched"
            value={sum("hoursWatched").toFixed(0)}
            unit="h"
            delta={23}
          />
          <StatCard label="rooms hosted" value={sum("roomsHosted")} delta={9} />
          <StatCard label="live now" value={liveRooms.length} tone="live" />
        </div>

        <SectionHead
          title="last 30 days"
          sub="rolling window"
          dot="success"
          size="sm"
          className="mt-6"
        />
        <div className="grid grid-cols-2 min-[900px]:grid-cols-4 gap-2.5">
          <StatCard
            label="new users (30d)"
            value={USER_GROWTH.reduce((s, d) => s + d.new_users, 0)}
            delta={7}
          />
          <StatCard
            label="rooms created (30d)"
            value={ROOM_ACTIVITY.reduce((s, d) => s + d.created, 0)}
            delta={14}
          />
          <StatCard label="avg peak people" value={6.4} delta={-3} />
          <StatCard label="active streamers" value={9} delta={2} />
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
              data={USER_GROWTH}
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
              data={ROOM_ACTIVITY}
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
          sub={`${liveRooms.length} streaming now`}
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
          <AllTimeRoomsTable rooms={ALLTIME_ROOMS} />
        </div>

        <SectionHead title="top users" sub="leaderboards" size="sm" className="mt-6" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-3.5">
          <TopUsersTable users={top("hoursStreamed")} label="hours streamed" />
          <TopUsersTable users={top("hoursWatched")} label="hours watched" />
        </div>
      </div>
    </div>
  );
}
