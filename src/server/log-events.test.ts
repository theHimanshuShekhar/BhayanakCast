import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClientIpResolver } from "./client-ip.ts";
import {
  logReportDropped,
  logTimelineEvent,
  logTimelineWriteFailed,
  logUntrustedProxy,
  SLOW_WRITE_MS,
  timedWrite,
  withSlowWriteLog,
} from "./log-events.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

let logs: CapturedLogs;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => logs.restore());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("timedWrite", () => {
  it("returns what the write returns and says nothing when it is quick", async () => {
    expect(await timedWrite("op", async () => 42)).toBe(42);
    expect(logs.entries).toEqual([]);
  });

  it("warns about a write over the threshold, naming it and the time it took", async () => {
    await timedWrite("room.end", () => sleep(30), { roomId: "r1" }, 10);
    expect(logs.find("db.slow_write")).toMatchObject({
      level: "warn",
      operation: "room.end",
      roomId: "r1",
      thresholdMs: 10,
    });
    expect(logs.find("db.slow_write")?.ms).toBeGreaterThanOrEqual(10);
  });

  it("warns about a write that fails slowly, and still throws", async () => {
    await expect(
      timedWrite(
        "room.end",
        async () => {
          await sleep(30);
          throw new Error("deadlock");
        },
        {},
        10,
      ),
    ).rejects.toThrow("deadlock");
    expect(logs.find("db.slow_write")).toMatchObject({ operation: "room.end", failed: true });
  });

  it("has a documented threshold", () => {
    expect(SLOW_WRITE_MS).toBe(500);
  });
});

describe("withSlowWriteLog", () => {
  const store = {
    async findThing(id: string) {
      await sleep(30);
      return id;
    },
    async saveThing(id: string) {
      await sleep(30);
      return `saved ${id}`;
    },
    label: "not a function",
  };

  it("times the writes, not the reads, and keeps their results", async () => {
    const timed = withSlowWriteLog(store, (name) => name.startsWith("save"), 10);
    expect(await timed.findThing("a")).toBe("a");
    expect(logs.entries).toEqual([]);
    expect(await timed.saveThing("a")).toBe("saved a");
    expect(logs.find("db.slow_write")).toMatchObject({ operation: "saveThing" });
    expect(timed.label).toBe("not a function");
  });
});

describe("hooks for the room timeline (ticket #115)", () => {
  it("logs a timeline event at info, under its kind, so the viewer can search across rooms", () => {
    logTimelineEvent({ kind: "joined", roomId: "r1", userId: "u1", username: "ana" });
    expect(logs.find("timeline.joined")).toMatchObject({
      level: "info",
      roomId: "r1",
      userId: "u1",
    });
  });

  it("logs a failed timeline write at error", () => {
    logTimelineWriteFailed(new Error("insert failed"), { roomId: "r1", kind: "joined" });
    expect(logs.find("timeline.write_failed")).toMatchObject({
      level: "error",
      roomId: "r1",
      kind: "joined",
      err: { message: "insert failed" },
    });
  });
});

describe("logUntrustedProxy", () => {
  it("warns that cf-connecting-ip was ignored, and doesn't name the peer", () => {
    createClientIpResolver(["10.1.1.5"], { warn: logUntrustedProxy })("10.1.1.9", "203.0.113.4");
    expect(logs.find("http.untrusted_proxy")).toMatchObject({
      level: "warn",
      msg: expect.stringContaining("TRUSTED_PROXY_IPS"),
    });
    expect(logs.lines.join("")).not.toContain("10.1.1.9");
    expect(logs.lines.join("")).not.toContain("203.0.113.4");
  });
});

describe("logReportDropped (quality, connection-event and problem reports)", () => {
  it("warns with the kind of report and why it was dropped", () => {
    logReportDropped("connection_event", "not_in_room", { roomId: "r1", userId: "u1" });
    expect(logs.find("connection_event.dropped")).toMatchObject({
      level: "warn",
      reason: "not_in_room",
      roomId: "r1",
      userId: "u1",
    });
  });
});
