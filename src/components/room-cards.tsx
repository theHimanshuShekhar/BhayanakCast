// Room cards + thumbnail mosaic, shared by home, profile and past pages.
// Ported from docs/design/prototype/home.jsx.
import { useEffect, useState } from "react";
import type { LiveRoom, PastRoom, Stream } from "~/lib/types";
import { Icon } from "./icons";
import { Avatar, AvatarStack, Chip, ScreenPlaceholder } from "./ui";

const cardBase =
  "bg-surface border border-border rounded-[var(--radius)] p-3.5 cursor-pointer flex flex-col gap-2.5 min-w-0 text-left";
const cardFoot = "flex items-center pt-2.5 border-t border-dashed border-border-subtle text-muted";

// Mosaic of live screen shares: 1 full · 2 split · 3 hero+stack (ADR 2 caps streamers at 3).
const MOSAIC_GRID: Record<number, string> = {
  1: "grid-cols-1 grid-rows-1",
  2: "grid-cols-2 grid-rows-1",
  3: "grid-cols-2 grid-rows-2 [&>*:first-child]:row-span-2",
};

const pill =
  "inline-flex items-center gap-1 px-2 py-[3px] rounded-full bg-black/55 backdrop-blur-[6px] text-[10px] text-white tracking-[0.04em]";

export const StreamMosaic = ({
  streams,
  cached = false,
  frame = 0,
  freshness,
}: {
  streams: Stream[];
  cached?: boolean;
  frame?: number;
  freshness?: string;
}) => {
  const list = streams.slice(0, 3);
  const n = Math.max(1, list.length);
  return (
    <div className="relative aspect-video rounded-[var(--radius-sm)] overflow-hidden bg-[oklch(0.14_0.02_260)] border border-border-subtle">
      <div
        key={frame}
        className={`absolute inset-0 grid gap-[2px] animate-bc-fade ${MOSAIC_GRID[n]} ${cached ? "saturate-[0.35] brightness-[0.8]" : ""}`}
      >
        {list.map((s) => (
          <div key={s.user} className="relative min-w-0 min-h-0 overflow-hidden">
            <ScreenPlaceholder kind={s.screen} label={false} frame={frame} />
            {n > 1 && (
              <span className="absolute bottom-1.5 left-1.5 z-[2] inline-flex items-center gap-1 max-w-[calc(100%-12px)] pl-0.5 pr-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur-[6px] text-[9.5px] font-semibold text-white">
                <Avatar name={s.user} size="sm" className="!w-3.5 !h-3.5 !text-[6px]" />
                <span className="truncate">{s.user}</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(180deg,oklch(0_0_0/0.35),transparent_35%)]" />
      <div className="absolute top-2 left-2 right-2 z-[3] flex items-start justify-between">
        {cached ? (
          <span className={`${pill} uppercase tracking-[0.08em]`}>ended</span>
        ) : (
          <Chip kind="liveSolid" dot>
            LIVE
          </Chip>
        )}
        <div className="flex flex-col items-end gap-1">
          <span className={pill}>
            <Icon.Screen size={10} /> {n} {n === 1 ? "stream" : "streams"}
          </span>
          {freshness && <span className={`${pill} !text-[9.5px] !text-white/85`}>{freshness}</span>}
        </div>
      </div>
    </div>
  );
};

// Thumbnails refresh every 3 minutes (ADR 10); freshness label ticks every 20s.
const SNAPSHOT_MS = 3 * 60 * 1000;
export const useSnapshots = () => {
  const [frame, setFrame] = useState(0);
  const [at, setAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const snap = setInterval(() => {
      setFrame((f) => f + 1);
      setAt(Date.now());
    }, SNAPSHOT_MS);
    const clock = setInterval(() => setNow(Date.now()), 20000);
    return () => {
      clearInterval(snap);
      clearInterval(clock);
    };
  }, []);
  const mins = Math.max(0, Math.floor((now - at) / 60000));
  return { frame, freshness: mins < 1 ? "updated just now" : `updated ${mins}m ago` };
};

export const LiveCard = ({
  room,
  onOpen,
  snap,
}: {
  room: LiveRoom;
  onOpen: (room: LiveRoom) => void;
  snap?: { frame: number; freshness: string };
}) => {
  const viewers = room.members.length - 1;
  return (
    <button
      type="button"
      aria-label={`Join ${room.name}`}
      onClick={() => onOpen(room)}
      className={`${cardBase} shadow-pop transition-[transform,border-color] duration-[160ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklch,var(--color-primary)_40%,var(--color-border))]`}
    >
      <StreamMosaic streams={room.streams} frame={snap?.frame} freshness={snap?.freshness} />
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[15px] font-bold tracking-[-0.005em] truncate">{room.name}</span>
        {room.isPrivate && (
          <span className="text-muted" title="private room">
            <Icon.Lock size={12} />
          </span>
        )}
      </div>
      <div className="flex items-center gap-2.5 w-full">
        <AvatarStack names={room.members} max={4} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold">{room.streamer}</div>
          <div className="text-[10.5px] text-muted">
            Host · {viewers} viewer{viewers === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <div className={`${cardFoot} gap-3 text-[11px] w-full`}>
        <span className="inline-flex items-center gap-1.5">
          <Icon.Users size={12} /> {room.viewers}/{room.capacity}
        </span>
        <span className="inline-flex items-center gap-1.5 text-success">
          <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_6px_var(--color-success)]" />{" "}
          Streaming
        </span>
      </div>
    </button>
  );
};

export const PastCard = ({
  room,
  onOpen,
}: {
  room: PastRoom;
  onOpen: (room: PastRoom) => void;
}) => (
  <button
    type="button"
    aria-label={`View recap of ${room.name}`}
    onClick={() => onOpen(room)}
    className={`${cardBase} shadow-card transition-[transform,border-color] duration-[120ms] hover:-translate-y-px hover:border-border-strong`}
  >
    <StreamMosaic streams={room.streams} cached freshness={`cached · ${room.cachedAgo}`} />
    <div className="text-[13.5px] font-semibold">{room.name}</div>
    <div className="flex items-center gap-2.5 w-full">
      <AvatarStack names={room.members} max={3} size="md" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold">{room.members.length} joined</div>
        <div className="text-[10.5px] text-muted">Stream participants</div>
      </div>
    </div>
    <div className={`${cardFoot} gap-2.5 text-[10.5px] w-full`}>
      <span className="inline-flex items-center gap-1">
        <Icon.Users size={11} /> {room.members.length} joined
      </span>
      <span className="inline-flex items-center gap-1">
        <Icon.Eye size={11} /> Ended · {room.started}
      </span>
    </div>
  </button>
);
