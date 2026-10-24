import { describe, expect, it } from "vitest";
import {
  ANCHOR_BITRATE,
  AUDIO_ALLOWANCE,
  aboveCeiling,
  BITS_PER_PIXEL,
  CAMERA_DEFAULT_RUNG,
  CAMERA_LADDER,
  CODEC_CAP_SCALE,
  carryOver,
  ceilingOf,
  codecCap,
  DOWN_SAMPLES,
  FIRST_MINUTE_MS,
  FIRST_MINUTE_UP_SAMPLES,
  FIRST_MINUTE_WARMUP_READINGS,
  feeds60,
  fitCapture,
  fitRung,
  freshLadderState,
  heightCap,
  INITIAL_UPLINK,
  MAX_BACKOFF,
  MAX_CAPTURE_PIXELS,
  nextRung,
  paceOf,
  pairCeilings,
  probeClaim,
  probeDue,
  type Rung,
  readSample,
  START_BITRATE_SHARE,
  type StatsSample,
  scaleSteps,
  screenSteps,
  seedBitrate,
  shedFirst,
  step,
  strained,
  UP_SAMPLES,
  UPLINK_DROP_LIMIT,
  UPLINK_FLOOR,
  UPLINK_SHARE,
  UplinkBudget,
  WARMUP_READINGS,
} from "./quality";

/** A 1080p60 screen in a text-like room: 720p30, 900p30, 1080p30, 1080p60. */
const SCREEN_LADDER = screenSteps({ width: 1920, height: 1080, frameRate: 60 }, "framerate");
const SCREEN_DEFAULT_RUNG = 2;
const TOP = SCREEN_LADDER.length - 1;
const GOOD: StatsSample = {
  availableBitrate: 20_000_000,
  sendBitrate: 2_000_000,
  loss: 0,
  rttMs: 30,
  limit: "none",
};
const LOSSY: StatsSample = { ...GOOD, loss: 0.1 };
const times = (n: number, sample: StatsSample) => Array.from({ length: n }, () => sample);

/** Feed `samples` to the controller one by one, as the Mesh does; the rung after each. */
function run(samples: StatsSample[], from = SCREEN_DEFAULT_RUNG, max = TOP) {
  let state = freshLadderState(from);
  const rungs: number[] = [];
  for (const sample of samples) {
    state = step(SCREEN_LADDER, state, sample, { max });
    rungs.push(state.rung);
  }
  return { state, rungs };
}

const labels = (steps: readonly Rung[]) => steps.map((r) => r.label);
const mbps = (steps: readonly Rung[]) => steps.map((r) => r.maxBitrate / 1_000_000);

