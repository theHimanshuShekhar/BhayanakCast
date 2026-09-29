import { describe, expect, it } from "vitest";
import { levelOf } from "./audio-level";
import { hear, SILENT, SPEAKING_HOLD_MS, SPEAKING_LEVEL } from "./speaking";

describe("hear", () => {
  it("starts speaking on a loud frame and holds through short pauses", () => {
    const loud = hear(SILENT, SPEAKING_LEVEL + 0.1, 1_000);
    expect(loud.speaking).toBe(true);
    expect(hear(loud, 0, 1_000 + SPEAKING_HOLD_MS - 1).speaking).toBe(true);
    expect(hear(loud, 0, 1_000 + SPEAKING_HOLD_MS).speaking).toBe(false);
  });

  it("keeps speaking while frames stay loud", () => {
    let state = SILENT;
    for (let t = 0; t < 3 * SPEAKING_HOLD_MS; t += 100) state = hear(state, 0.8, t);
    expect(state.speaking).toBe(true);
  });

  it("stays quiet below the level: background hiss isn't speech", () => {
    expect(hear(SILENT, SPEAKING_LEVEL - 0.01, 1_000).speaking).toBe(false);
    // About -50 dBFS.
    expect(hear(SILENT, levelOf(0.003), 1_000).speaking).toBe(false);
    // About -20 dBFS: talking.
    expect(hear(SILENT, levelOf(0.1), 1_000).speaking).toBe(true);
  });
});
