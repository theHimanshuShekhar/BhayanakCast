import { describe, expect, it } from "vitest";
import { timeTicks } from "./timeline-chart";

describe("timeTicks", () => {
  it("has five ticks across a session on a wide chart, three on a narrow one", () => {
    expect(timeTicks(0, 120_000, 480).map((t) => t.label)).toEqual([
      "0s",
      "30s",
      "1m",
      "1m 30s",
      "2m",
    ]);
    expect(timeTicks(0, 120_000, 300).map((t) => t.label)).toEqual(["0s", "1m", "2m"]);
  });

  it("never shows two ticks that read the same, however short the span", () => {
    for (const span of [0, 400, 1_000, 2_000, 3_000, 59_000]) {
      const labels = timeTicks(1_000, 1_000 + span, 480).map((t) => t.label);
      expect(new Set(labels).size, `${span} ms`).toBe(labels.length);
    }
    // Under a second there is only the start.
    expect(timeTicks(0, 400, 480).map((t) => t.label)).toEqual(["0s"]);
    expect(timeTicks(5_000, 5_000, 480).map((t) => t.label)).toEqual(["0s"]);
  });

  it("keeps the first tick at the start of the axis", () => {
    expect(timeTicks(10_000, 70_000, 480)[0]).toEqual({ t: 10_000, label: "0s" });
  });
});
