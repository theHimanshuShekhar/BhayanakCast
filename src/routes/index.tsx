import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { Icon, type IconComponent } from "~/components/icons";
import { LiveCard, PastCard, useSnapshots } from "~/components/room-cards";
import { SignInButton } from "~/components/sign-in-button";
import { SignInErrorNotice } from "~/components/sign-in-error-notice";
import { Avatar, Btn, Chip } from "~/components/ui";
import { useAppActions } from "~/lib/app-actions";
import { validateSignInErrorSearch } from "~/lib/ban";
import { useCurrentSession } from "~/lib/current-user";
import { ONLINE_COUNT, PAST_ROOMS, USER_PROFILES, userIdOf } from "~/lib/mock-data";
import { useLiveRooms } from "~/lib/rooms-store";
import type { LiveRoom, PastRoom, UserProfile } from "~/lib/types";

export const Route = createFileRoute("/")({
  // A failed Discord sign-in (e.g. a banned user) lands here with an error to show.
  validateSearch: validateSignInErrorSearch,
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
}: {
  icon: IconComponent;
  label: string;
  value: number;
}) => (
  <div className="bg-surface border border-border rounded-[10px] px-3 py-2.5 shadow-card">
    <div className="inline-flex items-center gap-[5px] text-[10px] tracking-[0.06em] text-muted uppercase">
      <I size={10} /> {label}
    </div>
    <div className="mt-1 text-lg font-bold tracking-[-0.01em]">{value}</div>
  </div>
);

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
  user: UserProfile;
  liveRoom: LiveRoom | undefined;
  onOpen: (username: string) => void;
}) => (
  <button
    type="button"
    onClick={() => onOpen(user.username)}
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
          user.discord
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

function HomePage() {
  const navigate = useNavigate();
  const { openCreateRoom } = useAppActions();
  const { user } = useCurrentSession();
  const search = Route.useSearch();
  const rooms = useLiveRooms();
  const [q, setQ] = useState("");
  const snap = useSnapshots();
  const term = q.trim().toLowerCase();

  const matches = (r: LiveRoom | PastRoom) => {
    if (!term) return true;
    const tags = ("tags" in r ? r.tags : []).map((t) => t.toLowerCase());
    if (term.startsWith("#")) return tags.some((t) => t.includes(term.slice(1)));
    const kind = "kind" in r ? r.kind : undefined;
    const hay = [r.name, r.streamer, ...r.members, ...tags, kind, kind && KIND_LABELS[kind]]
      .filter((s): s is string => !!s)
      .map((s) => s.toLowerCase());
    return hay.some((s) => s.includes(term));
  };
  const filtered = rooms.filter(matches);
  const past = PAST_ROOMS.filter(matches);
  const users =
    term && !term.startsWith("#")
      ? Object.values(USER_PROFILES).filter(
          (u) => u.username.toLowerCase().includes(term) || u.discord.toLowerCase().includes(term),
        )
      : [];
  const liveRoomOf = (name: string) =>
    rooms.find((r) => r.streams.some((s) => s.user === name)) ??
    rooms.find((r) => r.members.includes(name));

  const openRoom = (r: LiveRoom) => navigate({ to: "/room/$roomId", params: { roomId: r.id } });
  const openPast = (r: PastRoom) => navigate({ to: "/past/$roomId", params: { roomId: r.id } });
  const openProfile = (username: string) =>
    navigate({ to: "/profile/$userId", params: { userId: userIdOf(username) } });

  const sidebar = useMemo(() => {
    const P = Object.values(USER_PROFILES);
    const streamers = new Set(rooms.flatMap((r) => r.streams.map((s) => s.user)));
    const watching = rooms.reduce((s, r) => s + r.viewers, 0);
    const trending = [...rooms]
      .sort((a, b) => b.viewers / b.capacity - a.viewers / a.capacity)
      .slice(0, 3);
    return { P, streamers, watching, trending };
  }, [rooms]);

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
                <UserResult
                  key={u.username}
                  user={u}
                  liveRoom={liveRoomOf(u.username)}
                  onOpen={openProfile}
                />
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

        <div className={panelCls}>
          <PanelHead icon={Icon.Sparkle}>Right Now</PanelHead>
          <div className="grid grid-cols-2 gap-2">
            <StatMini icon={Icon.Users} label="Online" value={ONLINE_COUNT} />
            <StatMini icon={Icon.Broadcast} label="Live Rooms" value={rooms.length} />
            <StatMini icon={Icon.Eye} label="Watching" value={sidebar.watching} />
            <StatMini icon={Icon.Screen} label="Streaming" value={sidebar.streamers.size} />
          </div>
        </div>

        <div className={panelCls}>
          <PanelHead icon={Icon.Bolt}>Filling Up</PanelHead>
          {sidebar.trending.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => openRoom(r)}
              className="w-[calc(100%+1rem)] flex items-center gap-2.5 p-2 -mx-2 rounded-lg cursor-pointer text-left hover:bg-surface"
            >
              <Avatar name={r.streamer} size="md" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{r.name}</div>
                <div className="text-[10.5px] text-muted">{r.streamer}</div>
              </div>
              <span className="text-[10.5px] font-semibold text-success-ink px-1.5 py-0.5 rounded-md tabular-nums bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)]">
                {r.viewers}/{r.capacity}
              </span>
            </button>
          ))}
        </div>

        <div className={panelCls}>
          <PanelHead icon={Icon.Users}>Community</PanelHead>
          <CommunityRow icon={Icon.Users} label="Members" value={sidebar.P.length} />
          <CommunityRow
            icon={Icon.Eye}
            label="Hours Watched"
            value={`${Math.round(sidebar.P.reduce((s, p) => s + p.stats.hoursWatched, 0))}h`}
            accent
          />
          <CommunityRow
            icon={Icon.Broadcast}
            label="Hours Streamed"
            value={`${Math.round(sidebar.P.reduce((s, p) => s + p.stats.hoursStreamed, 0))}h`}
          />
          <CommunityRow
            icon={Icon.Plus}
            label="Rooms Hosted"
            value={sidebar.P.reduce((s, p) => s + p.stats.roomsHosted, 0)}
          />
        </div>
      </aside>
    </div>
  );
}