describe("screenSteps", () => {
  it("anchors a step's bitrate on pixels x fps, so that 1080p30 is 3 Mbps", () => {
    expect(ANCHOR_BITRATE).toBe(3_000_000);
    expect(BITS_PER_PIXEL).toBeCloseTo(0.0482, 4);
    const steps = screenSteps({ width: 1920, height: 1080, frameRate: 60 }, "framerate");
    const byLabel = Object.fromEntries(steps.map((r) => [r.label, r.maxBitrate]));
    // Worked by hand: 1920*1080*30 pixels a second is 3.0 Mbps; twice the frames, twice the
    // bitrate; 1600*900*30 and 1280*720*30 are 0.694 and 0.444 of 1080p30's pixels a second.
    expect(byLabel).toEqual({
      "720p30": 1_330_000,
      "900p30": 2_080_000,
      "1080p30": 3_000_000,
      "1080p60": 6_000_000,
    });
  });

  it("makes a 16:9 1080p60 capture's steps, dropping frames before size for text", () => {
    const steps = screenSteps({ width: 1920, height: 1080, frameRate: 60 }, "framerate");
    expect(labels(steps)).toEqual(["720p30", "900p30", "1080p30", "1080p60"]);
    expect(steps.map((r) => r.frameRate)).toEqual([30, 30, 30, 60]);
    expect(steps.map((r) => [r.width, r.height])).toEqual([
      [1280, 720],
      [1600, 900],
      [1920, 1080],
      [1920, 1080],
    ]);
  });

  it("drops size before frames for motion, and keeps the floor at 30 fps", () => {
    const steps = screenSteps({ width: 1920, height: 1080, frameRate: 60 }, "size");
    expect(labels(steps)).toEqual(["720p30", "720p60", "900p60", "1080p60"]);
    expect(mbps(steps)).toEqual([1.33, 2.67, 4.17, 6]);
  });

  it("fits a 21:9 ultrawide to the pixel cap and keeps every step ultrawide-shaped", () => {
    // 3440x1440 is 4.95 MP: fitted to 3.7 MP by pixel count (about 2970x1240), not to 1920 wide.
    const steps = screenSteps({ width: 3440, height: 1440, frameRate: 60 }, "framerate");
    const top = steps.at(-1) as Rung;
    expect(top.label).toMatch(/^29[67]\d×12[34]\d@60$/);
    expect(steps.at(-2)?.label).toMatch(/^29[67]\d×12[34]\d@30$/);
    expect(top.width).toBeGreaterThan(2960);
    expect(top.width).toBeLessThan(2985);
    expect(top.height).toBeGreaterThan(1235);
    expect(top.height).toBeLessThan(1250);
    expect((top.width as number) * top.height).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS * 1.001);
    expect(steps).toHaveLength(5);
    for (const step of steps) {
      expect((step.width as number) / step.height).toBeCloseTo(3440 / 1440, 1);
      expect(step.label).toMatch(/^\d{4}×\d{3,4}@(30|60)$/);
    }
    // 1080p, 900p and 720p worth of pixels below the top; the floor is 720p class at 30 fps.
    const pixels = steps.map((r) => ((r.width as number) * r.height) / 1e6);
    expect(pixels[0]).toBeGreaterThan(0.89);
    expect(pixels[0]).toBeLessThan(0.95);
    expect(pixels[1]).toBeGreaterThan(1.4);
    expect(pixels[1]).toBeLessThan(1.48);
    expect(pixels[2]).toBeGreaterThan(2.0);
    expect(pixels[2]).toBeLessThan(2.15);
    expect(steps[0]).toMatchObject({ frameRate: 30 });
    expect(steps[0]?.maxBitrate).toBeGreaterThan(1_300_000);
    expect(steps[0]?.maxBitrate).toBeLessThan(1_400_000);
    // The same pixels cost the same as for a 16:9 screen: 1080p's worth is about 3 Mbps.
    expect(steps[2]?.maxBitrate).toBeGreaterThanOrEqual(2_990_000);
    expect(steps[2]?.maxBitrate).toBeLessThanOrEqual(3_010_000);
  });

  it("gives a 1440p screen its native size, with 1440p steps above 1080p", () => {
    const steps = screenSteps({ width: 2560, height: 1440, frameRate: 60 }, "framerate");
    expect(labels(steps)).toEqual(["720p30", "900p30", "1080p30", "1440p30", "1440p60"]);
    expect(steps.at(-1)).toMatchObject({ width: 2560, height: 1440 });
    expect(mbps(steps)).toEqual([1.33, 2.08, 3, 5.33, 10.67]);
  });

  it("gives a small window fewer steps and never upscales it", () => {
    expect(labels(screenSteps({ width: 1280, height: 720, frameRate: 30 }, "framerate"))).toEqual([
      "720p30",
    ]);
    expect(labels(screenSteps({ width: 1280, height: 720, frameRate: 60 }, "size"))).toEqual([
      "720p30",
      "720p60",
    ]);
    const small = screenSteps({ width: 1000, height: 600, frameRate: 30 }, "framerate");
    expect(small).toEqual([
      expect.objectContaining({
        label: "1000×600@30",
        width: 1000,
        height: 600,
        maxBitrate: 870_000,
      }),
    ]);
    // A window a few lines above 720 has no step a few lines below it.
    expect(screenSteps({ width: 1344, height: 756, frameRate: 30 }, "size")).toHaveLength(1);
  });

  it("offers 60 fps only to a capture that delivers it, and 60 when it can't tell", () => {
    const rates = (frameRate?: number) =>
      new Set(
        screenSteps({ width: 1920, height: 1080, ...(frameRate && { frameRate }) }, "size").map(
          (r) => r.frameRate,
        ),
      );
    expect(rates(30)).toEqual(new Set([30]));
    expect(rates(29.97)).toEqual(new Set([30]));
    expect(rates(59.94)).toEqual(new Set([30, 60]));
    expect(rates()).toEqual(new Set([30, 60]));
  });

  it("is ordered by bitrate, with distinct labels, for any capture and either order", () => {
    for (const [width, height] of [
      [1920, 1080],
      [3440, 1440],
      [2560, 1080],
      [3840, 2160],
      [5120, 1440],
      [1080, 1920],
      [800, 600],
    ] as const) {
      for (const order of ["framerate", "size"] as const) {
        const steps = screenSteps({ width, height, frameRate: 60 }, order);
        const rates = steps.map((r) => r.maxBitrate);
        expect(rates, `${width}x${height} ${order}`).toEqual([...rates].sort((a, b) => a - b));
        expect(new Set(rates).size).toBe(rates.length);
        expect(new Set(labels(steps)).size).toBe(steps.length);
        expect(steps[0]?.frameRate).toBe(30);
        for (const step of steps) {
          expect(step.width).toBeLessThanOrEqual(width);
          expect(step.height).toBeLessThanOrEqual(height);
        }
        const top = steps.at(-1) as Rung;
        expect((top.width as number) * top.height).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS * 1.01);
      }
    }
  });

  it("fits a capture to the pixel cap in its own shape, and never enlarges it", () => {
    const fits = (width: number, height: number) => fitCapture({ width, height });
    expect(fits(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(fits(3440, 1440)).toEqual({ width: 2968, height: 1242 });
    expect(fits(3840, 2160)).toEqual({ width: 2560, height: 1440 });
    // 32:9 and a portrait screen, the shapes the fixed 2970x1440 box cut short.
    expect(fits(5120, 1440)).toEqual({ width: 3620, height: 1018 });
    expect(fits(1440, 2560)).toEqual({ width: 1440, height: 2560 });
    expect(fits(2160, 3840)).toEqual({ width: 1440, height: 2560 });
    for (const [w, h] of [
      [5120, 1440],
      [2160, 3840],
      [3440, 1440],
    ] as const) {
      const { width, height } = fits(w, h);
      expect(width * height).toBeGreaterThan(MAX_CAPTURE_PIXELS * 0.99);
      expect(width * height).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS * 1.001);
    }
  });

  it("builds a portrait screen's steps in its own shape too", () => {
    const steps = screenSteps({ width: 1440, height: 2560, frameRate: 30 }, "size");
    expect(steps.at(-1)).toMatchObject({ width: 1440, height: 2560, frameRate: 30 });
    for (const step of steps) {
      expect(step.height / (step.width as number)).toBeCloseTo(2560 / 1440, 1);
    }
  });

  it("takes a capture for a 60 fps one from 59, and keeps doing so until it reports well under", () => {
    expect(feeds60(undefined)).toBe(true);
    expect(feeds60(undefined, false)).toBe(true);
    expect(feeds60(59.94)).toBe(true);
    expect(feeds60(30)).toBe(false);
    expect(feeds60(29.97, false)).toBe(false);
    // A rate that dithers around the cutoff doesn't flip it either way.
    expect(feeds60(58, true)).toBe(true);
    expect(feeds60(55, true)).toBe(true);
    expect(feeds60(58, false)).toBe(false);
    expect(feeds60(45, true)).toBe(false);
  });

  it("carries a sender over to the step of the same size when only the frame rates changed", () => {
    const sixty = screenSteps({ width: 1920, height: 1080, frameRate: 60 }, "size");
    const thirty = screenSteps({ width: 1920, height: 1080, frameRate: 30 }, "size");
    // 900p60 -> the 900p step that remains, 900p30; never a smaller size at a lower cost.
    expect(thirty[carryOver(sixty[2] as Rung, thirty)]?.label).toBe("900p30");
    // And back: 900p30 isn't in the 60 fps motion steps, the same size at 60 fps is.
    expect(sixty[carryOver(thirty[1] as Rung, sixty)]?.label).toBe("900p60");
    // A text room's 1080p60 loses the 60 fps step and keeps its size.
    const text60 = screenSteps({ width: 1920, height: 1080, frameRate: 60 }, "framerate");
    const text30 = screenSteps({ width: 1920, height: 1080, frameRate: 30 }, "framerate");
    expect(text30[carryOver(text60.at(-1) as Rung, text30)]?.label).toBe("1080p30");
    // No ratchet down however often it flips.
    let step = sixty[3] as Rung;
    for (let i = 0; i < 6; i++) {
      const to = i % 2 === 0 ? thirty : sixty;
      step = to[carryOver(step, to)] as Rung;
    }
    expect(step.height).toBe(1080);
  });

  it("carries a sender over to a new size at the highest step that costs no more", () => {
    const wide = screenSteps({ width: 3440, height: 1440, frameRate: 60 }, "framerate");
    const old = screenSteps({ width: 1920, height: 1080, frameRate: 60 }, "framerate")[2] as Rung;
    // 1080p30 cost 3 Mbps; the wide screen's 3 Mbps step is 2226x932.
    expect(wide[carryOver(old, wide)]?.label).toBe("2226×932@30");
    expect(carryOver({ ...old, maxBitrate: 1 }, wide)).toBe(0);
    expect(carryOver({ ...old, maxBitrate: 99_000_000 }, wide)).toBe(wide.length - 1);
  });

  it("caps a camera by its capture's height, and nothing when it can't tell", () => {
    expect(heightCap(CAMERA_LADDER, 360)).toBe(1);
    expect(heightCap(CAMERA_LADDER, 480)).toBe(1);
    expect(heightCap(CAMERA_LADDER, 240)).toBe(0);
    expect(heightCap(CAMERA_LADDER, 100)).toBe(0);
    expect(heightCap(CAMERA_LADDER)).toBe(1);
  });

  it("falls back on a 1080p shape when the capture's size is unknown", () => {
    expect(labels(screenSteps({}, "framerate"))).toEqual([
      "720p30",
      "900p30",
      "1080p30",
      "1080p60",
    ]);
  });
});

