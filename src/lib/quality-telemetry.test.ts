import { describe, expect, it, vi } from "vitest";
import { QualityCollector } from "./quality-collector";
import {
  browserOf,
  MAX_SAMPLE_AGE_MS,
  type PendingSample,
  QUALITY_BATCH_MAX,
  QualityReporter,
  type QualitySample,
  REPORT_DELAY_MS,
  type ReportQualityInput,
  readStream,
  reportQualityInput,
  SAMPLE_WINDOW_MS,
  SampleWindow,
  type StreamReading,
  sampleWindowMs,
} from "./quality-telemetry";

// Quality telemetry (#94): a window of stats readings summarised into a row, kept null where a
// browser lacks a stat, and batched for the server.

/** A reading `seconds` into a session, with counters growing at a steady rate. */
const reading = (seconds: number, extra: Partial<StreamReading> = {}): StreamReading => ({
  at: seconds * 1_000,
  bytes: seconds * 250_000,
  frames: seconds * 30,
  qpSum: seconds * 30 * 40,
  ...extra,
});

describe("SampleWindow", () => {
  it("averages and takes deltas over the window, measured from its first reading", () => {
    const window = new SampleWindow(
      reading(100, { keyFrames: 4, plis: 1, nacks: 10, packetsLost: 5, packetsReceived: 1000 }),
    );
    window.add(
      reading(116, {
        targetBitrate: 2_000_000,
        availableBitrate: 4_000_000,
        rttMs: 20,
        keyFrames: 6,
        plis: 3,
        nacks: 25,
        packetsLost: 15,
        packetsReceived: 1990,
        frameWidth: 1920,
        frameHeight: 1080,
        fps: 29,
        codec: "video/VP9",
        limit: "none",
        localCandidate: "host",
        remoteCandidate: "relay",
      }),
    );
    window.add(
      reading(132, {
        targetBitrate: 1_000_000,
        availableBitrate: 2_000_000,
        rttMs: 40,
        keyFrames: 7,
        plis: 4,
        nacks: 30,
        packetsLost: 25,
        packetsReceived: 2980,
        frameWidth: 1920,
        frameHeight: 1080,
        fps: 30,
        codec: "video/VP9",
        limit: "bandwidth",
        localCandidate: "host",
        remoteCandidate: "relay",
        relayProtocol: "tls",
      }),
    );

    expect(window.summarise()).toEqual({
      windowMs: 32_000,
      targetBitrate: 1_500_000,
      // 250 kB/s over the window.
      bitrate: 2_000_000,
      availableBitrate: 3_000_000,
      // Δ(qpSum) / Δ(frames).
      qp: 40,
      codec: "video/VP9",
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 30,
      // The worst seen in the window.
      limitation: "bandwidth",
      // Δlost / (Δlost + Δreceived): 20 of 2000.
      loss: 0.01,
      rttMs: 30,
      plis: 3,
      firs: null,
      nacks: 20,
      keyFrames: 3,
      freezes: null,
      freezeSeconds: null,
      localCandidate: "host",
      remoteCandidate: "relay",
      relayProtocol: "tls",
    });
  });

  it("uses a sender's reported loss when there are no packet counters, averaged", () => {
    const window = new SampleWindow(reading(0));
    window.add(reading(4, { loss: 0.02 }));
    window.add(reading(8, { loss: 0.04 }));
    expect(window.summarise().loss).toBe(0.03);
  });

  it("keeps what a browser lacks null, never 0 (Firefox senders)", () => {
    // Firefox: no target, estimate, limitation reason, QP or round trip on a sender.
    const window = new SampleWindow({ at: 0, bytes: 0, frames: 0 });
    window.add({ at: 8_000, bytes: 1_000_000, frames: 240, frameWidth: 1280, frameHeight: 720 });
    expect(window.summarise()).toEqual({
      windowMs: 8_000,
      targetBitrate: null,
      bitrate: 1_000_000,
      availableBitrate: null,
      qp: null,
      codec: null,
      frameWidth: 1280,
      frameHeight: 720,
      fps: 30,
      limitation: null,
      loss: null,
      rttMs: null,
      plis: null,
      firs: null,
      nacks: null,
      keyFrames: null,
      freezes: null,
      freezeSeconds: null,
      localCandidate: null,
      remoteCandidate: null,
      relayProtocol: null,
    });
  });

  it("takes a counter that went backwards (the stream restarted) as unknown", () => {
    const window = new SampleWindow(reading(100, { plis: 9, freezes: 3 }));
    window.add(reading(104, { plis: 0, freezes: 0 }));
    const summary = window.summarise();
    expect(summary.plis).toBeNull();
    expect(summary.freezes).toBeNull();
  });

  it("counts a receiver's freezes and their length as deltas", () => {
    const window = new SampleWindow(reading(0, { freezes: 2, freezeSeconds: 1.5 }));
    window.add(reading(30, { freezes: 5, freezeSeconds: 4.25 }));
    expect(window.summarise()).toMatchObject({ freezes: 3, freezeSeconds: 2.75 });
  });

  it("falls back on its first reading for a window with no others, with no counts or rates", () => {
    // A rung change on the pass that closed a window: no time passed, so nothing was counted
    // (which is not the same as counting 0 keyframes, PLIs or freezes).
    const window = new SampleWindow(
      reading(0, {
        targetBitrate: 900_000,
        limit: "cpu",
        plis: 4,
        firs: 0,
        nacks: 9,
        keyFrames: 2,
        freezes: 1,
        freezeSeconds: 0.5,
        fps: 29,
      }),
    );
    expect(window.summarise()).toMatchObject({
      windowMs: 0,
      targetBitrate: 900_000,
      limitation: "cpu",
      bitrate: null,
      qp: null,
      fps: null,
      plis: null,
      firs: null,
      nacks: null,
      keyFrames: null,
      freezes: null,
      freezeSeconds: null,
    });
  });

  it("knows the codec the stream last reported", () => {
    const window = new SampleWindow(reading(0, { codec: "video/VP9" }));
    window.add(reading(4));
    expect(window.codec).toBe("video/VP9");
    window.add(reading(8, { codec: "video/AV1" }));
    expect(window.codec).toBe("video/AV1");
  });

  it("is due once its readings span the time", () => {
    const window = new SampleWindow(reading(0));
    window.add(reading(28));
    expect(window.due(28_000)).toBe(true);
    expect(window.due(30_000)).toBe(false);
  });
});

