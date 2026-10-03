// Admin dashboard — restricted to admins (ADR 6).
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import {
  BanUserDialog,
  type DialogTarget,
  EndRoomDialog,
  type RoleChangeTarget,
  type RoomDialogTarget,
  SetRoleDialog,
  UnbanUserDialog,
} from "~/components/admin-dialogs";
import { BarChart, LineChart } from "~/components/charts";
import { Icon } from "~/components/icons";
import { SectionHead } from "~/components/section-head";
import { Avatar, Btn, MonoCaps, Seg } from "~/components/ui";
import {
  ADMIN_WINDOW_DAYS,
  type AdminRole,
  type AdminRoomRow,
  type AdminUserRow,
  type BanUserInput,
  LEADERBOARD_SIZE,
  type LeaderboardEntry,
  percentChange,
  type WindowCount,
} from "~/lib/admin";
import { banUserFn, endRoomFn, setUserRoleFn, unbanUserFn } from "~/lib/admin.functions";
import {
  adminDailySeriesQuery,
  adminKeys,
  adminLeaderboardsQuery,
  adminLiveRoomsQuery,
  adminOverviewQuery,
  adminRecentRoomsQuery,
  adminUsersQuery,
  turnUsageQuery,
} from "~/lib/admin.queries";
import { useCurrentSession } from "~/lib/current-user";
import { fmtAgo, fmtMins } from "~/lib/format";
import type { LiveRoomCard, RoomPerson } from "~/lib/rooms";
import { roomKeys } from "~/lib/rooms.queries";
import { TURN_FREE_TIER_GB } from "~/lib/turn-usage";
import { useDebounced } from "~/lib/use-debounced";
import { useMountedNow } from "~/lib/use-now";

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
      queryClient.ensureQueryData(adminRecentRoomsQuery(FIRST_ROOMS_PAGE)),
      queryClient.ensureQueryData(adminLeaderboardsQuery()),
      queryClient.ensureQueryData(adminUsersQuery(FIRST_USERS_PAGE)),
    ]);
  },
  component: AdminPage,
});

/** The users table as the page opens: no search, everyone, page 1. */
const FIRST_USERS_PAGE = { q: "", banned: false, page: 1 };

/** The recent-rooms table as the page opens: no search, page 1. */
const FIRST_ROOMS_PAGE = { q: "", page: 1 };

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
          className={`inline-flex items-center gap-[5px] text-[10.5px] tracking-[0.04em] ${delta >= 0 ? "text-success-ink" : "text-live-ink"}`}
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
const UserCell = ({ person }: { person: RoomPerson | null }) =>
  person ? (
    <div className="inline-flex items-center gap-2 text-fg-muted">
      <Avatar name={person.username} image={person.image} size="sm" /> {person.username}
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

/**
 * Text relative to now for `iso`. A dash until mounted: the server's "now" and the browser's
 * differ, and a text mismatch on hydration makes React render the whole page again, which
 * wipes anything typed into it.
 */
const Since = ({ iso, format }: { iso: string; format: (iso: string, now: number) => string }) => {
  const now = useMountedNow();
  return now === null ? "—" : format(iso, now);
};

const LiveRoomsTable = ({ rooms }: { rooms: LiveRoomCard[] }) => {
  const queryClient = useQueryClient();
  const [endTarget, setEndTarget] = useState<RoomDialogTarget | null>(null);
  const end = async (roomId: string) => {
    await endRoomFn({ data: { roomId } });
    // Live and past lists both change, here and on home.
    await queryClient.invalidateQueries({ queryKey: roomKeys.all });
  };
  return (
    <div className="overflow-x-auto">
      <table aria-label="live rooms" className="w-full min-w-[640px] border-collapse text-xs">
        <thead>
          <tr>
            <th className={th}>room</th>
            <th className={th}>host</th>
            <th className={`${th} !text-right`}>people</th>
            <th className={`${th} !text-right`}>streams</th>
            <th className={`${th} !text-right`}>duration</th>
            <th className={`${th} w-[110px]`}>
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
                <UserCell person={r.host} />
              </td>
              <td className={`${td} text-right`}>
                <b>{r.participantCount}</b>
                <span className="text-subtle">/{r.capacity}</span>
              </td>
              <td className={`${td} text-right`}>{r.streamCount}</td>
              <td className={`${td} text-right`}>
                <Since
                  iso={r.createdAt}
                  format={(iso, now) => fmtMins((now - Date.parse(iso)) / 60_000)}
                />
              </td>
              <td className={td}>
                <div className="flex justify-end gap-1.5">
                  <Link
                    to="/room/$roomId"
                    params={{ roomId: r.id }}
                    className="inline-flex items-center h-7 px-2.5 text-[11.5px] border rounded-[var(--radius-sm)] bg-surface border-border !text-fg shadow-card hover:bg-surface-2 hover:no-underline"
                  >
                    open
                  </Link>
                  <Btn
                    size="sm"
                    variant="danger"
                    aria-label={`End ${r.name}`}
                    onClick={() => setEndTarget(r)}
                  >
                    end
                  </Btn>
                </div>
              </td>
            </tr>
          ))}
          {rooms.length === 0 && <EmptyRow cols={6}>no live rooms</EmptyRow>}
        </tbody>
      </table>
      <EndRoomDialog
        target={endTarget}
        onOpenChange={(open) => !open && setEndTarget(null)}
        onEnd={end}
      />
    </div>
  );
};

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
      className={`${th} ${active ? "!text-primary-strong" : ""}`}
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

