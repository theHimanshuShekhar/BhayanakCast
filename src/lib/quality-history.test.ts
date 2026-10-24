import { describe, expect, it } from "vitest";
import { MAX_READING_GAP_MS } from "./quality-collector";
import { HISTORY_MS, MAX_CHANGES, pathLabel, QualityHistory, stepChange } from "./quality-history";
import type { StreamReading } from "./quality-telemetry";

// The last minute of each stream, kept in memory for the quality modal, fed with the readings the
// Mesh takes of its senders and receivers.

/** A clock the test moves. */
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** A receiver's reading `s` seconds in: 500 kB a second (4 Mbps), `lost` packets lost so far. */
const reading = (s: number, extra: Partial<StreamReading> = {}): StreamReading => ({
  at: 50_000 + s * 1_000,
  bytes: 500_000 * s,
  packetsReceived: 100 * s,
  packetsLost: 0,
  frameWidth: 1920,
  frameHeight: 1080,
  fps: 30,
  codec: "video/VP9",
  ...extra,
});

/** Feed a stream one reading a second for `seconds` seconds, moving the clock with it. */
function feed(h: QualityHistory, c: ReturnType<typeof clock>, key: string, seconds: number) {
  for (let s = 0; s <= seconds; s++) {
    h.observe(key, reading(s));
    c.advance(1_000);
  }
}

describe("QualityHistory", () => {
  it("measures from two readings: the first only sets the baseline", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    expect(h.observe("recv/ana", reading(0))).toBeUndefined();
    expect(h.points("recv/ana")).toEqual([]);
    c.advance(1_000);
    expect(h.observe("recv/ana", reading(1))).toMatchObject({
      at: c.now(),
      bps: 4_000_000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "video/VP9",
    });
    expect(h.points("recv/ana")).toHaveLength(1);
  });

  it("takes a receiver's loss from the packets it lost since the previous reading", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    h.observe("recv/ana", reading(0));
    c.advance(1_000);
    // 100 arrived and 25 were lost in the second: a fifth of the packets.
    const point = h.observe("recv/ana", reading(1, { packetsLost: 25 }));
    expect(point?.loss).toBeCloseTo(0.2);
  });

  it("takes a sender's loss as its receiver reported it, and keeps the cap it was given", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    h.observe("send/bo", reading(0, { loss: 0.01 }), 3_000_000);
    c.advance(1_000);
    const point = h.observe("send/bo", reading(1, { loss: 0.04 }), 2_080_000);
    expect(point).toMatchObject({ loss: 0.04, capBps: 2_080_000 });
  });

  it("counts freezes from the first reading of the share, not the receiver's lifetime", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    h.observe("recv/ana", reading(0, { freezes: 7 }));
    c.advance(1_000);
    expect(h.observe("recv/ana", reading(1, { freezes: 7 }))?.freezes).toBe(0);
    c.advance(1_000);
    expect(h.observe("recv/ana", reading(2, { freezes: 9 }))?.freezes).toBe(2);
  });

  it("keeps only the last minute", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    feed(h, c, "recv/ana", 90);
    const points = h.points("recv/ana");
    // 91 readings a second apart make 90 points; the 60 within a minute of now stay.
    expect(points.at(-1)?.at).toBe(c.now() - 1_000);
    expect(points[0]?.at).toBeGreaterThanOrEqual(c.now() - HISTORY_MS);
    expect(points).toHaveLength(HISTORY_MS / 1_000);
  });

  it("stops showing points as they age out, even if nothing new arrives", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    feed(h, c, "recv/ana", 10);
    expect(h.points("recv/ana")).toHaveLength(10);
    c.advance(HISTORY_MS - 5_000);
    // The newest are 5 to 15 seconds shy of a minute old; the rest are gone.
    expect(h.points("recv/ana").length).toBeGreaterThan(0);
    expect(h.points("recv/ana").length).toBeLessThan(10);
    c.advance(10_000);
    expect(h.points("recv/ana")).toEqual([]);
  });

  it("keeps each stream's points apart", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    feed(h, c, "recv/ana", 3);
    feed(h, c, "send/bo", 5);
    expect(h.points("recv/ana")).toHaveLength(3);
    expect(h.points("send/bo")).toHaveLength(5);
    expect(h.points("recv/nobody")).toEqual([]);
  });

  it("forgets a stream altogether: its points, step changes and baseline", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    feed(h, c, "recv/ana", 3);
    h.changed("recv/ana", { from: "720p30", to: "1080p30", cause: "probe" });
    h.forget("recv/ana");
    expect(h.points("recv/ana")).toEqual([]);
    expect(h.changes("recv/ana")).toEqual([]);
    expect(h.latest("recv/ana")).toBeUndefined();
    // A share that begins again starts from a new baseline: the next reading makes no point.
    expect(h.observe("recv/ana", reading(4))).toBeUndefined();
  });

  it("leaves other streams alone when one is forgotten", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    feed(h, c, "recv/ana", 3);
    feed(h, c, "send/bo", 3);
    h.forget("recv/ana");
    expect(h.points("send/bo")).toHaveLength(3);
  });

  it("makes no point from readings too close together (two passes landing at once)", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    h.observe("recv/ana", reading(0));
    c.advance(1_000);
    h.observe("recv/ana", reading(1));
    c.advance(50);
    expect(h.observe("recv/ana", { ...reading(1), at: reading(1).at + 50, bytes: 500_050 })).toBe(
      undefined,
    );
    expect(h.points("recv/ana")).toHaveLength(1);
  });

  it("ignores an older reading that arrives after a newer one, and keeps the freeze baseline", () => {
    // The quality pass and the modal's refresh can read one stream at once; their results may
    // come back in either order. The older one has smaller counters, which must not read as a
    // new track (that would reset the baseline and zero the freezes).
    const c = clock();
    const h = new QualityHistory(c.now);
    h.observe("recv/ana", reading(0, { freezes: 7 }));
    c.advance(1_000);
    h.observe("recv/ana", reading(1, { freezes: 7 }));
    c.advance(2_000);
    expect(h.observe("recv/ana", reading(3, { freezes: 9 }))?.freezes).toBe(2);
    c.advance(10);
    expect(h.observe("recv/ana", reading(2, { freezes: 8 }))).toBeUndefined();
    c.advance(1_000);
    expect(h.observe("recv/ana", reading(4, { freezes: 9 }))).toMatchObject({
      freezes: 2,
      bps: 4_000_000,
    });
    expect(h.points("recv/ana")).toHaveLength(3);
  });

  it("starts over after a long gap rather than averaging an outage into one point", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    h.observe("recv/ana", reading(0));
    c.advance(1_000);
    h.observe("recv/ana", reading(1));
    c.advance(MAX_READING_GAP_MS + 1_000);
    expect(h.observe("recv/ana", reading(30))).toBeUndefined();
    c.advance(1_000);
    expect(h.observe("recv/ana", reading(31))).toMatchObject({ bps: 4_000_000 });
  });

  it("starts over when a counter goes backwards (a new track under the same key)", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    h.observe("recv/ana", reading(5));
    c.advance(1_000);
    expect(h.observe("recv/ana", reading(6, { bytes: 10 }))).toBeUndefined();
  });

  it("records a point it is handed whole, for a total it works out itself", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    h.record("total", { bps: 9_000_000, capBps: 23_000_000 });
    expect(h.points("total")).toEqual([{ at: c.now(), bps: 9_000_000, capBps: 23_000_000 }]);
  });

  it("remembers the latest reading, for facts that aren't a series (the path)", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    h.observe("recv/ana", reading(0, { relayProtocol: "tls" }));
    expect(h.latest("recv/ana")).toMatchObject({ relayProtocol: "tls" });
  });
});

