// UI view models. Shapes mirror what server functions / the realtime socket will return.

export type ScreenKind = "ableton" | "fl-studio" | "cli" | "browser" | "game";
export type RoomKind = "gaming" | "code" | "music" | "art" | "watch" | "chat";
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

export type Settings = {
  theme: "dark" | "light";
  accentHue: number;
  radius: number;
  density: "compact" | "comfortable" | "spacious";
  layout: "mosaic" | "grid" | "spotlight";
  showChat: boolean;
};
