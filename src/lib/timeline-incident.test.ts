import { describe, expect, it } from "vitest";
import type { NamedSnapshotStream, RecentReport, ReportSnapshotEntry } from "./problem-report";
import { snapshotRows } from "./timeline-incident";

const person = (id: string) => ({ id, username: id.toUpperCase(), image: null });
const stream = (
  from: string,
  to: string,
  rest: Partial<NamedSnapshotStream> = {},
): NamedSnapshotStream => ({
  from,
  to,
  fromName: from.toUpperCase(),
  toName: to.toUpperCase(),
  ...rest,
});
const entry = (
  user: string,
  streams: NamedSnapshotStream[],
  pairs: [string, ReportSnapshotEntry["pairs"][number]["state"]][] = [],
): ReportSnapshotEntry => ({
  user: person(user),
  at: "2026-10-10T22:35:00.000Z",
  own: false,
  browser: { name: "chrome", version: "141" },
  truncated: false,
  streams,
  pairs: pairs.map(([peerId, state]) => ({ peerId, name: peerId.toUpperCase(), state })),
});
const report = (snapshots: ReportSnapshotEntry[]): RecentReport => ({
  id: "r1",
  at: "2026-10-10T22:35:04.000Z",
  roomId: "room",
  roomName: "a room",
  reporter: person("bo"),
  stream: null,
  category: "blurry",
  note: null,
  snapshotId: "r1",
  reused: false,
  snapshots,
});

describe("snapshotRows", () => {
  it("makes one row per stream, using what each end knows best", () => {
    const rows = snapshotRows(
      report([
        // The streamer knows the step it chose and why; it also measured what it sends.
        entry("ana", [
          stream("ana", "bo", { step: "1080p30", cap: 6e6, reason: "shared", bps: 1 }),
        ]),
        // The viewer measured what arrived.
        entry("bo", [
          stream("ana", "bo", {
            step: "720p30",
            bps: 2_400_000,
            width: 1280,
            height: 720,
            fps: 24,
            loss: 0.031,
            rttMs: 48,
            path: "relay · UDP",
          }),
        ]),
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      streamerId: "ana",
      viewerId: "bo",
      streamer: "ANA",
      viewer: "BO",
      idle: false,
      // The streamer's word for the step, cap and reason; the viewer's for the numbers.
      step: "1080p30",
      cap: 6e6,
      reason: "shared",
      bps: 2_400_000,
      width: 1280,
      height: 720,
      fps: 24,
      loss: 0.031,
      rttMs: 48,
      path: "relay · UDP",
      reports: 2,
    });
  });

  it("falls back to the other end's reading where its own browser had none", () => {
    const [row] = snapshotRows(
      report([
        entry("ana", [stream("ana", "bo", { step: "1080p30", cap: 6e6, rttMs: 20 })]),
        entry("bo", [stream("ana", "bo", { fps: 30 })]),
      ]),
    );
    expect(row).toMatchObject({ step: "1080p30", rttMs: 20, fps: 30 });
    expect(row?.bps).toBeUndefined();
  });

  it("keeps a stream only one browser reported, and a stream and its reverse apart", () => {
    const rows = snapshotRows(
      report([
        entry("bo", [stream("ana", "bo", { fps: 30 }), stream("bo", "ana", { step: "720p30" })]),
      ]),
    );
    expect(rows.map((r) => `${r.streamerId}>${r.viewerId}`)).toEqual(["ana>bo", "bo>ana"]);
  });

  it("adds a row for each pair nobody streams over, once, whichever side reported it", () => {
    const rows = snapshotRows(
      report([
        entry(
          "ana",
          [stream("ana", "bo", { step: "720p30" })],
          [
            ["bo", "connected"],
            ["cy", "connected"],
          ],
        ),
        entry("cy", [], [["ana", "connected"]]),
        entry("bo", [], [["cy", "connected"]]),
      ]),
    );
    const idle = rows.filter((r) => r.idle);
    expect(idle.map((r) => [r.streamer, r.viewer])).toEqual([
      ["ANA", "CY"],
      ["BO", "CY"],
    ]);
    // After the streams.
    expect(rows.map((r) => r.idle)).toEqual([false, true, true]);
  });

  it("gives each row the worst state either end reports for the pair", () => {
    const rows = snapshotRows(
      report([
        entry("ana", [stream("ana", "bo", { step: "720p30" })], [["bo", "connected"]]),
        entry("bo", [], [["ana", "failed"]]),
        entry("cy", [], [["ana", "connected"]]),
        entry("ana", [], [["cy", "relayed"]]),
      ]),
    );
    const state = (a: string, b: string) =>
      rows.find((r) => [r.streamerId, r.viewerId].sort().join() === [a, b].sort().join())?.pair;
    expect(state("ana", "bo")).toBe("failed");
    expect(state("ana", "cy")).toBe("relayed");
  });

  it("flags a row that shows trouble: a pair that is not up, loss over 2%, or a frozen picture", () => {
    const rows = snapshotRows(
      report([
        entry(
          "bo",
          [
            stream("ana", "bo", { loss: 0.031 }),
            stream("cy", "bo", { fps: 0 }),
            stream("dee", "bo", { loss: 0.004, fps: 30 }),
            stream("eve", "bo", { fps: 30 }),
          ],
          [["eve", "connecting"]],
        ),
      ]),
    );
    expect(rows.map((r) => [r.streamerId, r.trouble])).toEqual([
      ["ana", true],
      ["cy", true],
      ["dee", false],
      ["eve", true],
    ]);
  });

  it("has no rows for a snapshot that was too large to keep, nor for none", () => {
    expect(snapshotRows(report([]))).toEqual([]);
    expect(snapshotRows(report([{ ...entry("ana", []), truncated: true }]))).toEqual([]);
  });
});
