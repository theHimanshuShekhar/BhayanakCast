import { describe, expect, it } from "vitest";
import { distinctTicks, timeTicks } from "./timeline-chart";

describe("distinctTicks", () => {
  const mbps = (v: number) => (v / 1_000_000).toFixed(1);

  it("keeps ticks whose labels differ", () => {
    expect(distinctTicks([0, 5_000_000, 10_000_000], mbps)).toEqual([0, 5_000_000, 10_000_000]);
  });

  it("drops a tick that would read the same as one before it (a small range rounds together)", () => {
    // 0.05 and 0.1 Mbps both read "0.1" at one decimal: the lower is kept.
    expect(distinctTicks([0, 50_000, 100_000], mbps)).toEqual([0, 50_000]);
    expect(distinctTicks([0, 0, 0], mbps)).toEqual([0]);
  });
});

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

  it("counts back from the end for a rolling window: the last minute reads -1m ... now", () => {
    expect(timeTicks(0, 60_000, 480, true).map((t) => t.label)).toEqual([
      "-1m",
      "-45s",
      "-30s",
      "-15s",
      "now",
    ]);
    expect(timeTicks(0, 60_000, 300, true).map((t) => t.label)).toEqual(["-1m", "-30s", "now"]);
    // Ticks stay where they were: only the words change.
    expect(timeTicks(0, 60_000, 480, true).map((t) => t.t)).toEqual(
      timeTicks(0, 60_000, 480).map((t) => t.t),
    );
  });

  it("keeps the first tick at the start of the axis", () => {
    expect(timeTicks(10_000, 70_000, 480)[0]).toEqual({ t: 10_000, label: "0s" });
  });
});
