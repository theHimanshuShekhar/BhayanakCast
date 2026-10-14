import { describe, expect, it } from "vitest";
import type {
  RoomTimeline,
  RoomTimelineEntry,
  TimelineDetails,
  TimelineEventKind,
} from "./room-timeline";
import {
  buildTimelineModel,
  type Category,
  filterLanes,
  filterReports,
  filterRows,
  groupMarks,
  type Lane,
  type Mark,
  reportMarkers,
  type Segment,
  type TimelineFilter,
  toRows,
  visibleSegments,
} from "./timeline-model";

const SEC = 1_000;
const T0 = Date.UTC(2026, 9, 10, 22, 30, 0);
const iso = (sec: number) => new Date(T0 + sec * SEC).toISOString();
const at = (sec: number) => T0 + sec * SEC;
const NOW = at(15 * 60);

const people = {
  ana: { id: "ana", username: "Ana", image: null },
  bo: { id: "bo", username: "Bo", image: null },
  cy: { id: "cy", username: "Cy", image: null },
};

const ev = (
  sec: number,
  kind: TimelineEventKind,
  who: string | null,
  extra: { target?: string; details?: TimelineDetails } = {},
): RoomTimelineEntry => ({
  source: "event",
  at: iso(sec),
  kind,
  actorUserId: who,
  targetUserId: extra.target ?? null,
  details: extra.details ?? {},
});
const span = (
  source: "presence" | "stream" | "host",
  userId: string,
  from: number,
  to: number | null,
): RoomTimelineEntry => ({
  source,
  at: iso(from),
  userId,
  endedAt: to === null ? null : iso(to),
});
const room = (entries: RoomTimelineEntry[], truncated = false): RoomTimeline => ({
  entries: [...entries].sort((a, b) => a.at.localeCompare(b.at)),
  people,
  truncated,
});
const lane = (lanes: Lane[], id: string) => {
  const found = lanes.find((l) => l.id === id);
  if (!found) throw new Error(`no lane ${id} in ${lanes.map((l) => l.id).join(", ")}`);
  return found;
};
const spans = (l: Lane, track: string) =>
  l.segments
    .filter((s) => s.track === track)
    .map((s) => [(s.from - T0) / SEC, (s.to - T0) / SEC, s.tone, s.open]);

