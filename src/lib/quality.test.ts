import { describe, expect, it } from "vitest";
import {
  CAMERA_DEFAULT_RUNG,
  CAMERA_LADDER,
  captureCap,
  DOWN_SAMPLES,
  freshLadderState,
  MAX_BACKOFF,
  nextRung,
  readSample,
  SCREEN_DEFAULT_RUNG,
  SCREEN_LADDER,
  type StatsSample,
  step,
  UP_SAMPLES,
} from "./quality";

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

describe("screen ladder", () => {
  it("runs from 720p30 up to 1080p60, starting at 1080p30", () => {
    expect(SCREEN_LADDER[0]?.label).toBe("720p30");
    expect(SCREEN_LADDER[TOP]?.label).toBe("1080p60");
    expect(SCREEN_LADDER[SCREEN_DEFAULT_RUNG]?.label).toBe("1080p30");
    const bitrates = SCREEN_LADDER.map((r) => r.maxBitrate);
    expect(bitrates).toEqual([...bitrates].sort((a, b) => a - b));
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

describe("captureCap", () => {
  it("caps the ladder at what the capture can feed", () => {
    expect(captureCap(SCREEN_LADDER, { height: 1080, frameRate: 60 })).toBe(TOP);
    expect(captureCap(SCREEN_LADDER, { height: 1080, frameRate: 30 })).toBe(2);
    expect(captureCap(SCREEN_LADDER, { height: 720, frameRate: 60 })).toBe(0);
    expect(captureCap(SCREEN_LADDER, { height: 1440, frameRate: 59.94 })).toBe(TOP);
    expect(captureCap(CAMERA_LADDER, { height: 360, frameRate: 12 })).toBe(1);
    expect(captureCap(SCREEN_LADDER, {})).toBe(TOP);
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
