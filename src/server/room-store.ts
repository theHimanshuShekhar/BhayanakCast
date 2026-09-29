/**
 * The room hub's persistence port: every read and durable write the realtime server makes
 * (ADRs 4, 12). The hub (./room-hub.ts) depends on the `RoomStore` interface only;
 * `createDbRoomStore` is the Postgres implementation, used in production and in the
 * protocol tests (on PGlite).
 *
 * Later tickets grow this port rather than touching the DB from the hub: host intervals and
 * `rooms.hostUserId` (host lifecycle), stream intervals (media state: `openStream`,
 * `closeStream`, `checkpointStreams`), `lastEmptyAt`, room end
 * and `rollupEndedRoom` (room ending: `markRoomEmpty`, `markRoomOccupied`, `endRoom`,
 * `rollupEndedRoom`), `room_members` roles and kicks (moderation), live rooms
 * on boot and `last_seen_at` checkpoints (restart recovery: `loadLiveRooms`,
 * `checkpointPresence`).
 */
import { and, asc, eq, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  hostIntervals,
  presenceIntervals,
  roomMembers,
  rooms,
  streamIntervals,
  user,
} from "../db/schema/index.ts";
import type { RoomRole } from "../lib/realtime.ts";
import type { SignedInCaller } from "./caller.ts";
import { rollupEndedRoom } from "./stats.ts";
import { roomVisibleTo } from "./visibility.ts";

/** A live room as the hub needs it when someone joins. */
export interface StoredRoom {
  id: string;
  name: string;
  hostUserId: string | null;
  /** Private rooms never reach the lobby channel (ADR 20). */
  isPrivate: boolean;
  /** Anyone has ever been in it (a presence interval exists); a new room hasn't. */
  occupied: boolean;
  /** Room roles other than plain member, by user id (`room_members`). */
  roles: Map<string, Exclude<RoomRole, "member">>;
}

/** An open presence interval found on boot (left behind by a restart or crash). */
export interface OpenPresence {
  userId: string;
  username: string;
  startedAt: Date;
  lastSeenAt: Date;
  /** They also have an open stream interval in the room (they were sharing). */
  sharing: boolean;
}

/** A live room as the hub reloads it on boot (ADR 4 restart addendum). */
export interface RestoredRoom extends StoredRoom {
  /** Its open presence intervals, oldest first. */
  presences: OpenPresence[];
  createdAt: Date;
  /** When it last became empty, if it was empty when the last server stopped (ADR 14). */
  lastEmptyAt: Date | null;
}