describe("readStream", () => {
  const report = (entries: Record<string, unknown>[]) =>
    new Map(entries.map((e) => [e.id as string, e])) as unknown as RTCStatsReport;
  const path = [
    { id: "t", type: "transport", selectedCandidatePairId: "p" },
    {
      id: "p",
      type: "candidate-pair",
      localCandidateId: "l",
      remoteCandidateId: "r",
      availableOutgoingBitrate: 5_000_000,
      currentRoundTripTime: 0.025,
    },
    {
      id: "l",
      type: "local-candidate",
      candidateType: "relay",
      protocol: "udp",
      relayProtocol: "tls",
    },
    { id: "r", type: "remote-candidate", candidateType: "srflx", protocol: "udp" },
  ];

  it("reads a Chromium sender", () => {
    const read = readStream(
      report([
        ...path,
        {
          id: "o",
          type: "outbound-rtp",
          kind: "video",
          timestamp: 5_000,
          bytesSent: 1_000,
          framesEncoded: 10,
          qpSum: 400,
          keyFramesEncoded: 1,
          pliCount: 2,
          targetBitrate: 2_500_000,
          qualityLimitationReason: "bandwidth",
          frameWidth: 1920,
          frameHeight: 1080,
          framesPerSecond: 30,
          codecId: "c",
        },
        { id: "c", type: "codec", mimeType: "video/AV1" },
        { id: "ri", type: "remote-inbound-rtp", kind: "video", fractionLost: 0.01 },
      ]),
      "send",
    );
    expect(read).toEqual({
      at: 5_000,
      bytes: 1_000,
      frames: 10,
      qpSum: 400,
      keyFrames: 1,
      plis: 2,
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 30,
      targetBitrate: 2_500_000,
      availableBitrate: 5_000_000,
      rttMs: 25,
      loss: 0.01,
      limit: "bandwidth",
      codec: "video/AV1",
      localCandidate: "relay",
      remoteCandidate: "srflx",
      relayProtocol: "tls",
    });
  });

  it("leaves out what a Firefox sender lacks, and what a receiver doesn't have", () => {
    const sent = readStream(
      report([
        {
          id: "o",
          type: "outbound-rtp",
          kind: "video",
          timestamp: 1,
          bytesSent: 5,
          framesEncoded: 1,
        },
        { id: "p", type: "candidate-pair", selected: true },
      ]),
      "send",
    ) as StreamReading;
    expect(sent).toEqual({ at: 1, bytes: 5, frames: 1 });
    expect("targetBitrate" in sent).toBe(false);
    expect("limit" in sent).toBe(false);

    const received = readStream(
      report([
        ...path,
        {
          id: "i",
          type: "inbound-rtp",
          kind: "video",
          timestamp: 9,
          bytesReceived: 50,
          framesDecoded: 5,
          packetsReceived: 100,
          packetsLost: 2,
          freezeCount: 1,
          totalFreezesDuration: 0.4,
        },
      ]),
      "recv",
    ) as StreamReading;
    expect(received).toMatchObject({
      bytes: 50,
      frames: 5,
      packetsReceived: 100,
      packetsLost: 2,
      freezes: 1,
      freezeSeconds: 0.4,
    });
    // A receiver's estimate is for its own sending, not for this stream.
    expect(received.loss).toBeUndefined();
  });

  it("finds no stream where the report has none (or only audio)", () => {
    expect(readStream(report([]), "send")).toBeUndefined();
    expect(
      readStream(report([{ id: "a", type: "inbound-rtp", kind: "audio", timestamp: 1 }]), "recv"),
    ).toBeUndefined();
  });
});

