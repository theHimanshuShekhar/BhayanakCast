// UI view models. Shapes mirror what server functions / the realtime socket will return.
import type { UserSettings } from "~/db/settings";
import type { RoomKind } from "./rooms";

export type { RoomKind };

export type ScreenKind = "ableton" | "fl-studio" | "cli" | "browser" | "game";
export type RoomRole = "host" | "mod" | "member";

/** A share on a room card; its screen is a placeholder until thumbnails land (spec #5). */
export type Stream = { user: string; screen: ScreenKind };

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

/** A line in the room chat: someone's message, or a system line (joins and leaves). */
export type ChatMessage =
  | { id: string; system: true; text: string; at: string }
  | {
      id: string;
      system?: false;
      userId: string;
      user: string;
      role: RoomRole;
      text: string;
      /** ISO timestamp, server clock. */
      at: string;
    };

/** The room page's starting view (src/lib/room-view.ts). */
export type RoomDetail = {
  id: string;
  name: string;
  /** Host's username; null only if their account was deleted. */
  host: string | null;
  hostId: string | null;
  capacity: number;
  /** ISO timestamp. */
  createdAt: string;
  participants: Participant[];
};

export type ActivityItem = { who: string; what: string; when: string };

export type Settings = UserSettings;
