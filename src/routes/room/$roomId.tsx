import { Menu } from "@base-ui/react/menu";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ButtonHTMLAttributes, useMemo, useState } from "react";
import { Icon } from "~/components/icons";
import { RoomSide } from "~/components/room/side-panel";
import { type ModAction, type Reaction, Tile } from "~/components/room/tile";
import { Btn, Chip } from "~/components/ui";
import { useAppActions } from "~/lib/app-actions";
import { MAX_STREAMERS } from "~/lib/format";
import { ACTIVITY, buildRoomDetail, CURRENT_USER } from "~/lib/mock-data";
import { findRoom } from "~/lib/rooms-store";
import { useSettings } from "~/lib/settings";
import type { ActivityItem, ChatMessage, Participant, RoomDetail, RoomRole } from "~/lib/types";

export const Route = createFileRoute("/room/$roomId")({
  component: RoomRoute,
});

function RoomRoute() {
  const { roomId } = Route.useParams();
  const room = findRoom(roomId);
  if (!room) {
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
  // key resets all room state when navigating between rooms
  return <RoomPage key={room.id} detail={buildRoomDetail(room)} />;
}

const DENSITY_CLS = {
  compact: "gap-2 p-2.5 auto-rows-[minmax(120px,auto)]",
  comfortable: "gap-3 p-4 auto-rows-[minmax(140px,auto)]",
  spacious: "gap-[18px] p-[22px] auto-rows-[minmax(180px,auto)]",
} as const;

const REACTIONS = ["🔥", "💯", "✨", "🎧", "⚡", "🫡"];

const ControlBtn = ({
  state,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { state?: "active" | "muted" }) => {
  const st =
    state === "active"
      ? "bg-primary text-primary-ink border-transparent shadow-[0_0_18px_var(--color-primary-glow)]"
      : state === "muted"
        ? "bg-[color-mix(in_oklch,var(--color-live)_22%,var(--color-surface-2))] text-live-ink border-[color-mix(in_oklch,var(--color-live)_40%,transparent)]"
        : "bg-surface-2 text-fg border-border hover:bg-surface-3";
  return (
    <button
      type="button"
      className={`w-10 h-10 rounded-full grid place-items-center border cursor-pointer transition-all duration-[120ms] disabled:opacity-45 disabled:cursor-not-allowed ${st} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};

const nowTs = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function RoomPage({ detail }: { detail: RoomDetail }) {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { openSettings } = useAppActions();
  const [participants, setParticipants] = useState<Participant[]>(detail.participants);
  const [chat, setChat] = useState<ChatMessage[]>(detail.chat);
  const [activity, setActivity] = useState<ActivityItem[]>(ACTIVITY);
  const [showViewers, setShowViewers] = useState(true);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [mutedIds, setMutedIds] = useState<Set<string>>(() => new Set());
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [sideOpen, setSideOpen] = useState(false);

  const me = participants.find((p) => p.you);
  const myRole: RoomRole = detail.host === CURRENT_USER ? "host" : (me?.role ?? "member");
  const streamingCount = participants.filter((p) => p.streaming).length;
  const canStartShare = !!me?.streaming || streamingCount < MAX_STREAMERS;

  const log = (who: string, what: string) =>
    setActivity((a) => [{ who, what, when: "just now" }, ...a]);
  const system = (text: string) =>
    setChat((c) => [...c, { id: `sys${Date.now()}`, system: true, text }]);

  const updateMe = (patch: Partial<Participant>) =>
    setParticipants((ps) =>
      ps.map((p) => {
        if (!p.you) return p;
        const next = { ...p, ...patch };
        // anyone with a cam or share gets a stage tile; otherwise they collapse to a viewer chip
        const onStage = next.streaming || next.camera;
        return { ...next, viewerOnly: !onStage, size: next.streaming ? "l" : "s" };
      }),
    );

  // TODO(ADR 1/2): these toggle real getUserMedia/getDisplayMedia tracks once the mesh lands.
  const toggleMic = () => updateMe({ muted: !me?.muted });
  const toggleCam = () => updateMe({ camera: !me?.camera });
  const toggleShare = () => {
    if (!me) return;
    const streaming = !me.streaming;
    updateMe({ streaming, screen: "browser" });
    log(CURRENT_USER, streaming ? "started streaming" : "stopped streaming");
  };

  const send = (text: string) =>
    setChat((c) => [
      ...c,
      { id: `c${Date.now()}`, user: CURRENT_USER, role: myRole, ts: nowTs(), text },
    ]);

  const react = (emoji: string) => {
    const target =
      participants.find((p) => p.id === pinnedId) ??
      participants.find((p) => p.streaming) ??
      participants.find((p) => !p.viewerOnly);
    if (!target) return;
    const r: Reaction = {
      id: Date.now() + Math.random(),
      emoji,
      dx: (Math.random() - 0.5) * 60,
      participantId: target.id,
    };
    setReactions((rs) => [...rs, r]);
    setTimeout(() => setReactions((rs) => rs.filter((x) => x.id !== r.id)), 2400);
  };

  // TODO(ADR 15): send as WebSocket commands; server authorises against the sender's role.
  const moderate = (id: string, action: ModAction) => {
    const target = participants.find((p) => p.id === id);
    if (!target) return;
    if (action === "kick") {
      setParticipants((ps) => ps.filter((p) => p.id !== id));
      system(`${target.name} was removed from the room`);
      log(target.name, "was kicked");
      if (pinnedId === id) setPinnedId(null);
    } else if (action === "stopShare") {
      setParticipants((ps) =>
        ps.map((p) => (p.id === id ? { ...p, streaming: false, size: "s" } : p)),
      );
      log(target.name, "had their share stopped");
    } else {
      const role: RoomRole = action === "promote" ? "mod" : "member";
      setParticipants((ps) => ps.map((p) => (p.id === id ? { ...p, role } : p)));
      log(target.name, action === "promote" ? "was made a mod" : "is no longer a mod");
    }
  };

  const toggleMute = (id: string) =>
    setMutedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stage = useMemo(() => {
    const base = showViewers ? participants : participants.filter((p) => !p.viewerOnly);
    if (!pinnedId) return base;
    return [
      ...base
        .filter((p) => p.id === pinnedId)
        .map((p) => ({ ...p, pinned: true, viewerOnly: false, size: "l" as const })),
      ...base
        .filter((p) => p.id !== pinnedId)
        .map((p) => (p.size === "l" ? { ...p, size: "m" as const } : p)),
    ];
  }, [participants, showViewers, pinnedId]);

  const leave = () => navigate({ to: "/" });
  const openProfile = (username: string) =>
    navigate({ to: "/profile/$username", params: { username } });

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
            <h1 className="m-0 text-[11.5px] text-fg font-semibold truncate">{detail.name}</h1>
          </nav>
          <div className="flex gap-1.5 items-center flex-shrink-0">
            <Chip className="!bg-surface max-sm:!hidden">
              <Icon.Users size={11} /> {participants.length}/{detail.capacity}
            </Chip>
            <Chip kind="live" dot>
              LIVE · 1h 42m
            </Chip>
            <button
              type="button"
              aria-pressed={showViewers}
              title="Show participants without video"
              className={`inline-flex items-center gap-2 h-7 px-2.5 rounded-lg border text-[11px] whitespace-nowrap cursor-pointer ${showViewers ? "bg-primary-soft border-[color-mix(in_oklch,var(--color-primary)_45%,transparent)] text-primary" : "bg-surface border-border text-fg-muted"}`}
              onClick={() => setShowViewers((v) => !v)}
            >
              <span
                className={`w-3 h-3 rounded-[3px] border grid place-items-center ${showViewers ? "bg-primary border-transparent text-primary-ink" : "border-border-strong"}`}
              >
                {showViewers && <Icon.Check size={10} />}
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
              locallyMuted={mutedIds.has(p.id)}
              reactions={reactions.filter((r) => r.participantId === p.id)}
              onPin={(id) => setPinnedId((cur) => (cur === id ? null : id))}
              onToggleMute={toggleMute}
              onModerate={moderate}
            />
          ))}
        </div>

        <div className="relative flex items-center justify-center gap-2.5 px-[18px] py-3.5 max-sm:px-2 max-sm:py-2.5 bg-canvas border-t border-border-subtle">
          <div className="absolute left-[18px] flex gap-2 max-lg:hidden">
            <Btn variant="ghost" size="sm" title="Room info">
              <Icon.Hash size={12} /> room info
            </Btn>
          </div>

          <div className="flex gap-2 max-sm:gap-1.5 p-1.5 bg-surface border border-border rounded-full shadow-card">
            <ControlBtn
              state={me?.camera ? "active" : "muted"}
              onClick={toggleCam}
              aria-label={me?.camera ? "Turn camera off" : "Turn camera on"}
              aria-pressed={!!me?.camera}
            >
              {me?.camera ? <Icon.Cam size={16} /> : <Icon.CamOff size={16} />}
            </ControlBtn>
            <ControlBtn
              state={me?.muted ? "muted" : "active"}
              onClick={toggleMic}
              aria-label={me?.muted ? "Unmute mic" : "Mute mic"}
              aria-pressed={!me?.muted}
            >
              {me?.muted ? <Icon.MicOff size={16} /> : <Icon.Mic size={16} />}
            </ControlBtn>
            <ControlBtn
              state={me?.streaming ? "active" : undefined}
              onClick={toggleShare}
              disabled={!canStartShare}
              aria-label={me?.streaming ? "Stop sharing" : "Share screen"}
              aria-pressed={!!me?.streaming}
              title={canStartShare ? "Screen share" : `${MAX_STREAMERS} people are already sharing`}
              className="max-sm:hidden"
            >
              <Icon.Screen size={16} />
            </ControlBtn>
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
                    {REACTIONS.map((e) => (
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
          room={detail}
          participants={participants}
          chat={chat}
          activity={activity}
          onSend={send}
          onOpenProfile={openProfile}
          open={sideOpen}
          onClose={() => setSideOpen(false)}
        />
      )}
    </div>
  );
}
