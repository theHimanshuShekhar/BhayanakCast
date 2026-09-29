/**
 * The one rule for which rooms a caller may see (ADR 16). Every query that
 * lists or looks up rooms — live, past, recaps, profile streams, search — adds
 * `roomVisibleTo(caller)` to its WHERE clause instead of re-deriving it.
 *
 * - Visitor: public rooms only.
 * - User: public rooms, plus private rooms they host or were approved into
 *   (mods count as approved), unless they were kicked.
 * - Admin: every room.
 */
import { eq, or, type SQL, sql } from "drizzle-orm";
import { roomMembers, rooms } from "../db/schema/index.ts";
import type { Caller } from "./caller.ts";

/** SQL condition on `rooms` for rooms `caller` may see; `undefined` means no restriction. */
export function roomVisibleTo(caller: Caller): SQL | undefined {
  if (caller.role === "admin") return undefined;
  const publicRoom = eq(rooms.isPrivate, false);
  if (!caller.user) return publicRoom;
  const userId = caller.user.id;
  return or(
    publicRoom,
    eq(rooms.hostUserId, userId),
    memberWhere(userId, sql`(${roomMembers.approved} or ${roomMembers.role} <> 'member')`),
  );
}

/**
 * SQL condition on `rooms` for rooms whose knocks `caller` may decide and whose invite link
 * they may share (ADR 16): the host, its mods (not kicked) and admins; `undefined` means any.
 */
export function roomApprovableBy(caller: Caller): SQL | undefined {
  if (caller.role === "admin") return undefined;
  if (!caller.user) return sql`false`;
  const userId = caller.user.id;
  return or(eq(rooms.hostUserId, userId), memberWhere(userId, sql`${roomMembers.role} = 'mod'`));
}

/** `userId` is a member of the room (not kicked) matching `condition` on `room_members`. */
function memberWhere(userId: string, condition: SQL): SQL {
  return sql`exists (
    select 1 from ${roomMembers}
    where ${roomMembers.roomId} = ${rooms.id}
      and ${roomMembers.userId} = ${userId}
      and not ${roomMembers.kicked}
      and ${condition}
  )`;
}
