/**
 * Private-room invites, server half (ADR 16). Each function takes the database and the caller
 * explicitly, so src/lib/invites.functions.ts stays a thin wrapper and tests call these
 * directly against PGlite. Knocking and admitting happen over the socket (./room-hub.ts).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { rooms } from "../db/schema/index.ts";
import type { InvitedRoom } from "../lib/invites.ts";
import type { Caller } from "./caller.ts";
import { roomApprovableBy } from "./visibility.ts";

/**
 * The live private room `inviteToken` opens, for its knock screen; null if the token is
 * unknown, or its room ended or is public. Anyone holding the link may see the room's name.
 */
export async function resolveInvite(db: Db, inviteToken: string): Promise<InvitedRoom | null> {
  const [room] = await db
    .select({ roomId: rooms.id, name: rooms.name })
    .from(rooms)
    .where(
      and(eq(rooms.inviteToken, inviteToken), eq(rooms.isPrivate, true), isNull(rooms.endedAt)),
    );
  return room ?? null;
}

/**
 * The invite token of the live private room `roomId`, for its host, its mods (not kicked) and
 * admins, who may share the link; null for anyone else, or for a public or ended room.
 */
export async function getInviteToken(
  db: Db,
  caller: Caller,
  roomId: string,
): Promise<string | null> {
  const [room] = await db
    .select({ inviteToken: rooms.inviteToken })
    .from(rooms)
    .where(
      and(
        eq(rooms.id, roomId),
        eq(rooms.isPrivate, true),
        isNull(rooms.endedAt),
        roomApprovableBy(caller),
      ),
    );
  return room?.inviteToken ?? null;
}
