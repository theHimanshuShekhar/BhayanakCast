import { Menu } from "@base-ui/react/menu";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, redirect, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Icon } from "~/components/icons";
import { ControlBtn } from "~/components/room/control-btn";
import { KnockToasts } from "~/components/room/knock-toasts";
import { failureText, Lobby } from "~/components/room/lobby";
import { PeerAudio } from "~/components/room/peer-audio";
import { QualityDebug } from "~/components/room/quality-debug";
import { RoomSide } from "~/components/room/side-panel";
import { isModerator, type ModAction, Tile } from "~/components/room/tile";
import { Btn, Chip } from "~/components/ui";
import { useAppActions } from "~/lib/app-actions";
import { useCurrentSession } from "~/lib/current-user";
import { fmtMins, MAX_STREAMERS } from "~/lib/format";
import { inviteUrl } from "~/lib/invites";
import { getInviteTokenFn, regenerateInviteTokenFn } from "~/lib/invites.functions";
import { decideKnock, usePendingKnocks } from "~/lib/knock-live";
import {
  getLocalMedia,
  type LocalDeviceKind,
  type ShareFailure,
  shareHintFor,
  useCanShare,
  useLocalMedia,
} from "~/lib/local-media";
import {
  type FeedEntry,
  type KnockEntry,
  type MediaState,
  REACTION_EMOJIS,
  type ReactionEmoji,
} from "~/lib/realtime";
import {
  feedLine,
  markInRoom,
  moderate,
  sendChat,
  sendReaction,
  useRoomLive,
  useRoomReactions,
  wasInRoom,
} from "~/lib/room-live";
import { useRoomMesh, useSpeakers } from "~/lib/room-media";
import { roomDetailFor, withRoster } from "~/lib/room-view";
import { type LiveRoomCard, ROOM_NAME_MAX, type RoomKind } from "~/lib/rooms";
import { roomQuery } from "~/lib/rooms.queries";
import { useSettings } from "~/lib/settings";
import { uploadShareThumbnail } from "~/lib/thumbnail-capture";
import type { ChatMessage, Participant, RoomDetail, RoomRole } from "~/lib/types";

export const Route = createFileRoute("/room/$roomId")({
  // Visitors go home with the "sign in to join" prompt open. A UX guard only: the room
  // server functions and socket check the session themselves.
  beforeLoad: ({ context, params }) => {
    if (!context.session.user) throw redirect({ to: "/", search: { join: params.roomId } });
  },
  loader: async ({ context, params }) => {
    const room = await context.queryClient.ensureQueryData(roomQuery(params.roomId));
    if (!room) throw notFound();
  },
  notFoundComponent: RoomNotFound,
  component: RoomRoute,
});

function RoomNotFound() {
  return (
    <div className="px-10 py-20 text-center">
      <h1 className="m-0 mb-2 text-lg">room not found</h1>
      <p className="m-0 mb-4 text-muted text-[12.5px]">it may have ended or never existed.</p>
      <Link to="/" className="text-primary">
        back to rooms
      </Link>
    </div>
  );
}

/** Why this page isn't showing the room (it's full, or the user took it elsewhere). */
function RoomNotice({
  title,
  waiting = false,
  children,
}: {
  title: string;
  /** Still trying to get in: announce it as a live status. */
  waiting?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="px-10 py-20 text-center" role={waiting ? "status" : "alert"}>
      <h1 className="m-0 mb-2 text-lg">{title}</h1>
      <p className="m-0 mb-4 text-muted text-[12.5px]">{children}</p>
      <Link to="/" className="text-primary">
        back to rooms
      </Link>
    </div>
  );
}

function RoomRoute() {
  const { roomId } = Route.useParams();
  const { user, role } = useCurrentSession();
  const { data: room } = useSuspenseQuery(roomQuery(roomId));
  // It can end or disappear after load (a later refetch or socket invalidation).
  if (!room) return <RoomGone roomId={roomId} />;
  // key resets all room state (back to the lobby) when navigating between rooms or the
  // signed-in user changes
  return <RoomVisit key={`${room.id}:${user?.id ?? ""}`} room={room} admin={role === "admin"} />;
}

