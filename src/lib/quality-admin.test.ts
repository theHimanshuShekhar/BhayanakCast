import { describe, expect, it } from "vitest";
import { aggregatePairs, type QualityRow, STARVED_MIN_SECONDS, timelineOf } from "./quality-admin";

// The pair aggregation behind the admin's quality table (#94): each end reports its own rows,
// and a pair is one streamer's screen or camera to one viewer.

const T0 = Date.parse("2026-10-11T12:00:00Z");

/** A sent row from ana to bo `seconds` into the session, over a 30 s window. */
const sent = (seconds: number, extra: Partial<QualityRow> = {}): QualityRow => ({
  at: new Date(T0 + seconds * 1_000),
  reporterUserId: "ana",
  peerUserId: "bo",
  direction: "send",
  slot: "screen",
  trigger: "window",
  windowMs: 30_000,
  browser: "chrome",
  browserMajor: 139,
  rung: "1080p30",
  maxBitrate: 3_000_000,
  toRung: null,
  rungReason: null,
  targetBitrate: 2_900_000,
  bitrate: 2_800_000,
  qp: 30,
  codec: "video/VP9",
  loss: 0.01,
  rttMs: 20,
  freezes: null,
  freezeSeconds: null,
  localCandidate: "host",
  remoteCandidate: "host",
  relayProtocol: null,
  ...extra,
});

/** What bo receives of it. */
const received = (seconds: number, extra: Partial<QualityRow> = {}): QualityRow =>
  sent(seconds, {
    reporterUserId: "bo",
    peerUserId: "ana",
    direction: "recv",
    browser: "firefox",
    browserMajor: 142,
    rung: null,
    maxBitrate: null,
    targetBitrate: null,
    qp: 36,
    loss: 0.03,
    rttMs: 40,
    freezes: 1,
    freezeSeconds: 0.5,
    ...extra,
  });

