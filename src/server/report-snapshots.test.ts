import { describe, expect, it } from "vitest";
import { REPORT_SNAPSHOT_ACCEPT_MS, REPORT_SNAPSHOT_WINDOW_MS } from "../lib/problem-report.ts";
import { ReportSnapshots } from "./report-snapshots.ts";

// The room's snapshot for problem reports (#117): started by the first report, reused by the ones
// that follow inside the minute, and taken from each person once.

const T0 = new Date("2026-10-14T12:00:00Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);

describe("opening a snapshot", () => {
  it("starts one for the first report in a room, under that report's id", () => {
    const snapshots = new ReportSnapshots();
    expect(snapshots.open("r1", "rep-1", T0)).toEqual({ snapshotId: "rep-1", fresh: true });
  });

  it("reuses it for a report inside the minute, in that room only", () => {
    const snapshots = new ReportSnapshots();
    snapshots.open("r1", "rep-1", T0);
    expect(snapshots.open("r1", "rep-2", plus(REPORT_SNAPSHOT_WINDOW_MS - 1))).toEqual({
      snapshotId: "rep-1",
      fresh: false,
    });
    expect(snapshots.open("r2", "rep-3", plus(1_000))).toEqual({
      snapshotId: "rep-3",
      fresh: true,
    });
  });

  it("starts a new one once the minute is over, and the reports after it reuse that", () => {
    const snapshots = new ReportSnapshots();
    snapshots.open("r1", "rep-1", T0);
    const later = plus(REPORT_SNAPSHOT_WINDOW_MS);
    expect(snapshots.open("r1", "rep-2", later)).toEqual({ snapshotId: "rep-2", fresh: true });
    expect(snapshots.open("r1", "rep-3", plus(REPORT_SNAPSHOT_WINDOW_MS + 5_000))).toEqual({
      snapshotId: "rep-2",
      fresh: false,
    });
  });
});

describe("claiming a place in a snapshot", () => {
  it("lets each person in once, for a snapshot of their own room", () => {
    const snapshots = new ReportSnapshots();
    snapshots.open("r1", "rep-1", T0);
    expect(snapshots.claim("r1", "ana", "rep-1", plus(1_000))).toBe(true);
    expect(snapshots.claim("r1", "ana", "rep-1", plus(2_000))).toBe(false);
    expect(snapshots.claim("r1", "bo", "rep-1", plus(2_000))).toBe(true);
    // Not that room's snapshot, and not one that was ever asked for.
    expect(snapshots.claim("r2", "cy", "rep-1", plus(2_000))).toBe(false);
    expect(snapshots.claim("r1", "cy", "made-up", plus(2_000))).toBe(false);
  });

  it("still takes a late snapshot of an earlier minute, until the accept time is up", () => {
    const snapshots = new ReportSnapshots();
    snapshots.open("r1", "rep-1", T0);
    snapshots.open("r1", "rep-2", plus(REPORT_SNAPSHOT_WINDOW_MS));
    expect(snapshots.claim("r1", "ana", "rep-1", plus(REPORT_SNAPSHOT_WINDOW_MS + 1))).toBe(true);
    expect(snapshots.claim("r1", "bo", "rep-1", plus(REPORT_SNAPSHOT_ACCEPT_MS + 1))).toBe(false);
  });

  it("gives a place back, for a snapshot that failed to be stored and is sent again", () => {
    const snapshots = new ReportSnapshots();
    snapshots.open("r1", "rep-1", T0);
    snapshots.claim("r1", "ana", "rep-1", plus(1_000));
    snapshots.release("r1", "ana", "rep-1");
    expect(snapshots.claim("r1", "ana", "rep-1", plus(2_000))).toBe(true);
  });

  it("forgets snapshots past their accept time", () => {
    const snapshots = new ReportSnapshots();
    snapshots.open("r1", "rep-1", T0);
    snapshots.open("r2", "rep-2", T0);
    snapshots.open("r3", "rep-3", plus(REPORT_SNAPSHOT_ACCEPT_MS + 1));
    expect(snapshots.size).toBe(1);
  });
});