/** The room ended or vanished: this tab isn't in it any more. */
function RoomGone({ roomId }: { roomId: string }) {
  useEffect(() => markInRoom(roomId, false), [roomId]);
  return <RoomNotFound />;
}

/**
 * One visit to a room: the lobby first (pick and preview devices; nothing is sent to the room
 * yet), then the room itself with what was chosen. A reload of a room this tab entered skips
 * the lobby and rejoins at once, mic and camera off; so does a knocker just admitted, with the
 * mic and camera they turned on while waiting (src/routes/join/$inviteToken.tsx). The mic and
 * camera are released, and the tab counts as having left, when the visit ends (back, leave, or
 * navigating away; a reload never runs this).
 */
function RoomVisit({ room, admin }: { room: LiveRoomCard; admin: boolean }) {
  const navigate = useNavigate();
  const { user } = useCurrentSession();
  const [entered, setEntered] = useState<MediaState | null>(null);
  // Before the first paint after hydration, so a reload doesn't flash the lobby's controls.
  useLayoutEffect(() => {
    if (!wasInRoom(room.id)) return;
    // Nothing is on after a reload.
    const local = getLocalMedia().getSnapshot();
    setEntered({ mic: local.mic.status === "on", cam: local.cam.status === "on", share: false });
  }, [room.id]);
  useEffect(
    () => () => {
      getLocalMedia().release();
      markInRoom(room.id, false);
    },
    [room.id],
  );
  if (!entered) {
    return (
      <Lobby
        roomName={room.name}
        host={room.host?.username ?? null}
        people={room.participants.filter((p) => p.id !== user?.id).map((p) => p.username)}
        capacity={room.capacity}
        me={user?.username ?? ""}
        onEnter={({ mic, cam }) => {
          markInRoom(room.id, true);
          setEntered({ mic, cam, share: false });
        }}
        onBack={() => {
          markInRoom(room.id, false);
          navigate({ to: "/" });
        }}
      />
    );
  }
  return (
    <RoomPage
      detail={roomDetailFor(room, user)}
      kind={room.kind}
      meId={user?.id ?? null}
      admin={admin}
      isPrivate={room.isPrivate}
      initialMedia={entered}
    />
  );
}

/**
 * The room-info menu. In a private room the host, mods and admins can copy its invite link,
 * and the host can regenerate it so old links stop working (ADR 16); `onInviteResult` gets what
 * to tell them, done or not.
 */
