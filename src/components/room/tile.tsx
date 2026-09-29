// Stage tile — screen share / camera / viewer-only. Ported from docs/design/prototype/room.jsx.
import { Menu } from "@base-ui/react/menu";
import { type CSSProperties, useRef } from "react";
import { avatarFor } from "~/lib/format";
import type { Participant, RoomRole, Settings } from "~/lib/types";
import { Icon } from "../icons";
import { Avatar, Chip, ScreenPlaceholder, Wave } from "../ui";

/** A reaction floating up the tile, drifting `dx` pixels sideways. */
export type Reaction = { id: string; emoji: string; dx: number };

const tileSpanDesktop = (p: Participant, layout: Settings["layout"], small: boolean) => {
  if (small) return "col-span-2 row-span-1";
  if (layout === "grid") return "col-span-3 row-span-2";
  if (layout === "spotlight")
    return p.size === "l" ? "col-span-8 row-span-4" : "col-span-4 row-span-2";
  return (
    { l: "col-span-6 row-span-3", m: "col-span-4 row-span-2", s: "col-span-3 row-span-2" }[
      p.size ?? "m"
    ] ?? "col-span-4 row-span-2"
  );
};

// phones/tablets: 2-col grid — hero tiles full width, others half
const tileSpan = (p: Participant, layout: Settings["layout"]) => {
  const small = !!p.viewerOnly;
  const m = small
    ? " max-md:col-span-1 max-md:row-span-1"
    : p.size === "l"
      ? " max-md:col-span-2 max-md:row-span-2"
      : " max-md:col-span-1 max-md:row-span-2";
  return tileSpanDesktop(p, layout, small) + m;
};

const tileBase =
  "@container group relative bg-surface border border-border rounded-[var(--radius)] overflow-hidden flex flex-col min-w-0 min-h-0";
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

export const Tile = ({
  p,
  layout,
  myRole,
  admin = false,
  locallyMuted,
  reactions,
  onPin,
  onToggleMute,
  onModerate,
}: {
  p: Participant;
  layout: Settings["layout"];
  myRole: RoomRole;
  /** The viewer is a site admin: moderation in any room. */
  admin?: boolean;
  locallyMuted: boolean;
  reactions: Reaction[];
  onPin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onModerate: (id: string, action: ModAction) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const span = tileSpan(p, layout);

  if (p.viewerOnly) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a tile groups one person's view, not a form
      <div role="group" aria-label={displayName(p)} className={`${tileBase} ${span} shadow-pop`}>
        <div className="flex items-center gap-2.5 px-3 py-2.5 h-full">
          <Avatar name={p.name} size="md" ring={p.speaking} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate">{displayName(p)}</div>
            <div className="text-[10.5px] text-muted">viewer</div>
          </div>
          <div className="text-muted">
            {p.muted ? <Icon.MicOff size={14} /> : <Icon.Mic size={14} />}
          </div>
        </div>
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

  return (
    // biome-ignore lint/a11y/useSemanticElements: a tile groups one person's view, not a form
    <div
      ref={ref}
      role="group"
      aria-label={displayName(p)}
      className={`${tileBase} ${span} ${ring}`}
    >
      {p.streaming ? (
        <ScreenPlaceholder kind={p.screen ?? "browser"} />
      ) : (
        <div className="flex-1 relative min-h-0 overflow-hidden grid place-items-center bg-[oklch(0.22_0.02_260)]">
          <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,oklch(0.26_0.02_260)_0,oklch(0.26_0.02_260)_12px,oklch(0.20_0.02_260)_12px,oklch(0.20_0.02_260)_24px)]" />
          <div className="relative z-[1] flex flex-col items-center gap-2.5">
            <Avatar name={p.name} size="lg" ring={p.speaking} />
            <div className="text-[10px] tracking-[0.14em] px-2 py-[3px] rounded-full text-[oklch(0.85_0.01_260)] bg-black/45 border border-white/12">
              {p.camera ? "CAM · NO SHARE" : "AUDIO ONLY"}
            </div>
          </div>
        </div>
      )}

      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(180deg,oklch(0_0_0/0)_40%,oklch(0_0_0/0.55))]" />

      <div className="absolute top-2.5 left-2.5 z-[3] flex gap-1.5">
        {p.streaming && (
          <Chip kind="liveSolid" dot>
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
          aria-label={p.pinned ? "Unpin" : "Pin"}
          title={p.pinned ? "Unpin" : "Pin"}
          onClick={() => onPin(p.id)}
        >
          <Icon.Pin size={14} />
        </button>
        {!p.you && (
          <button
            type="button"
            className={overlayBtn}
            aria-label={locallyMuted ? "Unmute for me" : "Mute for me"}
            aria-pressed={locallyMuted}
            title={locallyMuted ? "Unmute for me" : "Mute for me"}
            onClick={() => onToggleMute(p.id)}
          >
            {locallyMuted ? <Icon.MicOff size={14} /> : <Icon.Headset size={14} />}
          </button>
        )}
        <button
          type="button"
          className={overlayBtn}
          aria-label="Fullscreen"
          title="Fullscreen"
          onClick={() => ref.current?.requestFullscreen?.()}
        >
          <Icon.Maximize size={14} />
        </button>
        {canModerate && (
          <Menu.Root>
            <Menu.Trigger className={overlayBtn} aria-label={`Moderate ${p.name}`}>
              <Icon.More size={14} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                side="bottom"
                align="end"
                sideOffset={6}
                className="z-[160] outline-0"
              >
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
                        <Icon.Leave size={13} /> kick from room
                      </Menu.Item>
                    </>
                  )}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
      </div>

      {p.streaming && p.camera && (
        <div
          className="absolute bottom-2.5 right-2.5 z-[3] w-14 aspect-[4/3] hidden @[300px]:grid rounded-lg overflow-hidden border border-border-strong shadow-pop place-items-center"
          style={{ background: `linear-gradient(135deg, ${av.c1}, ${av.c2})` }}
        >
          <Avatar name={p.name} size="sm" />
        </div>
      )}

      <div
        className={`absolute bottom-2.5 left-2.5 z-[3] ${p.camera ? "right-2.5 @[300px]:right-[76px]" : "right-2.5"} flex items-center gap-2`}
      >
        <span
          className={`inline-flex items-center gap-2 max-w-full py-[5px] pl-[5px] pr-[9px] rounded-full text-[11px] font-semibold truncate ${glassPill}`}
        >
          <Avatar name={p.name} size="sm" />
          <span className="inline-flex items-center gap-1.5">
            {displayName(p)}
            {p.speaking ? <Wave on /> : p.muted ? <Icon.MicOff size={12} /> : null}
          </span>
        </span>
      </div>

      <FloatingReactions reactions={reactions} />
    </div>
  );
};

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