describe("browserOf", () => {
  it.each([
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0",
      { name: "firefox", major: 142 },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      { name: "chrome", major: 139 },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.3405.86",
      { name: "edge", major: 139 },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
      { name: "safari", major: 18 },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/139.0.0.0 Safari/537.36",
      { name: "chrome", major: 139 },
    ],
    // No version to be had is null, never 0.
    ["curl/8.0", { name: "other", major: null }],
    ["", { name: "other", major: null }],
  ])("%s", (userAgent, expected) => {
    expect(browserOf(userAgent)).toEqual(expected);
  });
});

describe("sampleWindowMs", () => {
  it("is 30 s unless a build says otherwise, and never below the floor", () => {
    expect(sampleWindowMs(undefined)).toBe(SAMPLE_WINDOW_MS);
    expect(sampleWindowMs("junk")).toBe(SAMPLE_WINDOW_MS);
    expect(sampleWindowMs("-5")).toBe(SAMPLE_WINDOW_MS);
    expect(sampleWindowMs("10000")).toBe(10_000);
    expect(sampleWindowMs("1")).toBe(8_000);
  });
});

/** A valid row as a page sends it. */
const row = (extra: Partial<QualitySample> = {}): QualitySample => ({
  peerId: "bo",
  ageMs: 0,
  slot: "screen",
  direction: "send",
  trigger: "window",
  windowMs: 30_000,
  rung: "1080p30",
  toRung: null,
  reason: null,
  maxBitrate: 3_000_000,
  targetBitrate: 2_900_000,
  bitrate: 2_800_000,
  availableBitrate: null,
  qp: 31.5,
  codec: "video/VP9",
  frameWidth: 1920,
  frameHeight: 1080,
  fps: 30,
  limitation: null,
  loss: 0,
  rttMs: 12.5,
  plis: 0,
  firs: null,
  nacks: 2,
  keyFrames: 1,
  freezes: null,
  freezeSeconds: null,
  localCandidate: "host",
  remoteCandidate: "host",
  relayProtocol: null,
  ...extra,
});

