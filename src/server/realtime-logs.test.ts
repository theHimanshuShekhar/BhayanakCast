import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONNECTION_RATE_LIMITS } from "../lib/realtime.ts";
import { type RealtimeHarness, startRealtimeHarness, type TestUser } from "./realtime-harness.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

// What the realtime server writes to the log (src/server/logger.ts): the refusals and refused
// upgrades that used to be silent, and the socket lifecycle. Tests read the lines the process
// logger would have written to stdout.

let h: RealtimeHarness;
let logs: CapturedLogs;
let ana: TestUser;

beforeEach(async () => {
  logs = captureLogs();
  h = await startRealtimeHarness({ socketsPerUser: 2 });
  ana = await h.createUser("ana");
});

afterEach(async () => {
  await h.close();
  logs.restore();
});

describe("refused socket messages", () => {
  it("log a warn line with the message type for a bad_request", async () => {
    const roomId = await h.createRoom(ana);
    const a = await h.connectAs(ana);
    await a.join(roomId);

    a.sendRaw(JSON.stringify({ type: "reaction.send", emoji: "💩", targetUserId: ana.id }));
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "reaction.send" });

    const line = logs.find("socket.refused");
    expect(line).toMatchObject({
      level: "warn",
      code: "bad_request",
      type: "reaction.send",
      userId: ana.id,
      roomId,
    });
    expect(typeof line?.socketId).toBe("number");
    expect(line?.msg).toEqual(expect.any(String));
  });

  it("log a warn line for a rate_limited refusal", async () => {
    const a = await h.connectAs(ana);
    // Each socket may knock only so often (CONNECTION_RATE_LIMITS): one more is refused.
    const roomId = await h.createRoom(ana);
    for (let i = 0; i <= CONNECTION_RATE_LIMITS["knock.request"].messages; i++) {
      a.send({ type: "knock.request", inviteToken: `invite-${i}` });
    }
    await a.waitFor("error", (m) => m.code === "rate_limited");
    const line = logs.find("socket.refused");
    expect(logs.all("socket.refused").some((l) => l.code === "rate_limited")).toBe(true);
    expect(logs.all("socket.refused").find((l) => l.code === "rate_limited")).toMatchObject({
      level: "warn",
      type: "knock.request",
      userId: ana.id,
    });
    expect(line).toBeDefined();
    expect(roomId).toBeTruthy();
  });

  it("log an unparseable frame as a bad_request, without its content", async () => {
    const a = await h.connectAs(ana);
    a.sendRaw("this is not json: my secret chat line");
    await a.waitFor("error");
    expect(logs.find("socket.refused")).toMatchObject({ level: "warn", code: "bad_request" });
    expect(logs.lines.join("\n")).not.toContain("my secret chat line");
  });
});

describe("refused upgrades", () => {
  it("log the wrong-origin refusal (403) without the origin", async () => {
    expect(await h.upgradeStatus(ana, { origin: "https://evil.example" })).toBe(403);
    expect(logs.find("socket.upgrade_refused")).toMatchObject({
      level: "warn",
      status: 403,
      reason: "wrong_origin",
    });
    expect(logs.lines.join("\n")).not.toContain("evil.example");
  });

  it("log the too-many-sockets refusal (429) with the user", async () => {
    await h.connectAs(ana);
    await h.connectAs(ana);
    expect(await h.upgradeStatus(ana)).toBe(429);
    expect(logs.find("socket.upgrade_refused")).toMatchObject({
      level: "warn",
      status: 429,
      reason: "too_many_sockets",
      userId: ana.id,
    });
  });
});

describe("socket lifecycle", () => {
  it("logs open and close at info, for a user and for a visitor", async () => {
    const a = await h.connectAs(ana);
    const visitor = await h.connect(null);
    await a.close();
    await visitor.close();
    await h.settled();

    const opens = logs.all("socket.open");
    expect(opens.map((l) => l.level)).toEqual(["info", "info"]);
    expect(opens[0]).toMatchObject({ userId: ana.id });
    expect(opens[1]).not.toHaveProperty("userId");
    expect(opens[1]).toMatchObject({ anonymous: true });
    const closes = logs.all("socket.close");
    expect(closes).toHaveLength(2);
    expect(closes[0]).toMatchObject({ level: "info", userId: ana.id });
    expect(closes.map((l) => l.socketId).sort()).toEqual(opens.map((l) => l.socketId).sort());
  });
});

describe("what is never logged", () => {
  it("keeps IP addresses, session cookies and chat out of every line a session writes", async () => {
    const bo = await h.createUser("bo");
    const roomId = await h.createRoom(ana);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    a.send({ type: "chat.send", text: "a very private sentence" });
    await b.waitFor("chat.message");
    a.sendRaw(JSON.stringify({ type: "reaction.send", emoji: "💩", targetUserId: bo.id }));
    await a.waitFor("error");
    await h.upgradeStatus(ana, { origin: "https://evil.example" });
    await h.upgradeStatus(ana);
    await a.close();
    await b.close();
    await h.settled();

    expect(logs.lines.length).toBeGreaterThan(0);
    const text = logs.lines.join("\n");
    expect(text).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    expect(text).not.toContain("::1");
    expect(text).not.toContain("a very private sentence");
    for (const user of [ana, bo]) {
      const token = user.cookie.split("=")[1]?.split(".")[0];
      expect(token).toBeTruthy();
      expect(text).not.toContain(token as string);
    }
  });
});
