import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Icon, type IconComponent } from "~/components/icons";
import { LiveCard, PastCard, useSnapshots } from "~/components/room-cards";
import { SignInButton } from "~/components/sign-in-button";
import { SignInErrorNotice } from "~/components/sign-in-error-notice";
import { Avatar, Btn, Chip } from "~/components/ui";
import { useAppActions } from "~/lib/app-actions";
import { type SignInErrorSearch, validateSignInErrorSearch } from "~/lib/ban";
import { useCurrentSession } from "~/lib/current-user";
import { homeSummaryQuery } from "~/lib/home.queries";
import { useOnlineUsers } from "~/lib/lobby-live";
import { USER_SEARCH_QUERY_MAX, type UserSearchResult } from "~/lib/profiles";
import { searchUsersQuery } from "~/lib/profiles.queries";
import type { LiveRoomCard, PastRoomCard } from "~/lib/rooms";
import { liveRoomsQuery, pastRoomsQuery, roomQuery } from "~/lib/rooms.queries";

export const Route = createFileRoute("/")({
  // `join` is set when a visitor was sent here from a room URL; the shell then shows the
  // "sign in to join" prompt for that room. A failed Discord sign-in (e.g. a banned
  // user) lands here with `error`/`error_description` to show.
  validateSearch: (search: Record<string, unknown>): { join?: string } & SignInErrorSearch => ({
    ...(typeof search.join === "string" && search.join ? { join: search.join } : {}),
    ...validateSignInErrorSearch(search),
  }),
  loaderDeps: ({ search }) => ({ join: search.join }),
  loader: async ({ context, deps }) => {
    const { queryClient, session } = context;
    await Promise.all([
      queryClient.ensureQueryData(liveRoomsQuery()),
      queryClient.ensureQueryData(pastRoomsQuery()),
      queryClient.ensureQueryData(homeSummaryQuery()),
      // The shell's "sign in to join" prompt names this room.
      !session.user && deps.join ? queryClient.ensureQueryData(roomQuery(deps.join)) : null,
    ]);
  },
  component: HomePage,
});

const panelCls = "bg-canvas border border-border rounded-[var(--radius)] shadow-card p-3.5";
const KIND_LABELS: Record<string, string> = {
  gaming: "gaming",
  code: "coding",
  music: "music",
  art: "art",
  watch: "watch party",
  chat: "just chatting",
};

const SectionBar = ({ title, count, dot }: { title: string; count: number; dot: string }) => (
  <div className="flex items-center gap-2.5 mt-[18px] mb-3">
    <h2 className="m-0 text-[15px] font-bold tracking-[-0.005em] inline-flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {title}
    </h2>
    <span className="text-xs text-subtle">({count})</span>
  </div>
);

const PanelHead = ({ icon: I, children }: { icon: IconComponent; children: ReactNode }) => (
  <div className="flex items-center gap-[7px] mb-2.5 text-[11px] uppercase tracking-[0.1em] text-fg-muted font-semibold">
    <span className="inline-flex text-primary">
      <I size={12} />
    </span>{" "}
    {children}
  </div>
);

const StatMini = ({
  icon: I,
  label,
  value,
  pending,
}: {
  icon: IconComponent;
  label: string;
  value?: number;
  /** Why there's no number yet: shows a muted dash with this as its tooltip. */
  pending?: string;
}) => (
  <div
    className="bg-surface border border-border rounded-[10px] px-3 py-2.5 shadow-card"
    title={pending}
  >
    <div className="inline-flex items-center gap-[5px] text-[10px] tracking-[0.06em] text-muted uppercase">
      <I size={10} /> {label}
    </div>
    {pending ? (
      <div className="mt-1 text-lg font-bold tracking-[-0.01em] text-subtle">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{pending}</span>
      </div>
    ) : (
      <div className="mt-1 text-lg font-bold tracking-[-0.01em] tabular-nums">{value}</div>
    )}
  </div>
);

/** Online users from the lobby socket (ADR 20); reads the count itself, like the rail's. */
const OnlineTile = () => {
  const online = useOnlineUsers();
  return online === null ? (
    <StatMini icon={Icon.Users} label="Online" pending="Connecting to the live count" />
  ) : (
    <StatMini icon={Icon.Users} label="Online" value={online} />
  );
};