describe("pathLabel", () => {
  it("calls a connection with no relay on either end direct", () => {
    expect(pathLabel(reading(0, { localCandidate: "host", remoteCandidate: "srflx" }))).toBe(
      "direct",
    );
    expect(pathLabel(reading(0, { localCandidate: "prflx", remoteCandidate: "prflx" }))).toBe(
      "direct",
    );
  });

  it("names the transport of a relay, as the local TURN allocation reports it", () => {
    const relayed = { localCandidate: "relay", remoteCandidate: "host" } as const;
    expect(pathLabel(reading(0, { ...relayed, relayProtocol: "udp" }))).toBe("relay · UDP");
    expect(pathLabel(reading(0, { ...relayed, relayProtocol: "tcp" }))).toBe("relay · TCP");
    expect(pathLabel(reading(0, { ...relayed, relayProtocol: "tls" }))).toBe("relay · TLS");
  });

  it("is a relay without a transport when only the far end relays, or the browser doesn't say", () => {
    expect(pathLabel(reading(0, { localCandidate: "host", remoteCandidate: "relay" }))).toBe(
      "relay",
    );
    expect(pathLabel(reading(0, { localCandidate: "relay", remoteCandidate: "relay" }))).toBe(
      "relay",
    );
  });

  it("is unknown before the pair is selected", () => {
    expect(pathLabel(reading(0))).toBeUndefined();
    expect(pathLabel(undefined)).toBeUndefined();
  });
});

describe("stepChange", () => {
  it("names the step it left and its cause only when they are known", () => {
    expect(stepChange(undefined, "1080p60", undefined)).toEqual({ to: "1080p60" });
    expect(stepChange("1080p60", "900p30", "budget")).toEqual({
      from: "1080p60",
      to: "900p30",
      cause: "budget",
    });
    expect(stepChange("1080p60", "900p30", undefined)).not.toHaveProperty("cause");
  });
});

describe("codec switches", () => {
  it("are kept per stream, stamped with the clock, and forgotten with it", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    h.switched("send/bo", { from: "video/AV1", to: "video/H264" });
    c.advance(5_000);
    h.switched("send/cy", { from: "video/VP9", to: "video/VP8" });
    expect(h.switches("send/bo")).toEqual([{ at: 1_000_000, from: "video/AV1", to: "video/H264" }]);
    expect(h.switches("send/cy")).toHaveLength(1);
    expect(h.switches("send/none")).toEqual([]);
    h.forget("send/bo");
    expect(h.switches("send/bo")).toEqual([]);
  });
});

describe("step changes", () => {
  it("are kept oldest first, stamped with the clock", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    h.changed("send/bo", { to: "1080p30" });
    c.advance(5_000);
    h.changed("send/bo", { from: "1080p30", to: "900p30", cause: "connection" });
    expect(h.changes("send/bo")).toEqual([
      { at: 1_000_000, to: "1080p30" },
      { at: 1_005_000, from: "1080p30", to: "900p30", cause: "connection" },
    ]);
  });

  it("keep the last few, however old, so a quiet minute still shows how it got here", () => {
    const c = clock();
    const h = new QualityHistory(c.now);
    for (let i = 0; i < MAX_CHANGES + 5; i++) {
      h.changed("send/bo", { from: `s${i}`, to: `s${i + 1}`, cause: "probe" });
      c.advance(60_000);
    }
    const changes = h.changes("send/bo");
    expect(changes).toHaveLength(MAX_CHANGES);
    expect(changes.at(-1)?.to).toBe(`s${MAX_CHANGES + 5}`);
    expect(changes[0]?.from).toBe("s5");
  });
});
