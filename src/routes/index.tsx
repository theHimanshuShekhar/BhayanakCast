import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { HomeNotice } from "~/components/home-notice";
import { Icon, type IconComponent } from "~/components/icons";
import { isFull, LiveCard, PastCard, useNow } from "~/components/room-cards";
import { SectionHead } from "~/components/section-head";
import { SignInButton } from "~/components/sign-in-button";
import { SignInErrorNotice } from "~/components/sign-in-error-notice";
import { Avatar, Btn, Chip } from "~/components/ui";
import { useAppActions } from "~/lib/app-actions";
import { type SignInErrorSearch, validateSignInErrorSearch } from "~/lib/ban";
import { useCurrentSession } from "~/lib/current-user";
import { homeSummaryQuery } from "~/lib/home.queries";
import { useOnlineCount } from "~/lib/lobby-live";
import {
  READ_RATE_LIMITED_MESSAGE,
  USER_SEARCH_QUERY_MAX,
  type UserSearchResult,
} from "~/lib/profiles";
import { searchUsersQuery } from "~/lib/profiles.queries";
import { type LiveRoomCard, type PastRoomCard, ROOM_KIND_LABELS } from "~/lib/rooms";
import { liveRoomsQuery, pastRoomsQuery, roomQuery } from "~/lib/rooms.queries";
import { useDebounced } from "~/lib/use-debounced";