describe("pairCeilings", () => {
  const MBPS = 1_000_000;
  const open = { link: undefined };
  const via = (link: number) => ({ link });
  it("divides the budget equally among viewers with no known limit", () => {
    expect(pairCeilings(12 * MBPS, [open, {}, open])).toEqual([4 * MBPS, 4 * MBPS, 4 * MBPS]);
    expect(pairCeilings(12 * MBPS, [])).toEqual([]);
  });

  it("is the lower of a pair's fair share and what its own link carries", () => {
    expect(pairCeilings(12 * MBPS, [via(1 * MBPS), open, open])[0]).toBe(1 * MBPS);
    // A link above the equal share is not the lower one.
    expect(pairCeilings(12 * MBPS, [via(9 * MBPS), open, open])).toEqual([
      4 * MBPS,
      4 * MBPS,
      4 * MBPS,
    ]);
  });

  it("gives the share a link-limited viewer can't use to the others", () => {
    // The first viewer's link carries 1 Mbps: the other two share the remaining 11.
    expect(pairCeilings(12 * MBPS, [via(1 * MBPS), open, open])).toEqual([
      1 * MBPS,
      5.5 * MBPS,
      5.5 * MBPS,
    ]);
  });

  it("settles cascading limits: what the second leaves is shared again", () => {
    // 10 Mbps over four is 2.5 each, but one carries only 1 (so 3 each), and another only 3.
    expect(pairCeilings(10 * MBPS, [via(1 * MBPS), via(3 * MBPS), open, open])).toEqual([
      1 * MBPS,
      3 * MBPS,
      3 * MBPS,
      3 * MBPS,
    ]);
    // A viewer whose link only just exceeds the first share is limited by it once others leave.
    expect(pairCeilings(10 * MBPS, [via(0.5 * MBPS), via(2.7 * MBPS), open, open])).toEqual([
      0.5 * MBPS,
      2.7 * MBPS,
      3.4 * MBPS,
      3.4 * MBPS,
    ]);
  });

  it("leaves budget unused when every viewer is limited, and never goes negative", () => {
    expect(pairCeilings(10 * MBPS, [via(1 * MBPS), via(2 * MBPS)])).toEqual([1 * MBPS, 2 * MBPS]);
    expect(pairCeilings(-5, [open, via(3)])).toEqual([0, 0]);
  });
});

describe("ceilingOf", () => {
  it("is the lower of a pair's fair share and what its own link carries", () => {
    expect(ceilingOf({ fairShare: 5_000_000 })).toBe(5_000_000);
    expect(ceilingOf({ fairShare: 5_000_000, link: 2_000_000 })).toBe(2_000_000);
    expect(ceilingOf({ fairShare: 5_000_000, link: 8_000_000 })).toBe(5_000_000);
  });
});

describe("aboveCeiling", () => {
  it("is how far a target is over its ceiling, and 0 within it or without one", () => {
    expect(aboveCeiling(10_670_000, 7_670_000)).toBe(3_000_000);
    expect(aboveCeiling(5_000_000, 7_670_000)).toBe(0);
    expect(aboveCeiling(7_670_000, 7_670_000)).toBe(0);
    expect(aboveCeiling(5_000_000)).toBe(0);
  });
});

describe("shedFirst", () => {
  const screen = (bitrate: number, over = 0) => ({ camera: false, bitrate, over });
  const camera = (bitrate: number) => ({ camera: true, bitrate });
  it("steps a camera down before any screen, however heavy the screens are", () => {
    expect(shedFirst([screen(6_000_000, 2_000_000), camera(500_000), screen(3_000_000)])).toBe(1);
    expect(shedFirst([camera(150_000), screen(6_000_000), camera(500_000)])).toBe(2);
  });

  it("then steps down the screen furthest above its ceiling, and then the heaviest", () => {
    // The pair that took what others are entitled to goes first, though it isn't the heaviest.
    expect(
      shedFirst([screen(6_000_000), screen(5_000_000, 3_000_000), screen(10_000_000, 1_000_000)]),
    ).toBe(1);
    // Within their ceilings (over 0), the heaviest goes first.
    expect(shedFirst([screen(6_000_000, 0), screen(10_000_000, 0), screen(8_000_000, 0)])).toBe(1);
    expect(shedFirst([screen(3_000_000), screen(6_000_000), screen(4_000_000)])).toBe(1);
    expect(shedFirst([])).toBeUndefined();
  });
});

