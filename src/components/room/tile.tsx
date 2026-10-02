// Stage tile — screen share / camera / viewer-only. Ported from docs/design/prototype/room.jsx.
import { Menu } from "@base-ui/react/menu";
import { type CSSProperties, useRef } from "react";
import { avatarFor } from "~/lib/format";
import type { Participant, RoomRole } from "~/lib/types";
import { Icon } from "../icons";
import { Avatar, Btn, Chip, ScreenPlaceholder, Wave } from "../ui";
import { CameraVideo } from "./camera-video";
import { ScreenVideo } from "./screen-video";

/** A reaction floating up the tile, drifting `dx` pixels sideways. */
export type Reaction = { id: string; emoji: string; dx: number };

const tileBase =
  "@container group relative bg-surface border border-border rounded-[var(--radius)] overflow-hidden flex flex-col min-w-0 min-h-0 animate-bc-enter transition-shadow duration-200";
const glassPill = "bg-black/55 backdrop-blur-[8px] text-white";
const overlayBtn =
  "w-[26px] h-[26px] inline-flex items-center justify-center rounded-[var(--radius-sm)] text-white cursor-pointer hover:bg-white/20 transition-colors data-popup-open:bg-white/20";
const menuItem =
  "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11.5px] text-fg-muted outline-0 cursor-pointer data-highlighted:bg-surface-2 data-highlighted:text-fg";

export type ModAction = "kick" | "stopShare" | "promote" | "demote";

const RANK: Record<RoomRole, number> = { member: 0, mod: 1, host: 2 };

/** The host, a mod or an admin: kicks, stops shares and, in a private room, admits (ADRs 15, 16). */
export const isModerator = (myRole: RoomRole, admin: boolean) =>
  admin || myRole === "host" || myRole === "mod";

/**
 * What the viewer (`myRole`, `admin`) may do to `p` (ADR 15; the server decides): host and mods
 * act on people below them, only the host changes roles, and an admin may do it all to anyone.
 */
export const moderationFor = (p: Participant, myRole: RoomRole, admin: boolean) => {
  const any = !p.you && (admin || RANK[myRole] > RANK[p.role]);
  const moderator = isModerator(myRole, admin);
  return {
    kick: any && moderator,
    stopShare: any && moderator && p.streaming,
    setRole: any && (admin || myRole === "host") && p.role !== "host",
  };
};

const displayName = (p: Participant) => (p.you ? `${p.name} (you)` : p.name);

/**
 * How the stage shows someone (DESIGN.md "Stage"): their screen in the screen zone, their camera
 * in the camera row, or a compact chip when they have neither on.
 */
export type TileVariant = "screen" | "camera" | "chip";