describe("the report schema", () => {
  const input = (samples: unknown[]) => ({ roomId: "r1", samples });
  const accepts = (sample: unknown) => reportQualityInput.safeParse(input([sample])).success;

  it("takes a sent row, a rung change and a received row", () => {
    expect(accepts(row())).toBe(true);
    expect(accepts(row({ trigger: "rung", toRung: "900p30", reason: "pressure" }))).toBe(true);
    expect(
      accepts(row({ direction: "recv", rung: null, maxBitrate: null, targetBitrate: null })),
    ).toBe(true);
  });

  it("refuses a rung change that doesn't say where to and why, or a received row with a rung", () => {
    expect(accepts(row({ trigger: "rung" }))).toBe(false);
    expect(accepts(row({ toRung: "900p30", reason: "pressure" }))).toBe(false);
    expect(accepts(row({ rung: null }))).toBe(false);
    expect(accepts(row({ direction: "recv" }))).toBe(false);
  });

  it("bounds every field", () => {
    for (const bad of [
      { loss: 1.5 },
      { loss: -0.1 },
      { bitrate: -1 },
      { bitrate: 1.5 },
      { bitrate: 2_000_000_000 },
      { qp: Number.NaN },
      { windowMs: 11 * 60_000 },
      { ageMs: MAX_SAMPLE_AGE_MS + 1 },
      { peerId: "" },
      { peerId: "x".repeat(65) },
      { codec: "audio/opus" },
      { codec: `video/${"x".repeat(40)}` },
      { rung: "1080p 30" },
      { localCandidate: "elsewhere" },
      { slot: "mic" },
      { fps: 5_000 },
    ]) {
      expect(accepts({ ...row(), ...bad }), JSON.stringify(bad)).toBe(false);
    }
    expect(accepts({ ...row(), extra: 1 })).toBe(false);
    expect(accepts({ ...row(), qp: undefined })).toBe(false);
  });

  it("holds between 1 and the batch maximum of rows", () => {
    expect(reportQualityInput.safeParse(input([])).success).toBe(false);
    expect(reportQualityInput.safeParse(input(Array(QUALITY_BATCH_MAX).fill(row()))).success).toBe(
      true,
    );
    expect(
      reportQualityInput.safeParse(input(Array(QUALITY_BATCH_MAX + 1).fill(row()))).success,
    ).toBe(false);
    expect(reportQualityInput.safeParse({ roomId: "", samples: [row()] }).success).toBe(false);
  });
});