describe("person lanes", () => {
  it("draws presence, host and shares from the intervals, one lane per person", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        span("presence", "bo", 30, 300),
        span("host", "ana", 0, 200),
        span("host", "bo", 200, 300),
        span("stream", "ana", 100, 140),
      ]),
      NOW,
    );
    const ana = lane(lanes, "person:ana");
    expect(ana.label).toBe("Ana");
    expect(ana.people).toEqual(["ana"]);
    expect(spans(ana, "presence")).toEqual([[0, 600, "present", false]]);
    expect(spans(ana, "host")).toEqual([[0, 200, "host", false]]);
    // A 40 second share is its own segment, for zoom to find.
    expect(spans(ana, "share")).toEqual([[100, 140, "share", false]]);
    expect(spans(lane(lanes, "person:bo"), "host")).toEqual([[200, 300, "host", false]]);
  });

  it("keeps an interval that is still open open, to the end of what is known", () => {
    const { lanes, domain } = buildTimelineModel(
      room([span("presence", "ana", 0, null), span("stream", "ana", 100, null)]),
      NOW,
    );
    const ana = lane(lanes, "person:ana");
    expect(spans(ana, "presence")).toEqual([[0, 900, "present", true]]);
    expect(spans(ana, "share")).toEqual([[100, 900, "share", true]]);
    expect(domain).toEqual({ t0: at(0), t1: NOW });
  });

  it("shows a grace that was resumed as a stretch inside the presence", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        ev(100, "disconnect", "ana"),
        ev(100, "grace_start", "ana", { details: { graceMs: 30_000 } }),
        ev(112, "grace_resume", "ana", { details: { awayMs: 12_000 } }),
      ]),
      NOW,
    );
    const ana = lane(lanes, "person:ana");
    expect(spans(ana, "presence")).toEqual([
      [0, 600, "present", false],
      [100, 112, "grace", false],
    ]);
    expect(ana.segments.find((s) => s.tone === "grace")?.label).toBe("reconnected after 12s");
  });

  it("shows a grace that ends in a leave as the stretch after the presence, then gone", () => {
    const { lanes } = buildTimelineModel(
      room([
        // The presence closes where the socket dropped.
        span("presence", "ana", 0, 100),
        ev(100, "disconnect", "ana"),
        ev(100, "grace_start", "ana", { details: { graceMs: 30_000 } }),
        ev(130, "grace_expire", "ana"),
        ev(130, "leave", "ana", { details: { reason: "grace_expired" } }),
      ]),
      NOW,
    );
    const ana = lane(lanes, "person:ana");
    expect(spans(ana, "presence")).toEqual([
      [0, 100, "present", false],
      [100, 130, "grace", false],
    ]);
    expect(ana.segments.find((s) => s.tone === "grace")?.label).toBe("did not come back");
  });

  it("leaves an unfinished grace open", () => {
    const { lanes } = buildTimelineModel(
      room([span("presence", "ana", 0, null), ev(600, "grace_start", "ana")]),
      NOW,
    );
    expect(spans(lane(lanes, "person:ana"), "presence")).toEqual([
      [0, 900, "present", true],
      [600, 900, "grace", true],
    ]);
  });

  it("pairs camera and mic events into stretches, and a flap is two stretches", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        ev(10, "mic_on", "ana"),
        ev(40, "mic_off", "ana"),
        ev(43, "mic_on", "ana"),
        ev(50, "mic_off", "ana"),
        ev(20, "cam_on", "ana"),
        ev(200, "cam_off", "ana"),
      ]),
      NOW,
    );
    const ana = lane(lanes, "person:ana");
    expect(spans(ana, "mic")).toEqual([
      [10, 40, "mic", false],
      [43, 50, "mic", false],
    ]);
    expect(spans(ana, "cam")).toEqual([[20, 200, "cam", false]]);
  });

  it("closes a camera left on when the person leaves, and opens one seen only turning off at the room's start", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 100),
        ev(10, "cam_on", "ana"),
        ev(100, "leave", "ana", { details: { reason: "left" } }),
        span("presence", "bo", 0, 600),
        ev(60, "mic_off", "bo"),
      ]),
      NOW,
    );
    expect(spans(lane(lanes, "person:ana"), "cam")).toEqual([[10, 100, "cam", false]]);
    // Its start is before what was recorded: drawn from the start of the timeline.
    expect(spans(lane(lanes, "person:bo"), "mic")).toEqual([[0, 60, "mic", false]]);
  });

  it("does not run a camera on through a leave and a rejoin", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 100),
        span("presence", "ana", 200, 600),
        ev(10, "cam_on", "ana"),
        ev(250, "cam_on", "ana"),
        ev(300, "cam_off", "ana"),
      ]),
      NOW,
    );
    expect(spans(lane(lanes, "person:ana"), "cam")).toEqual([
      [10, 100, "cam", false],
      [250, 300, "cam", false],
    ]);
  });

  it("builds host stretches from host_change events when the host intervals are gone", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        span("presence", "bo", 0, 500),
        ev(0, "host_change", "ana", { target: "ana", details: {} }),
        ev(300, "host_change", "bo", { target: "bo", details: { from: "ana" } }),
      ]),
      NOW,
    );
    // Ana hosted until the change; Bo until they left.
    expect(spans(lane(lanes, "person:ana"), "host")).toEqual([[0, 300, "host", false]]);
    expect(spans(lane(lanes, "person:bo"), "host")).toEqual([[300, 500, "host", false]]);
  });

  it("keeps a host that is still there open, and uses the stored intervals when it has them", () => {
    const open = buildTimelineModel(
      room([span("presence", "ana", 0, null), ev(0, "host_change", "ana", { target: "ana" })]),
      NOW,
    );
    expect(spans(lane(open.lanes, "person:ana"), "host")).toEqual([[0, 900, "host", true]]);
    // Both, and the events are not drawn on top of the intervals.
    const both = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        span("host", "ana", 0, 200),
        ev(0, "host_change", "ana", { target: "ana" }),
      ]),
      NOW,
    );
    expect(spans(lane(both.lanes, "person:ana"), "host")).toEqual([[0, 200, "host", false]]);
  });

  it("keeps a camera that is still on open", () => {
    const { lanes } = buildTimelineModel(
      room([span("presence", "ana", 0, null), ev(10, "cam_on", "ana")]),
      NOW,
    );
    expect(spans(lane(lanes, "person:ana"), "cam")).toEqual([[10, 900, "cam", true]]);
  });

  it("falls back to join and leave events when a room's intervals have been purged", () => {
    const { lanes } = buildTimelineModel(
      room([
        ev(0, "join", "ana"),
        ev(300, "leave", "ana", { details: { reason: "left" } }),
        ev(100, "share_start", "ana"),
        ev(160, "share_stop", "ana"),
      ]),
      NOW,
    );
    const ana = lane(lanes, "person:ana");
    expect(spans(ana, "presence")).toEqual([[0, 300, "present", false]]);
    expect(spans(ana, "share")).toEqual([[100, 160, "share", false]]);
  });

  it("puts moderation, device errors and refusals on the lane of the person they are about", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        span("presence", "bo", 0, 600),
        ev(50, "kick", "ana", { target: "bo" }),
        ev(70, "device_error", "ana", { details: { device: "mic", name: "NotAllowedError" } }),
        ev(80, "refusals", "bo", { details: { counts: { "chat:rate_limited": 3 } } }),
        ev(90, "join", "ana"),
      ]),
      NOW,
    );
    expect(lane(lanes, "person:bo").marks.map((m) => [m.kind, m.category])).toEqual([
      ["moderation", "moderation"],
      ["refusal", "refusals"],
    ]);
    expect(lane(lanes, "person:ana").marks.map((m) => [m.kind, m.category])).toEqual([
      ["error", "media"],
    ]);
  });
});