export const Route = createFileRoute("/")({
  // `join` is set when a visitor was sent here from a room URL; the shell then shows the
  // "sign in to join" prompt for that room. A failed Discord sign-in (e.g. a banned
  // user) lands here with `error`/`error_description` to show. Someone whose room an admin
  // ended lands here with `ended=admin`.
  validateSearch: (
    search: Record<string, unknown>,
  ): { join?: string; ended?: "admin" } & SignInErrorSearch => ({
    ...(typeof search.join === "string" && search.join ? { join: search.join } : {}),
    ...(search.ended === "admin" ? { ended: "admin" as const } : {}),
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

/** Filling Up shows once there are more live rooms than this. */
const FILLING_UP_AFTER = 4;

const panelCls = "bg-canvas border border-border rounded-[var(--radius)] shadow-card p-3.5";

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
  <div className="min-w-0 bg-surface rounded-[var(--radius-sm)] px-2.5 py-2.5" title={pending}>
    <div className="flex items-center gap-[5px] text-[10px] tracking-[0.04em] text-muted uppercase truncate">
      <span className="inline-flex shrink-0">
        <I size={10} />
      </span>
      <span className="truncate">{label}</span>
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

/** The online count from the lobby socket (ADR 20); reads the count itself, like the rail's. */
const OnlineTile = () => {
  const online = useOnlineCount();
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
}: {
  icon: IconComponent;
  label: string;
  value: ReactNode;
}) => (
  <div className="flex items-center justify-between py-2 [&+&]:border-t [&+&]:border-dashed [&+&]:border-border-subtle">
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted">
      <span className="inline-flex text-subtle">
        <I size={11} />
      </span>{" "}
      {label}
    </span>
    <span className="text-[12.5px] font-semibold px-2 py-0.5 rounded-md bg-surface-2 text-fg tabular-nums">
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
    className="flex items-center gap-3 p-3 text-left bg-surface border border-border rounded-[var(--radius)] shadow-card cursor-pointer transition-[transform,border-color] duration-[120ms] motion-safe:hover:-translate-y-px hover:border-border-strong min-w-0"
  >
    <Avatar name={user.username} image={user.image} size="lg" ring={!!liveRoom} />
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
      <div className="flex gap-3 mt-1 text-[10.5px] text-muted tabular-nums">
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

// The header's "start a room" is the action here, so the empty state only explains.
const EmptyBrowse = () => (
  <div className="flex items-start gap-3 px-4 py-5 bg-canvas border border-dashed border-border rounded-[var(--radius)]">
    <span className="inline-flex mt-0.5 text-muted">
      <Icon.Broadcast size={16} />
    </span>
    <div>
      <h2 className="m-0 mb-1 text-[15px] font-bold tracking-[-0.005em]">
        No live rooms right now
      </h2>
      <p className="m-0 text-muted text-[12.5px] max-w-[56ch]">
        Rooms cap at 10 people so whoever shows up will actually vibe. Start one and invite your
        crew.
      </p>
    </div>
  </div>
);

// A visitor's first look at home: what this is and the way in, above the rooms at every width
// (below lg the sidebar comes after the whole feed, so it can't hold the sign-in).
const VisitorIntro = () => (
  <section
    aria-label="Sign in"
    className="flex items-center gap-4 mb-4 px-4 py-3.5 bg-canvas border border-border rounded-[var(--radius)] shadow-card max-sm:flex-col max-sm:items-stretch max-sm:gap-3"
  >
    <div className="flex-1 min-w-0">
      <p className="m-0 text-[13px] font-bold text-fg">Your crew. Your screens. One room.</p>
      <p className="m-0 mt-1 text-[12px] text-muted">
        Up to 3 people share their screens at once, 10 to a room, right in the browser. Your mic and
        camera stay off until you turn them on.
      </p>
    </div>
    <div className="shrink-0 sm:w-[210px]">
      <SignInButton />
    </div>
  </section>
);

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
  // The rooms on the first render (server and hydration agree on them). Any other room went
  // live while the page was open, and its card switches on.
  const [firstRoomIds] = useState(() => new Set(rooms.map((r) => r.id)));
  const now = useNow();
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
    const hay = [fields.name, ...fields.people, ...tags, kind, kind && ROOM_KIND_LABELS[kind]]
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
  const { data: foundUsers, error: searchError } = useQuery({
    ...searchUsersQuery(userTerm),
    enabled: userTerm !== "",
    placeholderData: keepPreviousData,
    // A refusal for too many searches lasts a minute, so retrying only adds to it.
    retry: (failures, error) => error.message !== READ_RATE_LIMITED_MESSAGE && failures < 3,
  });
  const searching = term && !term.startsWith("#") && userTerm;
  const users = searching ? (foundUsers ?? []) : [];
  const searchRefused = searching && searchError?.message === READ_RATE_LIMITED_MESSAGE;
  // Only once the user search has caught up with the typing, so it never flashes mid-debounce,
  // and never while it was refused (that notice says why there are no people).
  const noMatches =
    term !== "" &&
    !searchRefused &&
    filtered.length + past.length + users.length === 0 &&
    (term.startsWith("#") || userTerm === term.slice(0, USER_SEARCH_QUERY_MAX));
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
    // One minmax(0, 1fr) column below lg: an implicit auto column grows to the widest unbreakable
    // line, so one long room name in Filling Up made the whole phone page wider than the screen.
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_300px] content-start lg:content-stretch gap-6 px-6 py-5 max-sm:px-3.5 max-sm:py-4 h-full overflow-auto lg:overflow-hidden">
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
        {search.ended === "admin" && (
          <HomeNotice
            icon={Icon.Broadcast}
            title="This room was ended by an admin"
            detail="Everyone in it was sent back here. It shows under Past Streams."
            onDismiss={() =>
              navigate({
                to: "/",
                search: (prev) => ({ ...prev, ended: undefined }),
                replace: true,
              })
            }
          />
        )}
        <div className="flex items-end justify-between gap-4 mb-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-3">
          <div className="min-w-0">
            <h1 className="m-0 mb-1 text-xl sm:text-2xl font-extrabold tracking-[-0.01em]">
              Active Rooms
            </h1>
            <p className="m-0 text-[12.5px] text-muted">
              Who's hanging out right now, and every hangout from the last 30 days.
            </p>
          </div>
          {/* Visitors start rooms by signing in first: the intro below is their one way in. */}
          {user && (
            <Btn variant="primary" onClick={openCreateRoom} className="shrink-0 max-sm:h-11">
              <Icon.Plus size={14} /> start a room
            </Btn>
          )}
        </div>

        {!user && <VisitorIntro />}

        <label className="flex items-center gap-2.5 h-11 px-3.5 mb-3.5 bg-canvas border border-border rounded-[var(--radius-sm)] text-muted cursor-text focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--color-primary-soft)] transition-shadow">
          <Icon.Search size={14} />
          <input
            aria-label="Search rooms and users"
            className="flex-1 self-stretch min-w-0 bg-transparent border-0 outline-0 text-fg text-[12.5px] placeholder:text-muted"
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
        </label>

        {/* Shown while searching; the section heads carry the counts otherwise. */}
        <div
          role="status"
          className={
            term ? "mb-2.5 text-[11px] text-muted tracking-[0.04em] tabular-nums" : "sr-only"
          }
        >
          {filtered.length} live · {past.length} past
          {term && !term.startsWith("#") ? ` · ${users.length} people` : ""}
        </div>

        {noMatches && (
          <div className="flex flex-col items-start gap-2.5 py-8 px-1">
            <p className="m-0 text-[13px] text-fg-muted">
              Nothing matches <span className="text-fg font-semibold break-all">“{q.trim()}”</span>.
              {term.startsWith("#")
                ? " No room carries that tag right now."
                : " Try a room name, a username or a #tag."}
            </p>
            <Btn size="sm" onClick={() => setQ("")}>
              <Icon.Close size={12} /> clear search
            </Btn>
          </div>
        )}

        {searchRefused && (
          <p role="status" className="mb-2.5 text-[12px] text-muted">
            Too many searches. Try again in a minute.
          </p>
        )}

        {users.length > 0 && (
          <>
            <SectionHead title="People" sub={users.length} className="mt-[18px]" />
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))]">
              {users.map((u) => (
                <UserResult key={u.id} user={u} liveRoom={liveRoomOf(u.id)} onOpen={openProfile} />
              ))}
            </div>
          </>
        )}

        {rooms.length === 0 ? (
          <div className="py-10">
            <EmptyBrowse />
          </div>
        ) : (
          <>
            {(!term || filtered.length > 0) && (
              <SectionHead
                title="Live Now"
                sub={filtered.length}
                dot="livePulse"
                className="mt-[18px]"
              />
            )}
            <div className="grid gap-3.5 grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))]">
              {filtered.map((r) => (
                <LiveCard
                  key={r.id}
                  room={r}
                  onOpen={openRoom}
                  now={now}
                  justLive={!firstRoomIds.has(r.id)}
                />
              ))}
            </div>
          </>
        )}
        {past.length > 0 && (
          <>
            <SectionHead
              title="Past Streams"
              sub="last 30 days"
              dot="muted"
              className="mt-[18px]"
            />
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))]">
              {past.map((r) => (
                <PastCard key={r.id} room={r} onOpen={openPast} />
              ))}
            </div>
          </>
        )}
      </div>

      <aside className="min-w-0 flex flex-col gap-3.5 lg:min-h-0 lg:overflow-auto [&>*]:shrink-0 [&>*]:min-w-0 max-lg:grid max-lg:grid-cols-[minmax(0,1fr)] max-lg:sm:grid-cols-[repeat(2,minmax(0,1fr))] max-lg:items-start">
        <section aria-label="Right Now" className={panelCls}>
          <PanelHead icon={Icon.Sparkle}>Right Now</PanelHead>
          <div className="grid grid-cols-3 gap-2">
            <OnlineTile />
            <StatMini icon={Icon.Eye} label="Watching" value={rightNow.inRooms} />
            <StatMini icon={Icon.Screen} label="Streaming" value={rightNow.streaming} />
          </div>
        </section>

        {/* Hidden with no live rooms: the main column already says so. */}
        {/* Only once the grid is longer than a glance: with a few rooms it repeats the cards. */}
        {rooms.length > FILLING_UP_AFTER && (
          <section aria-label="Filling Up" className={panelCls}>
            <PanelHead icon={Icon.Bolt}>Filling Up</PanelHead>
            {trending.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openRoom(r)}
                className="w-[calc(100%+1rem)] flex items-center gap-2.5 p-2 -mx-2 rounded-lg cursor-pointer text-left hover:bg-surface"
              >
                <Avatar name={r.host?.username ?? r.name} image={r.host?.image ?? null} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{r.name}</div>
                  <div className="text-[10.5px] text-muted truncate">
                    {r.host?.username ?? "deleted account"}
                  </div>
                </div>
                <span
                  className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums ${isFull(r) ? "bg-surface-2 text-fg-muted" : "text-success-ink bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)]"}`}
                >
                  {isFull(r) ? "full" : `${r.participantCount}/${r.capacity}`}
                </span>
              </button>
            ))}
          </section>
        )}

        <section aria-label="Community" className={panelCls}>
          <PanelHead icon={Icon.Users}>Community</PanelHead>
          <CommunityRow icon={Icon.Users} label="Members" value={community.members} />
          <CommunityRow
            icon={Icon.Eye}
            label="Hours Watched"
            value={`${Math.round(community.hoursWatched)}h`}
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
