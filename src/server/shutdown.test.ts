import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShutdown } from "./shutdown.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
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

  it("keeps going past a failing step, and exits 1", async () => {
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
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("stuck"));
  });
});