describe("probeClaim", () => {
  const MBPS = 1_000_000;
  const viewer = (target: number, ceiling: number) => ({ camera: false, target, ceiling });
  const camera = (target: number) => ({ camera: true, target });

  it("entitles a screen to climb to its own ceiling, whoever sits above theirs", () => {
    // 23 Mbps over three viewers: 7.67 each. Two sit at 10.67, the third at 1.33 wants 2.08.
    const claims = [
      viewer(10.67 * MBPS, 7.67 * MBPS),
      viewer(10.67 * MBPS, 7.67 * MBPS),
      viewer(1.33 * MBPS, 7.67 * MBPS),
    ];
    expect(probeClaim(claims, 2, 2.08 * MBPS).within).toBe(true);
    expect(probeClaim(claims, 2, 7.67 * MBPS).within).toBe(true);
    expect(probeClaim(claims, 2, 10.67 * MBPS).within).toBe(false);
  });

  it("counts every other viewer at no less than its ceiling when a screen would pass its own", () => {
    // Beyond its ceiling, a screen needs room that nobody is entitled to: a viewer that hasn't
    // started (target 0) still has its share kept.
    const claims = [viewer(5 * MBPS, 7.67 * MBPS), viewer(0, 7.67 * MBPS), viewer(0, 7.67 * MBPS)];
    const { within, committed } = probeClaim(claims, 0, 10.67 * MBPS);
    expect(within).toBe(false);
    expect(committed).toBe((5 + 7.67 + 7.67) * MBPS);
    // Another above its ceiling counts at what it targets.
    const above = [viewer(5 * MBPS, 7.67 * MBPS), viewer(9 * MBPS, 7.67 * MBPS)];
    expect(probeClaim(above, 0, 10 * MBPS).committed).toBe(14 * MBPS);
  });

  it("counts a camera at its target, and a camera's own probe is never within a ceiling", () => {
    const claims = [viewer(3 * MBPS, 8 * MBPS), camera(0.15 * MBPS), camera(0.5 * MBPS)];
    expect(probeClaim(claims, 1, 0.5 * MBPS)).toEqual({
      within: false,
      committed: 8 * MBPS + 0.65 * MBPS,
    });
    expect(probeClaim(claims, -1, 0.5 * MBPS).within).toBe(false);
  });
});

describe("nextRung", () => {
  it("steps down one rung after loss in consecutive samples, not after a single one", () => {
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, LOSSY), 2)).toBe(1);
    expect(nextRung(SCREEN_LADDER, [LOSSY], 2)).toBe(2);
    expect(nextRung(SCREEN_LADDER, [GOOD, LOSSY], 2)).toBe(2);
    expect(nextRung(SCREEN_LADDER, [LOSSY, GOOD], 2)).toBe(2);
  });

  it("steps down for a long round trip or a CPU limit", () => {
    for (const bad of [
      { ...GOOD, rttMs: 800 },
      { ...GOOD, limit: "cpu" as const },
    ]) {
      expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, bad), 3)).toBe(2);
    }
  });

  it("steps down for a bandwidth limit only when the estimate is below what is being sent", () => {
    const short = {
      ...GOOD,
      limit: "bandwidth" as const,
      sendBitrate: 3_000_000,
      availableBitrate: 1_000_000,
    };
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, short), 3)).toBeLessThan(3);
    // Our own maxBitrate is the constraint: the estimate is ample, so this isn't the network.
    const selfCapped = { ...short, sendBitrate: 3_000_000, availableBitrate: 3_200_000 };
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, selfCapped), 3)).toBe(3);
    // Nothing known of the estimate or the send rate: not evidence.
    const blind = { loss: 0, limit: "bandwidth" as const };
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, blind), 3)).toBe(3);
  });

  it("goes down as far as the estimate says it must, and no further than the lowest rung", () => {
    const starved = { ...LOSSY, availableBitrate: 2_000_000 };
    // 2 Mbps: 720p30 (1.5 Mbps) is the highest rung that fits below 1080p60.
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, starved), TOP)).toBe(0);
    const some = { ...LOSSY, availableBitrate: 2_500_000 };
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, some), TOP)).toBe(1);
    // What another sender to the peer sends isn't there for this one.
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, some), TOP, { reserved: 1_000_000 })).toBe(
      0,
    );
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, LOSSY), 0)).toBe(0);
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, LOSSY), 2, { min: 2 })).toBe(2);
  });

  it("never steps down for a still screen that sends next to nothing on a healthy link", () => {
    const still = { ...GOOD, sendBitrate: 20_000, availableBitrate: 300_000 };
    expect(nextRung(SCREEN_LADDER, times(20, still), 2)).toBe(3);
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, still), 2)).toBe(2);
    const stillCapped = { ...still, limit: "bandwidth" as const };
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, stillCapped), 2)).toBe(2);
  });

  it("probes up one rung after a full clean window, with no headroom asked of the estimate", () => {
    expect(nextRung(SCREEN_LADDER, times(UP_SAMPLES - 1, GOOD), 1)).toBe(1);
    expect(nextRung(SCREEN_LADDER, times(UP_SAMPLES, GOOD), 1)).toBe(2);
    // The estimate only probes up to about the rung's own bitrate: still fine to try the next.
    const atCap = { ...GOOD, availableBitrate: 3_000_000, limit: "bandwidth" as const };
    expect(nextRung(SCREEN_LADDER, times(UP_SAMPLES, atCap), 2)).toBe(3);
    // Any blip resets the wait.
    const blip = [...times(2, GOOD), { ...GOOD, loss: 0.02 }, ...times(2, GOOD)];
    expect(nextRung(SCREEN_LADDER, blip, 1)).toBe(1);
    expect(
      nextRung(SCREEN_LADDER, times(UP_SAMPLES, { ...GOOD, limit: "cpu" }), 1, { min: 1 }),
    ).toBe(1);
    const blind = { loss: 0, limit: "none" as const };
    expect(nextRung(SCREEN_LADDER, times(UP_SAMPLES, blind), 2)).toBe(3);
  });

  it("waits twice as long per failed probe, up to a limit", () => {
    expect(nextRung(SCREEN_LADDER, times(UP_SAMPLES, GOOD), 1, { backoff: 1 })).toBe(1);
    expect(nextRung(SCREEN_LADDER, times(UP_SAMPLES * 2, GOOD), 1, { backoff: 1 })).toBe(2);
    expect(nextRung(SCREEN_LADDER, times(UP_SAMPLES * 2, GOOD), 1, { backoff: 2 })).toBe(1);
    const most = UP_SAMPLES * 2 ** MAX_BACKOFF;
    expect(nextRung(SCREEN_LADDER, times(most, GOOD), 1, { backoff: 99 })).toBe(2);
  });

  it("never goes beyond the caps", () => {
    expect(nextRung(SCREEN_LADDER, times(UP_SAMPLES, GOOD), TOP)).toBe(TOP);
    expect(nextRung(SCREEN_LADDER, times(UP_SAMPLES, GOOD), 2, { max: 2 })).toBe(2);
    // A rung outside the caps moves inside at once, whatever the samples say.
    expect(nextRung(SCREEN_LADDER, [], 4, { max: 1 })).toBe(1);
    expect(nextRung(SCREEN_LADDER, [], 0, { min: 1 })).toBe(1);
  });
});