export const Tile = ({
  p,
  variant,
  className = "",
  myRole,
  admin = false,
  locallyMuted,
  volume = 1,
  cameraTrack,
  onCameraShown,
  screenTrack,
  shareVolume = 1,
  onShareVolume,
  reactions,
  onPin,
  onToggleMute,
  onVolume,
  onModerate,
  cantConnect = false,
  onRetry,
}: {
  p: Participant;
  variant: TileVariant;
  /** Placement on the stage (grid spans, size). */
  className?: string;
  myRole: RoomRole;
  /** The viewer is a site admin: moderation in any room. */
  admin?: boolean;
  locallyMuted: boolean;
  /** How loud this person plays here, 0–1 (the viewer's own setting). */
  volume?: number;
  /** Their camera (yours: the local one), shown while `p.camera`. */
  cameraTrack?: MediaStreamTrack | null;
  /** Stable: whether a peer's camera is on screen here (unshown ones are paused towards us). */
  onCameraShown?: (userId: string, shown: boolean) => void;
  /** Their screen share (yours: your capture), shown while `p.streaming`. */
  screenTrack?: MediaStreamTrack | null;
  /** How loud their share's audio plays here, 0–1 (the viewer's own setting). */
  shareVolume?: number;
  /** Set when their share has audio: the share volume control. */
  onShareVolume?: (id: string, volume: number) => void;
  reactions: Reaction[];
  onPin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onVolume?: (id: string, volume: number) => void;
  onModerate: (id: string, action: ModAction) => void;
  /** This page's connection to them failed, even after an ICE restart (ADR 3). */
  cantConnect?: boolean;
  /** Try connecting to them again. */
  onRetry?: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const cantConnectState = cantConnect && <CantConnect name={p.name} onRetry={onRetry} />;

  if (variant === "chip") {
    // Someone with neither a share nor a camera on: a compact chip, so screens keep the stage.
    return (
      // biome-ignore lint/a11y/useSemanticElements: a tile groups one person's view, not a form
      <div
        role="group"
        aria-label={displayName(p)}
        className={`group relative inline-flex items-center gap-2 min-w-0 max-w-[220px] h-10 pl-1.5 pr-3 rounded-full bg-surface border transition-[border-color,box-shadow] duration-200 animate-bc-enter ${p.speaking ? "border-primary shadow-[0_0_0_1px_var(--color-primary),0_0_14px_var(--color-primary-glow)]" : "border-border"} ${className}`}
      >
        {cantConnectState}
        <Avatar name={p.name} image={p.image} size="md" />
        <span className="text-xs font-semibold truncate">{displayName(p)}</span>
        {p.role !== "member" && (
          <span className="text-[10px] uppercase tracking-[0.06em] text-muted">{p.role}</span>
        )}
        <span className="text-muted shrink-0" title={p.muted ? "mic off" : "mic on"}>
          {p.speaking ? <Wave on /> : p.muted ? <Icon.MicOff size={13} /> : <Icon.Mic size={13} />}
        </span>
        {!p.you && (
          // Their controls, above the chip on hover or keyboard focus (like a tile's overlay).
          // Above: chips sit at the stage's bottom, so below would overflow and scroll it.
          <div className="absolute left-0 bottom-full z-[20] pb-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto has-data-popup-open:opacity-100 has-data-popup-open:pointer-events-auto transition-opacity duration-150">
            <div
              className={`flex items-center gap-1 p-[3px] rounded-[10px] border border-white/14 ${glassPill}`}
            >
              <button
                type="button"
                className={overlayBtn}
                aria-label={`${locallyMuted ? "Unmute for me" : "Mute for me"}: ${p.name}`}
                aria-pressed={locallyMuted}
                title={locallyMuted ? "Unmute for me" : "Mute for me"}
                onClick={() => onToggleMute(p.id)}
              >
                {locallyMuted ? <Icon.MicOff size={14} /> : <Icon.Headset size={14} />}
              </button>
              {onVolume && (
                <label className="inline-flex items-center gap-1 pl-1" title="their voice, for me">
                  <Icon.Mic size={12} aria-hidden="true" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    aria-label={`Volume for ${p.name}`}
                    onChange={(e) => onVolume(p.id, Number(e.target.value))}
                    className="w-14 h-[26px] cursor-pointer accent-white"
                  />
                </label>
              )}
              <ModerateMenu
                p={p}
                myRole={myRole}
                admin={admin}
                onModerate={onModerate}
                triggerClassName={overlayBtn}
              />
            </div>
          </div>
        )}
        <FloatingReactions reactions={reactions} />
      </div>
    );
  }

  const ring = p.speaking
    ? "shadow-[var(--shadow-pop),0_0_0_2px_var(--color-primary),0_0_24px_var(--color-primary-glow)]"
    : p.streaming
      ? "shadow-[var(--shadow-pop),0_0_0_1px_color-mix(in_oklch,var(--color-live)_40%,transparent),0_0_26px_color-mix(in_oklch,var(--color-live)_25%,transparent)]"
      : "shadow-pop";

  const can = moderationFor(p, myRole, admin);
  const canModerate = can.kick || can.stopShare || can.setRole;
  const av = avatarFor(p.name);
  const camera = p.camera && cameraTrack && (
    <CameraVideo
      userId={p.userId}
      name={p.name}
      track={cameraTrack}
      mirrored={p.you}
      onShown={p.you ? undefined : onCameraShown}
    />
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: a tile groups one person's view, not a form
    <div
      ref={ref}
      role="group"
      aria-label={displayName(p)}
      className={`${tileBase} ${className} ${ring}`}
    >
      {variant === "screen" && p.streaming ? (
        // Mounted when the share starts, so the screen switches on each time (DESIGN.md motion).
        <div className="flex-1 relative min-h-0 flex flex-col animate-bc-power-on">
          {screenTrack ? (
            <ScreenVideo userId={p.userId} name={p.name} track={screenTrack} />
          ) : (
            <ScreenPlaceholder kind={p.screen ?? "browser"} />
          )}
        </div>
      ) : camera ? (
        <div className="flex-1 relative min-h-0 overflow-hidden bg-black">{camera}</div>
      ) : (
        // Their camera is on but its picture hasn't arrived yet (or a pinned chip).
        <div className="flex-1 relative min-h-0 overflow-hidden grid place-items-center bg-[oklch(0.22_0.02_260)]">
          <Avatar name={p.name} image={p.image} size="lg" ring={p.speaking} />
        </div>
      )}

      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(180deg,oklch(0_0_0/0)_40%,oklch(0_0_0/0.55))]" />

      <div className="absolute top-2.5 left-2.5 z-[3] flex gap-1.5">
        {p.streaming && (
          <Chip kind="liveSolid" dot className="animate-bc-enter [animation-delay:260ms]">
            LIVE
          </Chip>
        )}
        {p.role === "host" && <Chip kind="accent">host</Chip>}
        {p.role === "mod" && (
          <Chip className="!bg-black/55 !text-white !border-transparent">mod</Chip>
        )}
        {p.pinned && (
          <Chip className="!bg-black/55 !text-white !border-transparent">
            <Icon.Pin size={10} /> pinned
          </Chip>
        )}
      </div>

      <div
        className={`absolute top-2.5 right-2.5 z-[4] flex gap-1 p-[3px] rounded-[10px] border border-white/14 opacity-0 -translate-y-1 transition-[opacity,transform] duration-[160ms] group-hover:opacity-100 group-hover:translate-y-0 focus-within:opacity-100 focus-within:translate-y-0 has-data-popup-open:opacity-100 has-data-popup-open:translate-y-0 ${glassPill}`}
      >
        <button
          type="button"
          className={overlayBtn}
          aria-label={`${p.pinned ? "Unpin" : "Pin"} ${p.name}`}
          title={p.pinned ? "Unpin" : "Pin"}
          onClick={() => onPin(p.id)}
        >
          <Icon.Pin size={14} />
        </button>
        {!p.you && (
          <button
            type="button"
            className={overlayBtn}
            aria-label={`${locallyMuted ? "Unmute for me" : "Mute for me"}: ${p.name}`}
            aria-pressed={locallyMuted}
            title={locallyMuted ? "Unmute for me" : "Mute for me"}
            onClick={() => onToggleMute(p.id)}
          >
            {locallyMuted ? <Icon.MicOff size={14} /> : <Icon.Headset size={14} />}
          </button>
        )}
        {!p.you && onVolume && (
          <label className="inline-flex items-center gap-1 pl-1" title="their voice, for me">
            <Icon.Mic size={12} aria-hidden="true" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label={`Volume for ${p.name}`}
              onChange={(e) => onVolume(p.id, Number(e.target.value))}
              className="w-14 h-[26px] cursor-pointer accent-white"
            />
          </label>
        )}
        {!p.you && p.streaming && onShareVolume && (
          <label
            className="inline-flex items-center gap-1 pl-1"
            title="their screen's sound, for me"
          >
            <Icon.Screen size={12} aria-hidden="true" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={shareVolume}
              aria-label={`Share volume for ${p.name}`}
              onChange={(e) => onShareVolume(p.id, Number(e.target.value))}
              className="w-14 h-[26px] cursor-pointer accent-white"
            />
          </label>
        )}
        <button
          type="button"
          className={overlayBtn}
          aria-label={`Fullscreen ${p.name}`}
          title="Fullscreen"
          onClick={() => ref.current?.requestFullscreen?.()}
        >
          <Icon.Maximize size={14} />
        </button>
        {canModerate && (
          <ModerateMenu
            p={p}
            myRole={myRole}
            admin={admin}
            onModerate={onModerate}
            triggerClassName={overlayBtn}
          />
        )}
      </div>

      {p.streaming && p.camera && (
        <div
          className="absolute bottom-2.5 right-2.5 z-[3] w-14 aspect-[4/3] hidden @[300px]:grid rounded-lg overflow-hidden border border-border-strong shadow-pop place-items-center"
          style={{ background: `linear-gradient(135deg, ${av.c1}, ${av.c2})` }}
        >
          {camera || <Avatar name={p.name} image={p.image} size="sm" />}
        </div>
      )}

      <div
        className={`absolute bottom-2.5 left-2.5 z-[3] ${p.camera ? "right-2.5 @[300px]:right-[76px]" : "right-2.5"} flex items-center gap-2`}
      >
        <span
          className={`inline-flex items-center gap-2 max-w-full py-[5px] pl-[5px] pr-[9px] rounded-full text-[11px] font-semibold truncate ${glassPill}`}
        >
          <Avatar name={p.name} image={p.image} size="sm" />
          <span className="inline-flex items-center gap-1.5">
            {displayName(p)}
            {p.speaking ? <Wave on /> : p.muted ? <Icon.MicOff size={12} /> : null}
          </span>
        </span>
      </div>

      {cantConnectState}
      <FloatingReactions reactions={reactions} />
    </div>
  );
};