describe("aggregatePairs", () => {
  it("joins the sender's and the receiver's rows into one pair, with the viewer's browser", () => {
    const pairs = aggregatePairs([sent(30), received(30), sent(60), received(60)]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      streamerId: "ana",
      viewerId: "bo",
      slot: "screen",
      viewerBrowser: "firefox 142",
      codec: "video/VP9",
      firstAt: new Date(T0 + 30_000).toISOString(),
      lastAt: new Date(T0 + 60_000).toISOString(),
    });
  });

  it("makes a pair of each streamer, viewer and slot", () => {
    const pairs = aggregatePairs([
      sent(30),
      sent(30, { slot: "cam", rung: "360p15", maxBitrate: 500_000 }),
      sent(30, { peerUserId: "cy" }),
      sent(30, { reporterUserId: "bo", peerUserId: "ana" }),
    ]);
    expect(pairs.map((p) => `${p.streamerId}>${p.viewerId}:${p.slot}`)).toEqual([
      "ana>bo:screen",
      "ana>bo:cam",
      "ana>cy:screen",
      "bo>ana:screen",
    ]);
  });

  it("adds up the time on each rung, lowest rung first, rung changes included", () => {
    const pairs = aggregatePairs([
      sent(30, { rung: "1080p30", maxBitrate: 3_000_000 }),
      sent(40, {
        trigger: "rung",
        windowMs: 10_000,
        rung: "1080p30",
        maxBitrate: 3_000_000,
        toRung: "900p30",
        rungReason: "pressure",
      }),
      sent(70, { rung: "900p30", maxBitrate: 2_200_000 }),
      sent(100, { rung: "900p30", maxBitrate: 2_200_000 }),
    ]);
    expect(pairs[0]?.rungTimes).toEqual([
      { rung: "900p30", seconds: 60 },
      { rung: "1080p30", seconds: 40 },
    ]);
    expect(pairs[0]?.rungChanges).toBe(1);
  });

  it("weighs averages by window length, and takes loss from the receiver and QP from the sender", () => {
    const [pair] = aggregatePairs([
      sent(30, { windowMs: 30_000, qp: 30, rttMs: 10 }),
      sent(40, { windowMs: 10_000, qp: 50, rttMs: 30 }),
      received(30, { windowMs: 30_000, loss: 0.02 }),
      received(40, { windowMs: 10_000, loss: 0.06 }),
    ]);
    expect(pair?.qp).toBe(35);
    expect(pair?.loss).toBeCloseTo(0.03);
    // Both ends' round trips, weighted: (10*30 + 30*10 + 40*30 + 40*10) / 80 = 27.5.
    expect(pair?.rttMs).toBeCloseTo(27.5);
    expect(pair?.freezes).toBe(2);
    expect(pair?.freezeSeconds).toBe(1);
  });

  it("averages QP over the windows on the pair's latest codec only, never across a switch", () => {
    const pair = aggregatePairs([
      sent(30, { codec: "video/VP9", qp: 40 }),
      sent(60, { codec: "video/VP9", qp: 42 }),
      sent(90, { codec: "video/AV1", qp: 100 }),
      sent(120, { codec: "video/AV1", qp: 120 }),
      received(120, { codec: "video/AV1", qp: 9 }),
    ])[0];
    expect(pair?.codec).toBe("video/AV1");
    expect(pair?.qp).toBe(110);
    // Back on the first codec later: that one is the latest.
    const back = aggregatePairs([
      sent(30, { codec: "video/AV1", qp: 100 }),
      sent(60, { codec: "video/VP9", qp: 40 }),
      sent(90, { codec: "video/VP9", qp: 44 }),
    ])[0];
    expect(back?.qp).toBe(42);
    // No codec ever known: no QP to compare.
    expect(aggregatePairs([sent(30, { codec: null, qp: 40 })])[0]?.qp).toBeNull();
    // The receiver's QP is used on the latest codec when the sender has none.
    expect(
      aggregatePairs([
        sent(30, { codec: "video/VP9", qp: null }),
        received(30, { codec: "video/VP9", qp: 33 }),
        received(60, { codec: "video/AV1", qp: 7 }),
        sent(60, { codec: "video/AV1", qp: null }),
      ])[0]?.qp,
    ).toBe(7);
  });

  it("shows a viewer's browser without a version when it had none", () => {
    const [pair] = aggregatePairs([
      sent(30),
      received(30, { browser: "other", browserMajor: null }),
    ]);
    expect(pair?.viewerBrowser).toBe("other");
  });

  it("groups many rows without losing or reordering any", () => {
    const rows = Array.from({ length: 6_000 }, (_, i) =>
      sent(i, { peerUserId: `viewer${i % 3}`, windowMs: 1_000 }),
    );
    const pairs = aggregatePairs(rows);
    expect(pairs.map((p) => p.viewerId)).toEqual(["viewer0", "viewer1", "viewer2"]);
    for (const pair of pairs) {
      expect(pair.rungTimes).toEqual([{ rung: "1080p30", seconds: 2_000 }]);
    }
  });

  it("falls back on the other end for what one lacks, and shows null where neither knows", () => {
    // A Firefox sender reports no QP; its receiver does. Nobody reports loss or freezes.
    const [pair] = aggregatePairs([
      sent(30, { qp: null, loss: null, rttMs: null }),
      received(30, { qp: 33, loss: null, rttMs: null, freezes: null, freezeSeconds: null }),
    ]);
    expect(pair).toMatchObject({
      qp: 33,
      codec: "video/VP9",
      loss: null,
      rttMs: null,
      freezes: null,
      freezeSeconds: null,
    });
  });

  it("says direct or relay, and over what the relay is reached", () => {
    const path = (...rows: QualityRow[]) => aggregatePairs(rows)[0]?.path;
    expect(path(sent(30))).toEqual({ kind: "direct", relayProtocol: null });
    expect(path(sent(30, { localCandidate: null, remoteCandidate: null }))).toBeNull();
    // The sender's far end is the relay; the viewer's own end knows it reaches it over TLS.
    expect(
      path(
        sent(30, { remoteCandidate: "relay" }),
        received(30, { localCandidate: "relay", remoteCandidate: "host", relayProtocol: "tls" }),
      ),
    ).toEqual({ kind: "relay", relayProtocol: "tls" });
    expect(path(sent(30, { localCandidate: "relay" }))).toEqual({
      kind: "relay",
      relayProtocol: null,
    });
  });

  describe("starved", () => {
    /** `count` windows of 30 s on a rung, sending near `target` of its `maxBitrate`. */
    const windows = (count: number, rung: string, maxBitrate: number, target: number | null) =>
      Array.from({ length: count }, (_, i) =>
        sent(30 * (i + 1), { rung, maxBitrate, targetBitrate: target }),
      );

    it("flags a target well below the rung's maximum while staying on a high rung", () => {
      const [pair] = aggregatePairs(windows(4, "1080p30", 3_000_000, 900_000));
      expect(pair?.starved).toEqual({ rung: "1080p30", share: 1 });
    });

    it("doesn't flag a target near the maximum", () => {
      expect(aggregatePairs(windows(4, "1080p30", 3_000_000, 2_700_000))[0]?.starved).toBeNull();
      expect(aggregatePairs(windows(4, "1080p30", 3_000_000, 1_500_000))[0]?.starved).toBeNull();
    });

    it("doesn't flag the steps below the one the share started on", () => {
      // It started on 1080p30 and fell to 720p30: a low target there is the step it fell to.
      const rows = [
        ...windows(1, "1080p30", 3_000_000, 2_900_000),
        ...windows(4, "720p30", 1_330_000, 100_000).map((row) => ({
          ...row,
          at: new Date(row.at.getTime() + 100_000_000),
        })),
      ];
      expect(aggregatePairs(rows)[0]?.starved).toBeNull();
    });

    it("flags a share whose own steps are small, whatever the bitrate", () => {
      // A 5:4 window or a small share starts on a step of 1.5 Mbps or less: it can be starved too.
      const [pair] = aggregatePairs(windows(4, "1280×1024@30", 1_900_000, 400_000));
      expect(pair?.starved).toEqual({ rung: "1280×1024@30", share: 1 });
      expect(aggregatePairs(windows(4, "720p30", 1_330_000, 100_000))[0]?.starved).toEqual({
        rung: "720p30",
        share: 1,
      });
    });

    it("judges a share by the step it started on, not by an absolute bitrate", () => {
      // It started on a 6 Mbps step: a 3 Mbps step it climbed to afterwards doesn't count as the
      // top, but the first does.
      const rows = [
        ...windows(1, "1080p60", 6_000_000, 5_000_000),
        ...windows(4, "1080p30", 3_000_000, 500_000).map((row) => ({
          ...row,
          at: new Date(row.at.getTime() + 100_000_000),
        })),
      ];
      expect(aggregatePairs(rows)[0]?.starved).toBeNull();
    });

    it("doesn't flag a sender that reports no target (Firefox)", () => {
      expect(aggregatePairs(windows(4, "1080p30", 3_000_000, null))[0]?.starved).toBeNull();
    });

    it("doesn't flag a brief dip, or a pair that was starved only a little of the time", () => {
      expect(STARVED_MIN_SECONDS).toBe(60);
      expect(aggregatePairs(windows(1, "1080p30", 3_000_000, 500_000))[0]?.starved).toBeNull();
      const mostlyFine = [
        ...windows(2, "1080p30", 3_000_000, 500_000),
        ...windows(8, "1080p30", 3_000_000, 2_900_000).map((row) => ({
          ...row,
          at: new Date(row.at.getTime() + 100_000_000),
        })),
      ];
      expect(aggregatePairs(mostlyFine)[0]?.starved).toBeNull();
    });

    it("names the rung it was starved on longest", () => {
      const rows = [
        ...windows(2, "1080p30", 3_000_000, 900_000),
        ...windows(4, "1080p60", 6_000_000, 1_000_000).map((row) => ({
          ...row,
          at: new Date(row.at.getTime() + 100_000_000),
        })),
      ];
      expect(aggregatePairs(rows)[0]?.starved?.rung).toBe("1080p60");
    });
  });
});

