import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { QualityView } from "~/lib/mesh";
import type { QualityPoint } from "~/lib/quality-history";
import { QualityBody } from "./quality-modal";

// What the modal shows of a stream (#104), rendered to HTML: effects (the refresh each second,
// measuring the charts) don't run, the markup is enough.

const NOW = Date.now();
const point = (secondsAgo: number, extra: Partial<QualityPoint> = {}): QualityPoint => ({
  at: NOW - secondsAgo * 1_000,
  bps: 2_000_000,
  capBps: 3_000_000,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: "video/VP9",
  loss: 0.012,
  rttMs: 34,
  freezes: 1,
  ...extra,
});
const names: Record<string, string> = { kira: "kira", mo: "mo" };
const html = (view: QualityView) =>
  renderToStaticMarkup(<QualityBody view={view} name={(id) => names[id] ?? "someone"} />);

const viewer: QualityView = {
  side: "viewer",
  userId: "kira",
  state: "connected",
  note: { seq: 2, step: "1080p30", maxBitrate: 3_000_000, reason: "shared" },
  path: "relay · TLS",
  points: [point(3), point(2), point(1)],
  changes: [
    { at: NOW - 40_000, to: "1080p60" },
    { at: NOW - 30_000, from: "1080p60", to: "2968×1242@60", cause: "capture" },
    { at: NOW - 20_000, from: "2968×1242@60", to: "1080p30", cause: "budget" },
  ],
};

describe("a viewer's modal", () => {
  it("leads with the reason and its explanation, then the step and its cap", () => {
    const out = html(viewer);
    expect(out).toContain("Streamer&#x27;s upload is shared");
    expect(out).toContain("Held by the streamer&#x27;s upload budget");
    expect(out).toContain("1080p30");
    expect(out).toContain("up to 3.00 Mbps");
    // The reason comes before either graph.
    expect(out.indexOf("Streamer&#x27;s upload is shared")).toBeLessThan(out.indexOf("<svg"));
  });

  it("has a graph each for bitrate (with the step's cap) and resolution, labelled for a screen reader", () => {
    const out = html(viewer);
    expect(out).toContain('aria-label="Bitrate received from kira, last minute: 2.00 Mbps now"');
    expect(out).toContain(
      'aria-label="Resolution of kira&#x27;s screen, last minute: 1080 lines now"',
    );
    expect(out).toContain("step cap 3.0 Mbps");
    // The cap is a dashed line in the bitrate chart.
    expect(out).toContain('stroke-dasharray="5 4"');
    // Axes count back from now.
    expect(out).toContain(">now<");
    expect(out).toContain(">-1m<");
  });

  it("leaves headroom above the tallest picture on the resolution graph, with ticks that differ", () => {
    const out = html(viewer);
    // 1080 lines: the axis runs to 1440, so the line isn't drawn on its top edge.
    expect(out).toContain(">1440p<");
    expect(out).toContain(">720p<");
    expect(out).toContain(">0p<");
    expect(
      html({ ...viewer, points: [point(2, { height: 360 }), point(1, { height: 360 })] }),
    ).toContain(">720p<");
  });

  it("has chips for the path, loss, round trip, codec, fps and freezes", () => {
    const out = html(viewer);
    for (const text of ["relay · TLS", "loss 1.2%", "rtt 34 ms", "VP9", "30 fps", "1 freezes"]) {
      expect(out, text).toContain(text);
    }
  });

  it("lists the step changes with what made each one, not the reason the pair is at now", () => {
    const out = html(viewer);
    // The chip says the upload is shared now; the timeline says what each change was.
    expect(out).toContain("1080p60 → 2968×1242@60");
    expect(out).toContain("Screen size changed");
    expect(out).toContain("2968×1242@60 → 1080p30");
    expect(out).toContain("Upload is shared");
    expect(out).toContain("20s ago");
    // The first step isn't a change from anything: it has no cause.
    expect(out).toMatch(/started at 1080p60<\/span><\/span>/);
  });

  it("leaves a change's cause out when the streamer didn't say", () => {
    const out = html({
      ...viewer,
      changes: [{ at: NOW - 20_000, from: "1080p60", to: "900p30" }],
    });
    // Only the list: the chip above still says why the pair sits where it does.
    const list = out.slice(out.indexOf("<ol"));
    expect(list).toContain("1080p60 → 900p30");
    expect(list).not.toContain("&middot;");
    expect(list).not.toContain(" · ");
    expect(list).not.toContain("Screen size changed");
  });

  it("is plain for a shared upload, green at the top and amber only for the link or the computer", () => {
    const chip = (reason: "best" | "shared" | "connection" | "computer" | "starting") => {
      const out = html({
        ...viewer,
        note: { seq: 1, step: "1080p30", maxBitrate: 3_000_000, reason },
      });
      return out.match(/data-testid="quality-reason"><span class="([^"]*)"/)?.[1] ?? "";
    };
    expect(chip("best")).toContain("var(--color-success)");
    expect(chip("connection")).toContain("var(--color-warning)");
    expect(chip("computer")).toContain("var(--color-warning)");
    for (const plain of ["shared", "starting"] as const) {
      expect(chip(plain), plain).not.toContain("var(--color-warning)");
      expect(chip(plain), plain).not.toContain("var(--color-success)");
    }
  });

  it("marks the streamer's side unknown, and still shows what it receives, before they have said", () => {
    const { note: _, ...heardNothing } = viewer as Extract<QualityView, { side: "viewer" }>;
    const out = html(heardNothing as QualityView);
    expect(out).toContain("Streamer&#x27;s side unknown");
    expect(out).not.toContain("up to ");
    expect(out).toContain('aria-label="Bitrate received from kira');
    expect(out).not.toContain("step cap");
  });

  it("says it is collecting readings when there's nothing to draw yet, and shows dashes, not zeros", () => {
    const out = html({ ...viewer, points: [], changes: [], path: undefined, note: undefined });
    expect(out).toContain("collecting readings");
    expect(out).toContain("path unknown");
    expect(out).toContain("loss –");
    expect(out).toContain("no step changes yet");
  });

  it("doesn't call stale readings 'now'", () => {
    const out = html({ ...viewer, points: [point(120), point(119)] });
    expect(out).not.toContain("2.00 Mbps now");
    expect(out).toContain("loss –");
  });
});