const CommunityRow = ({
  icon: I,
  label,
  value,
  accent,
}: {
  icon: IconComponent;
  label: string;
  value: ReactNode;
  accent?: boolean;
}) => (
  <div className="flex items-center justify-between py-2 [&+&]:border-t [&+&]:border-dashed [&+&]:border-border-subtle">
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted">
      <span className="inline-flex text-subtle">
        <I size={11} />
      </span>{" "}
      {label}
    </span>
    <span
      className={`text-[12.5px] font-semibold px-2 py-0.5 rounded-md ${accent ? "bg-primary text-primary-ink" : "bg-surface-2 text-fg"}`}
    >
      {value}
    </span>
  </div>
);

const UserResult = ({
  user,
  liveRoom,
  onOpen,
}: {
  user: UserSearchResult;
  liveRoom: LiveRoomCard | undefined;
  onOpen: (userId: string) => void;
}) => (
  <button
    type="button"
    onClick={() => onOpen(user.id)}
    className="flex items-center gap-3 p-3 text-left bg-surface border border-border rounded-[var(--radius)] shadow-card cursor-pointer transition-[transform,border-color] duration-[120ms] hover:-translate-y-px hover:border-border-strong min-w-0"
  >
    <Avatar name={user.username} size="lg" ring={!!liveRoom} />
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold truncate">{user.username}</span>
        {liveRoom && (
          <Chip kind="live" dot>
            LIVE
          </Chip>
        )}
      </div>
      <div className="text-[10.5px] text-muted truncate">
        {liveRoom ? (
          <>
            in <span className="text-fg-muted font-medium">{liveRoom.name}</span>
          </>
        ) : (
          user.displayName
        )}
      </div>
      <div className="flex gap-3 mt-1 text-[10.5px] text-subtle">
        <span className="inline-flex items-center gap-1">
          <Icon.Broadcast size={10} /> {user.stats.hoursStreamed.toFixed(0)}h
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon.Eye size={10} /> {user.stats.hoursWatched.toFixed(0)}h
        </span>
      </div>
    </div>
  </button>
);

const EmptyBrowse = ({ onCreate }: { onCreate: () => void }) => (
  <div className="grid place-items-center h-full p-10">
    <div className="relative overflow-hidden text-center max-w-[440px] px-7 py-10 bg-canvas border border-border rounded-[var(--radius-lg)] shadow-pop">
      <div className="absolute -inset-px pointer-events-none bg-[radial-gradient(200px_120px_at_50%_0%,var(--color-primary-soft),transparent_60%)]" />
      <div className="relative w-[72px] h-[72px] mx-auto mb-[18px] rounded-[20px] grid place-items-center bg-surface border border-border text-primary shadow-[var(--shadow-card),0_0_32px_var(--color-primary-glow)]">
        <Icon.Broadcast size={32} />
      </div>
      <h2 className="relative m-0 mb-2 text-lg tracking-[-0.01em]">No live rooms right now</h2>
      <p className="relative m-0 mb-[18px] text-muted text-[12.5px]">
        Rooms cap at 10 people so whoever shows up will actually vibe. Start one and invite your
        crew.
      </p>
      <div className="relative flex gap-2 justify-center">
        <Btn variant="primary" onClick={onCreate}>
          <Icon.Plus size={14} /> Start a Room
        </Btn>
      </div>
    </div>
  </div>
);

