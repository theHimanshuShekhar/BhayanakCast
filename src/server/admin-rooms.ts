/**
 * Ending any live room (spec #7, ADR 6 addendum). Like ./admin-users.ts, it takes the database
 * and the caller explicitly and refuses anyone without the admin role before doing anything.
 *
 * The live realtime hub ends the room on its queue: one it holds sends everyone in it home, and
 * one it doesn't hold ends in the database only, where no join can load it meanwhile. Either way
 * intervals close, stats roll up and the action is audited. With no hub in this process, the
 * room ends in the database directly.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { rooms } from "../db/schema/index.ts";
import { type EndRoomInput, endRoomInput } from "../lib/admin.ts";
import { recordAdminAction } from "./admin-users.ts";
import { type Caller, requireAdmin } from "./caller.ts";
import type { RoomHub } from "./room-hub.ts";
import { createDbRoomStore } from "./room-store.ts";

export interface AdminRoomDeps {
  /** The live realtime hub (./live-hub.ts); null when none runs in this process. */
  hub: Pick<RoomHub, "endRoomByAdmin"> | null;
}

/**
 * End the live room `roomId` now. A room that isn't live (already ended, say by its empty-room
 * timer meanwhile, or unknown) is left alone and nothing is logged.
 */
export async function endRoom(
  db: Db,
  caller: Caller,
  input: EndRoomInput,
  deps: AdminRoomDeps,
  now: Date = new Date(),
): Promise<void> {
  requireAdmin(caller);
  const { roomId } = endRoomInput.parse(input);
  const [room] = await db
    .select({ name: rooms.name })
    .from(rooms)
    .where(and(eq(rooms.id, roomId), isNull(rooms.endedAt)));
  if (!room) return;
  const ended = deps.hub
    ? await deps.hub.endRoomByAdmin(roomId)
    : await endRoomInDb(db, roomId, now);
  if (!ended) return;
  await recordAdminAction(db, caller, "end_room", { roomId }, { name: room.name });
}

/**
 * End the live room `roomId` at `at` in the database alone: its open host, presence and stream
 * intervals close (at their last-seen time if that's earlier) and its stats roll up once. True
 * if it was live until now.
 */
async function endRoomInDb(db: Db, roomId: string, at: Date): Promise<boolean> {
  const store = createDbRoomStore(db);
  await store.closeHostInterval(roomId, at);
  if (!(await store.endRoom(roomId, at))) return false;
  await store.rollupEndedRoom(roomId, at);
  return true;
}