const streamer: QualityView = {
  side: "streamer",
  budget: 23_000_000,
  budgetMeasured: false,
  uplink: [
    point(3, { bps: 8_000_000, capBps: 23_000_000 }),
    point(2, { bps: 9_000_000, capBps: 23_000_000 }),
  ],
  viewers: [
    {
      userId: "kira",
      state: "connected",
      note: { step: "2968×1242@60", maxBitrate: 10_670_000, reason: "best" },
      path: "direct",
      points: [point(3), point(2)],
    },
    {
      userId: "mo",
      state: "relayed",
      note: { step: "900p30", maxBitrate: 2_080_000, reason: "connection" },
      path: "relay · UDP",
      points: [point(3), point(2)],
    },
  ],
  changes: [
    { at: NOW - 30_000, userId: "kira", to: "2968×1242@60" },
    { at: NOW - 10_000, userId: "mo", from: "1080p30", to: "900p30", cause: "connection" },
    { at: NOW - 5_000, userId: "kira", from: "2968×1242@60", to: "1440p30", cause: "budget" },
  ],
};

describe("a streamer's modal", () => {
  it("graphs the total upload against the video budget, called an estimate until it is measured", () => {
    const out = html(streamer);
    expect(out).toContain("9.0 Mbps of 23.0 Mbps");
    expect(out).toContain(
      "Your total upload against the video budget (estimate), last minute: 9.0 Mbps of 23.0 Mbps now",
    );
    expect(out).toContain("video budget (estimate)");
    const measured = html({ ...streamer, budgetMeasured: true });
    expect(measured).toContain("video budget<");
    expect(measured).not.toContain("(estimate)");
  });

  it("words each change from the streamer's side, naming who", () => {
    const out = html(streamer);
    expect(out).toContain("The connection between you and mo");
    expect(out).toContain("Your upload is shared");
    // The first step has no cause.
    expect(out).toMatch(/started at 2968×1242@60<\/span><\/span>/);
  });

  it("has a row for each viewer: a sparkline, the step and the reason from the streamer's side", () => {
    const out = html(streamer);
    expect(out).toContain('aria-label="kira: 2.00 Mbps now, last minute"');
    expect(out).toContain('aria-label="mo: 2.00 Mbps now, last minute"');
    expect(out).toContain("2968×1242@60");
    expect(out).toContain("Best quality");
    expect(out).toContain("900p30");
    expect(out).toContain("The connection between you and mo");
  });

  it("makes each viewer's sparkline taller than a hairline", () => {
    expect(html(streamer)).toMatch(/<svg[^>]*style="height:48px"[^>]*aria-label="kira/);
  });

  it("has a timeline of step changes across all viewers, naming who", () => {
    const out = html(streamer);
    expect(out).toContain("started at 2968×1242@60");
    expect(out).toContain("900p30");
    expect(out).toContain("<b>mo </b>");
  });

  it("says when nobody else is here, and when a viewer's sender hasn't started", () => {
    expect(html({ ...streamer, viewers: [], changes: [] })).toContain("nobody else is here yet");
    const waiting = html({
      ...streamer,
      viewers: [{ userId: "kira", state: "connecting", points: [] }],
    });
    expect(waiting).toContain("connecting…");
  });
});