/** "`userId` was still in `roomId` at `at`", for the `last_seen_at` checkpoint (ADR 12). */
export interface PresenceSeen {
  roomId: string;
  userId: string;
  at: Date;
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
  /** Move each open interval's `last_seen_at` forward to its `at` (never backwards). */
  checkpointPresence(seen: PresenceSeen[]): Promise<void>;
  /** Every live room with its roles and open presence intervals, for the hub on boot. */
  loadLiveRooms(): Promise<RestoredRoom[]>;
  /**
   * Open a stream interval for `userId` in `roomId` at `at` (they started sharing). One left
   * open by a crash is closed at its last-seen checkpoint first, like presence.
   */
  openStream(roomId: string, userId: string, at: Date): Promise<void>;
  /**
   * Close the user's open stream interval in `roomId` at `at` (never before it started), if
   * there is one.
   */
  closeStream(roomId: string, userId: string, at: Date): Promise<void>;
  /** `checkpointPresence` for open stream intervals. */
  checkpointStreams(seen: PresenceSeen[]): Promise<void>;
  /**
   * `userId` holds the host role in `roomId` from `at` (ADRs 11, 14). Their host interval is
   * open afterwards: one already open for them is kept (so this is idempotent), anyone else's
   * closes at `at`. `rooms.hostUserId` and the `room_members` roles follow: the previous host
   * becomes a member (still approved, for a private room), the new one `host`.
   */
  setHost(roomId: string, userId: string, at: Date): Promise<void>;
  /**
   * Close the room's open host interval at `at` (never before it started), if there is one
   * (when the room ends).
   */
  closeHostInterval(roomId: string, at: Date): Promise<void>;
  /** The room became empty at `at` (ADR 14): `rooms.lastEmptyAt`. */
  markRoomEmpty(roomId: string, at: Date): Promise<void>;
  /** Someone joined the empty room: it's occupied again, so `lastEmptyAt` clears. */
  markRoomOccupied(roomId: string): Promise<void>;
  /**
   * End the live room at `endedAt` (when it last became empty, ADR 14): it's a past stream from
   * now on. A presence or stream interval still open in it closes too, at its last-seen time if
   * that's earlier (host intervals: `closeHostInterval`). False if it wasn't live.
   */
  endRoom(roomId: string, endedAt: Date): Promise<boolean>;
  /** Fold the ended room into the persistent stats (ADR 11); a no-op if already done. */
  rollupEndedRoom(roomId: string, at: Date): Promise<void>;
  /** Whether `userId` was kicked from `roomId` (they can't rejoin it, ADR 15). */
  isKicked(roomId: string, userId: string): Promise<boolean>;
  /**
   * Kick `userId` from `roomId` for good: `room_members.kicked`, back to a plain member, and no
   * longer approved into a private room (ADR 16).
   */
  kick(roomId: string, userId: string): Promise<void>;
  /**
   * `userId`, present in `roomId`, is a mod or a plain member now (`room_members.role`); either
   * way they stay approved, so a private room stays open to them.
   */
  setRole(roomId: string, userId: string, role: "mod" | "member"): Promise<void>;
  /** Rename `roomId` (`name` already validated). */
  renameRoom(roomId: string, name: string): Promise<void>;
  /** The live private room `inviteToken` opens; null if unknown, ended or public (ADR 16). */
  findInvitedRoom(inviteToken: string): Promise<StoredRoom | null>;
  /** `userId`'s knock on the private `roomId` was admitted: approved until the room ends. */
  approve(roomId: string, userId: string): Promise<void>;
}

/**
 * Whether anyone has ever been in the room (`rooms` row in scope). Spelled out: drizzle leaves
 * columns unqualified inside a select list, and both tables have an `id`-like `room_id`/`id`.
 */
const everOccupied = sql<boolean>`exists (select 1 from "presence_intervals" as "seen" where "seen"."room_id" = "rooms"."id")`;