describe("step", () => {
  it("climbs a fast clean link rung by rung to the cap, and stays there", () => {
    const { rungs } = run(times(UP_SAMPLES * 4 + 5, GOOD), 0);
    expect(rungs[UP_SAMPLES - 1]).toBe(1);
    expect(rungs[UP_SAMPLES * 2 - 1]).toBe(2);
    expect(rungs[UP_SAMPLES * 3 - 1]).toBe(3);
    expect(rungs.at(-1)).toBe(TOP);
    const capped = run(times(UP_SAMPLES * 4 + 5, GOOD), 0, 2);
    expect(capped.rungs.at(-1)).toBe(2);
  });

  it("steps a lossy link down", () => {
    expect(run(times(DOWN_SAMPLES, LOSSY)).rungs).toEqual([2, 1]);
    expect(run(times(DOWN_SAMPLES * 4, LOSSY), TOP).rungs.at(-1)).toBeLessThan(TOP);
  });

  it("backs off after a failed probe, and waits longer before the next", () => {
    // Clean window: probe up to 3. Lossy: back down. Then 5 clean samples aren't enough.
    const failed = run([...times(UP_SAMPLES, GOOD), ...times(DOWN_SAMPLES, LOSSY)]);
    expect(failed.rungs.at(-1)).toBe(2);
    expect(failed.state.backoff).toBe(1);
    const again = (n: number) =>
      run([...times(UP_SAMPLES, GOOD), ...times(DOWN_SAMPLES, LOSSY), ...times(n, GOOD)]);
    expect(again(UP_SAMPLES).rungs.at(-1)).toBe(2);
    expect(again(UP_SAMPLES * 2).rungs.at(-1)).toBe(3);
    // A second failure doubles it again.
    const twice = run([
      ...times(UP_SAMPLES, GOOD),
      ...times(DOWN_SAMPLES, LOSSY),
      ...times(UP_SAMPLES * 2, GOOD),
      ...times(DOWN_SAMPLES, LOSSY),
    ]);
    expect(twice.state.backoff).toBe(2);
    expect(twice.rungs.at(-1)).toBe(2);
  });

  it("forgets the backoff once a probe has held for a window", () => {
    const held = run([
      ...times(UP_SAMPLES, GOOD),
      ...times(DOWN_SAMPLES, LOSSY),
      ...times(UP_SAMPLES * 2, GOOD), // probe up again
      ...times(UP_SAMPLES, GOOD), // and it holds
    ]);
    expect(held.state.backoff).toBe(0);
    expect(held.state.probing).toBe(false);
  });

  it("marks a sender its own link holds down, until a higher step has held", () => {
    expect(freshLadderState(2).limited).toBe(false);
    // A step down under pressure is the link holding it down; so is a probe that failed.
    const down = run(times(DOWN_SAMPLES, LOSSY));
    expect(down.state.limited).toBe(true);
    // A step up on a clean window is a probe: it is still held until it has held for a window.
    const probing = run([...times(DOWN_SAMPLES, LOSSY), ...times(UP_SAMPLES, GOOD)], 2);
    expect(probing.state).toMatchObject({ probing: true, limited: true });
    const held = run([...times(DOWN_SAMPLES, LOSSY), ...times(UP_SAMPLES * 2, GOOD)], 2, 2);
    expect(held.state).toMatchObject({ probing: false, limited: false });
  });

  it("doesn't count a step down for pressure that wasn't a probe as a failed probe", () => {
    expect(run(times(DOWN_SAMPLES, LOSSY)).state.backoff).toBe(0);
  });

  it("drops a camera from 360p15 to 180p under pressure, and back once it's clean", () => {
    expect(CAMERA_LADDER[CAMERA_DEFAULT_RUNG]?.label).toBe("360p15");
    expect(nextRung(CAMERA_LADDER, times(DOWN_SAMPLES, LOSSY), CAMERA_DEFAULT_RUNG)).toBe(0);
    expect(CAMERA_LADDER[0]?.label).toBe("180p15");
    expect(nextRung(CAMERA_LADDER, times(UP_SAMPLES, GOOD), 0)).toBe(CAMERA_DEFAULT_RUNG);
  });
});

describe("fitRung", () => {
  it("picks the highest rung that fits the room, never below the lowest", () => {
    expect(fitRung(SCREEN_LADDER, 10_000_000)).toBe(TOP);
    expect(fitRung(SCREEN_LADDER, 3_000_000)).toBe(2);
    expect(fitRung(SCREEN_LADDER, 2_999_999)).toBe(1);
    expect(fitRung(SCREEN_LADDER, 0)).toBe(0);
    // Not above the top it is given (the capture's cap, or the default).
    expect(fitRung(SCREEN_LADDER, 10_000_000, SCREEN_DEFAULT_RUNG)).toBe(SCREEN_DEFAULT_RUNG);
  });
});