describe("timelineOf", () => {
  it("makes a series of each measure, from the end that reports it", () => {
    const timeline = timelineOf([
      received(60, { qp: 40, loss: 0.05 }),
      sent(30, { bitrate: 2_000_000, targetBitrate: 2_500_000, qp: 30 }),
      sent(40, {
        trigger: "rung",
        windowMs: 10_000,
        rung: "1080p30",
        toRung: "900p30",
        rungReason: "pressure",
      }),
      sent(70, { rung: "900p30", maxBitrate: 2_200_000, bitrate: 1_800_000, qp: 35 }),
      received(30, { qp: 38, loss: 0.01 }),
    ]);
    const t = (s: number) => T0 + s * 1_000;
    expect(timeline.sent.map((p) => [p.t, p.v])).toEqual([
      [t(30), 2_000_000],
      [t(40), 2_800_000],
      [t(70), 1_800_000],
    ]);
    expect(timeline.target[0]).toEqual({ t: t(30), v: 2_500_000 });
    // QP is the sender's; loss the receiver's.
    expect(timeline.qp.map((p) => p.v)).toEqual([30, 30, 35]);
    expect(timeline.loss.map((p) => [p.t, p.v])).toEqual([
      [t(30), 0.01],
      [t(60), 0.05],
    ]);
    expect(timeline.rungs).toEqual(["900p30", "1080p30"]);
    expect(timeline.rung.map((p) => p.v)).toEqual([1, 1, 0]);
    expect(timeline.ceiling.map((p) => p.v)).toEqual([3_000_000, 3_000_000, 2_200_000]);
    expect(timeline.changes).toEqual([
      { t: t(40), from: "1080p30", to: "900p30", reason: "pressure" },
    ]);
  });

  it("orders the steps of a share built from its own capture by bitrate, labels and all", () => {
    // An ultrawide's steps are named by their size, and no two shares need share a step.
    const step = (label: string, maxBitrate: number) => ({ rung: label, maxBitrate });
    const timeline = timelineOf([
      sent(30, step("2226×932@30", 3_000_000)),
      sent(60, step("2968×1242@60", 10_670_000)),
      sent(90, step("1484×622@30", 1_340_000)),
      sent(120, step("2226×932@30", 3_000_000)),
    ]);
    expect(timeline.rungs).toEqual(["1484×622@30", "2226×932@30", "2968×1242@60"]);
    expect(timeline.rung.map((p) => p.v)).toEqual([1, 2, 0, 1]);
    const pairs = aggregatePairs([
      sent(30, step("2226×932@30", 3_000_000)),
      sent(60, step("2968×1242@60", 10_670_000)),
      sent(90, step("1484×622@30", 1_340_000)),
    ]);
    expect(pairs[0]?.rungTimes.map((r) => r.rung)).toEqual([
      "1484×622@30",
      "2226×932@30",
      "2968×1242@60",
    ]);
  });

  it("uses the receiver's QP when the sender reports none, and the sender's loss when the receiver has none", () => {
    const timeline = timelineOf([
      sent(30, { qp: null, loss: 0.02 }),
      received(30, { qp: 33, loss: null }),
    ]);
    expect(timeline.qp.map((p) => p.v)).toEqual([33]);
    expect(timeline.loss.map((p) => p.v)).toEqual([0.02]);
  });

  it("plots QP of the latest codec only", () => {
    const timeline = timelineOf([
      sent(30, { codec: "video/VP9", qp: 40 }),
      sent(60, { codec: "video/AV1", qp: 100 }),
      sent(90, { codec: "video/AV1", qp: 110 }),
    ]);
    expect(timeline.qp.map((p) => p.v)).toEqual([100, 110]);
  });

  it("leaves a stat a browser lacked out, rather than plotting it as 0", () => {
    const timeline = timelineOf([sent(30, { targetBitrate: null, qp: null })]);
    expect(timeline.target).toEqual([]);
    expect(timeline.qp).toEqual([]);
  });
});