describe("QualityCollector", () => {
  const sender = { peerId: "bo", slot: "screen", direction: "send" } as const;
  const receiver = { peerId: "bo", slot: "screen", direction: "recv" } as const;
  const rung = { label: "1080p30", maxBitrate: 3_000_000 };

  function collector(windowMs = 30_000) {
    const rows: PendingSample[] = [];
    let now = 0;
    const c = new QualityCollector({
      emit: (row) => rows.push(row),
      windowMs,
      now: () => now,
    });
    return {
      rows,
      c,
      read: (id: typeof sender | typeof receiver, seconds: number, r?: typeof rung) => {
        now = seconds * 1_000;
        c.observe(id, reading(seconds, { fps: 30 }), r);
      },
    };
  }

  it("sends one row per window, from the reading that closed the one before", () => {
    const { rows, read } = collector();
    for (let s = 0; s <= 64; s += 4) read(sender, s, rung);
    // Closed at 28 s (a window less the pass tolerance) and 56 s.
    expect(rows.map((r) => [r.windowMs, r.endedAt])).toEqual([
      [28_000, 28_000],
      [28_000, 56_000],
    ]);
    expect(rows[0]).toMatchObject({
      peerId: "bo",
      slot: "screen",
      direction: "send",
      trigger: "window",
      rung: "1080p30",
      maxBitrate: 3_000_000,
      toRung: null,
      reason: null,
      bitrate: 2_000_000,
    });
  });

  it("ends the window at a rung change, with where from, to and why", () => {
    const { rows, c, read } = collector();
    for (let s = 0; s <= 12; s += 4) read(sender, s, rung);
    c.rungChanged(sender, { label: "900p30", maxBitrate: 2_200_000 }, "pressure");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trigger: "rung",
      rung: "1080p30",
      maxBitrate: 3_000_000,
      toRung: "900p30",
      reason: "pressure",
      windowMs: 12_000,
    });
    // The next window is on the new rung, and starts where this one ended.
    for (let s = 16; s <= 44; s += 4) read(sender, s, { label: "900p30", maxBitrate: 2_200_000 });
    expect(rows[1]).toMatchObject({
      trigger: "window",
      rung: "900p30",
      maxBitrate: 2_200_000,
      windowMs: 28_000,
    });
  });

  it("has no row for a rung change of a stream not read yet", () => {
    const { rows, c } = collector();
    c.rungChanged(sender, rung, "budget");
    expect(rows).toEqual([]);
  });

  it("has a received row carry no rung, and none for a stream that never received anything", () => {
    const { rows, c } = collector();
    for (let s = 0; s <= 28; s += 4) {
      c.observe(receiver, reading(s));
      // A share not begun: the transceiver is there, with no traffic yet.
      c.observe({ ...receiver, peerId: "cy" }, { at: s * 1_000, bytes: 0, frames: 0 });
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      peerId: "bo",
      direction: "recv",
      rung: null,
      maxBitrate: null,
    });
  });

  it("reports a receive stream that stalled as a row with a bitrate of 0", () => {
    const { rows, c } = collector();
    for (let s = 0; s <= 28; s += 4) c.observe(receiver, reading(s));
    // The stream goes quiet: its counters stop growing.
    const stalled = reading(28);
    for (let s = 32; s <= 56; s += 4) c.observe(receiver, { ...stalled, at: s * 1_000 });
    expect(rows.map((r) => [r.direction, r.bitrate])).toEqual([
      ["recv", 2_000_000],
      ["recv", 0],
    ]);
    expect(rows[1]).toMatchObject({ frameWidth: null, windowMs: 28_000, keyFrames: null });
  });

  it("still reports a stalled stream after a gap, which the stream had before", () => {
    const { rows, c } = collector();
    c.observe(receiver, reading(4));
    // A long gap restarts the window; the stream has received before, though.
    const stalled = reading(4);
    for (let s = 60; s <= 88; s += 4) c.observe(receiver, { ...stalled, at: s * 1_000 });
    expect(rows.map((r) => r.bitrate)).toEqual([0]);
  });

  it("ends the window where the codec changes, so QP is of one codec", () => {
    const { rows, c } = collector();
    const reads = (seconds: number, codec: string) =>
      c.observe(sender, { ...reading(seconds, { fps: 30 }), codec }, rung);
    for (let s = 0; s <= 12; s += 4) reads(s, "video/VP9");
    expect(rows).toEqual([]);
    reads(16, "video/AV1");
    // The VP9 window ended at its last reading; the AV1 one starts from the switch.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger: "window", codec: "video/VP9", windowMs: 12_000 });
    for (let s = 20; s <= 44; s += 4) reads(s, "video/AV1");
    expect(rows[1]).toMatchObject({ codec: "video/AV1", windowMs: 28_000 });
    expect(rows).toHaveLength(2);
  });

  it("ends no window for a reading that doesn't say its codec", () => {
    const { rows, c } = collector();
    c.observe(sender, { ...reading(0), codec: "video/VP9" }, rung);
    c.observe(sender, reading(4), rung);
    c.observe(sender, { ...reading(8), codec: "video/VP9" }, rung);
    expect(rows).toEqual([]);
  });

  it("gives a rung change that ends a zero-length window null counts, not 0", () => {
    const { rows, c } = collector();
    c.observe(sender, reading(0, { plis: 3, keyFrames: 1 }), rung);
    c.rungChanged(sender, { label: "900p30", maxBitrate: 2_200_000 }, "pressure");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trigger: "rung",
      windowMs: 0,
      plis: null,
      nacks: null,
      keyFrames: null,
      bitrate: null,
    });
  });

  it("starts a window over after a pause, a reset or a peer leaving", () => {
    const { rows, c, read } = collector();
    for (let s = 0; s <= 12; s += 4) read(sender, s, rung);
    // A silence of a minute: nothing before it belongs with what comes after.
    for (let s = 72; s <= 96; s += 4) read(sender, s, rung);
    expect(rows).toEqual([]);
    c.reset(sender);
    c.rungChanged(sender, rung, "resume");
    expect(rows).toEqual([]);
    for (let s = 100; s <= 112; s += 4) read(sender, s, rung);
    c.forget("bo");
    c.rungChanged(sender, rung, "budget");
    expect(rows).toEqual([]);
  });
});

