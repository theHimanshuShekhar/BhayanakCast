import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShutdown } from "./shutdown.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

let logs: CapturedLogs;

beforeEach(() => {
  logs = captureLogs();
});

afterEach(() => {
  logs.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createShutdown", () => {
  it("runs the steps in order, then exits 0", async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown(
      [
        { name: "first", run: async () => order.push("first") },
        { name: "second", run: () => order.push("second") },
      ],
      { exit },
    );
    await shutdown("SIGTERM");
    expect(order).toEqual(["first", "second"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("logs the reason it is shutting down for", async () => {
    const shutdown = createShutdown([], { exit: vi.fn() });
    await shutdown("SIGTERM");
    expect(logs.find("server.shutdown")).toMatchObject({
      level: "info",
      reason: "SIGTERM",
    });
  });

  it("keeps going past a failing step, logs it, and exits 1", async () => {
    const after = vi.fn();
    const exit = vi.fn();
    const shutdown = createShutdown(
      [
        {
          name: "broken",
          run: () => {
            throw new Error("boom");
          },
        },
        { name: "after", run: after },
      ],
      { exit },
    );
    await shutdown("SIGTERM");
    expect(after).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logs.find("server.shutdown_step_failed")).toMatchObject({
      level: "error",
      step: "broken",
      err: { message: "boom" },
    });
  });

  it("exits with the code it was given (a crash), even when every step works", async () => {
    const exit = vi.fn();
    const shutdown = createShutdown([{ name: "ok", run: () => {} }], { exit });
    await shutdown("uncaughtException", 1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logs.find("server.shutdown")).toMatchObject({ reason: "uncaughtException" });
  });

  it("does nothing the second time it is called", async () => {
    const run = vi.fn();
    const exit = vi.fn();
    const shutdown = createShutdown([{ name: "once", run }], { exit });
    await shutdown("SIGTERM");
    await shutdown("SIGINT");
    expect(run).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("writes out the held-back log counts before it exits", async () => {
    const flush = vi.fn();
    const exit = vi.fn(() => {
      expect(flush).toHaveBeenCalledWith(true);
    });
    const shutdown = createShutdown([], { exit, flushLogs: flush });
    await shutdown("SIGTERM");
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("exits 1 and names the step when one never finishes", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const shutdown = createShutdown([{ name: "stuck", run: () => new Promise(() => {}) }], {
      timeoutMs: 8_000,
      exit,
    });
    void shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(7_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logs.find("server.shutdown_timeout")).toMatchObject({
      level: "error",
      step: "stuck",
      timeoutMs: 8_000,
    });
  });
});