describe("strained and probeDue", () => {
  it("counts loss, a long round trip and a short estimate as strain, but not a CPU limit", () => {
    expect(strained(GOOD)).toBe(false);
    expect(strained(LOSSY)).toBe(true);
    expect(strained({ ...GOOD, rttMs: 800 })).toBe(true);
    expect(
      strained({
        ...GOOD,
        limit: "bandwidth",
        sendBitrate: 3_000_000,
        availableBitrate: 1_000_000,
      }),
    ).toBe(true);
    // A CPU-bound encoder is slow on every pair at once whatever the uplink is.
    expect(strained({ ...GOOD, limit: "cpu" })).toBe(false);
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, { ...GOOD, limit: "cpu" }), 3)).toBe(2);
  });

  it("is due once a full clean window has gathered, waiting longer after failed probes", () => {
    expect(probeDue(times(UP_SAMPLES - 1, GOOD))).toBe(false);
    expect(probeDue(times(UP_SAMPLES, GOOD))).toBe(true);
    // Not pressured, but not clean either (1 to 5% loss): never due.
    expect(probeDue(times(UP_SAMPLES * 2, { ...GOOD, loss: 0.03 }))).toBe(false);
    expect(probeDue(times(UP_SAMPLES, GOOD), 1)).toBe(false);
    expect(probeDue(times(UP_SAMPLES * 2, GOOD), 1)).toBe(true);
  });
});

describe("UplinkBudget", () => {
  const MBPS = 1_000_000;
  const calm = { pairs: 4, strainedPairs: 0, sent: 10 * MBPS };
  const shared = { pairs: 4, strainedPairs: 3, sent: 10 * MBPS };
  const pass = (budget: UplinkBudget, reading: typeof calm, n = 1) => {
    for (let i = 0; i < n; i++) budget.observe(reading);
  };

  it("starts at the floor ADR 2 assumes less an audio allowance, and says what room is left", () => {
    const budget = new UplinkBudget();
    expect(budget.limit).toBe(INITIAL_UPLINK);
    expect(INITIAL_UPLINK).toBe(UPLINK_FLOOR - AUDIO_ALLOWANCE);
    expect(AUDIO_ALLOWANCE).toBeGreaterThanOrEqual(1_700_000);
    expect(budget.room(20 * MBPS)).toBe(INITIAL_UPLINK - 20 * MBPS);
    expect(budget.room(30 * MBPS)).toBe(0);
  });

  it("is an estimate until the uplink has been measured under strain", () => {
    const budget = new UplinkBudget();
    expect(budget.measured).toBe(false);
    // A clean spell and a probe that grows it are not a measurement of the uplink's limit.
    pass(budget, calm, UP_SAMPLES);
    expect(budget.admit(INITIAL_UPLINK, 1.5 * MBPS)).toBe(true);
    expect(budget.measured).toBe(false);
    // One strained pass isn't enough either; two in a row measure it.
    pass(budget, shared);
    expect(budget.measured).toBe(false);
    pass(budget, shared);
    expect(budget.measured).toBe(true);
    // Strain with nothing sent measures nothing.
    const idle = new UplinkBudget();
    pass(idle, { ...shared, sent: 0 }, 2);
    expect(idle.measured).toBe(false);
  });

  it("admits what fits, and refuses what doesn't before a clean spell", () => {
    const budget = new UplinkBudget(10 * MBPS);
    expect(budget.admit(8 * MBPS, 2 * MBPS)).toBe(true);
    expect(budget.admit(8 * MBPS, 2.5 * MBPS)).toBe(false);
    pass(budget, calm, UP_SAMPLES - 1);
    expect(budget.admit(8 * MBPS, 2.5 * MBPS)).toBe(false);
    expect(budget.limit).toBe(10 * MBPS);
  });

  it("grows by just the one probe after a clean spell, so the next must wait", () => {
    const budget = new UplinkBudget(10 * MBPS);
    pass(budget, calm, UP_SAMPLES);
    expect(budget.admit(10 * MBPS, 1.5 * MBPS)).toBe(true);
    expect(budget.limit).toBe(11.5 * MBPS);
    expect(budget.admit(11.5 * MBPS, 1.5 * MBPS)).toBe(false);
    pass(budget, calm, UP_SAMPLES);
    expect(budget.admit(11.5 * MBPS, 1.5 * MBPS)).toBe(true);
    // Not on a sender's turn: it waits.
    pass(budget, calm, UP_SAMPLES);
    expect(budget.admit(13 * MBPS, 1.5 * MBPS, false)).toBe(false);
  });

  it("drops to a share of what was sent when most pairs are strained, not on one bad link", () => {
    const budget = new UplinkBudget(12 * MBPS);
    pass(budget, { pairs: 4, strainedPairs: 1, sent: 10 * MBPS }, 5);
    pass(budget, { pairs: 1, strainedPairs: 1, sent: 10 * MBPS }, 5);
    expect(budget.limit).toBe(12 * MBPS);
    // Two in a row, as a step down needs; one such reading isn't enough.
    pass(budget, shared);
    expect(budget.limit).toBe(12 * MBPS);
    pass(budget, shared);
    expect(budget.limit).toBe(10 * MBPS * UPLINK_SHARE);
    // Half the pairs is enough, but never a lone strained one of two.
    const half = new UplinkBudget(8 * MBPS);
    pass(half, { pairs: 2, strainedPairs: 1, sent: 7 * MBPS }, 4);
    expect(half.limit).toBe(8 * MBPS);
    pass(half, { pairs: 2, strainedPairs: 2, sent: 7 * MBPS }, 2);
    expect(half.limit).toBe(7 * MBPS * UPLINK_SHARE);
  });

  it("bounds one drop, so a quiet scene sending next to nothing doesn't collapse it", () => {
    const budget = new UplinkBudget(20 * MBPS);
    pass(budget, { ...shared, sent: 0.5 * MBPS }, 2);
    expect(budget.limit).toBe(20 * MBPS * UPLINK_DROP_LIMIT);
    // A real shortage keeps lowering it, a step at a time.
    pass(budget, { ...shared, sent: 0.5 * MBPS }, 2);
    expect(budget.limit).toBeCloseTo(20 * MBPS * UPLINK_DROP_LIMIT ** 2, 0);
  });

  it("never raises the budget by pressure, and recovers one probe at a time once it clears", () => {
    const budget = new UplinkBudget(20 * MBPS);
    pass(budget, { ...shared, sent: 30 * MBPS }, 2);
    expect(budget.limit).toBe(20 * MBPS);
    pass(budget, shared, 2);
    const lowered = budget.limit;
    expect(lowered).toBeLessThan(20 * MBPS);
    pass(budget, calm, UP_SAMPLES);
    expect(budget.admit(lowered, MBPS)).toBe(true);
    expect(budget.limit).toBe(lowered + MBPS);
  });

  it("waits twice as long after a growth that brought pressure back, until one holds", () => {
    const budget = new UplinkBudget(10 * MBPS);
    pass(budget, calm, UP_SAMPLES);
    expect(budget.admit(10 * MBPS, MBPS)).toBe(true);
    // The pressure returns before the growth held: backoff.
    pass(budget, shared, 2);
    pass(budget, calm, UP_SAMPLES);
    expect(budget.admit(budget.limit, MBPS)).toBe(false);
    pass(budget, calm, UP_SAMPLES);
    expect(budget.admit(budget.limit, MBPS)).toBe(true);
    // This one holds for a window: the wait is the short one again.
    pass(budget, calm, UP_SAMPLES);
    expect(budget.admit(budget.limit, MBPS)).toBe(true);
  });
});

