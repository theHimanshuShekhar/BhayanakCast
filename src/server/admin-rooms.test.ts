import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client.ts";
import {
  adminActions,
  hostIntervals,
  presenceIntervals,
  rooms,
  streamIntervals,
  user,
  userStats,
} from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { type AdminRoomDeps, endRoom } from "./admin-rooms.ts";
import { AdminRequiredError, type Caller } from "./caller.ts";
import type { RoomHub } from "./room-hub.ts";

// Ending a room from /admin (#46): through the live hub when one runs, else in the database
// only, with the same bookkeeping; audited only when this call ended it.

const T0 = new Date("2026-09-01T12:00:00Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

let db: Db;
let close: () => Promise<void>;
let endRoomByAdmin: ReturnType<typeof vi.fn<RoomHub["endRoomByAdmin"]>>;

const admin: Caller = { user: { id: "admin", username: "admin_jpg", image: null }, role: "admin" };
const noHub: AdminRoomDeps = { hub: null };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db
    .insert(user)
    .values(["admin", "ana", "bo"].map((id) => ({ id, name: id, email: `${id}@discord.invalid` })));
  endRoomByAdmin = vi.fn(async () => true);
});

afterEach(async () => {
  await close();
});

/**
 * A live room created at T0 by ana (host since), with ana present from T0 (last seen at 9) and
 * bo present and sharing from 2 (last seen at 10): as a server that stopped would leave it.
 */
async function seedLiveRoom(id = "r1") {
  await db
    .insert(rooms)
    .values({ id, name: "problem room", createdBy: "ana", hostUserId: "ana", createdAt: T0 });
  await db.insert(presenceIntervals).values([
    { roomId: id, userId: "ana", startedAt: T0, lastSeenAt: at(9) },
    { roomId: id, userId: "bo", startedAt: at(2), lastSeenAt: at(10) },
  ]);
  await db
    .insert(streamIntervals)
    .values({ roomId: id, userId: "bo", startedAt: at(2), lastSeenAt: at(10) });
  await db.insert(hostIntervals).values({ roomId: id, userId: "ana", startedAt: T0 });
  return id;
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

async function roomRow(id = "r1") {
  const [row] = await db.select().from(rooms).where(eq(rooms.id, id));
  return { endedAt: iso(row?.endedAt), rolledUpAt: iso(row?.statsRolledUpAt) };
}

async function ends(
  table: typeof presenceIntervals | typeof streamIntervals | typeof hostIntervals,
) {
  const rows = await db
    .select({ userId: table.userId, endedAt: table.endedAt })
    .from(table)
    .orderBy(asc(table.userId));
  return rows.map((r) => [r.userId, iso(r.endedAt)]);
}

async function statsOf(userId: string) {
  const [row] = await db.select().from(userStats).where(eq(userStats.userId, userId));
  return row ?? null;
}

const auditRows = () =>
  db
    .select({
      actorUserId: adminActions.actorUserId,
      action: adminActions.action,
      targetUserId: adminActions.targetUserId,
      targetRoomId: adminActions.targetRoomId,
      details: adminActions.details,
    })
    .from(adminActions);

describe("endRoom", () => {
  it("refuses visitors and users before doing anything", async () => {
    const roomId = await seedLiveRoom();
    const deps = { hub: { endRoomByAdmin } };
    for (const caller of [
      { user: null, role: "visitor" },
      { user: { id: "ana", username: "ana", image: null }, role: "user" },
      { user: null, role: "admin" },
    ] satisfies Caller[]) {
      await expect(endRoom(db, caller, { roomId }, deps, at(12))).rejects.toBeInstanceOf(
        AdminRequiredError,
      );
    }
    expect(endRoomByAdmin).not.toHaveBeenCalled();
    expect(await roomRow()).toEqual({ endedAt: null, rolledUpAt: null });
    expect(await auditRows()).toEqual([]);
  });

  it("without the hub, ends the room in the database: intervals close, stats roll up, audited", async () => {
    const roomId = await seedLiveRoom();

    await endRoom(db, admin, { roomId }, noHub, at(12));

    expect(await roomRow()).toEqual({ endedAt: iso(at(12)), rolledUpAt: iso(at(12)) });
    // Open presence and streams close at their last-seen time (ADR 12); host at the end.
    expect(await ends(presenceIntervals)).toEqual([
      ["ana", iso(at(9))],
      ["bo", iso(at(10))],
    ]);
    expect(await ends(streamIntervals)).toEqual([["bo", iso(at(10))]]);
    expect(await ends(hostIntervals)).toEqual([["ana", iso(at(12))]]);
    expect(await statsOf("ana")).toMatchObject({
      roomsJoined: 1,
      roomsHosted: 1,
      secondsWatched: 9 * 60,
    });
    expect(await statsOf("bo")).toMatchObject({ secondsStreamed: 8 * 60, secondsWatched: 0 });
    expect(await auditRows()).toEqual([
      {
        actorUserId: "admin",
        action: "end_room",
        targetUserId: null,
        targetRoomId: roomId,
        details: { name: "problem room" },
      },
    ]);
  });

  it("with the hub, leaves the ending to it and audits it", async () => {
    const roomId = await seedLiveRoom();
    // The hub ends it as it would (the protocol tests cover what it does).
    endRoomByAdmin.mockImplementation(async (id) => {
      await db
        .update(rooms)
        .set({ endedAt: at(11), statsRolledUpAt: at(11) })
        .where(eq(rooms.id, id));
      return true;
    });

    await endRoom(db, admin, { roomId }, { hub: { endRoomByAdmin } }, at(12));

    expect(endRoomByAdmin).toHaveBeenCalledWith(roomId);
    expect(await roomRow()).toEqual({ endedAt: iso(at(11)), rolledUpAt: iso(at(11)) });
    expect(await auditRows()).toMatchObject([{ action: "end_room", targetRoomId: roomId }]);
  });

  it("logs nothing when the room ended some other way before the hub got to it", async () => {
    const roomId = await seedLiveRoom();
    // Its empty-room timer ended it first: the hub finds nothing live to end.
    endRoomByAdmin.mockImplementation(async (id) => {
      await db
        .update(rooms)
        .set({ endedAt: at(11), statsRolledUpAt: at(11) })
        .where(eq(rooms.id, id));
      return false;
    });

    await endRoom(db, admin, { roomId }, { hub: { endRoomByAdmin } }, at(12));

    expect(await roomRow()).toEqual({ endedAt: iso(at(11)), rolledUpAt: iso(at(11)) });
    expect(await auditRows()).toEqual([]);
  });

  it("does nothing, and logs nothing, for a room that isn't live", async () => {
    const roomId = await seedLiveRoom();
    await endRoom(db, admin, { roomId }, noHub, at(12));
    await endRoom(db, admin, { roomId }, { hub: { endRoomByAdmin } }, at(20));
    await endRoom(db, admin, { roomId: "no-such-room" }, { hub: { endRoomByAdmin } }, at(20));

    expect(endRoomByAdmin).not.toHaveBeenCalled();
    expect(await roomRow()).toEqual({ endedAt: iso(at(12)), rolledUpAt: iso(at(12)) });
    expect(await statsOf("ana")).toMatchObject({ roomsJoined: 1 });
    expect(await auditRows()).toHaveLength(1);
  });

  it("refuses a bad input", async () => {
    await expect(endRoom(db, admin, { roomId: "" }, noHub)).rejects.toThrow();
    expect(await auditRows()).toEqual([]);
  });
});
