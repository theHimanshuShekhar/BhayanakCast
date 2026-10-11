import { describe, expect, it } from "vitest";
import { forgetIdle, withinRateLimit, withinWindow } from "./rate-limit.ts";

const T0 = new Date("2026-10-11T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("withinWindow", () => {
  it("allows at most `max` in any window, and refused attempts don't count", () => {
    const recent: number[] = [];
    expect([0, 1, 2, 3].map((i) => withinWindow(recent, 3, 1_000, at(i)))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(recent).toHaveLength(3);
    // The window slides: the first is out of it by 1,000 ms later.
    expect(withinWindow(recent, 3, 1_000, at(1_001))).toBe(true);
  });

  it("takes an action of weight `count` whole or not at all", () => {
    const recent: number[] = [];
    expect(withinWindow(recent, 10, 1_000, at(0), 6)).toBe(true);
    expect(recent).toHaveLength(6);
    // 6 + 5 would pass 10: refused, and none of its weight is recorded.
    expect(withinWindow(recent, 10, 1_000, at(10), 5)).toBe(false);
    expect(recent).toHaveLength(6);
    expect(withinWindow(recent, 10, 1_000, at(10), 4)).toBe(true);
    expect(recent).toHaveLength(10);
    expect(withinWindow(recent, 10, 1_000, at(20))).toBe(false);
    // Once the window has passed it all clears.
    expect(withinWindow(recent, 10, 1_000, at(2_000), 10)).toBe(true);
  });

  it("refuses a weight above the maximum outright", () => {
    expect(withinWindow([], 3, 1_000, at(0), 4)).toBe(false);
  });
});

describe("withinRateLimit", () => {
  it("keeps a record per key", () => {
    const sends = new Map<string, number[]>();
    expect(withinRateLimit(sends, "a", 2, 1_000, at(0), 2)).toBe(true);
    expect(withinRateLimit(sends, "a", 2, 1_000, at(1), 1)).toBe(false);
    expect(withinRateLimit(sends, "b", 2, 1_000, at(1), 1)).toBe(true);
    expect(sends.get("a")).toHaveLength(2);
    expect(sends.get("b")).toHaveLength(1);
  });
});

describe("forgetIdle", () => {
  it("drops the keys with nothing left in the window, and keeps the rest", () => {
    const sends = new Map<string, number[]>([
      ["old", [at(0).getTime()]],
      ["recent", [at(0).getTime(), at(900).getTime()]],
      ["empty", []],
    ]);
    forgetIdle(sends, 1_000, at(1_000));
    expect([...sends.keys()]).toEqual(["recent"]);
  });
});