describe("readSample", () => {
  const report = (entries: Record<string, unknown>[]) =>
    new Map(entries.map((e) => [e.id as string, e])) as unknown as RTCStatsReport;

  it("reads the estimate, round trip, loss, limit and codec of a video sender", () => {
    const sample = readSample(
      report([
        { id: "t", type: "transport", selectedCandidatePairId: "p2" },
        { id: "p1", type: "candidate-pair", availableOutgoingBitrate: 1, currentRoundTripTime: 9 },
        {
          id: "p2",
          type: "candidate-pair",
          availableOutgoingBitrate: 4_000_000,
          currentRoundTripTime: 0.05,
        },
        {
          id: "o",
          type: "outbound-rtp",
          kind: "video",
          qualityLimitationReason: "bandwidth",
          codecId: "c",
        },
        { id: "c", type: "codec", mimeType: "video/VP9" },
        { id: "r", type: "remote-inbound-rtp", kind: "video", fractionLost: 0.03 },
      ]),
    );
    expect(sample).toEqual({
      availableBitrate: 4_000_000,
      loss: 0.03,
      rttMs: 50,
      limit: "bandwidth",
      codec: "video/VP9",
    });
  });

  it("measures what was sent since the previous reading", () => {
    const at = (bytesSent: number, timestamp: number) =>
      report([{ id: "o", type: "outbound-rtp", kind: "video", bytesSent, timestamp }]);
    const first = readSample(at(1_000, 10_000));
    expect(first.sendBitrate).toBeUndefined();
    // 500,000 bytes in 4 s: 1 Mbps.
    expect(readSample(at(501_000, 14_000), first).sendBitrate).toBe(1_000_000);
  });

  it("copes with browsers that report less", () => {
    expect(readSample(report([{ id: "o", type: "outbound-rtp", kind: "video" }]))).toEqual({
      loss: 0,
      limit: "none",
    });
  });
});

describe("seedBitrate (ADR 2 addendum: the seeded estimate)", () => {
  it("is 90% of the start step's maxBitrate", () => {
    expect(START_BITRATE_SHARE).toBe(0.9);
    // Worked by hand: 90% of 6 Mbps, of 3 Mbps, and of the 2968x1242@60 step's 10.67 Mbps.
    expect(seedBitrate(6_000_000)).toBe(5_400_000);
    expect(seedBitrate(3_000_000)).toBe(2_700_000);
    const ultrawide = screenSteps({ width: 3440, height: 1440, frameRate: 60 }, "size");
    const top = ultrawide[ultrawide.length - 1] as Rung;
    expect(top.label).toBe("2968×1242@60");
    expect(top.maxBitrate).toBe(10_670_000);
    expect(seedBitrate(top.maxBitrate)).toBe(9_603_000);
  });

  it("is 90% of the scaled cap on H.264 or VP8, and still never above the ceiling", () => {
    const step1080 = SCREEN_LADDER[SCREEN_DEFAULT_RUNG] as Rung;
    expect(seedBitrate(codecCap(step1080, "video/H264"))).toBe(4_050_000);
    expect(seedBitrate(codecCap(step1080, "video/VP8"), 4_000_000)).toBe(4_000_000);
    expect(seedBitrate(codecCap(step1080, "video/VP9"))).toBe(2_700_000);
  });

  it("never passes the pair's ceiling", () => {
    expect(seedBitrate(6_000_000, 4_000_000)).toBe(4_000_000);
    expect(seedBitrate(6_000_000, 5_400_000)).toBe(5_400_000);
    expect(seedBitrate(6_000_000, 20_000_000)).toBe(5_400_000);
  });
});

