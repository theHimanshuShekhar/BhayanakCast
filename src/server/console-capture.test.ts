import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureConsole } from "./console-capture.ts";
import { log } from "./logger.ts";
import { logServerFnError } from "./request-errors.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

const SESSION_TOKEN = "sessTok_9f8e7d6c5b4a39281706";
const ACCESS_TOKEN = "discordAccess_aaaabbbbccccdddd";

let logs: CapturedLogs;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => logs.restore());

/** A stand-in for `console` whose original methods just record, as the real ones write to stdout. */
function fakeConsole() {
  const original: string[] = [];
  const target = {
    log: (...args: unknown[]) => original.push(`log ${args.join(" ")}`),
    info: (...args: unknown[]) => original.push(`info ${args.join(" ")}`),
    warn: (...args: unknown[]) => original.push(`warn ${args.join(" ")}`),
    error: (...args: unknown[]) => original.push(`error ${args.join(" ")}`),
    debug: (...args: unknown[]) => original.push(`debug ${args.join(" ")}`),
  } as unknown as Console;
  return { target, original };
}

describe("captureConsole", () => {
  it("sends console output through the logger, at the matching level, as console.<method>", () => {
    const { target, original } = fakeConsole();
    const restore = captureConsole(target);
    try {
      target.log("hello", { a: 1 });
      target.warn("careful");
      target.error("broken");
      expect(original).toEqual([]);
      expect(logs.entries[0]?.args).toEqual([{ a: 1 }]);
      expect(logs.entries.map((line) => [line.event, line.level, line.msg])).toEqual([
        ["console.log", "info", "hello"],
        ["console.warn", "warn", "careful"],
        ["console.error", "error", "broken"],
      ]);
    } finally {
      restore();
    }
  });

  it("writes an Error argument as err {name, message, stack}", () => {
    const { target } = fakeConsole();
    const restore = captureConsole(target);
    try {
      target.error("Something failed", new RangeError("out of range"));
      expect(logs.entries[0]).toMatchObject({
        level: "error",
        msg: "Something failed",
        err: { name: "RangeError", message: "out of range" },
      });
    } finally {
      restore();
    }
  });

  it("scrubs addresses and credentials out of what it formats", () => {
    const { target } = fakeConsole();
    const restore = captureConsole(target);
    try {
      target.log("peer 203.0.113.9 sent", { accessToken: ACCESS_TOKEN, sessionId: "s-123" });
      const text = logs.lines.join("");
      expect(text).not.toContain("203.0.113.9");
      expect(text).not.toContain(ACCESS_TOKEN);
    } finally {
      restore();
    }
  });

  it("leaves out an error the logger has already written, so one failure is one line", () => {
    const { target } = fakeConsole();
    const restore = captureConsole(target);
    try {
      const error = new Error("insert failed");
      log.error("quality.write_failed", "storing quality samples failed", { err: error });
      target.error("Server Fn Error!", error);
      expect(logs.entries.map((line) => line.event)).toEqual(["quality.write_failed"]);
    } finally {
      restore();
    }
  });

  it("puts the original methods back", () => {
    const { target, original } = fakeConsole();
    const before = target.error;
    const restore = captureConsole(target);
    restore();
    expect(target.error).toBe(before);
    target.error("plain");
    expect(original).toEqual(["error plain"]);
  });

  it("captures once however often it is installed", () => {
    const { target } = fakeConsole();
    const restoreFirst = captureConsole(target);
    const restoreSecond = captureConsole(target);
    try {
      target.log("once");
      expect(logs.entries).toHaveLength(1);
    } finally {
      restoreSecond();
      restoreFirst();
    }
  });
});

describe("a server function that throws with a token in its query parameters", () => {
  // As TanStack Start handles it (server-functions-handler.js): the function's middleware sees
  // the error first, then Start prints it with console.error("Server Fn Error!", error).
  function failedInsert() {
    return new DrizzleQueryError(
      'insert into "account" ("id", "access_token", "session_token") values ($1, $2, $3)',
      ["acc-1", ACCESS_TOKEN, SESSION_TOKEN],
      new DrizzleQueryError("select 1", [SESSION_TOKEN], new Error("connection terminated")),
    );
  }

  it("leaves no unredacted token in the output, with Start's print captured", () => {
    const { target } = fakeConsole();
    const restore = captureConsole(target);
    try {
      const error = failedInsert();
      logServerFnError(error, { name: "signInFn" });
      target.error("Server Fn Error!", error);
      const text = logs.lines.join("\n");
      expect(text).not.toContain(ACCESS_TOKEN);
      expect(text).not.toContain(SESSION_TOKEN);
      expect(logs.entries.some((line) => line.event === "server_fn.failed")).toBe(true);
    } finally {
      restore();
    }
  });

  it("leaves none either when only Start's print sees the error", () => {
    const { target } = fakeConsole();
    const restore = captureConsole(target);
    try {
      target.error("Server Fn Error!", failedInsert());
      const text = logs.lines.join("\n");
      expect(text).not.toContain(ACCESS_TOKEN);
      expect(text).not.toContain(SESSION_TOKEN);
      expect(logs.entries[0]).toMatchObject({ event: "console.error", level: "error" });
      expect(logs.entries[0]?.err?.message).toContain("params: [redacted]");
    } finally {
      restore();
    }
  });

  it("leaves none when an object holding the error is printed", () => {
    const { target } = fakeConsole();
    const restore = captureConsole(target);
    try {
      target.error("failed", { error: failedInsert(), params: [SESSION_TOKEN] });
      const text = logs.lines.join("\n");
      expect(text).not.toContain(SESSION_TOKEN);
      expect(text).not.toContain(ACCESS_TOKEN);
    } finally {
      restore();
    }
  });
});
