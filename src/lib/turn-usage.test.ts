import { describe, expect, it } from "vitest";
import { usageBarWidth } from "./turn-usage";

describe("usageBarWidth", () => {
  it("leaves the bar empty at zero", () => {
    expect(usageBarWidth(0)).toBe(0);
  });

  it("shows a sliver for a use too small to see", () => {
    expect(usageBarWidth(0.04)).toBeGreaterThan(0.04);
    expect(usageBarWidth(0.04)).toBeGreaterThanOrEqual(1);
  });

  it("is the true share once that is wide enough, up to full", () => {
    expect(usageBarWidth(42)).toBe(42);
    expect(usageBarWidth(100)).toBe(100);
  });
});