describe("pair lanes", () => {
  const state = (sec: number, who: string, peer: string, s: string) =>
    ev(sec, "pair_state", who, { target: peer, details: { state: s } });

  it("draws the pair's connection as segments, whichever side reported", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        span("presence", "bo", 0, 600),
        state(10, "ana", "bo", "connecting"),
        state(12, "bo", "ana", "connecting"),
        state(15, "ana", "bo", "connected"),
        state(16, "bo", "ana", "connected"),
      ]),
      NOW,
    );
    const pair = lane(lanes, "pair:ana|bo");
    expect(pair.label).toBe("Ana ↔ Bo");
    expect(pair.people).toEqual(["ana", "bo"]);
    expect(spans(pair, "state")).toEqual([
      [10, 16, "connecting", false],
      // Until one of them left.
      [16, 600, "connected", false],
    ]);
  });

  it("shows a flap: the worse of the two sides' states while they differ", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        span("presence", "bo", 0, 600),
        state(10, "ana", "bo", "connected"),
        state(10, "bo", "ana", "connected"),
        state(100, "ana", "bo", "disconnected"),
        state(104, "bo", "ana", "disconnected"),
        state(108, "ana", "bo", "connected"),
        state(109, "bo", "ana", "connected"),
        state(300, "bo", "ana", "failed"),
      ]),
      NOW,
    );
    expect(spans(lane(lanes, "pair:ana|bo"), "state")).toEqual([
      [10, 100, "connected", false],
      [100, 109, "disconnected", false],
      [109, 300, "connected", false],
      [300, 600, "failed", false],
    ]);
  });

  it("does not carry a connection across someone leaving and coming back", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        span("presence", "bo", 0, 100),
        span("presence", "bo", 200, 600),
        state(10, "ana", "bo", "connected"),
        state(10, "bo", "ana", "connected"),
        state(205, "bo", "ana", "connecting"),
        state(206, "ana", "bo", "connecting"),
        state(210, "ana", "bo", "connected"),
        state(210, "bo", "ana", "connected"),
      ]),
      NOW,
    );
    const states = spans(lane(lanes, "pair:ana|bo"), "state");
    expect(states[0]).toEqual([10, 100, "connected", false]);
    expect(states.at(-1)).toEqual([210, 600, "connected", false]);
  });

  it("leaves a connection open to the end while both are still there", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, null),
        span("presence", "bo", 0, null),
        state(10, "ana", "bo", "connected"),
      ]),
      NOW,
    );
    expect(spans(lane(lanes, "pair:ana|bo"), "state")).toEqual([[10, 900, "connected", true]]);
  });

  it("marks path changes, restarts, negotiation errors and quality steps", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        span("presence", "bo", 0, 600),
        ev(10, "pair_path", "ana", {
          target: "bo",
          details: { change: "connect", path: "direct" },
        }),
        ev(200, "pair_path", "ana", {
          target: "bo",
          details: {
            change: "change",
            path: "relay",
            local: { type: "relay", protocol: "udp", relayProtocol: "udp" },
          },
        }),
        ev(150, "pair_restart", "bo", {
          target: "ana",
          details: { how: "ice_restart", why: "failed" },
        }),
        ev(160, "pair_recovery", "bo", {
          target: "ana",
          details: { how: "ice_restart", recovered: false, afterMs: 9000 },
        }),
        ev(170, "negotiation_error", "bo", {
          target: "ana",
          details: { step: "answer", name: "InvalidStateError", message: "wrong state" },
        }),
        {
          source: "quality",
          at: iso(250),
          reporterUserId: "ana",
          peerUserId: "bo",
          direction: "send",
          slot: "screen",
          rung: "1080p30",
          toRung: "720p30",
          reason: "pressure",
        },
      ]),
      NOW,
    );
    const marks = lane(lanes, "pair:ana|bo").marks.map((m) => [(m.t - T0) / SEC, m.kind]);
    expect(marks).toEqual([
      [10, "path"],
      [150, "restart"],
      [160, "restart"],
      [170, "error"],
      [200, "path"],
      [250, "step"],
    ]);
    const change = lane(lanes, "pair:ana|bo").marks.find((m) => m.t === at(200));
    expect(change?.label).toBe("Ana: path changed to relay · UDP");
    expect(lane(lanes, "pair:ana|bo").marks.find((m) => m.kind === "step")?.label).toBe(
      "Ana → Bo: 1080p30 → 720p30 (pressure)",
    );
    // Everything on a pair lane is about connections.
    expect(new Set(lane(lanes, "pair:ana|bo").marks.map((m) => m.category))).toEqual(
      new Set(["connection"]),
    );
  });

  it("has a pair lane for each pair that has events, not for each pair of people", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        span("presence", "bo", 0, 600),
        span("presence", "cy", 0, 600),
        state(10, "ana", "bo", "connected"),
      ]),
      NOW,
    );
    expect(lanes.filter((l) => l.kind === "pair").map((l) => l.id)).toEqual(["pair:ana|bo"]);
  });
});

