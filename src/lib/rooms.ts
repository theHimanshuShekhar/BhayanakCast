/**
 * Rooms, client-safe half: the create-room input schema and the views the room
 * server functions return. No server-only imports, so both the UI and the server
 * (src/server/rooms.ts) use it.
 */
import { z } from "zod";

export const ROOM_KINDS = ["gaming", "code", "music", "art", "watch", "chat"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export const ROOM_NAME_MAX = 60;
export const ROOM_DESCRIPTION_MAX = 280;
export const ROOM_TAGS_MAX = 10;
const TAG = /^[a-z0-9][a-z0-9-]{0,23}$/;

/** What the create dialog sends. The host is always the caller, never part of the input. */
export const createRoomInput = z.object({
  name: z.string().trim().min(1, "Name the room").max(ROOM_NAME_MAX),
  kind: z.enum(ROOM_KINDS),
  tags: z
    .array(z.string().trim().toLowerCase().regex(TAG, "Tags are lowercase words or dashes"))
    .max(ROOM_TAGS_MAX)
    .transform((tags) => [...new Set(tags)]),
  description: z.string().trim().max(ROOM_DESCRIPTION_MAX).default(""),
  isPrivate: z.boolean().default(false),
});
export type CreateRoomInput = z.input<typeof createRoomInput>;

export const roomIdInput = z.object({ roomId: z.string().min(1).max(64) });

export interface RoomPerson {
  id: string;
  username: string;
}

/** A live room as listed on home ("Live Now", search, "Filling Up"). */
export interface LiveRoomCard {
  id: string;
  name: string;
  description: string;
  kind: RoomKind;
  tags: string[];
  isPrivate: boolean;
  /** Null only if the host's account was deleted. */
  host: RoomPerson | null;
  /** People in the room now (open presence intervals). */
  participants: RoomPerson[];
  participantCount: number;
  capacity: number;
  /** People sharing their screen now (open stream intervals). */
  streamers: RoomPerson[];
  streamCount: number;
  /** ISO timestamp. */
  createdAt: string;
}

/** The room page's header data. Participants and chat come from the socket (spec #3). */
export interface RoomSummary {
  id: string;
  name: string;
  description: string;
  kind: RoomKind;
  tags: string[];
  isPrivate: boolean;
  host: RoomPerson | null;
  capacity: number;
  createdAt: string;
}