/** Previous and next buttons under a table paged server-side. */
const Pager = ({
  label,
  page,
  pages,
  setPage,
}: {
  label: string;
  page: number;
  pages: number;
  setPage: (update: (page: number) => number) => void;
}) => (
  <nav
    aria-label={label}
    className="flex items-center justify-end gap-2 px-3.5 py-2.5 border-t border-border-subtle bg-canvas"
  >
    <MonoCaps>
      page {Math.min(page, pages)} of {pages}
    </MonoCaps>
    <Btn size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
      previous
    </Btn>
    <Btn size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
      next
    </Btn>
  </nav>
);

/** Recent rooms, searched and paged server-side; the sort headers order the page shown. */
const RecentRoomsTable = () => {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>({ key: "endedAt", dir: "desc" });
  const term = useDebounced(q.trim(), 250);
  const { data } = useQuery({
    ...adminRecentRoomsQuery({ q: term, page }),
    placeholderData: keepPreviousData,
  });
  const rooms: RecentRoom[] = (data?.rooms ?? []).map((r) => ({
    ...r,
    hostName: r.host?.username ?? "",
  }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const sorted = [...rooms].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    // Empty values last. Two empty ones tie: answering 1 for both orders (a comparator that
    // contradicts itself) sorts differently in Node and Firefox, so the server and the browser
    // rendered the live rooms in different orders and hydration failed.
    if (av == null && bv == null) return 0;
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
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <MonoCaps>{data?.total ?? 0} rooms</MonoCaps>
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
                  <UserCell person={r.host} />
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
                  {r.endedAt ? <Since iso={r.endedAt} format={fmtAgo} /> : "—"}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && <EmptyRow cols={7}>no matches</EmptyRow>}
          </tbody>
        </table>
      </div>
      <Pager label="recent rooms pages" page={page} pages={pages} setPage={setPage} />
    </div>
  );
};

/** "3 Oct 2026" for an ISO timestamp, in UTC like the rest of the dashboard. */
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const BanStatus = ({ ban }: { ban: AdminUserRow["ban"] }) =>
  ban ? (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex self-start items-center px-2 py-0.5 rounded-full text-[9.5px] tracking-[0.08em] font-semibold uppercase border bg-[color-mix(in_oklch,var(--color-live)_22%,transparent)] text-live-ink border-[color-mix(in_oklch,var(--color-live)_50%,transparent)]">
        banned
      </span>
      <span className="text-[11px] text-muted">
        {ban.reason ?? "no reason"} ·{" "}
        {ban.expiresAt ? `until ${fmtDate(ban.expiresAt)}` : "permanent"}
      </span>
    </div>
  ) : (
    <span className="text-subtle">active</span>
  );

/** Why admin `me` can't demote `u` (the server refuses too), or undefined if they can. */
function whyNoDemote(u: AdminUserRow, me: string | undefined): string | undefined {
  if (u.envAdmin) return "set in ADMIN_DISCORD_IDS: can't be demoted";
  if (u.id === me) return "you can't demote yourself";
  return undefined;
}

/**
 * Every user, searched and paged server-side, with ban, unban, promote and demote behind
 * confirmation dialogs (spec #7). Admins can't be banned (the server refuses too): demote them
 * first. Env admins and the admin themselves can't be demoted, nor banned users promoted.
 */