describe("domain", () => {
  it("covers every entry and the end of every interval", () => {
    const { domain } = buildTimelineModel(
      room([span("presence", "ana", 30, 600), ev(5, "takeover", "bo")]),
      NOW,
    );
    expect(domain).toEqual({ t0: at(5), t1: at(600) });
  });

  it("has a usable span for an empty timeline", () => {
    const { domain, lanes, rows } = buildTimelineModel(room([]), NOW);
    expect(lanes).toEqual([]);
    expect(rows).toEqual([]);
    expect(domain.t1).toBeGreaterThan(domain.t0);
  });
});

describe("problem report markers", () => {
  const report = (sec: number, id: string, extra: TimelineDetails = {}) =>
    ev(sec, "problem_report", "bo", {
      target: "ana",
      details: { reportId: id, category: "blurry", note: "can't read the text", ...extra },
    });

  it("maps a report event to a marker with its category, reporter, stream and note", () => {
    const [marker] = reportMarkers(room([report(120, "r1")]));
    expect(marker).toEqual({
      id: "r1",
      t: at(120),
      category: "blurry",
      reporterId: "bo",
      streamUserId: "ana",
      note: "can't read the text",
    });
  });

  it("ignores snapshot rows and reports without an id, and keeps the order of time", () => {
    const markers = reportMarkers(
      room([
        report(300, "later"),
        report(100, "earlier"),
        ev(110, "report_snapshot", "ana", { details: { reportId: "earlier" } }),
        ev(120, "problem_report", "bo", { details: { category: "blurry" } }),
      ]),
    );
    expect(markers.map((m) => m.id)).toEqual(["earlier", "later"]);
  });

  it("falls back to 'other' for a category this version doesn't know, and no note when blank", () => {
    const [marker] = reportMarkers(room([report(1, "r", { category: "new_one", note: "" })]));
    expect(marker?.category).toBe("other");
    expect(marker?.note).toBeNull();
  });

  it("follow the reports chip and the people picked", () => {
    const markers = reportMarkers(room([report(100, "r1")]));
    const filter = (categories: Category[], who: string[]): TimelineFilter => ({
      categories: new Set(categories),
      people: new Set(who),
    });
    expect(filterReports(markers, filter(["reports"], []))).toHaveLength(1);
    expect(filterReports(markers, filter(["presence"], []))).toHaveLength(0);
    // The reporter (bo) and the stream's owner (ana) both count; someone else doesn't.
    expect(filterReports(markers, filter(["reports"], ["bo"]))).toHaveLength(1);
    expect(filterReports(markers, filter(["reports"], ["ana"]))).toHaveLength(1);
    expect(filterReports(markers, filter(["reports"], ["cy"]))).toHaveLength(0);
  });

  it("are carried by the model, and are not lane marks", () => {
    const model = buildTimelineModel(
      room([span("presence", "ana", 0, 600), span("presence", "bo", 0, 600), report(120, "r1")]),
      NOW,
    );
    expect(model.reports.map((r) => r.id)).toEqual(["r1"]);
    expect(model.lanes.flatMap((l) => l.marks)).toEqual([]);
  });
});