describe("codecCap (ADR 2 addendum: caps by codec)", () => {
  const step1080 = SCREEN_LADDER[SCREEN_DEFAULT_RUNG] as Rung;

  it("scales a step's maxBitrate by 1.5 for H.264 and VP8, and leaves AV1 and VP9", () => {
    expect(CODEC_CAP_SCALE).toBe(1.5);
    expect(step1080.maxBitrate).toBe(3_000_000);
    expect(codecCap(step1080, "video/H264")).toBe(4_500_000);
    expect(codecCap(step1080, "video/VP8")).toBe(4_500_000);
    expect(codecCap(step1080, "video/VP9")).toBe(3_000_000);
    expect(codecCap(step1080, "video/AV1")).toBe(3_000_000);
    // Cameras are steps too.
    expect(codecCap(CAMERA_LADDER[0] as Rung, "video/H264")).toBe(225_000);
    expect(codecCap(CAMERA_LADDER[1] as Rung, "video/VP8")).toBe(750_000);
  });

  it("goes by the MIME type whatever its case, and leaves an unknown codec at the step's cap", () => {
    expect(codecCap(step1080, "video/h264")).toBe(4_500_000);
    expect(codecCap(step1080, "VIDEO/VP8")).toBe(4_500_000);
    expect(codecCap(step1080, undefined)).toBe(3_000_000);
    expect(codecCap(step1080, "video/H265")).toBe(3_000_000);
  });

  it("is a whole number of bits per second", () => {
    expect(codecCap({ ...step1080, maxBitrate: 1_000_001 }, "video/VP8")).toBe(1_500_002);
  });

  it("scales a whole ladder, keeping labels, sizes and rates", () => {
    const scaled = scaleSteps(SCREEN_LADDER, "video/H264");
    expect(scaled.map((s) => s.label)).toEqual(SCREEN_LADDER.map((s) => s.label));
    expect(scaled.map((s) => s.maxBitrate)).toEqual(
      SCREEN_LADDER.map((s) => s.maxBitrate * CODEC_CAP_SCALE),
    );
    expect(scaled.map((s) => [s.height, s.frameRate])).toEqual(
      SCREEN_LADDER.map((s) => [s.height, s.frameRate]),
    );
    expect(scaleSteps(SCREEN_LADDER, "video/AV1")).toEqual(SCREEN_LADDER);
    expect(scaleSteps(SCREEN_LADDER, undefined)).toEqual(SCREEN_LADDER);
  });

  it("moves the ladder's decisions: the fit, and a step down to what the estimate carries", () => {
    // 5 Mbps fits 1080p30 on AV1 (3 Mbps), but 1080p60 (6 Mbps) only fits as H.264's 1080p30 (4.5).
    const h264 = scaleSteps(SCREEN_LADDER, "video/H264");
    expect(fitRung(SCREEN_LADDER, 4_000_000)).toBe(2);
    expect(fitRung(h264, 4_000_000)).toBe(1);
    expect(fitRung(h264, 4_500_000)).toBe(2);
    const lossy = times(DOWN_SAMPLES, { ...LOSSY, availableBitrate: 4_000_000 });
    expect(nextRung(SCREEN_LADDER, lossy, TOP)).toBe(2);
    expect(nextRung(h264, lossy, TOP)).toBe(1);
  });
});

describe("paceOf (ADR 2 addendum: a share's first minute)", () => {
  it("ignores 1 warm-up reading and probes after 2 clean samples for the first 60 s", () => {
    expect(FIRST_MINUTE_MS).toBe(60_000);
    expect(paceOf(0)).toEqual({ warmup: 1, upSamples: 2 });
    expect(paceOf(59_999)).toEqual({ warmup: FIRST_MINUTE_WARMUP_READINGS, upSamples: 2 });
    expect(FIRST_MINUTE_UP_SAMPLES).toBe(2);
  });

  it("goes back to the normal windows at 60 s", () => {
    expect(paceOf(60_000)).toEqual({ warmup: 2, upSamples: 5 });
    expect(paceOf(10 * 60_000)).toEqual({ warmup: WARMUP_READINGS, upSamples: UP_SAMPLES });
  });

  it("takes a clock that went back for no first minute at all", () => {
    expect(paceOf(-1)).toEqual({ warmup: WARMUP_READINGS, upSamples: UP_SAMPLES });
  });
});

describe("a probe up in the first minute", () => {
  const FAST = { max: TOP, upSamples: FIRST_MINUTE_UP_SAMPLES };

  it("needs 2 clean samples where the normal pace needs 5", () => {
    expect(probeDue(times(2, GOOD), 0, FIRST_MINUTE_UP_SAMPLES)).toBe(true);
    expect(probeDue(times(1, GOOD), 0, FIRST_MINUTE_UP_SAMPLES)).toBe(false);
    expect(probeDue(times(2, GOOD))).toBe(false);
    expect(probeDue(times(UP_SAMPLES, GOOD))).toBe(true);
  });

  it("waits twice as long after each failed probe, as the normal pace does", () => {
    expect(probeDue(times(3, GOOD), 1, FIRST_MINUTE_UP_SAMPLES)).toBe(false);
    expect(probeDue(times(4, GOOD), 1, FIRST_MINUTE_UP_SAMPLES)).toBe(true);
  });

  it("moves a sender up after 2 clean samples, and still not after 1", () => {
    expect(nextRung(SCREEN_LADDER, times(1, GOOD), 1, FAST)).toBe(1);
    expect(nextRung(SCREEN_LADDER, times(2, GOOD), 1, FAST)).toBe(2);
    expect(nextRung(SCREEN_LADDER, times(2, GOOD), 1, { max: TOP })).toBe(1);
  });

  it("steps down as it always did: 2 pressured samples in a row", () => {
    expect(nextRung(SCREEN_LADDER, times(1, LOSSY), 2, FAST)).toBe(2);
    expect(nextRung(SCREEN_LADDER, times(DOWN_SAMPLES, LOSSY), 2, FAST)).toBeLessThan(2);
    // One clean sample between pressured ones breaks the run, as at the normal pace.
    expect(nextRung(SCREEN_LADDER, [LOSSY, GOOD, LOSSY], 2, FAST)).toBe(2);
  });

  it("goes the same way through `step`: up after 2 clean samples, and the probe is on", () => {
    let state = freshLadderState(1);
    state = step(SCREEN_LADDER, state, GOOD, FAST);
    expect(state.rung).toBe(1);
    state = step(SCREEN_LADDER, state, GOOD, FAST);
    expect(state).toMatchObject({ rung: 2, probing: true, window: [] });
  });

  it("counts a probe as held after the same 2 clean samples, and as failed on pressure", () => {
    let state = step(
      SCREEN_LADDER,
      step(SCREEN_LADDER, freshLadderState(1), GOOD, FAST),
      GOOD,
      FAST,
    );
    expect(state).toMatchObject({ rung: 2, probing: true });
    // Clean again for the pace's window: it held, and the wait is back to the shortest.
    const held = step(SCREEN_LADDER, step(SCREEN_LADDER, state, GOOD, { ...FAST, max: 2 }), GOOD, {
      ...FAST,
      max: 2,
    });
    expect(held).toMatchObject({ rung: 2, probing: false, backoff: 0 });
    // Pressure on the probe brings it back and doubles the wait: 4 clean samples, not 2.
    for (let i = 0; i < DOWN_SAMPLES; i++) state = step(SCREEN_LADDER, state, LOSSY, FAST);
    expect(state).toMatchObject({ rung: 1, probing: false, backoff: 1 });
    expect(probeDue(times(3, GOOD), state.backoff, FIRST_MINUTE_UP_SAMPLES)).toBe(false);
    expect(probeDue(times(4, GOOD), state.backoff, FIRST_MINUTE_UP_SAMPLES)).toBe(true);
  });
});