const SignInPanel = () => (
  <section aria-label="Sign in" className={`${panelCls} relative overflow-hidden`}>
    <div className="absolute -inset-px pointer-events-none bg-[radial-gradient(220px_110px_at_50%_0%,var(--color-primary-soft),transparent_65%)]" />
    <div className="relative">
      <PanelHead icon={Icon.Headset}>Join the Hang</PanelHead>
      <p className="m-0 mb-3 text-[12px] text-muted">
        Sign in with Discord to join rooms, share your screen and start your own.
      </p>
      <SignInButton />
    </div>
  </section>
);

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function HomePage() {
  const navigate = useNavigate();
  const { openCreateRoom, promptSignIn } = useAppActions();
  const { user } = useCurrentSession();
  const search = Route.useSearch();
  const { data: rooms } = useSuspenseQuery(liveRoomsQuery());
  const { data: pastRooms } = useSuspenseQuery(pastRoomsQuery());
  const {
    data: { rightNow, community },
  } = useSuspenseQuery(homeSummaryQuery());
  const [q, setQ] = useState("");
  const snap = useSnapshots();
  const term = q.trim().toLowerCase();

  // Search over rooms: name, host, people in it, #tags and kind.
  const matches = (fields: {
    name: string;
    people: string[];
    tags?: string[];
    kind?: LiveRoomCard["kind"];
  }) => {
    if (!term) return true;
    const tags = (fields.tags ?? []).map((t) => t.toLowerCase());
    if (term.startsWith("#")) return tags.some((t) => t.includes(term.slice(1)));
    const { kind } = fields;
    const hay = [fields.name, ...fields.people, ...tags, kind, kind && KIND_LABELS[kind]]
      .filter((s): s is string => !!s)
      .map((s) => s.toLowerCase());
    return hay.some((s) => s.includes(term));
  };
  const filtered = rooms.filter((r) =>
    matches({
      name: r.name,
      people: [...(r.host ? [r.host.username] : []), ...r.participants.map((p) => p.username)],
      tags: r.tags,
      kind: r.kind,
    }),
  );
  const past = pastRooms.filter((r) =>
    matches({
      name: r.name,
      people: [...(r.host ? [r.host.username] : []), ...r.people.map((p) => p.username)],
      tags: r.tags,
      kind: r.kind,
    }),
  );
  // Users by Discord username, searched server-side once typing pauses. A #tag search is
  // for rooms only.
  const userTerm = useDebounced(
    term.startsWith("#") ? "" : term.slice(0, USER_SEARCH_QUERY_MAX),
    200,
  );
  const { data: foundUsers } = useQuery({
    ...searchUsersQuery(userTerm),
    enabled: userTerm !== "",
    placeholderData: keepPreviousData,
  });
  const users = term && !term.startsWith("#") && userTerm ? (foundUsers ?? []) : [];
  const liveRoomOf = (userId: string) =>
    rooms.find((r) => r.participants.some((p) => p.id === userId));

  // Entering a room needs sign-in: visitors get the prompt and stay on home.
  const openRoom = (r: LiveRoomCard) =>
    user ? navigate({ to: "/room/$roomId", params: { roomId: r.id } }) : promptSignIn(r.name);
  const openPast = (r: PastRoomCard) => navigate({ to: "/past/$roomId", params: { roomId: r.id } });
  const openProfile = (userId: string) => navigate({ to: "/profile/$userId", params: { userId } });

  // "Filling Up": fullest first (a stable sort keeps newest first among ties).
  const trending = useMemo(
    () =>
      [...rooms]
        .sort((a, b) => b.participantCount / b.capacity - a.participantCount / a.capacity)
        .slice(0, 3),
    [rooms],
  );

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] content-start lg:content-stretch gap-6 px-6 py-5 max-sm:px-3.5 max-sm:py-4 h-full overflow-auto lg:overflow-hidden">
      <div className="lg:min-h-0 lg:overflow-auto min-w-0">
        <SignInErrorNotice
          search={search}
          onDismiss={() =>
            navigate({
              to: "/",
              search: (prev) => ({ ...prev, error: undefined, error_description: undefined }),
              replace: true,
            })
          }
        />
        <h1 className="m-0 mb-1 text-xl sm:text-2xl font-extrabold tracking-[-0.01em]">
          Active Rooms
        </h1>
        <div className="mb-4 text-[12.5px] text-muted">
          Join live streams or browse the last 30 days of broadcasts
        </div>

        <div className="flex items-center gap-2.5 h-10 px-3.5 mb-3.5 bg-canvas border border-border rounded-[10px] text-muted focus-within:border-primary">
          <Icon.Search size={14} />
          <input
            aria-label="Search rooms and users"
            className="flex-1 bg-transparent border-0 outline-0 text-fg text-[12.5px]"
            placeholder="Search rooms, users, #tags or categories…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="w-6 h-6 -mr-1.5 inline-flex items-center justify-center rounded-md text-muted cursor-pointer hover:bg-surface-2 hover:text-fg transition-colors"
            >
              <Icon.Close size={12} />
            </button>
          )}
        </div>

        <div className="mb-2.5 text-[11px] text-subtle tracking-[0.04em]">
          Showing {filtered.length + past.length} rooms
          {term && !term.startsWith("#") ? ` · ${users.length} users` : ""}
        </div>

        {users.length > 0 && (
          <>
            <SectionBar
              title="Users"
              count={users.length}
              dot="bg-primary shadow-[0_0_8px_var(--color-primary-glow)]"
            />
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))]">
              {users.map((u) => (
                <UserResult key={u.id} user={u} liveRoom={liveRoomOf(u.id)} onOpen={openProfile} />
              ))}
            </div>
          </>
        )}

        {rooms.length === 0 ? (
          <div className="py-10">
            <EmptyBrowse onCreate={openCreateRoom} />
          </div>
        ) : (
          <>
            {(!term || filtered.length > 0) && (
              <SectionBar
                title="Live Now"
                count={filtered.length}
                dot="bg-live shadow-[0_0_8px_var(--color-live)] animate-bc-pulse"
              />
            )}
            <div className="grid gap-3.5 grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))]">
              {filtered.map((r) => (
                <LiveCard key={r.id} room={r} onOpen={openRoom} snap={snap} />
              ))}
            </div>
          </>
        )}
        {past.length > 0 && (
          <>
            <SectionBar title="Past Streams" count={past.length} dot="bg-subtle" />
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(230px,100%),1fr))]">
              {past.map((r) => (
                <PastCard key={r.id} room={r} onOpen={openPast} />
              ))}
            </div>
          </>
        )}
      </div>

      <aside className="flex flex-col gap-3.5 lg:min-h-0 lg:overflow-auto [&>*]:shrink-0 max-lg:grid max-lg:sm:grid-cols-2 max-lg:items-start">
        {!user && <SignInPanel />}

        <section aria-label="Right Now" className={panelCls}>
          <PanelHead icon={Icon.Sparkle}>Right Now</PanelHead>
          <div className="grid grid-cols-2 gap-2">
            <OnlineTile />
            <StatMini icon={Icon.Broadcast} label="Live Rooms" value={rightNow.liveRooms} />
            <StatMini icon={Icon.Eye} label="Watching" value={rightNow.inRooms} />
            <StatMini icon={Icon.Screen} label="Streaming" value={rightNow.streaming} />
          </div>
        </section>

        <section aria-label="Filling Up" className={panelCls}>
          <PanelHead icon={Icon.Bolt}>Filling Up</PanelHead>
          {trending.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => openRoom(r)}
              className="w-[calc(100%+1rem)] flex items-center gap-2.5 p-2 -mx-2 rounded-lg cursor-pointer text-left hover:bg-surface"
            >
              <Avatar name={r.host?.username ?? r.name} size="md" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{r.name}</div>
                <div className="text-[10.5px] text-muted">{r.host?.username ?? "no host"}</div>
              </div>
              <span className="text-[10.5px] font-semibold text-success-ink px-1.5 py-0.5 rounded-md tabular-nums bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)]">
                {r.participantCount}/{r.capacity}
              </span>
            </button>
          ))}
        </section>

        <section aria-label="Community" className={panelCls}>
          <PanelHead icon={Icon.Users}>Community</PanelHead>
          <CommunityRow icon={Icon.Users} label="Members" value={community.members} />
          <CommunityRow
            icon={Icon.Eye}
            label="Hours Watched"
            value={`${Math.round(community.hoursWatched)}h`}
            accent
          />
          <CommunityRow
            icon={Icon.Broadcast}
            label="Hours Streamed"
            value={`${Math.round(community.hoursStreamed)}h`}
          />
          <CommunityRow icon={Icon.Plus} label="Rooms Hosted" value={community.roomsHosted} />
        </section>
      </aside>
    </div>
  );
}