describe("rows", () => {
  it("flattens the timeline to time-ordered rows with names, never ids", () => {
    const rows = toRows(
      room([
        ev(0, "join", "ana"),
        ev(20, "share_start", "ana"),
        ev(60, "kick", "ana", { target: "bo" }),
        ev(70, "pair_state", "bo", { target: "ana", details: { state: "failed" } }),
        ev(80, "problem_report", "bo", {
          target: "ana",
          details: { reportId: "r1", category: "no_audio", note: "silent" },
        }),
        ev(81, "report_snapshot", "ana", { details: { reportId: "r1" } }),
      ]),
    );
    expect(rows.map((r) => [(r.t - T0) / SEC, r.category, r.text])).toEqual([
      [0, "presence", "Ana joined"],
      [20, "media", "Ana started sharing"],
      [60, "moderation", "Ana kicked Bo"],
      [70, "connection", "Bo: connection to Ana failed"],
      [80, "reports", "Bo reported no audio on Ana's screen: “silent”"],
    ]);
    expect(rows[3]?.people).toEqual(["bo", "ana"]);
  });

  it("adds the start and end of an interval no event already told", () => {
    const rows = toRows(
      room([
        span("presence", "ana", 0, 100),
        ev(0, "join", "ana"),
        ev(100, "leave", "ana", { details: { reason: "left" } }),
        span("presence", "bo", 10, 90),
        span("stream", "bo", 20, 40),
      ]),
    );
    expect(rows.map((r) => [(r.t - T0) / SEC, r.text])).toEqual([
      [0, "Ana joined"],
      [10, "Bo joined"],
      [20, "Bo started sharing"],
      [40, "Bo stopped sharing"],
      [90, "Bo left"],
      [100, "Ana left"],
    ]);
  });

  it("files a kick under the person kicked: their presence ends there, with no second 'left'", () => {
    const rows = toRows(
      room([
        span("presence", "ana", 0, 600),
        span("presence", "bo", 0, 300),
        ev(300, "kick", "ana", { target: "bo" }),
      ]),
    );
    expect(rows.map((r) => [(r.t - T0) / SEC, r.text])).toEqual([
      [0, "Ana joined"],
      [0, "Bo joined"],
      [300, "Ana kicked Bo"],
      // The kicker's own presence is not what the kick told: it still needs its end.
      [600, "Ana left"],
    ]);
  });

  it("closes a kicked person's lane stretches at the kick, whether or not the intervals are there", () => {
    const { lanes } = buildTimelineModel(
      room([
        ev(0, "join", "ana"),
        ev(0, "join", "bo"),
        ev(50, "mic_on", "bo"),
        ev(300, "kick", "ana", { target: "bo" }),
      ]),
      NOW,
    );
    expect(spans(lane(lanes, "person:bo"), "presence")).toEqual([[0, 300, "present", false]]);
    expect(spans(lane(lanes, "person:bo"), "mic")).toEqual([[50, 300, "mic", false]]);
    expect(spans(lane(lanes, "person:ana"), "presence")).toEqual([[0, 900, "present", true]]);
    // The kick is a mark on the lane of the person kicked, not on the kicker's.
    expect(lane(lanes, "person:bo").marks.map((m) => m.kind)).toEqual(["moderation"]);
    expect(lane(lanes, "person:ana").marks).toEqual([]);
  });

  it("says what a refusals summary counted", () => {
    const [row] = toRows(
      room([
        ev(5, "refusals", "bo", {
          details: { counts: { "chat:rate_limited": 3, "x:bad_request": 1 } },
        }),
      ]),
    );
    expect(row?.text).toBe("Bo had 4 messages refused (3 rate limited, 1 bad request)");
    expect(row?.category).toBe("refusals");
  });
});

