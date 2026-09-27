// UI view models. Shapes mirror what server functions / the realtime socket will return.
import type { UserSettings } from "~/db/settings";
import type { RoomKind } from "./rooms";

export type { RoomKind };

export type ScreenKind = "ableton" | "fl-studio" | "cli" | "browser" | "game";
export type RoomRole = "host" | "mod" | "member";

export type Stream = { user: string; screen: ScreenKind };

export type LiveRoom = {
  id: string;
  name: string;
  streamer: string;
  viewers: number;
  capacity: number;
  tags: string[];
  kind: RoomKind;
  started: string;
  members: string[];
  streams: Stream[];
  isPrivate?: boolean;
  /** Host's user id when the host isn't a mock user (a room created in the UI). */
  hostId?: string;
};

export type PastRoom = {
  id: string;
  name: string;
  streamer: string;
  started: string;
  members: string[];
  streams: Stream[];
  cachedAgo: string;
};

export type Participant = {
  id: string;
  userId: string;
  name: string;
  role: RoomRole;
  streaming: boolean;
  speaking: boolean;
  muted: boolean;
  camera: boolean;
  size?: "l" | "m" | "s";
  screen?: ScreenKind;
  viewerOnly?: boolean;
  pinned?: boolean;
  you?: boolean;
};

export type ChatMessage =
  | { id: string; system: true; text: string }
  | { id: string; system?: false; user: string; role: RoomRole; ts: string; text: string };

export type RoomDetail = {
  id: string;
  name: string;
  host: string;
  hostId: string;
  capacity: number;
  participants: Participant[];
  chat: ChatMessage[];
};

export type ActivityItem = { who: string; what: string; when: string };

export type UserStats = {
  hoursStreamed: number;
  hoursWatched: number;
  roomsHosted: number;
  roomsJoined: number;
  peakViewers: number;
};

export type UserProfile = {
  id: string;
  username: string;
  discord: string;
  joined: string;
  stats: UserStats;
};

export type CoUser = { username: string; seconds: number };

export type AllTimeRoom = {
  id: string;
  name: string;
  streamer: string;
  peak: number;
  joined: number;
  duration: string;
  status: "live" | "ended";
  ended: string | null;
};

export type UserGrowthPoint = { date: string; new_users: number; cumulative: number };
export type RoomActivityPoint = { date: string; created: number; ended: number };

export type Settings = UserSettings;