function RoomInfoMenu({
  roomId,
  canInvite,
  canRegenerate,
  onInviteResult,
}: {
  roomId: string;
  canInvite: boolean;
  canRegenerate: boolean;
  onInviteResult: (notice: { message: string }) => void;
}) {
  const trigger = (
    <>
      <Icon.Hash size={12} /> room info
    </>
  );
  if (!canInvite) {
    return (
      <Btn variant="ghost" size="sm" title="Room info">
        {trigger}
      </Btn>
    );
  }
  const copyInvite = async () => {
    try {
      const token = await getInviteTokenFn({ data: { roomId } });
      if (!token) throw new Error("No invite token for this caller");
      await navigator.clipboard.writeText(inviteUrl(window.location.origin, token));
      onInviteResult({ message: "invite link copied" });
    } catch {
      onInviteResult({ message: "couldn't copy the invite link" });
    }
  };
  const regenerateInvite = async () => {
    try {
      if (!(await regenerateInviteTokenFn({ data: { roomId } }))) {
        throw new Error("Only the host can regenerate the invite link");
      }
      onInviteResult({ message: "new invite link made: old links no longer work" });
    } catch {
      onInviteResult({ message: "couldn't regenerate the invite link" });
    }
  };
  const itemCls =
    "flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-sm)] text-xs text-fg cursor-pointer outline-0 data-highlighted:bg-surface-2";
  return (
    <Menu.Root>
      <Menu.Trigger render={<Btn variant="ghost" size="sm" title="Room info" />}>
        {trigger}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={10} className="z-[160] outline-0">
          <Menu.Popup className="min-w-[200px] p-1.5 bg-surface border border-border-strong rounded-[var(--radius)] shadow-deep outline-0">
            <Menu.Item onClick={() => void copyInvite()} className={itemCls}>
              <Icon.Users size={13} /> copy invite link
            </Menu.Item>
            {canRegenerate && (
              <Menu.Item onClick={() => void regenerateInvite()} className={itemCls}>
                <Icon.Lock size={13} /> regenerate invite link
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The room's name, which the host or an admin can edit in place (`room.rename`). */
function RoomName({ name, canRename }: { name: string; canRename: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <>
        <h1 className="m-0 text-[11.5px] text-fg font-semibold truncate">{name}</h1>
        {canRename && (
          <button
            type="button"
            className="text-[11px] text-muted hover:text-fg cursor-pointer"
            onClick={() => setDraft(name)}
          >
            rename
          </button>
        )}
      </>
    );
  }
  const submit = () => {
    const next = draft.trim();
    if (next && next !== name) moderate({ type: "room.rename", name: next });
    setDraft(null);
  };
  return (
    <form
      className="flex items-center gap-1.5 min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        aria-label="Room name"
        // biome-ignore lint/a11y/noAutofocus: opened by the rename button to type into at once
        autoFocus
        value={draft}
        maxLength={ROOM_NAME_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setDraft(null);
        }}
        className="h-6 min-w-0 w-56 px-2 rounded-md bg-surface border border-border text-[11.5px] text-fg outline-0 focus:border-primary"
      />
      <button type="submit" className="text-[11px] text-primary cursor-pointer">
        save
      </button>
      <button
        type="button"
        className="text-[11px] text-muted hover:text-fg cursor-pointer"
        onClick={() => setDraft(null)}
      >
        cancel
      </button>
    </form>
  );
}

const DENSITY_CLS = {
  compact: "gap-2 p-2.5 auto-rows-[minmax(120px,auto)]",
  comfortable: "gap-3 p-4 auto-rows-[minmax(140px,auto)]",
  spacious: "gap-[18px] p-[22px] auto-rows-[minmax(180px,auto)]",
} as const;

/** Minutes since `iso`, ticking every 30s. */
const useMinutesSince = (iso: string) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(clock);
  }, []);
  return Math.max(0, now - Date.parse(iso)) / 60_000;
};

/** `error`'s message for a few seconds after each new one, then null. */
const useNotice = (error: { message: string } | null, ms = 4_000) => {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    setNotice(error.message);
    const timer = setTimeout(() => setNotice(null), ms);
    return () => clearTimeout(timer);
  }, [error, ms]);
  return notice;
};

const NO_CHAT: ChatMessage[] = [];
const NO_FEED: FeedEntry[] = [];
const NO_KNOCKS: KnockEntry[] = [];

/**
 * Why a screen share didn't start (a cancelled picker, `denied`, needs no words). `late` also
 * covers a server that didn't answer in time.
 */
const SHARE_FAILURE: Record<Exclude<ShareFailure, "denied">, string> = {
  late: "couldn't start sharing — try again.",
  missing: "there was nothing to share.",
  busy: "couldn't share your screen. try again.",
  unsupported: "this browser can't share its screen here.",
};

