import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseServerMessage } from "../lib/realtime.ts";
import { type RealtimeHarness, startRealtimeHarness, type TestUser } from "./realtime-harness.ts";

// A problem report (#117) has the server quietly ask every other browser in the room to send a
// snapshot now (`snapshot.request`). Nothing about it reaches the room's UI or its feed.

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let cy: TestUser;
let dee: TestUser;
let roomId: string;

beforeEach(async () => {
  h = await startRealtimeHarness();
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  cy = await h.createUser("cy");
  dee = await h.createUser("dee");
  roomId = await h.createRoom(ana, { name: "ana's room" });
});

afterEach(async () => {
  await h.close();
});

describe("asking the room for snapshots", () => {
  it("sends `snapshot.request` with the snapshot's id to everyone in the room but the reporter", async () => {
    const [a, b, c] = [await h.connectAs(ana), await h.connectAs(bo), await h.connectAs(cy)];
    for (const client of [a, b, c]) await client.join(roomId);
    expect(await h.hub.requestSnapshots(roomId, "rep-1", ana.id)).toBe(2);
    for (const client of [b, c]) {
      expect(await client.waitFor("snapshot.request")).toEqual({
        type: "snapshot.request",
        roomId,
        reportId: "rep-1",
      });
    }
    await h.settled();
    expect(a.received.some((m) => m.type === "snapshot.request")).toBe(false);
  });

  it("is silent to the room: no feed entry, no room event, no error", async () => {
    const a = await h.connectAs(ana);
    const b = await h.connectAs(bo);
    await a.join(roomId);
    await b.join(roomId);
    await a.waitForEvent("joined");
    await h.settled();
    const [seenByA, seenByB] = [a.received.length, b.received.length];
    await h.hub.requestSnapshots(roomId, "rep-1", ana.id);
    await b.waitFor("snapshot.request");
    await h.settled();
    // The reporter hears nothing; the other hears the ask and nothing else.
    expect(a.received.slice(seenByA)).toEqual([]);
    expect(b.received.slice(seenByB).map((m) => m.type)).toEqual(["snapshot.request"]);
  });

  it("asks nobody outside the room: another room, or only the lobby", async () => {
    const other = await h.createRoom(bo, { name: "bo's room" });
    const a = await h.connectAs(ana);
    const b = await h.connectAs(bo);
    const d = await h.connectAs(dee);
    await a.join(roomId);
    await b.join(other);
    expect(await h.hub.requestSnapshots(roomId, "rep-1", ana.id)).toBe(0);
    await h.settled();
    for (const client of [b, d]) {
      expect(client.received.some((m) => m.type === "snapshot.request")).toBe(false);
    }
  });

  it("does nothing for a room that isn't live here", async () => {
    expect(await h.hub.requestSnapshots("nope", "rep-1", ana.id)).toBe(0);
  });

  it("skips someone in their reconnect grace, who has no socket", async () => {
    const a = await h.connectAs(ana);
    const b = await h.connectAs(bo);
    await a.join(roomId);
    await b.join(roomId);
    await a.waitForEvent("joined");
    await b.close();
    await h.settled();
    expect(await h.hub.requestSnapshots(roomId, "rep-1", ana.id)).toBe(0);
  });
});

describe("the message", () => {
  it("is part of the protocol: a server message with a room and a report id", () => {
    const parsed = parseServerMessage({
      type: "snapshot.request",
      roomId: "r1",
      reportId: "rep-1",
    });
    expect(parsed.ok).toBe(true);
    expect(parseServerMessage({ type: "snapshot.request", roomId: "r1" }).ok).toBe(false);
  });
});
