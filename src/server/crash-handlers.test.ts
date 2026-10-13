import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCrashHandlers } from "./crash-handlers.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

let logs: CapturedLogs;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => logs.restore());

/** A stand-in for `process` that only emits. */
const fakeProcess = () => new EventEmitter() as unknown as NodeJS.Process;

describe("unhandledRejection", () => {
  it("is logged at error with its stack, and the server keeps running", () => {
    const proc = fakeProcess();
    const shutdown = vi.fn();
    installCrashHandlers({ shutdown, proc });

    proc.emit("unhandledRejection", new RangeError("late failure"), Promise.resolve());

    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]).toMatchObject({
      level: "error",
      event: "process.unhandled_rejection",
      err: { name: "RangeError", message: "late failure" },
    });
    expect(logs.entries[0]?.err?.stack).toContain("RangeError: late failure");
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("logs a rejection that isn't an Error", () => {
    const proc = fakeProcess();
    installCrashHandlers({ shutdown: vi.fn(), proc });
    proc.emit("unhandledRejection", "just a string", Promise.resolve());
    expect(logs.find("process.unhandled_rejection")?.err).toEqual({
      name: "NonError",
      message: "just a string",
    });
  });

  it("keeps handling later rejections", () => {
    const proc = fakeProcess();
    const shutdown = vi.fn();
    installCrashHandlers({ shutdown, proc });
    proc.emit("unhandledRejection", new Error("one"), Promise.resolve());
    proc.emit("unhandledRejection", new Error("two"), Promise.resolve());
    expect(logs.all("process.unhandled_rejection")).toHaveLength(2);
    expect(shutdown).not.toHaveBeenCalled();
  });
});

describe("uncaughtException", () => {
  it("is logged at error, then the server shuts down through the shutdown path, failing", () => {
    const proc = fakeProcess();
    const order: string[] = [];
    const shutdown = vi.fn(() => {
      order.push(`shutdown after ${logs.entries.length} line(s)`);
      return Promise.resolve();
    });
    installCrashHandlers({ shutdown, proc });

    proc.emit("uncaughtException", new TypeError("cannot read x"), "uncaughtException");

    expect(logs.find("process.uncaught_exception")).toMatchObject({
      level: "error",
      err: { name: "TypeError", message: "cannot read x" },
    });
    expect(shutdown).toHaveBeenCalledExactlyOnceWith("uncaughtException", 1);
    expect(order).toEqual(["shutdown after 1 line(s)"]);
  });

  it("still shuts down when the exception is not an Error", () => {
    const proc = fakeProcess();
    const shutdown = vi.fn(() => Promise.resolve());
    installCrashHandlers({ shutdown, proc });
    proc.emit("uncaughtException", { weird: true }, "uncaughtException");
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("logs a second exception during shutdown without shutting down twice", () => {
    const proc = fakeProcess();
    const shutdown = vi.fn(() => Promise.resolve());
    installCrashHandlers({ shutdown, proc });
    proc.emit("uncaughtException", new Error("first"), "uncaughtException");
    proc.emit("uncaughtException", new Error("second"), "uncaughtException");
    expect(logs.all("process.uncaught_exception")).toHaveLength(2);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("exits 1 itself if the shutdown path throws", () => {
    const proc = fakeProcess();
    const exit = vi.fn();
    const shutdown = vi.fn(() => {
      throw new Error("shutdown broke");
    });
    installCrashHandlers({ shutdown, proc, exit });
    proc.emit("uncaughtException", new Error("first"), "uncaughtException");
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe("installCrashHandlers", () => {
  it("returns a function that removes both handlers", () => {
    const proc = fakeProcess();
    const remove = installCrashHandlers({ shutdown: vi.fn(), proc });
    expect(proc.listenerCount("unhandledRejection")).toBe(1);
    expect(proc.listenerCount("uncaughtException")).toBe(1);
    remove();
    expect(proc.listenerCount("unhandledRejection")).toBe(0);
    expect(proc.listenerCount("uncaughtException")).toBe(0);
  });
});