export function createDbRoomStore(db: Db): RoomStore {
  /** The live room matching `where` (on `rooms`), with its roles. */
  async function findLiveRoom(where: SQL | undefined): Promise<StoredRoom | null> {
    const [room] = await db
      .select({
        id: rooms.id,
        name: rooms.name,
        hostUserId: rooms.hostUserId,
        isPrivate: rooms.isPrivate,
        occupied: everOccupied,
      })
      .from(rooms)
      .where(and(where, isNull(rooms.endedAt)));
    if (!room) return null;
    const members = await db
      .select({ userId: roomMembers.userId, role: roomMembers.role })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, room.id), ne(roomMembers.role, "member")));
    const roles: StoredRoom["roles"] = new Map();
    for (const { userId, role } of members) if (role !== "member") roles.set(userId, role);
    return { ...room, roles };
  }

  return {
    findRoomFor(caller, roomId) {
      return findLiveRoom(and(eq(rooms.id, roomId), roomVisibleTo(caller)));
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

    async checkpointPresence(seen) {
      if (seen.length === 0) return;
      await db.transaction(async (tx) => {
        for (const { roomId, userId, at } of seen) {
          await tx
            .update(presenceIntervals)
            .set({
              lastSeenAt: sql`greatest(${presenceIntervals.lastSeenAt}, ${at.toISOString()}::timestamptz)`,
            })
            .where(
              and(
                eq(presenceIntervals.roomId, roomId),
                eq(presenceIntervals.userId, userId),
                isNull(presenceIntervals.endedAt),
              ),
            );
        }
      });
    },

    async loadLiveRooms() {
      const live = await db
        .select({
          id: rooms.id,
          name: rooms.name,
          hostUserId: rooms.hostUserId,
          isPrivate: rooms.isPrivate,
          occupied: everOccupied,
          createdAt: rooms.createdAt,
          lastEmptyAt: rooms.lastEmptyAt,
        })
        .from(rooms)
        .where(isNull(rooms.endedAt));
      if (live.length === 0) return [];
      const ids = live.map((room) => room.id);
      const members = await db
        .select({ roomId: roomMembers.roomId, userId: roomMembers.userId, role: roomMembers.role })
        .from(roomMembers)
        .where(and(inArray(roomMembers.roomId, ids), ne(roomMembers.role, "member")));
      const open = await db
        .select({
          roomId: presenceIntervals.roomId,
          userId: presenceIntervals.userId,
          username: sql<string>`coalesce(${user.discordUsername}, ${user.name})`,
          startedAt: presenceIntervals.startedAt,
          lastSeenAt: presenceIntervals.lastSeenAt,
        })
        .from(presenceIntervals)
        .innerJoin(user, eq(user.id, presenceIntervals.userId))
        .where(and(inArray(presenceIntervals.roomId, ids), isNull(presenceIntervals.endedAt)))
        .orderBy(asc(presenceIntervals.startedAt));
      const restored = new Map<string, RestoredRoom>(
        live.map((room) => [room.id, { ...room, roles: new Map(), presences: [] }]),
      );
      for (const { roomId, userId, role } of members) {
        if (role !== "member") restored.get(roomId)?.roles.set(userId, role);
      }
      const streaming = await db
        .select({ roomId: streamIntervals.roomId, userId: streamIntervals.userId })
        .from(streamIntervals)
        .where(and(inArray(streamIntervals.roomId, ids), isNull(streamIntervals.endedAt)));
      const sharing = new Set(streaming.map((s) => `${s.roomId}:${s.userId}`));
      for (const { roomId, ...presence } of open) {
        restored
          .get(roomId)
          ?.presences.push({ ...presence, sharing: sharing.has(`${roomId}:${presence.userId}`) });
      }
      return [...restored.values()];
    },

    async openStream(roomId, userId, at) {
      await db.transaction(async (tx) => {
        await tx
          .update(streamIntervals)
          .set({ endedAt: sql`${streamIntervals.lastSeenAt}` })
          .where(openStreamOf(roomId, userId));
        await tx.insert(streamIntervals).values({ roomId, userId, startedAt: at, lastSeenAt: at });
      });
    },

    async closeStream(roomId, userId, at) {
      // A restored streamer who never returns closes at their presence's last checkpoint,
      // which can predate a share started since: that stream then lasted no time.
      const end = sql`greatest(${streamIntervals.startedAt}, ${at.toISOString()}::timestamptz)`;
      await db
        .update(streamIntervals)
        .set({ endedAt: end, lastSeenAt: end })
        .where(openStreamOf(roomId, userId));
    },

    async checkpointStreams(seen) {
      if (seen.length === 0) return;
      await db.transaction(async (tx) => {
        for (const { roomId, userId, at } of seen) {
          await tx
            .update(streamIntervals)
            .set({
              lastSeenAt: sql`greatest(${streamIntervals.lastSeenAt}, ${at.toISOString()}::timestamptz)`,
            })
            .where(openStreamOf(roomId, userId));
        }
      });
    },

    async setHost(roomId, userId, at) {
      await db.transaction(async (tx) => {
        const openInRoom = and(eq(hostIntervals.roomId, roomId), isNull(hostIntervals.endedAt));
        const [open] = await tx
          .select({ userId: hostIntervals.userId })
          .from(hostIntervals)
          .where(openInRoom);
        if (open?.userId !== userId) {
          if (open) await tx.update(hostIntervals).set({ endedAt: at }).where(openInRoom);
          await tx.insert(hostIntervals).values({ roomId, userId, startedAt: at });
        }
        const [room] = await tx
          .select({ hostUserId: rooms.hostUserId })
          .from(rooms)
          .where(eq(rooms.id, roomId));
        const previous = room?.hostUserId;
        if (previous !== userId) {
          await tx.update(rooms).set({ hostUserId: userId }).where(eq(rooms.id, roomId));
        }
        if (previous && previous !== userId) {
          await tx
            .update(roomMembers)
            .set({ role: "member", approved: true })
            .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, previous)));
        }
        await tx
          .insert(roomMembers)
          .values({ roomId, userId, role: "host", approved: true })
          .onConflictDoUpdate({
            target: [roomMembers.roomId, roomMembers.userId],
            set: { role: "host", approved: true },
          });
      });
    },

    async closeHostInterval(roomId, at) {
      // Host can pass to someone in their reconnect grace, whose leave (and so the room's end)
      // then dates from before they became host: that host interval lasted no time.
      const end = sql`greatest(${hostIntervals.startedAt}, ${at.toISOString()}::timestamptz)`;
      await db
        .update(hostIntervals)
        .set({ endedAt: end })
        .where(and(eq(hostIntervals.roomId, roomId), isNull(hostIntervals.endedAt)));
    },

    async markRoomEmpty(roomId, at) {
      await db.update(rooms).set({ lastEmptyAt: at }).where(eq(rooms.id, roomId));
    },

    async markRoomOccupied(roomId) {
      await db.update(rooms).set({ lastEmptyAt: null }).where(eq(rooms.id, roomId));
    },

    async endRoom(roomId, endedAt) {
      return db.transaction(async (tx) => {
        const [ended] = await tx
          .update(rooms)
          .set({ endedAt })
          .where(and(eq(rooms.id, roomId), isNull(rooms.endedAt)))
          .returning({ id: rooms.id });
        if (!ended) return false;
        const at = sql`${endedAt.toISOString()}::timestamptz`;
        for (const table of [presenceIntervals, streamIntervals]) {
          const end = sql`greatest(${table.startedAt}, least(${table.lastSeenAt}, ${at}))`;
          await tx
            .update(table)
            .set({ endedAt: end, lastSeenAt: end })
            .where(and(eq(table.roomId, roomId), isNull(table.endedAt)));
        }
        return true;
      });
    },

    async rollupEndedRoom(roomId, at) {
      await rollupEndedRoom(db, roomId, at);
    },

    async isKicked(roomId, userId) {
      const [member] = await db
        .select({ kicked: roomMembers.kicked })
        .from(roomMembers)
        .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)));
      return member?.kicked ?? false;
    },

    async kick(roomId, userId) {
      await db
        .insert(roomMembers)
        .values({ roomId, userId, role: "member", approved: false, kicked: true })
        .onConflictDoUpdate({
          target: [roomMembers.roomId, roomMembers.userId],
          set: { role: "member", approved: false, kicked: true },
        });
    },

    async setRole(roomId, userId, role) {
      await db
        .insert(roomMembers)
        .values({ roomId, userId, role, approved: true })
        .onConflictDoUpdate({
          target: [roomMembers.roomId, roomMembers.userId],
          set: { role, approved: true },
        });
    },

    async renameRoom(roomId, name) {
      await db.update(rooms).set({ name }).where(eq(rooms.id, roomId));
    },

    findInvitedRoom(inviteToken) {
      return findLiveRoom(and(eq(rooms.inviteToken, inviteToken), eq(rooms.isPrivate, true)));
    },

    async approve(roomId, userId) {
      await db
        .insert(roomMembers)
        .values({ roomId, userId, role: "member", approved: true })
        .onConflictDoUpdate({
          target: [roomMembers.roomId, roomMembers.userId],
          set: { approved: true },
        });
    },
  };
}

const openStreamOf = (roomId: string, userId: string) =>
  and(
    eq(streamIntervals.roomId, roomId),
    eq(streamIntervals.userId, userId),
    isNull(streamIntervals.endedAt),
  );
