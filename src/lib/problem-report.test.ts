import { describe, expect, it } from "vitest";
import { connectionEvent, reportConnectionEventsInput } from "./connection-events";
import type { QualityView } from "./mesh";
import { PROBLEM_NOTE_MAX, reportProblemInput } from "./problem-report";
import { type ReportSnapshot, reportSnapshot } from "./report-snapshot";
import { answerSnapshotRequest, browserOf, buildSnapshot } from "./snapshot-builder";

// A problem report (#117): the snapshot a browser sends of its own connections, and the form the
// reporter fills in. The snapshot keeps what the quality modal shows and each pair's state, and
// never a device label or an address.

const NOW = 1_000_000;
const chrome: ReportSnapshot["browser"] = { name: "chrome", version: "126" };

/** A viewer's view of `userId`'s share, the way the Mesh makes it. */
const viewerView = (userId: string, overrides: Partial<QualityView> = {}): QualityView =>
  ({
    side: "viewer",
    userId,
    state: "connected",
    note: { seq: 3, step: "1080p30", maxBitrate: 8_000_000, reason: "connection" },
    path: "relay · UDP",
    points: [
      {
        at: NOW - 1_000,
        bps: 2_345_678.9,
        capBps: 8_000_000,
        width: 1920,
        height: 1080,
        fps: 29.6,
        codec: "video/VP9",
        loss: 0.04567891,
        rttMs: 87.4,
        freezes: 2,
      },
    ],
    changes: [],
    switches: [],
    ...overrides,
  }) as QualityView;

