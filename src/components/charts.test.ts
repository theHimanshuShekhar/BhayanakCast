import { describe, expect, it } from "vitest";
import { fmtTick, labelIndexes } from "./charts";

describe("fmtTick", () => {
  it("rounds to whole numbers from a max of 4 up, where they stay distinct", () => {
    expect([0, 1.25, 2.5, 3.75, 5].map((v) => fmtTick(v, 5))).toEqual(["0", "1", "3", "4", "5"]);
    expect([0, 2.5, 5, 7.5, 10].map((v) => fmtTick(v, 10))).toEqual(["0", "3", "5", "8", "10"]);
    expect([0, 25, 50, 75, 100].map((v) => fmtTick(v, 100))).toEqual([
      "0",
      "25",
      "50",
      "75",
      "100",
    ]);
  });

  it("keeps whole-number ticks of a small scale as they were", () => {
    expect([0, 1, 2, 3, 4].map((v) => fmtTick(v, 4))).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("tells ticks apart on a scale under 2 (maxY is floored at 1)", () => {
    expect([0, 0.25, 0.5, 0.75, 1].map((v) => fmtTick(v, 1))).toEqual([
      "0",
      "0.25",
      "0.5",
      "0.75",
      "1",
    ]);
  });
});

describe("labelIndexes", () => {
  const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

  it("labels every step-th index and the last when it is far enough from the one before", () => {
    // 0, 5, 10 then the last (13) is 3 past 10: more than half a step of 5.
    expect(sorted(labelIndexes(14, 5))).toEqual([0, 5, 10, 13]);
  });

  it("labels every index when the step is 1", () => {
    expect(sorted(labelIndexes(4, 1))).toEqual([0, 1, 2, 3]);
  });

  it("does not repeat the last when it falls on a step", () => {
    expect(sorted(labelIndexes(7, 3))).toEqual([0, 3, 6]);
  });

  it("drops the label before the last when they are under half a step apart", () => {
    // 22 days at a step of 4: the last (21) would sit right next to 20.
    expect(sorted(labelIndexes(22, 4))).toEqual([0, 4, 8, 12, 16, 21]);
  });

  it("is empty for no data", () => {
    expect(labelIndexes(0, 1).size).toBe(0);
  });
});