describe("QualityReporter", () => {
  const sample = (endedAt: number, extra: Partial<PendingSample> = {}): PendingSample => {
    const { ageMs: _, ...rest } = row();
    return { ...rest, endedAt, ...extra };
  };

  it("sends the rows queued together in one report after a short wait, dated by age", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(100_000);
      const send = vi.fn(async (_report: ReportQualityInput) => ({ stored: 2 }));
      const reporter = new QualityReporter({ roomId: "r1", send });
      reporter.add(sample(99_000));
      vi.advanceTimersByTime(2_000);
      reporter.add(sample(101_000, { peerId: "cy" }));
      expect(send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(REPORT_DELAY_MS);
      expect(send).toHaveBeenCalledTimes(1);
      const [report] = send.mock.calls[0] as unknown as [
        { roomId: string; samples: QualitySample[] },
      ];
      expect(report.roomId).toBe("r1");
      expect(report.samples.map((s) => [s.peerId, s.ageMs])).toEqual([
        ["bo", 6_000],
        ["cy", 4_000],
      ]);
      expect(reportQualityInput.safeParse(report).success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("splits a long queue into reports of at most the batch maximum", async () => {
    const send = vi.fn(async (_report: ReportQualityInput) => ({}));
    const reporter = new QualityReporter({ roomId: "r1", send, now: () => 0 });
    for (let i = 0; i < QUALITY_BATCH_MAX + 6; i++) reporter.add(sample(0));
    await reporter.flush();
    expect(send.mock.calls.map(([r]) => (r as { samples: unknown[] }).samples.length)).toEqual([
      QUALITY_BATCH_MAX,
      6,
    ]);
    reporter.close();
  });

  it("drops a report that fails, and goes on", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    const log = vi.fn();
    const reporter = new QualityReporter({ roomId: "r1", send, log, now: () => 0 });
    reporter.add(sample(0));
    await reporter.flush();
    expect(log).toHaveBeenCalledWith("reporting failed", expect.any(Error));
    reporter.add(sample(0));
    await reporter.flush();
    expect(send).toHaveBeenCalledTimes(2);
    const [second] = send.mock.calls[1] as unknown as [{ samples: unknown[] }];
    expect(second.samples).toHaveLength(1);
  });

  it("keeps the newest rows while reports can't go out, and sends nothing once closed", async () => {
    const send = vi.fn(async (_report: ReportQualityInput) => ({}));
    const reporter = new QualityReporter({ roomId: "r1", send, now: () => 0 });
    for (let i = 0; i < QUALITY_BATCH_MAX * 5; i++) reporter.add(sample(0, { windowMs: i }));
    await reporter.flush();
    const sent = send.mock.calls.flatMap(([r]) => (r as { samples: QualitySample[] }).samples);
    expect(sent).toHaveLength(QUALITY_BATCH_MAX * 4);
    expect(sent[0]?.windowMs).toBe(QUALITY_BATCH_MAX);

    send.mockClear();
    reporter.add(sample(0));
    reporter.close();
    reporter.add(sample(0));
    await reporter.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("clamps an age to what the server accepts", async () => {
    const send = vi.fn(async (_report: ReportQualityInput) => ({}));
    const reporter = new QualityReporter({ roomId: "r1", send, now: () => 10 * 60_000 });
    reporter.add(sample(0));
    reporter.add(sample(20 * 60_000));
    await reporter.flush();
    const [report] = send.mock.calls[0] as unknown as [{ samples: QualitySample[] }];
    expect(report.samples.map((s) => s.ageMs)).toEqual([MAX_SAMPLE_AGE_MS, 0]);
  });
});
