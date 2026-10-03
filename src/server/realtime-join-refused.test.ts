import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { presenceIntervals } from "../db/schema/index.ts";
import { ROOM_CAPACITY } from "../lib/format.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";

// A refused `room.join` (kicked, full, unknown or private) leaves the user where they were:
// they are only moved out of their current room once the join is certain (#63, ADR 21).

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let cy: TestUser;
/** ana's room, where bo is when he tries to join elsewhere. */
let home: string;
/** cy's room, which bo can't get into in each test. */
let target: string;
let a: TestClient;
let b: TestClient;

beforeEach(async () => {
  h = await startRealtimeHarness();
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  cy = await h.createUser("cy");
  home = await h.createRoom(ana, { name: "home" });
  target = await h.createRoom(cy, { name: "target" });
  a = await h.connectAs(ana);
  await a.join(home);
  b = await h.connectAs(bo);
  await b.join(home);
  await a.waitForEvent("joined");
});

afterEach(async () => {
  await h.close();
});

/** bo asks for `room` and gets `code`; he is still in `home` afterwards, with nothing lost. */
async function expectRefusedAndStillHome(room: string, code: string) {
  const lefts = () => a.received.filter((m) => m.type === "room.event" && m.event.kind === "left");
  const before = lefts().length;
  b.send({ type: "room.join", roomId: room });
  expect(await b.waitFor("error", (e) => e.re === "room.join")).toMatchObject({ code });
  await h.settled();

  // The room never saw him leave, and his latest presence interval is still open.
  expect(a.pending()).toEqual([]);
  expect(lefts()).toHaveLength(before);
  const open = await h.db
    .select({ endedAt: presenceIntervals.endedAt })
    .from(presenceIntervals)
    .where(and(eq(presenceIntervals.roomId, home), eq(presenceIntervals.userId, bo.id)));
  expect(open.filter((row) => row.endedAt === null)).toHaveLength(1);

  // He can still use the room: it hears his chat.
  b.send({ type: "chat.send", text: "still here" });
  expect(await a.waitFor("chat.message")).toMatchObject({ message: { text: "still here" } });
}

describe("a refused room.join", () => {
  it("leaves the user in their room when they were kicked from the other", async () => {
    const c = await h.connectAs(cy);
    await c.join(target);
    // bo goes to the other room, is kicked from it, and goes back home.
    await b.join(target);
    c.send({ type: "mod.kick", userId: bo.id });
    await b.waitFor("error", (e) => e.code === "kicked");
    await b.join(home);
    await a.waitForEvent("left");
    await a.waitForEvent("joined");

    await expectRefusedAndStillHome(target, "kicked");
  });

  it("leaves the user in their room when the other is full", async () => {
    const c = await h.connectAs(cy);
    await c.join(target);
    for (let i = 1; i < ROOM_CAPACITY; i++) {
      const guest = await h.createUser(`guest${i}`);
      await (await h.connectAs(guest)).join(target);
    }
    await h.settled();

    await expectRefusedAndStillHome(target, "room_full");
  });

  it("leaves the user in their room when the other doesn't exist", async () => {
    await expectRefusedAndStillHome(randomUUID(), "not_found");
  });

  it("leaves the user in their room when the other is private and they weren't let in", async () => {
    const secret = await h.createRoom(cy, { name: "secret", isPrivate: true });
    await expectRefusedAndStillHome(secret, "forbidden");
  });

  it("still moves the user when the join is accepted", async () => {
    const c = await h.connectAs(cy);
    await c.join(target);

    await b.join(target);

    expect(await a.waitForEvent("left")).toMatchObject({ event: { userId: bo.id } });
    expect(await c.waitForEvent("joined")).toMatchObject({
      event: { participant: { userId: bo.id } },
    });
  });
});
