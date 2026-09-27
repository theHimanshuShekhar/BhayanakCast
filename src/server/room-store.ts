/**
 * The room hub's persistence port: every read and durable write the realtime server makes
 * (ADRs 4, 12). The hub (./room-hub.ts) depends on the `RoomStore` interface only;
 * `createDbRoomStore` is the Postgres implementation, used in production and in the
 * protocol tests (on PGlite).
 *
 * Later tickets grow this port rather than touching the DB from the hub: host intervals and
 * `rooms.hostUserId` (host lifecycle), stream intervals (media state), `lastEmptyAt`, room end
 * and `rollupEndedRoom` (room ending), `room_members` roles and kicks (moderation), live rooms
 * on boot and `last_seen_at` checkpoints (restart recovery).
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { presenceIntervals, roomMembers, rooms } from "../db/schema/index.ts";
import type { RoomRole } from "../lib/realtime.ts";
import type { SignedInCaller } from "./caller.ts";
import { roomVisibleTo } from "./visibility.ts";

/** A live room as the hub needs it when someone joins. */
export interface StoredRoom {
  id: string;
  hostUserId: string | null;
  /** Room roles other than plain member, by user id (`room_members`). */
  roles: Map<string, Exclude<RoomRole, "member">>;
}

export interface RoomStore {
  /** The live room `roomId` if `caller` may enter it; null if unknown, ended or hidden (ADR 16). */
  findRoomFor(caller: SignedInCaller, roomId: string): Promise<StoredRoom | null>;
  /**
   * Open a presence interval for `userId` in `roomId` at `at`. An interval left open by a crash
   * (or anything else) is closed at its last-seen checkpoint first (ADR 12).
   */
  openPresence(roomId: string, userId: string, at: Date): Promise<void>;
  /** Close the user's open presence interval in `roomId` at `at`, if there is one. */
  closePresence(roomId: string, userId: string, at: Date): Promise<void>;
}

export function createDbRoomStore(db: Db): RoomStore {
  return {
    async findRoomFor(caller, roomId) {
      const [room] = await db
        .select({ id: rooms.id, hostUserId: rooms.hostUserId })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), isNull(rooms.endedAt), roomVisibleTo(caller)));
      if (!room) return null;
      const members = await db
        .select({ userId: roomMembers.userId, role: roomMembers.role })
        .from(roomMembers)
        .where(and(eq(roomMembers.roomId, roomId), ne(roomMembers.role, "member")));
      const roles: StoredRoom["roles"] = new Map();
      for (const { userId, role } of members) if (role !== "member") roles.set(userId, role);
      return { ...room, roles };
    },

    async openPresence(roomId, userId, at) {
      await db.transaction(async (tx) => {
        const open = and(
          eq(presenceIntervals.roomId, roomId),
          eq(presenceIntervals.userId, userId),
          isNull(presenceIntervals.endedAt),
        );
        await tx
          .update(presenceIntervals)
          .set({ endedAt: sql`${presenceIntervals.lastSeenAt}` })
          .where(open);
        await tx
          .insert(presenceIntervals)
          .values({ roomId, userId, startedAt: at, lastSeenAt: at });
      });
    },

    async closePresence(roomId, userId, at) {
      await db
        .update(presenceIntervals)
        .set({ endedAt: at, lastSeenAt: at })
        .where(
          and(
            eq(presenceIntervals.roomId, roomId),
            eq(presenceIntervals.userId, userId),
            isNull(presenceIntervals.endedAt),
          ),
        );
    },
  };
}
