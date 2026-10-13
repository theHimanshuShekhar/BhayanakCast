import { describe, expect, it } from "vitest";
import {
  bindLogUser,
  createLogger,
  LOG_SAMPLE_LIMIT,
  LOG_SAMPLE_WINDOW_MS,
  type LogLevel,
  resolveLogLevel,
  routeOf,
  withRequestLog,
} from "./logger.ts";

const T0 = Date.parse("2026-10-13T12:00:00.000Z");

/** A logger on a clock the test moves, writing parsed lines to `entries`. */
function setup(options: { level?: LogLevel | "silent"; commit?: string } = {}) {
  let now = T0;
  const lines: string[] = [];
  const logger = createLogger({
    write: (line) => lines.push(line),
    now: () => now,
    commit: options.commit ?? "abc1234",
    level: options.level ?? "debug",
  });
  return {
    logger,
    lines,
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("format", () => {
  it("writes one JSON object per line with the agreed fields", () => {
    const { logger, lines, entries } = setup();
    logger.warn("socket.refused", "Too many requests", {
      roomId: "room-1",
      userId: "user-1",
      requestId: "req-1",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(entries()[0]).toEqual({
      time: "2026-10-13T12:00:00.000Z",
      level: "warn",
      event: "socket.refused",
      msg: "Too many requests",
      commit: "abc1234",
      roomId: "room-1",
      userId: "user-1",
      requestId: "req-1",
    });
  });

  it("stamps the time in UTC with milliseconds", () => {
    const { logger, entries, advance } = setup();
    advance(123);
    logger.info("a.b", "x");
    expect(entries()[0]?.time).toBe("2026-10-13T12:00:00.123Z");
  });

  it("keeps extra fields and leaves out the ones that are absent", () => {
    const { logger, entries } = setup();
    logger.info("socket.close", "closed", { code: 1006, userId: undefined });
    expect(entries()[0]).toMatchObject({ code: 1006 });
    expect(entries()[0]).not.toHaveProperty("userId");
    expect(entries()[0]).not.toHaveProperty("roomId");
  });

  it("writes an error as {name, message, stack} with the stack as one string", () => {
    const { logger, lines, entries } = setup();
    const error = new TypeError("boom");
    logger.error("room.end_failed", "ending a room failed", { err: error });
    expect(lines).toHaveLength(1);
    const err = entries()[0]?.err as { name: string; message: string; stack: string };
    expect(err.name).toBe("TypeError");
    expect(err.message).toBe("boom");
    expect(typeof err.stack).toBe("string");
    expect(err.stack).toContain("TypeError: boom");
    expect(err.stack.split("\n").length).toBeGreaterThan(1);
  });

  it("describes a thrown value that is not an Error", () => {
    const { logger, entries } = setup();
    logger.error("x.failed", "threw a string", { err: "plain string" });
    expect(entries()[0]?.err).toEqual({ name: "NonError", message: "plain string" });
  });

  it("carries the commit on every line", () => {
    const { logger, entries } = setup({ commit: "deadbee" });
    logger.info("a", "one");
    logger.error("b", "two");
    expect(entries().map((entry) => entry.commit)).toEqual(["deadbee", "deadbee"]);
  });

  it("cuts a very long message so a line stays small", () => {
    const { logger, entries } = setup();
    logger.warn("x", "m".repeat(50_000));
    expect(String(entries()[0]?.msg).length).toBeLessThan(2_000);
  });
});

describe("levels", () => {
  it("drops lines below the level", () => {
    const { logger, entries } = setup({ level: "info" });
    logger.debug("a", "debug");
    logger.info("b", "info");
    logger.warn("c", "warn");
    logger.error("d", "error");
    expect(entries().map((entry) => entry.level)).toEqual(["info", "warn", "error"]);
  });

  it("writes nothing when silent", () => {
    const { logger, lines } = setup({ level: "silent" });
    logger.error("a", "x");
    expect(lines).toEqual([]);
  });

  it("keeps debug off in production, and on in development and under test", () => {
    expect(resolveLogLevel({ NODE_ENV: "production" })).toBe("info");
    expect(resolveLogLevel({})).toBe("info");
    expect(resolveLogLevel({ NODE_ENV: "staging" })).toBe("info");
    expect(resolveLogLevel({ NODE_ENV: "development" })).toBe("debug");
    expect(resolveLogLevel({ NODE_ENV: "test" })).toBe("debug");
  });

  it("is silent inside Vitest, whose tests read the lines they cause", () => {
    expect(resolveLogLevel({ NODE_ENV: "test", VITEST: "true" })).toBe("silent");
  });

  it("lets LOG_LEVEL override outside production, and ignores unknown values", () => {
    expect(resolveLogLevel({ NODE_ENV: "development", LOG_LEVEL: "warn" })).toBe("warn");
    expect(resolveLogLevel({ NODE_ENV: "test", LOG_LEVEL: "error" })).toBe("error");
    expect(resolveLogLevel({ NODE_ENV: "production", LOG_LEVEL: "loud" })).toBe("info");
  });

  it("never lets LOG_LEVEL turn debug on in production", () => {
    expect(resolveLogLevel({ NODE_ENV: "production", LOG_LEVEL: "debug" })).toBe("info");
  });
});

describe("sampling", () => {
  const refuse = (logger: ReturnType<typeof setup>["logger"], userId = "u1") =>
    logger.warn("socket.refused", "Too many requests", { userId });

  it("logs the first 10 of an event from one user in a minute, then counts the rest", () => {
    const { logger, entries } = setup();
    for (let i = 0; i < 25; i++) refuse(logger);
    expect(entries()).toHaveLength(LOG_SAMPLE_LIMIT);
  });

  it("writes one count line per minute for what it held back", () => {
    const { logger, entries, advance } = setup();
    for (let i = 0; i < 25; i++) refuse(logger);
    advance(LOG_SAMPLE_WINDOW_MS);
    logger.flush();
    const all = entries();
    expect(all).toHaveLength(LOG_SAMPLE_LIMIT + 1);
    expect(all.at(-1)).toMatchObject({
      level: "warn",
      event: "socket.refused",
      userId: "u1",
      suppressed: 15,
    });
    expect(all.at(-1)?.msg).toContain("15 more");
  });

  it("writes the count line before the next occurrence after the minute", () => {
    const { logger, entries, advance } = setup();
    for (let i = 0; i < 12; i++) refuse(logger);
    advance(LOG_SAMPLE_WINDOW_MS + 1);
    refuse(logger);
    const all = entries();
    expect(all).toHaveLength(LOG_SAMPLE_LIMIT + 2);
    expect(all[LOG_SAMPLE_LIMIT]).toMatchObject({ suppressed: 2 });
    expect(all[LOG_SAMPLE_LIMIT + 1]).not.toHaveProperty("suppressed");
  });

  it("starts a fresh budget each minute", () => {
    const { logger, entries, advance } = setup();
    for (let i = 0; i < 15; i++) refuse(logger);
    advance(LOG_SAMPLE_WINDOW_MS);
    for (let i = 0; i < 5; i++) refuse(logger);
    const plain = entries().filter((entry) => !("suppressed" in entry));
    expect(plain).toHaveLength(LOG_SAMPLE_LIMIT + 5);
  });

  it("writes nothing extra when nothing was held back", () => {
    const { logger, entries, advance } = setup();
    for (let i = 0; i < 3; i++) refuse(logger);
    advance(LOG_SAMPLE_WINDOW_MS * 3);
    logger.flush();
    expect(entries()).toHaveLength(3);
  });

  it("counts each user, each socket and each event on its own", () => {
    const { logger, entries } = setup();
    for (let i = 0; i < 15; i++) refuse(logger, "u1");
    for (let i = 0; i < 15; i++) refuse(logger, "u2");
    for (let i = 0; i < 15; i++) logger.warn("socket.refused", "x", { socketId: 7 });
    for (let i = 0; i < 15; i++) logger.warn("socket.other", "x", { userId: "u1" });
    expect(entries()).toHaveLength(LOG_SAMPLE_LIMIT * 4);
  });

  it("counts by sampleKey without writing it", () => {
    const { logger, entries, lines } = setup();
    for (let i = 0; i < 15; i++) logger.warn("read.rate_limited", "x", { sampleKey: "10.0.0.9" });
    for (let i = 0; i < 15; i++) logger.warn("read.rate_limited", "x", { sampleKey: "10.0.0.8" });
    expect(entries()).toHaveLength(LOG_SAMPLE_LIMIT * 2);
    expect(lines.join("")).not.toContain("10.0.0.");
    expect(lines.join("")).not.toContain("sampleKey");
  });

  it("always logs errors with different messages", () => {
    const { logger, entries } = setup();
    for (let i = 0; i < 30; i++) logger.error("room.failed", "same", { err: new Error("a") });
    for (let i = 0; i < 3; i++) {
      logger.error("room.failed", "same", { err: new Error(`different ${i}`) });
    }
    const messages = entries().map((entry) => (entry.err as { message: string }).message);
    expect(messages.filter((message) => message === "a")).toHaveLength(LOG_SAMPLE_LIMIT);
    expect(messages).toContain("different 0");
    expect(messages).toContain("different 1");
    expect(messages).toContain("different 2");
  });

  it("still logs a new error message when the bookkeeping is full", () => {
    const { logger, entries } = setup();
    for (let i = 0; i < 6_000; i++) logger.error("room.failed", "x", { err: new Error(`m${i}`) });
    expect(entries()).toHaveLength(6_000);
  });

  it("holds back repeats even when the bookkeeping is full", () => {
    const { logger, entries } = setup();
    for (let i = 0; i < 6_000; i++) logger.warn(`event.${i}`, "x");
    const before = entries().length;
    for (let i = 0; i < 100; i++) logger.warn("event.late", "x");
    expect(entries().length - before).toBeLessThanOrEqual(LOG_SAMPLE_LIMIT);
  });
});

describe("redaction", () => {
  const SECRETS = [
    "10.1.1.160",
    "192.168.0.7",
    "2001:db8::1",
    "::1",
    "hunter2-password",
    "sess-abc123-session-id",
    "tok_live_0123456789",
    "hello from the chat",
  ];

  it("never writes IP addresses, chat, tokens or session ids, whatever the field is called", () => {
    const { logger, lines } = setup();
    logger.warn("socket.refused", "refused a socket from 10.1.1.160 (2001:db8::1)", {
      ip: "10.1.1.160",
      ipAddress: "192.168.0.7",
      remoteAddress: "::1",
      clientIp: "10.1.1.160",
      "cf-connecting-ip": "10.1.1.160",
      token: "tok_live_0123456789",
      accessToken: "tok_live_0123456789",
      sessionId: "sess-abc123-session-id",
      session: { id: "sess-abc123-session-id", token: "tok_live_0123456789" },
      cookie: "better-auth.session_token=tok_live_0123456789",
      authorization: "Bearer tok_live_0123456789",
      password: "hunter2-password",
      text: "hello from the chat",
      chat: { text: "hello from the chat" },
      headers: { cookie: "x", "x-forwarded-for": "10.1.1.160" },
      nested: { deeper: { Token: "tok_live_0123456789", ok: "kept" } },
    });
    const line = lines.join("");
    for (const secret of SECRETS) expect(line).not.toContain(secret);
    expect(JSON.parse(line).nested.deeper.ok).toBe("kept");
  });

  it("scrubs addresses and credentials out of messages and errors", () => {
    const { logger, lines } = setup();
    const error = new Error("connect ECONNREFUSED 10.1.1.160:5432 (peer 2001:db8::1)");
    error.stack = `Error: connect ECONNREFUSED 192.168.0.7:5432\n    at sign-in (cookie=sess-abc123-session-id)`;
    logger.error("db.failed", "token=tok_live_0123456789 from [::1]", { err: error });
    const line = lines.join("");
    for (const secret of SECRETS) expect(line).not.toContain(secret);
    expect(line).toContain("ECONNREFUSED");
    expect(line).toContain(":5432");
  });

  it("keeps ordinary text, ids and times intact", () => {
    const { logger, entries } = setup();
    logger.info("room.joined", "joined at 12:30:45 build 1.2.3 room r-42", {
      roomId: "9f1c2d3e",
      step: "a::b is not an address",
    });
    expect(entries()[0]).toMatchObject({
      msg: "joined at 12:30:45 build 1.2.3 room r-42",
      roomId: "9f1c2d3e",
    });
  });

  it("scrubs the fields of the count line too", () => {
    const { logger, lines, advance } = setup();
    for (let i = 0; i < 15; i++) logger.warn("socket.refused", "from 10.1.1.160", { userId: "u1" });
    advance(LOG_SAMPLE_WINDOW_MS);
    logger.flush();
    expect(lines.join("")).not.toContain("10.1.1.160");
  });
});

describe("request context", () => {
  it("adds the request id and the signed-in user to lines written during a request", () => {
    const { logger, entries } = setup();
    withRequestLog({ requestId: "req-9", route: "/api/x" }, () => {
      logger.warn("a", "before sign-in");
      bindLogUser("user-9");
      logger.warn("b", "after sign-in");
    });
    logger.warn("c", "outside");
    expect(entries()).toMatchObject([
      { event: "a", requestId: "req-9", route: "/api/x" },
      { event: "b", requestId: "req-9", route: "/api/x", userId: "user-9" },
      { event: "c" },
    ]);
    expect(entries()[2]).not.toHaveProperty("requestId");
  });

  it("names the user a request has found out, and counts samples by them", () => {
    const { logger, entries } = setup();
    withRequestLog({ requestId: "req-1" }, () => {
      logger.info("a", "before the session is read");
      bindLogUser("user-9");
      for (let i = 0; i < 15; i++) logger.warn("read.refused", "x");
    });
    for (let i = 0; i < 15; i++) logger.warn("read.refused", "x", { userId: "user-9" });
    expect(entries()[0]).not.toHaveProperty("userId");
    const refusals = entries().filter((entry) => entry.event === "read.refused");
    expect(refusals).toHaveLength(LOG_SAMPLE_LIMIT);
    expect(refusals[0]).toMatchObject({ userId: "user-9", requestId: "req-1" });
  });

  it("ignores bindLogUser outside a request", () => {
    expect(() => bindLogUser("user-1")).not.toThrow();
  });

  it("follows the request across awaits, and lets explicit fields win", async () => {
    const { logger, entries } = setup();
    await withRequestLog({ requestId: "req-1" }, async () => {
      await Promise.resolve();
      logger.info("a", "x", { requestId: "mine" });
      logger.info("b", "y");
    });
    expect(entries().map((entry) => entry.requestId)).toEqual(["mine", "req-1"]);
  });

  it("ignores bindLogUser outside a request", () => {
    expect(() => bindLogUser("user-1")).not.toThrow();
  });
});

describe("routeOf", () => {
  it("keeps the path, and drops the query and invite tokens", () => {
    expect(routeOf("http://x/api/thumbnails/r1/u1?t=5")).toBe("/api/thumbnails/r1/u1");
    expect(routeOf("http://x/api/auth/callback/discord?code=SECRET&state=S")).toBe(
      "/api/auth/callback/discord",
    );
    expect(routeOf("http://x/join/inv-token-123")).toBe("/join/:token");
    expect(routeOf("/join/inv-token-123?x=1")).toBe("/join/:token");
  });
});
