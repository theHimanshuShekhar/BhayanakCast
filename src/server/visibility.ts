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
    sql`exists (
      select 1 from ${roomMembers}
      where ${roomMembers.roomId} = ${rooms.id}
        and ${roomMembers.userId} = ${userId}
        and not ${roomMembers.kicked}
        and (${roomMembers.approved} or ${roomMembers.role} <> 'member')
    )`,
  );
}