describe("filtering", () => {
  const all: TimelineFilter = {
    categories: new Set(["presence", "media", "connection", "moderation", "refusals", "reports"]),
    people: new Set(),
  };
  const rows = toRows(
    room([
      ev(0, "join", "ana"),
      ev(1, "join", "bo"),
      ev(20, "share_start", "ana"),
      ev(60, "kick", "ana", { target: "bo" }),
      ev(70, "pair_state", "bo", { target: "cy", details: { state: "failed" } }),
    ]),
  );

  it("keeps everything when every category is on and nobody is picked", () => {
    expect(filterRows(rows, all)).toHaveLength(5);
  });

  it("keeps only the categories that are on", () => {
    const only = filterRows(rows, { ...all, categories: new Set(["media", "moderation"]) });
    expect(only.map((r) => r.kind)).toEqual(["share_start", "kick"]);
    expect(filterRows(rows, { ...all, categories: new Set() })).toEqual([]);
  });

  it("keeps what involves a person picked, as actor, target or peer", () => {
    const bo = filterRows(rows, { ...all, people: new Set(["bo"]) });
    expect(bo.map((r) => r.kind)).toEqual(["join", "kick", "pair_state"]);
    const cy = filterRows(rows, { ...all, people: new Set(["cy"]) });
    expect(cy.map((r) => r.kind)).toEqual(["pair_state"]);
    const either = filterRows(rows, { ...all, people: new Set(["ana", "cy"]) });
    expect(either.map((r) => r.kind)).toEqual(["join", "share_start", "kick", "pair_state"]);
  });

  describe("on lanes", () => {
    const { lanes } = buildTimelineModel(
      room([
        span("presence", "ana", 0, 600),
        span("presence", "bo", 0, 600),
        span("presence", "cy", 0, 600),
        span("stream", "ana", 100, 140),
        ev(50, "kick", "ana", { target: "bo" }),
        ev(10, "pair_state", "ana", { target: "bo", details: { state: "connected" } }),
        ev(10, "pair_state", "cy", { target: "bo", details: { state: "connected" } }),
      ]),
      NOW,
    );

    it("keeps lanes of the people picked, and the pair lanes they are in", () => {
      const ids = (f: TimelineFilter) => filterLanes(lanes, f).map((l) => l.id);
      expect(ids(all).sort()).toEqual(
        ["pair:ana|bo", "pair:bo|cy", "person:ana", "person:bo", "person:cy"].sort(),
      );
      expect(ids({ ...all, people: new Set(["ana"]) }).sort()).toEqual(
        ["pair:ana|bo", "person:ana"].sort(),
      );
    });

    it("takes out the segments and marks of categories that are off, and the lanes left empty", () => {
      const noConnection = filterLanes(lanes, {
        ...all,
        categories: new Set(["presence", "media", "moderation"]),
      });
      expect(noConnection.map((l) => l.kind)).not.toContain("pair");
      const onlyMedia = filterLanes(lanes, { ...all, categories: new Set(["media"]) });
      expect(onlyMedia.map((l) => l.id)).toEqual(["person:ana"]);
      expect(onlyMedia[0]?.segments.map((s) => s.track)).toEqual(["share"]);
    });
  });
});

