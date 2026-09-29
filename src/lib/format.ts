import type { ScreenKind } from "./types";

const AVATARS = [
  { c1: "oklch(0.85 0.18 85)", c2: "oklch(0.7 0.2 30)" },
  { c1: "oklch(0.8 0.17 220)", c2: "oklch(0.65 0.2 280)" },
  { c1: "oklch(0.82 0.2 145)", c2: "oklch(0.7 0.18 190)" },
  { c1: "oklch(0.82 0.19 20)", c2: "oklch(0.7 0.17 350)" },
  { c1: "oklch(0.82 0.17 305)", c2: "oklch(0.7 0.2 250)" },
  { c1: "oklch(0.85 0.15 65)", c2: "oklch(0.75 0.15 120)" },
  { c1: "oklch(0.75 0.18 180)", c2: "oklch(0.65 0.18 240)" },
  { c1: "oklch(0.85 0.15 45)", c2: "oklch(0.65 0.2 15)" },
] as const;

export const avatarFor = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length] ?? AVATARS[0];
};

export const initials = (name: string) => {
  const parts = name
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return "??";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
};

const DISCORD_CDN = "cdn.discordapp.com";

/**
 * The URL to load for someone's stored Discord picture at `px` pixels a side, or null when
 * there is none we may load. Only Discord's own CDN is used (https, that host, no credentials):
 * a picture is shown to everyone who sees the person, so any other URL would let its owner log
 * their viewers' IPs. Discord serves the picture at the `size` asked for, so the rail doesn't
 * pull the 1024px original.
 */
export const discordAvatarUrl = (image: string | null | undefined, px: number): string | null => {
  if (!image) return null;
  let url: URL;
  try {
    url = new URL(image);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== DISCORD_CDN) return null;
  if (url.username || url.password || url.port) return null;
  url.hash = "";
  url.searchParams.set("size", String(px));
  return url.toString();
};

export const formatCotime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (h < 10) return `${h}h ${m}m`;
  return `${h}h`;
};

/** Minutes as "0m", "<1m", "45m", "2h", "1h 5m". */
export const fmtMins = (mins: number) => {
  const m = Math.round(mins);
  if (m <= 0) return mins > 0 ? "<1m" : "0m";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
};

/** "just now", "12m ago", "3h ago", "4d ago" for an ISO timestamp in the past. */
export const fmtAgo = (iso: string, now: number = Date.now()) => {
  const mins = Math.floor(Math.max(0, now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const SCREEN_KINDS: Record<ScreenKind, { label: string; hue: number }> = {
  ableton: { label: "ABLETON LIVE 12", hue: 220 },
  "fl-studio": { label: "FL STUDIO 24", hue: 305 },
  cli: { label: "TERMINAL — cargo run", hue: 145 },
  browser: { label: "CHROMIUM — figma.com", hue: 30 },
  game: { label: "GAME CAPTURE", hue: 0 },
};

export const ACCENTS = [
  { h: 265, name: "violet" },
  { h: 190, name: "cyan" },
  { h: 145, name: "lime" },
  { h: 85, name: "amber" },
  { h: 30, name: "coral" },
  { h: 310, name: "magenta" },
] as const;

export const ROOM_CAPACITY = 10;
export const MAX_STREAMERS = 3;