/** Over a tile whose connection failed: say so, with a retry (under the chips and controls). */
const CantConnect = ({ name, onRetry }: { name: string; onRetry?: () => void }) => (
  <div
    role="alert"
    className="absolute inset-0 z-[2] flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 p-2 text-center bg-black/70 text-white text-[11.5px] font-medium"
  >
    <span>can't connect to {name}</span>
    {onRetry && (
      <Btn size="sm" onClick={onRetry}>
        retry
      </Btn>
    )}
  </div>
);

const FloatingReactions = ({ reactions }: { reactions: Reaction[] }) =>
  reactions.map((r) => (
    <span
      key={r.id}
      role="img"
      aria-label={`reaction ${r.emoji}`}
      className="absolute bottom-4 left-1/2 z-[5] text-[22px] pointer-events-none animate-bc-float drop-shadow-[0_0_8px_var(--color-primary-glow)]"
      style={{ "--dx": `${r.dx}px` } as CSSProperties}
    >
      {r.emoji}
    </span>
  ));

/**
 * What a host, mod or admin can do to `p` (ADR 15): stop their share, change their role, kick
 * them. A kick asks first (the room page confirms it). On tiles and in the people tab.
 */
export const ModerateMenu = ({
  p,
  myRole,
  admin,
  onModerate,
  triggerClassName,
}: {
  p: Participant;
  myRole: RoomRole;
  admin: boolean;
  onModerate: (id: string, action: ModAction) => void;
  triggerClassName: string;
}) => {
  const can = moderationFor(p, myRole, admin);
  if (!(can.kick || can.stopShare || can.setRole)) return null;
  return (
    <Menu.Root>
      <Menu.Trigger className={triggerClassName} aria-label={`Moderate ${p.name}`}>
        <Icon.More size={14} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-[160] outline-0">
          <Menu.Popup className="min-w-[170px] p-1 bg-surface border border-border-strong rounded-[var(--radius-sm)] shadow-deep outline-0">
            {can.stopShare && (
              <Menu.Item className={menuItem} onClick={() => onModerate(p.id, "stopShare")}>
                <Icon.Screen size={13} /> stop their share
              </Menu.Item>
            )}
            {can.setRole && (
              <Menu.Item
                className={menuItem}
                onClick={() => onModerate(p.id, p.role === "mod" ? "demote" : "promote")}
              >
                <Icon.Sparkle size={13} /> {p.role === "mod" ? "remove mod" : "make mod"}
              </Menu.Item>
            )}
            {can.kick && (
              <>
                <Menu.Separator className="h-px bg-border-subtle my-1" />
                <Menu.Item
                  className={`${menuItem} !text-live-ink`}
                  onClick={() => onModerate(p.id, "kick")}
                >
                  <Icon.Leave size={13} /> kick from room…
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};