describe("buildSnapshot", () => {
  it("holds what the viewer's quality modal shows of a stream, rounded, with its age", () => {
    const snapshot = buildSnapshot({
      meId: "me",
      views: [viewerView("ana")],
      peers: [{ userId: "ana", state: "connected" }],
      browser: chrome,
      now: NOW,
    });
    expect(snapshot).toEqual({
      browser: chrome,
      streams: [
        {
          from: "ana",
          to: "me",
          step: "1080p30",
          cap: 8_000_000,
          reason: "connection",
          path: "relay · UDP",
          ageMs: 1_000,
          bps: 2_345_679,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: "VP9",
          loss: 0.0457,
          rttMs: 87,
          freezes: 2,
        },
      ],
      pairs: [{ peerId: "ana", state: "connected" }],
    });
  });

  it("gives a streamer's own share one stream per viewer, from this browser to them", () => {
    const view: QualityView = {
      side: "streamer",
      budget: 25_000_000,
      budgetMeasured: true,
      uplink: [],
      changes: [],
      switches: [],
      viewers: [
        {
          userId: "bo",
          state: "connected",
          note: { step: "720p30", maxBitrate: 3_000_000, reason: "shared" },
          path: "direct",
          points: [{ at: NOW - 500, bps: 2_900_000, capBps: 3_000_000 }],
        },
        // Nothing sent to them yet: not a stream.
        { userId: "cy", state: "connecting", points: [] },
      ],
    };
    const { streams } = buildSnapshot({
      meId: "me",
      views: [view],
      peers: [],
      browser: chrome,
      now: NOW,
    });
    expect(streams).toEqual([
      {
        from: "me",
        to: "bo",
        step: "720p30",
        cap: 3_000_000,
        reason: "shared",
        path: "direct",
        ageMs: 500,
        bps: 2_900_000,
      },
    ]);
  });

  it("leaves out the numbers of a reading that is no longer 'now', but keeps the streamer's word", () => {
    const stale = viewerView("ana", {
      points: [{ at: NOW - 30_000, bps: 1_000_000 }],
    } as Partial<QualityView>);
    const { streams } = buildSnapshot({
      meId: "me",
      views: [stale],
      peers: [],
      browser: chrome,
      now: NOW,
    });
    expect(streams).toEqual([
      {
        from: "ana",
        to: "me",
        step: "1080p30",
        cap: 8_000_000,
        reason: "connection",
        path: "relay · UDP",
      },
    ]);
  });

  it("skips a peer with no stream at all, and says only the pair's state of it", () => {
    const empty = viewerView("ana", { note: undefined, path: undefined, points: [] });
    const snapshot = buildSnapshot({
      meId: "me",
      views: [empty],
      peers: [{ userId: "ana", state: "failed" }],
      browser: chrome,
      now: NOW,
    });
    expect(snapshot.streams).toEqual([]);
    expect(snapshot.pairs).toEqual([{ peerId: "ana", state: "failed" }]);
  });

  it("holds no device label and no address, and fits what the server accepts", () => {
    const snapshot = buildSnapshot({
      meId: "me",
      views: [viewerView("ana")],
      peers: [{ userId: "ana", state: "relayed" }],
      browser: chrome,
      now: NOW,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/\d+\.\d+\.\d+\.\d+|label|deviceId/i);
    expect(reportSnapshot.safeParse(snapshot).success).toBe(true);
  });
});

describe("answerSnapshotRequest", () => {
  const snapshot: ReportSnapshot = { browser: chrome, streams: [], pairs: [] };

  it("hands the snapshot to the queue as a report_snapshot event for the report", () => {
    const added: unknown[] = [];
    answerSnapshotRequest(
      "rep-1",
      () => snapshot,
      (event) => added.push(event),
    );
    expect(added).toEqual([{ kind: "report_snapshot", reportId: "rep-1", ...snapshot }]);
  });

  it("swallows whatever goes wrong, so a request nobody on the page made never reaches it", () => {
    const calm = () => {
      throw new Error("getStats failed");
    };
    expect(() => answerSnapshotRequest("rep-1", calm, () => {})).not.toThrow();
    expect(() =>
      answerSnapshotRequest(
        "rep-1",
        () => snapshot,
        () => {
          throw new Error("queue broke");
        },
      ),
    ).not.toThrow();
  });
});

describe("browserOf", () => {
  it.each([
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.61 Safari/537.36",
      { name: "chrome", version: "126" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.81",
      { name: "edge", version: "126" },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
      { name: "firefox", version: "130" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      { name: "safari", version: "17" },
    ],
    ["curl/8.0", { name: "other", version: "" }],
    ["", { name: "other", version: "" }],
  ])("reads %#", (userAgent, expected) => {
    expect(browserOf(userAgent)).toEqual(expected);
  });
});

describe("reportProblemInput", () => {
  const snapshot = { browser: chrome, streams: [], pairs: [] };
  const ok = { roomId: "r1", category: "blurry", snapshot } as const;

  it("takes a category alone: the note is optional and so is the stream", () => {
    expect(reportProblemInput.parse(ok)).toEqual(ok);
  });

  it("trims the note, and treats a blank one as none", () => {
    expect(reportProblemInput.parse({ ...ok, note: "  it froze  " }).note).toBe("it froze");
    expect(reportProblemInput.parse({ ...ok, note: "   " }).note).toBeUndefined();
  });

  it("refuses a note over the limit, counted after trimming", () => {
    const longest = "x".repeat(PROBLEM_NOTE_MAX);
    expect(reportProblemInput.safeParse({ ...ok, note: ` ${longest} ` }).success).toBe(true);
    expect(reportProblemInput.safeParse({ ...ok, note: `${longest}x` }).success).toBe(false);
  });

  it("refuses a category that isn't one of the five", () => {
    expect(reportProblemInput.safeParse({ ...ok, category: "laggy" }).success).toBe(false);
    for (const category of ["blurry", "frozen", "no_audio", "cant_connect", "other"]) {
      expect(reportProblemInput.safeParse({ ...ok, category }).success).toBe(true);
    }
  });

  it("refuses fields it doesn't know", () => {
    expect(reportProblemInput.safeParse({ ...ok, userId: "someone-else" }).success).toBe(false);
  });
});

describe("the report_snapshot connection event", () => {
  const snapshot = {
    browser: chrome,
    streams: [],
    pairs: [{ peerId: "ana", state: "connected" }],
  };

  it("is a connection event of its own, tied to its report by id", () => {
    const event = { kind: "report_snapshot", ageMs: 0, reportId: "rep-1", ...snapshot };
    expect(connectionEvent.safeParse(event).success).toBe(true);
    expect(reportConnectionEventsInput.safeParse({ roomId: "r1", events: [event] }).success).toBe(
      true,
    );
  });

  it("needs the report id and refuses extra fields", () => {
    const base = { kind: "report_snapshot", ageMs: 0, ...snapshot };
    expect(connectionEvent.safeParse(base).success).toBe(false);
    expect(connectionEvent.safeParse({ ...base, reportId: "r", ip: "1.2.3.4" }).success).toBe(
      false,
    );
  });
});