const UsersTable = () => {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [banned, setBanned] = useState(false);
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim(), 250);
  const { data, isPlaceholderData } = useQuery({
    ...adminUsersQuery({ q: term, banned, page }),
    placeholderData: keepPreviousData,
  });
  // The rows are the previous search's until the new one lands (and are replaced under the
  // pointer when it does), so their actions are off: a click on one could miss or hit the wrong row.
  const stale = isPlaceholderData || q.trim() !== term;
  const [banTarget, setBanTarget] = useState<DialogTarget | null>(null);
  const [unbanTarget, setUnbanTarget] = useState<DialogTarget | null>(null);
  const [roleTarget, setRoleTarget] = useState<RoleChangeTarget | null>(null);
  const me = useCurrentSession().user?.id;
  // A ban also empties the user's room, so refresh every admin read, not just this table.
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.all });
  const setRole = async (userId: string, role: AdminRole) => {
    await setUserRoleFn({ data: { userId, role } });
    await refresh();
  };
  const ban = async (input: BanUserInput) => {
    await banUserFn({ data: input });
    await refresh();
  };
  const unban = async (userId: string) => {
    await unbanUserFn({ data: { userId } });
    await refresh();
  };
  const users = data?.users ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const search = (next: { q?: string; banned?: boolean }) => {
    if (next.q !== undefined) setQ(next.q);
    if (next.banned !== undefined) setBanned(next.banned);
    setPage(1);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 border-b border-border-subtle bg-canvas">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 h-[30px] px-2.5 flex-1 min-w-0 sm:flex-none sm:min-w-[280px] bg-surface border border-border rounded-lg text-muted focus-within:border-primary">
            <Icon.Search size={12} />
            <input
              aria-label="Search users"
              className="flex-1 min-w-0 bg-transparent border-0 outline-0 text-fg text-xs"
              placeholder="search usernames…"
              value={q}
              onChange={(e) => search({ q: e.target.value })}
            />
          </div>
          <div className="w-[180px]">
            <Seg
              value={banned ? "banned" : "everyone"}
              options={["everyone", "banned"]}
              onChange={(v) => search({ banned: v === "banned" })}
            />
          </div>
        </div>
        <MonoCaps>{data?.total ?? 0} users</MonoCaps>
      </div>
      <div className="overflow-x-auto">
        <table
          aria-label="users"
          aria-busy={stale}
          className="w-full min-w-[830px] border-collapse text-xs"
        >
          <thead>
            <tr>
              <th className={th}>user</th>
              <th className={th}>joined</th>
              <th className={th}>role</th>
              <th className={th}>status</th>
              <th className={`${th} !text-right`}>last seen</th>
              <th className={`${th} !text-right`}>hours</th>
              <th className={`${th} w-[150px]`}>
                <span className="sr-only">actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="group">
                <td className={td}>
                  <Link
                    to="/profile/$userId"
                    params={{ userId: u.id }}
                    className="inline-flex items-center gap-2 !text-fg font-medium hover:no-underline"
                  >
                    <Avatar name={u.username} image={u.image} size="sm" /> {u.username}
                  </Link>
                </td>
                <td className={`${td} !text-subtle`}>{fmtDate(u.joinedAt)}</td>
                <td className={td}>
                  {u.role === "admin" ? (
                    <MonoCaps className="!text-primary-strong">
                      {u.envAdmin ? "env admin" : "admin"}
                    </MonoCaps>
                  ) : (
                    "user"
                  )}
                </td>
                <td className={td}>
                  <BanStatus ban={u.ban} />
                </td>
                <td className={`${td} text-right !text-subtle`}>
                  {u.lastSeenAt ? <Since iso={u.lastSeenAt} format={fmtAgo} /> : "—"}
                </td>
                <td className={`${td} text-right`}>
                  {u.hours.toFixed(1)}
                  <span className="text-subtle">h</span>
                </td>
                <td className={td}>
                  <div className="flex justify-end gap-1.5">
                    {u.role === "admin" ? (
                      <Btn
                        size="sm"
                        aria-label={`Demote ${u.username}`}
                        disabled={stale || !!whyNoDemote(u, me)}
                        title={whyNoDemote(u, me)}
                        onClick={() => setRoleTarget({ ...u, role: "user" })}
                      >
                        demote
                      </Btn>
                    ) : u.ban ? null : (
                      <Btn
                        size="sm"
                        aria-label={`Promote ${u.username}`}
                        disabled={stale}
                        onClick={() => setRoleTarget({ ...u, role: "admin" })}
                      >
                        promote
                      </Btn>
                    )}
                    {u.ban ? (
                      <Btn
                        size="sm"
                        aria-label={`Unban ${u.username}`}
                        disabled={stale}
                        onClick={() => setUnbanTarget(u)}
                      >
                        unban
                      </Btn>
                    ) : u.role !== "admin" ? (
                      <Btn
                        size="sm"
                        variant="danger"
                        aria-label={`Ban ${u.username}`}
                        disabled={stale}
                        onClick={() => setBanTarget(u)}
                      >
                        ban
                      </Btn>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && <EmptyRow cols={7}>no users match</EmptyRow>}
          </tbody>
        </table>
      </div>
      <Pager label="users pages" page={page} pages={pages} setPage={setPage} />
      <BanUserDialog
        target={banTarget}
        onOpenChange={(open) => !open && setBanTarget(null)}
        onBan={ban}
      />
      <UnbanUserDialog
        target={unbanTarget}
        onOpenChange={(open) => !open && setUnbanTarget(null)}
        onUnban={unban}
      />
      <SetRoleDialog
        target={roleTarget}
        onOpenChange={(open) => !open && setRoleTarget(null)}
        onSetRole={setRole}
      />
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
            <span className="row-span-2 text-[10.5px] font-bold text-subtle tracking-[0.05em] group-hover:text-primary-strong">
              #{i + 1}
            </span>
            <Avatar
              name={u.username}
              image={u.image}
              size="sm"
              ring={i === 0}
              className="row-span-2"
            />
            <span className="col-start-3 text-[12.5px] font-semibold text-fg">{u.username}</span>
            <span className="col-start-4 row-start-1 text-[13px] font-bold text-primary-strong tracking-[-0.01em]">
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

/**
 * Relayed TURN egress this month against the free tier (ADR 3). Loaded on its own, not by the
 * route loader, so a slow Cloudflare never holds up the rest of the dashboard.
 */
const TurnUsagePanel = () => {
  const { data: usage, isError } = useQuery(turnUsageQuery());
  const note = (text: string) => (
    <div className={`${card} px-[18px] py-4 text-xs text-subtle`}>{text}</div>
  );
  if (isError || usage?.status === "unavailable") return note("usage unavailable");
  if (!usage) return note("loading…");
  if (usage.status === "not-configured") return note("not configured");
  const bar = Math.min(100, usage.percent);
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-3.5">
      <div className="flex flex-col gap-2.5">
        <StatCard
          label="relayed this month"
          value={usage.totalGb.toFixed(1)}
          unit={`GB of ${TURN_FREE_TIER_GB.toLocaleString("en-US")} GB · ${usage.percent.toFixed(1)}%`}
          tone={usage.warning ? "live" : "accent"}
        />
        <div
          role="progressbar"
          aria-label="TURN free tier used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(bar)}
          className="h-2 rounded-full bg-surface-2 border border-border overflow-hidden"
        >
          <span className={barFill} style={{ width: `${bar}%` }} />
        </div>
        {usage.warning && (
          <div role="alert" className="text-xs text-live-ink">
            Relayed bandwidth is at {usage.percent.toFixed(0)}% of the free tier; past{" "}
            {TURN_FREE_TIER_GB.toLocaleString("en-US")} GB Cloudflare charges $0.05/GB.
          </div>
        )}
      </div>
      <ChartCard title="relayed GB per day" legend={[["oklch(0.72 0.18 220)", "relayed GB"]]}>
        <BarChart
          label={`Relayed GB per day, ${usage.month}`}
          data={usage.daily.map((d) => ({ date: d.day.slice(5), gb: d.gb }))}
          xKey="date"
          height={160}
          series={[{ key: "gb", color: "oklch(0.72 0.18 220)" }]}
        />
      </ChartCard>
    </div>
  );
};

const windowStat = (count: WindowCount) => ({
  value: count.current,
  delta: percentChange(count),
});

function AdminPage() {
  const { data: overview } = useSuspenseQuery(adminOverviewQuery());
  const { data: daily } = useSuspenseQuery(adminDailySeriesQuery());
  const { data: liveRooms } = useSuspenseQuery(adminLiveRoomsQuery());
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
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_15%,var(--color-surface))] border border-[color-mix(in_oklch,var(--color-primary)_40%,transparent)] text-[11px] tracking-[0.06em] uppercase font-semibold text-primary-strong shadow-[0_0_16px_var(--color-primary-glow)]">
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
          title="TURN usage"
          sub={`relayed bandwidth · ${TURN_FREE_TIER_GB.toLocaleString("en-US")} GB free per month`}
          size="sm"
          className="mt-6"
        />
        <TurnUsagePanel />

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
          sub="last 30 days · search · sort a page"
          dot="muted"
          size="sm"
          className="mt-6"
        />
        <div className={`${card} overflow-hidden`}>
          <RecentRoomsTable />
        </div>

        <SectionHead title="users" sub="search · ban and unban" size="sm" className="mt-6" />
        <div className={`${card} overflow-hidden`}>
          <UsersTable />
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
