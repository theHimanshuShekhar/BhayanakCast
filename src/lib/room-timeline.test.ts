import { describe, expect, it } from "vitest";
import { boundDetails, MAX_TIMELINE_DETAILS_BYTES } from "./room-timeline";

// How much of a timeline row's details is kept (#115, #117).

describe("boundDetails", () => {
  it("keeps details that fit, as they are", () => {
    const details = { state: "connected" };
    expect(boundDetails(details)).toBe(details);
  });

  it("replaces details that are too big with { truncated: true }", () => {
    expect(boundDetails({ blob: "x".repeat(MAX_TIMELINE_DETAILS_BYTES) })).toEqual({
      truncated: true,
    });
  });

  it("measures bytes, not characters, against the limit it is given", () => {
    const text = "あ".repeat(100);
    expect(boundDetails({ text }, 400)).toEqual({ text });
    expect(boundDetails({ text }, 250)).toEqual({ truncated: true });
  });

  it("keeps the named fields of details that are cut, so a row stays tied to what it belongs to", () => {
    const details = {
      reportId: "rep-1",
      snapshot: "rep-1",
      category: "blurry",
      note: "x".repeat(2_000),
    };
    expect(boundDetails(details, 1_024, ["reportId", "snapshot", "category"])).toEqual({
      truncated: true,
      reportId: "rep-1",
      snapshot: "rep-1",
      category: "blurry",
    });
  });

  it("keeps only the named fields that are there", () => {
    expect(boundDetails({ blob: "x".repeat(2_000) }, 1_024, ["reportId"])).toEqual({
      truncated: true,
    });
  });
});