function RoomPage({
  detail,
  kind,
  meId,
  admin,
  isPrivate,
  initialMedia,
}: {
  detail: RoomDetail;
  /** Tunes screen shares (ADR 2 addendum). */
  kind: RoomKind;
  meId: string | null;
  /** A site admin: moderation in any room (ADR 15). */
  admin: boolean;
  /** Entered by invite link and knock (ADR 16). */
  isPrivate: boolean;
  /** The mic and camera as the lobby left them. */
  initialMedia: MediaState;
}) {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { openSettings } = useAppActions();
  // Starts from the loader's view; the realtime socket's snapshot and events take over.
  const [participants, setParticipants] = useState<Participant[]>(detail.participants);
  const live = useRoomLive(detail.id, meId, initialMedia);
  const local = useLocalMedia();
  // The host can rename the room while we're here.
  const roomName = live.room?.name ?? detail.name;
  const roster = live.room?.participants;
  useEffect(() => {
    if (roster) setParticipants((shown) => withRoster(shown, roster, meId));
  }, [roster, meId]);
  // Chat and the feed (each with its recent history) and reactions come over the socket.
  const chat = live.room?.chat ?? NO_CHAT;
  const feed = live.room?.feed ?? NO_FEED;
  const activity = useMemo(() => feed.map(feedLine), [feed]);
  const reactions = useRoomReactions(detail.id);
  // Knocks on a private room: the people tab's "waiting" group (and the toasts).
  const knocks = usePendingKnocks(detail.id);
  const [showNonSharers, setShowNonSharers] = useState(true);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [mutedIds, setMutedIds] = useState<Set<string>>(() => new Set());
  const [sideOpen, setSideOpen] = useState(false);

  const liveFor = useMinutesSince(detail.createdAt);

  const me = participants.find((p) => p.you);
  const myRole: RoomRole = me?.role ?? "member";
  // The controls show what this page asked for; tiles show what the server accepted.
  const { media, setMedia } = live;
  const joined = live.room !== null;
  const othersStreaming = participants.filter((p) => p.streaming && !p.you).length;
  const canStartShare = media.share || othersStreaming < MAX_STREAMERS;
  // Why a mic or camera didn't turn on here (e.g. permission denied).
  const [deviceError, setDeviceError] = useState<{ message: string } | null>(null);
  const mediaNotice = useNotice(live.mediaError);
  const moderationNotice = useNotice(live.moderationError);
  const deviceNotice = useNotice(deviceError, 8_000);
  // Whether "copy invite link" or "regenerate invite link" worked.
  const [inviteResult, setInviteResult] = useState<{ message: string } | null>(null);
  const inviteNotice = useNotice(inviteResult);
  const notice = moderationNotice ?? deviceNotice ?? mediaNotice ?? inviteNotice;

  // Mic and camera are real local tracks (src/lib/local-media.ts), announced once they're on;
  // the mesh sends them.
  const toggleDevice = async (kind: LocalDeviceKind) => {
    const localMedia = getLocalMedia();
    if (media[kind]) {
      localMedia.disable(kind);
      setMedia((m) => ({ ...m, [kind]: false }));
      return;
    }
    const track = await localMedia.enable(kind);
    const failure = localMedia.getSnapshot()[kind].failure;
    if (track) setMedia((m) => ({ ...m, [kind]: true }));
    else if (failure) setDeviceError({ message: failureText(kind, failure) });
  };
  const toggleMic = () => void toggleDevice("mic");
  const toggleCam = () => void toggleDevice("cam");
  // A share is announced first, and the screen captured once the server accepts it (at most
  // 3 streamers); turning it off (here, or by a mod) stops the capture (the effect below).
  // Until then it is pending: on for the room, with nothing captured yet.
  const [sharePending, setSharePending] = useState(false);
  const toggleShare = async () => {
    if (media.share) {
      setMedia((m) => ({ ...m, share: false }));
      return;
    }
    setSharePending(true);
    try {
      const answer = await live.requestShare();
      if (answer === "timeout") setDeviceError({ message: SHARE_FAILURE.late });
      if (answer !== "accepted") return;
      const localMedia = getLocalMedia();
      if (await localMedia.startShare(shareHintFor(kind))) return;
      const failure = localMedia.getSnapshot().share.failure;
      if (failure && failure !== "denied") setDeviceError({ message: SHARE_FAILURE[failure] });
    } finally {
      setSharePending(false);
    }
  };
  const canShare = useCanShare();
  useEffect(() => {
    if (!media.share) getLocalMedia().stopShare();
  }, [media.share]);
  // Once the screen is captured, a still of it goes to the room's cards (ADR 10).
  const shareTrack = media.share ? local.share.track : null;
  useEffect(() => {
    if (shareTrack) void uploadShareThumbnail(detail.id, shareTrack);
  }, [shareTrack, detail.id]);

  // A device that stopped by itself (unplugged, or access revoked) is off for the room too;
  // so is a share whose capture ended (the browser's own "stop sharing") or never started.
  const micLost = media.mic && local.mic.status === "off";
  const camLost = media.cam && local.cam.status === "off";
  const shareLost = media.share && !sharePending && local.share.status === "off";
  useEffect(() => {
    if (micLost) setMedia((m) => ({ ...m, mic: false }));
    if (camLost) setMedia((m) => ({ ...m, cam: false }));
    if (shareLost) setMedia((m) => ({ ...m, share: false }));
  }, [micLost, camLost, shareLost, setMedia]);

  // Out of the room for good: stop broadcasting at once.
  const out =
    live.ended ||
    live.error?.code === "not_found" ||
    live.error?.code === "taken_over" ||
    live.error?.code === "kicked";
  useEffect(() => {
    if (!out) return;
    getLocalMedia().release();
    // Coming back (a reload) goes through the lobby, not straight back in.
    markInRoom(detail.id, false);
  }, [out, detail.id]);
  // An admin ended the room: home says so.
  useEffect(() => {
    if (live.ended) navigate({ to: "/", search: { ended: "admin" } });
  }, [live.ended, navigate]);

  // Peer-to-peer media (ADR 1): every connection closes with the room (leave unmounts this).
  // Whose cameras are on screen here: the others are paused towards this page (ADR 2).
  const [shownCams, setShownCams] = useState<ReadonlySet<string>>(() => new Set());
  const onCameraShown = useCallback(
    (userId: string, shown: boolean) =>
      setShownCams((s) => {
        if (s.has(userId) === shown) return s;
        const next = new Set(s);
        if (shown) next.add(userId);
        else next.delete(userId);
        return next;
      }),
    [],
  );
  const mesh = useRoomMesh(
    detail.id,
    meId,
    roster,
    {
      mic: local.mic.track,
      cam: local.cam.track,
      screen: local.share.track,
      screenAudio: local.share.audio,
    },
    shownCams,
    !out,
  );
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [shareVolumes, setShareVolumes] = useState<Record<string, number>>({});
  const onShareVolume = useCallback(
    (id: string, volume: number) => setShareVolumes((v) => ({ ...v, [id]: volume })),
    [],
  );
  const micTracks = useMemo(() => {
    const tracks: Record<string, MediaStreamTrack | undefined> = {};
    for (const [userId, theirs] of Object.entries(mesh.remote)) tracks[userId] = theirs.mic;
    if (meId && local.mic.track) tracks[meId] = local.mic.track;
    return tracks;
  }, [mesh.remote, local.mic.track, meId]);
  const speaking = useSpeakers(micTracks);
  const people = useMemo(
    () => participants.map((p) => ({ ...p, speaking: speaking.has(p.userId) })),
    [participants, speaking],
  );

  // Floats on the pinned tile, else the first streamer's, else the first on stage, else yours.
  const react = (emoji: ReactionEmoji) => {
    const target =
      participants.find((p) => p.id === pinnedId) ??
      participants.find((p) => p.streaming) ??
      participants.find((p) => !p.viewerOnly) ??
      me;
    if (target) sendReaction(emoji, target.userId);
  };

  // WebSocket commands (ADR 15): the server authorises them and broadcasts the result.
  const onModerate = (id: string, action: ModAction) => {
    const target = participants.find((p) => p.id === id);
    if (!target) return;
    const userId = target.userId;
    if (action === "kick") moderate({ type: "mod.kick", userId });
    else if (action === "stopShare") moderate({ type: "mod.stopShare", userId });
    else moderate({ type: "mod.setRole", userId, role: action === "promote" ? "mod" : "member" });
  };

  const toggleMute = (id: string) =>
    setMutedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Hiding everyone not sharing leaves the streamers: the others' cameras are paused towards
  // this page (ADR 13 addendum).
  const stage = useMemo(() => {
    const base = showNonSharers ? people : people.filter((p) => p.streaming);
    if (!pinnedId) return base;
    return [
      ...base
        .filter((p) => p.id === pinnedId)
        .map((p) => ({ ...p, pinned: true, viewerOnly: false, size: "l" as const })),
      ...base
        .filter((p) => p.id !== pinnedId)
        .map((p) => (p.size === "l" ? { ...p, size: "m" as const } : p)),
    ];
  }, [people, showNonSharers, pinnedId]);

  // The room ended or was hidden from us since the page loaded.
  if (live.error?.code === "not_found") return <RoomNotFound />;
  if (live.error?.code === "taken_over") {
    return (
      <RoomNotice title="you joined from elsewhere">
        you're in a room in another tab or device now, so you left this one here.
      </RoomNotice>
    );
  }
  if (live.error?.code === "kicked") {
    return (
      <RoomNotice title="you were removed from this room">
        a host, mod or admin removed you from {roomName}, so you can't rejoin it.
      </RoomNotice>
    );
  }
  if (live.error?.code === "room_full") {
    return (
      <RoomNotice title={`room full (${detail.capacity}/${detail.capacity})`} waiting>
        you'll join {roomName} automatically as soon as a spot frees up.
      </RoomNotice>
    );
  }

  const leave = () => {
    markInRoom(detail.id, false);
    navigate({ to: "/" });
  };
  // Chat and the feed name people by username: resolve it to the user id of whoever has (or,
  // if removed since, had) that name here.
  const openProfile = (username: string) => {
    const person = [...participants, ...detail.participants].find((p) => p.name === username);
    if (person) navigate({ to: "/profile/$userId", params: { userId: person.userId } });
  };

  return (
    <div
      className={`grid h-full overflow-hidden ${settings.showChat ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""} grid-cols-1`}
    >
      <div className="flex flex-col min-w-0 min-h-0 bg-bg relative">
        <div className="flex items-center gap-3 px-[18px] max-sm:px-3 py-3 border-b border-border-subtle">
          <nav
            aria-label="Breadcrumb"
            className="flex-1 min-w-0 flex items-center gap-2 text-[11.5px] text-muted whitespace-nowrap"
          >
            <Link to="/" className="!text-muted hover:!text-fg hover:no-underline">
              home
            </Link>
            <span className="text-subtle">/</span>
            <RoomName name={roomName} canRename={joined && (admin || myRole === "host")} />
          </nav>
          <div className="flex gap-1.5 items-center flex-shrink-0">
            {/* The socket dropped; the realtime client is reconnecting with backoff. */}
            <span role="status" className="contents">
              {live.reconnecting && (
                <Chip dot className="animate-bc-pulse">
                  reconnecting…
                </Chip>
              )}
            </span>
            {/* The host is away: host passes on if they're not back by then (ADR 14). */}
            <span role="status" className="contents">
              {live.room?.hostGraceUntil && (
                <Chip dot className="animate-bc-pulse">
                  host reconnecting…
                </Chip>
              )}
            </span>
            <Chip className="!bg-surface max-sm:!hidden">
              <Icon.Users size={11} /> {participants.length}/{detail.capacity}
            </Chip>
            <Chip kind="live" dot>
              {/* The elapsed time can tick between the server render and hydration. */}
              <span suppressHydrationWarning>LIVE · {fmtMins(liveFor)}</span>
            </Chip>
            <button
              type="button"
              aria-pressed={showNonSharers}
              title="Show people who aren't sharing"
              className={`inline-flex items-center gap-2 h-7 px-2.5 rounded-lg border text-[11px] whitespace-nowrap cursor-pointer ${showNonSharers ? "bg-primary-soft border-[color-mix(in_oklch,var(--color-primary)_45%,transparent)] text-primary" : "bg-surface border-border text-fg-muted"}`}
              onClick={() => setShowNonSharers((v) => !v)}
            >
              <span
                className={`w-3 h-3 rounded-[3px] border grid place-items-center ${showNonSharers ? "bg-primary border-transparent text-primary-ink" : "border-border-strong"}`}
              >
                {showNonSharers && <Icon.Check size={10} />}
              </span>
              <span className="max-sm:sr-only">viewers</span>
            </button>
          </div>
        </div>

        <div
          className={`flex-1 min-h-0 overflow-auto grid grid-cols-12 max-md:grid-cols-2 max-md:auto-rows-[minmax(88px,auto)] content-start ${DENSITY_CLS[settings.density]}`}
        >
          {stage.map((p) => (
            <Tile
              key={p.id}
              p={p}
              layout={settings.layout}
              myRole={myRole}
              admin={admin}
              locallyMuted={mutedIds.has(p.id)}
              volume={volumes[p.id] ?? 1}
              onVolume={(id, volume) => setVolumes((v) => ({ ...v, [id]: volume }))}
              cameraTrack={p.you ? local.cam.track : mesh.remote[p.userId]?.cam}
              onCameraShown={onCameraShown}
              screenTrack={p.you ? local.share.track : mesh.remote[p.userId]?.screen}
              shareVolume={shareVolumes[p.id] ?? 1}
              onShareVolume={mesh.shareAudio.has(p.userId) ? onShareVolume : undefined}
              reactions={reactions.filter((r) => r.targetUserId === p.userId)}
              onPin={(id) => setPinnedId((cur) => (cur === id ? null : id))}
              onToggleMute={toggleMute}
              onModerate={onModerate}
              cantConnect={mesh.states[p.userId] === "failed"}
              onRetry={() => mesh.retry(p.userId)}
            />
          ))}
        </div>
        {import.meta.env.DEV && (
          <QualityDebug
            read={mesh.quality}
            names={Object.fromEntries(participants.map((p) => [p.userId, p.name]))}
          />
        )}
        {Object.entries(mesh.remote).map(
          ([userId, tracks]) =>
            tracks.mic && (
              <PeerAudio
                key={userId}
                userId={userId}
                track={tracks.mic}
                volume={volumes[userId] ?? 1}
                muted={mutedIds.has(userId)}
              />
            ),
        )}
        {/* Only while the server says they're sharing: a stopped share is silent (ADR 15). */}
        {people.map(({ userId, streaming }) => {
          const track = mesh.remote[userId]?.screenAudio;
          return (
            streaming &&
            track && (
              <PeerAudio
                key={`share:${userId}`}
                userId={userId}
                share
                track={track}
                volume={shareVolumes[userId] ?? 1}
                muted={mutedIds.has(userId)}
              />
            )
          );
        })}

        <div className="relative flex items-center justify-center gap-2.5 px-[18px] py-3.5 max-sm:px-2 max-sm:py-2.5 bg-canvas border-t border-border-subtle">
          <div className="absolute left-[18px] flex gap-2 max-lg:hidden">
            <RoomInfoMenu
              roomId={detail.id}
              canInvite={isPrivate && joined && isModerator(myRole, admin)}
              canRegenerate={isPrivate && joined && myRole === "host"}
              onInviteResult={setInviteResult}
            />
          </div>

          {/* A refused media change (a share start with 3 people already sharing), a share a
              moderator stopped, or a refused moderation command. */}
          <p
            role="status"
            className={
              notice
                ? "absolute bottom-full mt-0 mb-2 px-3 py-1.5 rounded-full text-[11px] text-live-ink bg-surface border border-border shadow-card"
                : "sr-only"
            }
          >
            {notice}
          </p>
          <div className="flex gap-2 max-sm:gap-1.5 p-1.5 bg-surface border border-border rounded-full shadow-card">
            <ControlBtn
              state={media.cam ? "active" : "muted"}
              onClick={toggleCam}
              disabled={!joined || local.cam.status === "starting"}
              aria-label={media.cam ? "Turn camera off" : "Turn camera on"}
              aria-pressed={media.cam}
            >
              {media.cam ? <Icon.Cam size={16} /> : <Icon.CamOff size={16} />}
            </ControlBtn>
            <ControlBtn
              state={media.mic ? "active" : "muted"}
              onClick={toggleMic}
              disabled={!joined || local.mic.status === "starting"}
              aria-label={media.mic ? "Mute mic" : "Unmute mic"}
              aria-pressed={media.mic}
            >
              {media.mic ? <Icon.Mic size={16} /> : <Icon.MicOff size={16} />}
            </ControlBtn>
            {/* Hidden where the browser can't share its screen (mobile, ADR 17). */}
            {canShare && (
              <ControlBtn
                state={media.share ? "active" : undefined}
                onClick={() => void toggleShare()}
                disabled={!joined || !canStartShare || local.share.status === "starting"}
                aria-label={media.share ? "Stop sharing" : "Share screen"}
                aria-pressed={media.share}
                title={
                  canStartShare ? "Screen share" : `${MAX_STREAMERS} people are already sharing`
                }
                className="max-sm:hidden"
              >
                <Icon.Screen size={16} />
              </ControlBtn>
            )}
            <Menu.Root>
              <Menu.Trigger
                aria-label="Reactions"
                className="w-10 h-10 rounded-full grid place-items-center border cursor-pointer bg-surface-2 text-fg border-border hover:bg-surface-3 max-[380px]:hidden"
              >
                <Icon.Smile size={16} />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner side="top" sideOffset={10} className="z-[160] outline-0">
                  <Menu.Popup className="flex gap-1 p-1.5 bg-surface border border-border-strong rounded-full shadow-deep outline-0">
                    {REACTION_EMOJIS.map((e) => (
                      <Menu.Item
                        key={e}
                        closeOnClick={false}
                        onClick={() => react(e)}
                        aria-label={`React ${e}`}
                        className="w-8 h-8 grid place-items-center rounded-full text-lg cursor-pointer outline-0 data-highlighted:bg-surface-2"
                      >
                        {e}
                      </Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
            {settings.showChat && (
              <ControlBtn
                state={sideOpen ? "active" : undefined}
                onClick={() => setSideOpen((o) => !o)}
                aria-label="Chat & people"
                aria-expanded={sideOpen}
                className="lg:hidden"
              >
                <Icon.Chat size={16} />
              </ControlBtn>
            )}
            <button
              type="button"
              onClick={leave}
              className="inline-flex items-center gap-2 h-10 px-4 max-sm:px-3 rounded-full bg-live text-white font-semibold text-xs cursor-pointer hover:brightness-110"
            >
              <Icon.Leave size={14} /> <span className="max-sm:sr-only">leave</span>
            </button>
          </div>

          <div className="absolute right-[18px] flex gap-2 max-lg:hidden">
            <Btn
              variant="ghost"
              size="sm"
              className="!w-7 !px-0"
              aria-label="Settings"
              onClick={openSettings}
            >
              <Icon.Gear size={14} />
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              className="!w-7 !px-0"
              aria-label="Fullscreen"
              onClick={() => document.documentElement.requestFullscreen?.()}
            >
              <Icon.Maximize size={14} />
            </Btn>
          </div>
        </div>
      </div>

      {isPrivate && <KnockToasts roomId={detail.id} />}
      {settings.showChat && sideOpen && (
        <button
          type="button"
          aria-label="Close panel"
          className="lg:hidden fixed inset-0 z-[110] bg-black/45 animate-bc-fade cursor-default"
          onClick={() => setSideOpen(false)}
        />
      )}
      {settings.showChat && (
        <RoomSide
          participants={people}
          chat={chat}
          chatError={live.chatError}
          activity={activity}
          onSend={sendChat}
          canSend={live.room !== null}
          onOpenProfile={openProfile}
          knocks={isPrivate && joined && isModerator(myRole, admin) ? knocks : NO_KNOCKS}
          onDecideKnock={decideKnock}
          open={sideOpen}
          onClose={() => setSideOpen(false)}
        />
      )}
    </div>
  );
}