describe("drawing a crowded lane", () => {
  const view = { t0: T0, t1: T0 + 1_000 * SEC };
  const mark = (sec: number, kind: Mark["kind"] = "refusal", relay?: boolean): Mark => ({
    t: at(sec),
    kind,
    category: "refusals",
    label: `mark at ${sec}`,
    people: [],
    ...(relay && { relay }),
  });

  it("groups marks of one kind that fall in the same pixel column, at the first one's time", () => {
    // 1,000 s over 100 px, in columns of 10 px: 100 s each.
    const groups = groupMarks([mark(10), mark(20), mark(90), mark(150), mark(950)], view, 100, 10);
    expect(groups.map((g) => [(g.t - T0) / SEC, g.marks.length])).toEqual([
      [10, 3],
      [150, 1],
      [950, 1],
    ]);
    expect(groups[0]?.marks.map((m) => m.label)).toEqual([
      "mark at 10",
      "mark at 20",
      "mark at 90",
    ]);
  });

  it("keeps different kinds apart, and a relayed path apart from a direct one", () => {
    const groups = groupMarks(
      [mark(10, "refusal"), mark(20, "error"), mark(30, "path"), mark(40, "path", true)],
      view,
      100,
      10,
    );
    expect(groups.map((g) => g.kind)).toEqual(["refusal", "error", "path", "path"]);
  });

  it("separates them again when zoomed in, so nothing is lost to the grouping", () => {
    const marks = [mark(10), mark(20), mark(90)];
    const wide = groupMarks(marks, view, 100, 10);
    const close = groupMarks(marks, { t0: T0, t1: T0 + 100 * SEC }, 100, 10);
    expect(wide).toHaveLength(1);
    expect(close).toHaveLength(3);
  });

  it("leaves out what is outside the view", () => {
    expect(groupMarks([mark(-5), mark(500), mark(1_200)], view, 100, 10)).toHaveLength(1);
  });

  it("draws one of a run of segments too thin to see, and every one that is wide enough", () => {
    const seg = (from: number, to: number, tone: Segment["tone"]): Segment => ({
      track: "state",
      from: at(from),
      to: at(to),
      tone,
      open: false,
      label: tone,
      category: "connection",
      people: [],
    });
    // 1,000 s over 1,000 px: a pixel is a second. A flap of 0.5 s is half of one.
    const flaps = Array.from({ length: 10 }, (_, i) => [
      seg(100 + i, 100.5 + i, "connected"),
      seg(100.5 + i, 101 + i, "disconnected"),
    ]).flat();
    const wide = seg(500, 600, "connected");
    const drawn = visibleSegments([...flaps, wide], view, 1_000);
    expect(drawn.length).toBeLessThan(flaps.length / 2);
    expect(drawn.at(-1)?.segment).toBe(wide);
    // Their order in the lane is how they are keyed, so each carries it.
    expect(drawn.at(-1)?.index).toBe(flaps.length);
    // At a scale where each is wide enough, all of them are drawn.
    expect(visibleSegments(flaps, { t0: at(100), t1: at(110) }, 1_000)).toHaveLength(flaps.length);
  });

  it("keeps a 5,000 entry room quick: the model, a filter and the grouping", () => {
    const people = ["ana", "bo", "cy", "dee", "eve", "fay"];
    const entries: RoomTimelineEntry[] = people.map((p) => span("presence", p, 0, 5_000));
    for (let i = 0; i < 4_900; i++) {
      const a = people[i % 6] as string;
      const b = people[(i + 1 + (i % 5)) % 6] as string;
      if (a === b) continue;
      const kind = i % 4;
      entries.push(
        kind === 0
          ? ev(i, "pair_state", a, {
              target: b,
              details: { state: i % 8 ? "connected" : "failed" },
            })
          : kind === 1
            ? ev(i, i % 8 === 1 ? "cam_on" : "cam_off", a)
            : kind === 2
              ? ev(i, "refusals", a, { details: { counts: { "chat:rate_limited": 1 } } })
              : ev(i, "pair_path", a, {
                  target: b,
                  details: { change: "change", path: "direct" },
                }),
      );
    }
    const timeline = room(entries);
    const started = performance.now();
    const model = buildTimelineModel(timeline, NOW);
    const shown = filterLanes(model.lanes, {
      categories: new Set(["presence", "media", "connection", "moderation", "refusals", "reports"]),
      people: new Set(),
    });
    let drawn = 0;
    let raw = 0;
    const marksOnly: number[] = [];
    for (const lane of shown) {
      const groups = groupMarks(lane.marks, model.domain, 800, 8).length;
      const kinds = new Set(lane.marks.map((m) => m.kind)).size;
      // A lane 800 px wide has 100 columns of 8 px: one mark per column and kind at most (twice
      // for a path, which can be direct or relayed).
      expect(groups).toBeLessThanOrEqual(100 * kinds * 2);
      marksOnly.push(groups);
      drawn += groups + visibleSegments(lane.segments, model.domain, 800).length;
      raw += lane.marks.length + lane.segments.length;
    }
    const took = performance.now() - started;
    expect(raw).toBeGreaterThan(2_000);
    // Well under what there is, though how far depends on how the room's entries fall.
    expect(drawn).toBeLessThan(raw * 0.75);
    expect(marksOnly.reduce((a, b) => a + b, 0)).toBeLessThan(raw / 3);
    // Generous: it takes tens of milliseconds, and a slow runner is no reason to fail.
    expect(took).toBeLessThan(2_000);
  });
});
