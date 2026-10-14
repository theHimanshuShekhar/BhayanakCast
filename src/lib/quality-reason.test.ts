import { describe, expect, it } from "vitest";
import type { StatsSample } from "./quality";
import {
  applyNote,
  CHANGE_CAUSES,
  causeOf,
  causeText,
  decodeNote,
  NOTE_REFRESH_MS,
  NoteSender,
  pressureCause,
  type ReasonState,
  reasonOf,
  reasonText,
  STEP_REASONS,
  type StepNote,
} from "./quality-reason";

// Why a pair sits where it does (ADR 2 addendum: the quality modal), as one of five plain
// reasons, mapped from the controller's state.

/** A pair below its top step, clean, and waiting: the baseline each case changes one thing of. */
const below: ReasonState = { atTop: false, probing: false, limited: false };

describe("reasonOf", () => {
  it("is best quality at the top step, whatever else is going on", () => {
    expect(reasonOf({ ...below, atTop: true })).toBe("best");
    expect(reasonOf({ ...below, atTop: true, pressure: "connection", limited: true })).toBe("best");
  });

  it("is getting started / trying higher while a probe is out, even on a link that held it down", () => {
    expect(reasonOf({ ...below, probing: true })).toBe("starting");
    expect(reasonOf({ ...below, probing: true, limited: true, cause: "connection" })).toBe(
      "starting",
    );
  });

  it("is the connection while the pair shows strain, and the computer while it is CPU-limited", () => {
    expect(reasonOf({ ...below, pressure: "connection" })).toBe("connection");
    expect(reasonOf({ ...below, pressure: "computer" })).toBe("computer");
  });

  it("keeps saying why it stepped down under pressure until a higher step has held", () => {
    expect(reasonOf({ ...below, limited: true, cause: "connection" })).toBe("connection");
    expect(reasonOf({ ...below, limited: true, cause: "computer" })).toBe("computer");
    // A pair held down with no cause recorded is its link's doing: that is what `limited` means.
    expect(reasonOf({ ...below, limited: true })).toBe("connection");
    // The cause is forgotten once the pair is no longer held down.
    expect(reasonOf({ ...below, cause: "computer", nextBitrate: 2, ceiling: 9 })).toBe("starting");
  });

  it("is the shared upload when the next step costs more than the pair's ceiling", () => {
    expect(reasonOf({ ...below, nextBitrate: 5_330_000, ceiling: 2_560_000 })).toBe("shared");
    // Exactly the ceiling fits (a probe within it is entitled to go ahead).
    expect(reasonOf({ ...below, nextBitrate: 2_560_000, ceiling: 2_560_000 })).toBe("starting");
  });

  it("blames the link, not the share, when the link is what lowered the pair's ceiling", () => {
    // `limited` pairs have a ceiling equal to what they target, so the next step is always over it.
    expect(
      reasonOf({
        ...below,
        limited: true,
        cause: "connection",
        nextBitrate: 3_000_000,
        ceiling: 2_080_000,
      }),
    ).toBe("connection");
  });

  it("is getting started / trying higher when nothing holds the pair back but time", () => {
    expect(reasonOf(below)).toBe("starting");
    expect(reasonOf({ ...below, nextBitrate: 3_000_000 })).toBe("starting");
  });
});

describe("pressureCause", () => {
  const clean: StatsSample = { loss: 0, limit: "none" };

  it("reads loss, a long round trip and a backed bandwidth limit as the connection", () => {
    expect(pressureCause({ ...clean, loss: 0.06 })).toBe("connection");
    expect(pressureCause({ ...clean, rttMs: 600 })).toBe("connection");
    expect(
      pressureCause({ ...clean, limit: "bandwidth", availableBitrate: 1_000, sendBitrate: 4_000 }),
    ).toBe("connection");
  });

  it("reads a CPU limit as the computer, but strain wins when both show", () => {
    expect(pressureCause({ ...clean, limit: "cpu" })).toBe("computer");
    expect(pressureCause({ ...clean, limit: "cpu", loss: 0.2 })).toBe("connection");
  });

  it("reads a clean sample, and a bandwidth limit the encoder put on itself, as no pressure", () => {
    expect(pressureCause(clean)).toBeUndefined();
    expect(pressureCause({ ...clean, loss: 0.02, rttMs: 200 })).toBeUndefined();
    expect(pressureCause({ ...clean, limit: "bandwidth" })).toBeUndefined();
  });
});

describe("reasonText", () => {
  it("words each reason for the viewer, and says the connection may be either end or the route", () => {
    expect(STEP_REASONS.map((r) => reasonText(r, { side: "viewer" }).label)).toEqual([
      "Best quality",
      "Streamer's upload is shared",
      "The connection between you",
      "Streamer's computer",
      "Getting started / trying higher",
    ]);
    expect(reasonText("connection", { side: "viewer" }).explanation).toMatch(
      /either end or the route between them/,
    );
  });

  it("words each reason from the streamer's side, naming the viewer", () => {
    const from = (r: (typeof STEP_REASONS)[number]) =>
      reasonText(r, { side: "streamer", viewer: "kira" }).label;
    expect(from("shared")).toBe("Your upload is shared");
    expect(from("connection")).toBe("The connection between you and kira");
    expect(from("computer")).toBe("Your computer");
    expect(from("best")).toBe("Best quality");
    expect(from("starting")).toBe("Getting started / trying higher");
    expect(reasonText("connection", { side: "streamer", viewer: "kira" }).explanation).toMatch(
      /either end or the route between/,
    );
  });

  it("words each reason for an admin, in the third person, naming both people", () => {
    const from = (r: Parameters<typeof reasonText>[0]) =>
      reasonText(r, { side: "admin", streamer: "ana", viewer: "kira" });
    expect(STEP_REASONS.map((r) => from(r).label)).toEqual([
      "Best quality",
      "Streamer's upload is shared",
      "The connection between ana and kira",
      "Streamer's computer",
      "Getting started / trying higher",
    ]);
    expect(from(undefined).label).toBe("Streamer's side unknown");
    // Never "you" or "your": the reader is neither end.
    for (const r of [...STEP_REASONS, undefined]) {
      const { label, explanation } = from(r);
      expect(`${label} ${explanation}`).not.toMatch(/\byou(r|rs)?\b/i);
    }
    expect(from("connection").explanation).toMatch(/either end or the route between them/);
  });

  it("marks a streamer's side the viewer hasn't heard as unknown", () => {
    const unknown = reasonText(undefined, { side: "viewer" });
    expect(unknown.label).toBe("Streamer's side unknown");
    expect(unknown.explanation).toMatch(/what you receive/);
  });
});

// The step message: what a streamer tells one viewer about the pair (step, its cap, why).

const body = { step: "1080p30", maxBitrate: 3_000_000, reason: "starting" } as const;

describe("NoteSender", () => {
  it("sends the first state, then nothing while it stays the same", () => {
    const sender = new NoteSender();
    const first = sender.due(body, 0) as StepNote;
    expect(first).toEqual({ seq: 1, ...body });
    sender.delivered(first, 0);
    expect(sender.due(body, 1_000)).toBeUndefined();
  });

  it("sends again, with a higher seq, when the step, its cap or the reason changes", () => {
    const sender = new NoteSender();
    const first = sender.due(body, 0) as StepNote;
    sender.delivered(first, 0);
    for (const changed of [
      { ...body, step: "900p30" },
      { ...body, step: "900p30", maxBitrate: 2_080_000 },
      { ...body, step: "900p30", maxBitrate: 2_080_000, reason: "connection" as const },
    ]) {
      const note = sender.due(changed, 1) as StepNote;
      expect(note).toMatchObject(changed);
      sender.delivered(note, 1);
    }
    expect(
      sender.due({ ...body, step: "900p30", maxBitrate: 2_080_000, reason: "connection" }, 2),
    ).toBeUndefined();
  });

  it("numbers messages in order", () => {
    const sender = new NoteSender();
    const seqs: number[] = [];
    for (const step of ["a", "b", "c"]) {
      const note = sender.due({ ...body, step }, 0) as StepNote;
      sender.delivered(note, 0);
      seqs.push(note.seq);
    }
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("tries again until a message is delivered (the socket was reconnecting)", () => {
    const sender = new NoteSender();
    expect(sender.due(body, 0)).toBeDefined();
    // Not marked delivered: still due, and under the same seq.
    expect(sender.due(body, 100)?.seq).toBe(1);
  });

  it("sends the current state again when the pair (re)connects", () => {
    const sender = new NoteSender();
    sender.delivered(sender.due(body, 0) as StepNote, 0);
    expect(sender.due(body, 10)).toBeUndefined();
    sender.reset();
    expect(sender.due(body, 20)).toMatchObject({ ...body });
  });

  it("keeps counting after a reset, so the viewer takes the new message as newer", () => {
    const sender = new NoteSender();
    sender.delivered(sender.due(body, 0) as StepNote, 0);
    sender.reset();
    expect((sender.due(body, 1) as StepNote).seq).toBe(2);
  });

  it("repeats an unchanged state after NOTE_REFRESH_MS, for a viewer that was away and missed it", () => {
    const sender = new NoteSender();
    sender.delivered(sender.due(body, 0) as StepNote, 0);
    expect(sender.due(body, NOTE_REFRESH_MS - 1)).toBeUndefined();
    expect(sender.due(body, NOTE_REFRESH_MS)).toMatchObject(body);
  });
});

describe("a step message's cause", () => {
  it("is part of what the viewer is told, so a new cause alone makes a message due", () => {
    const sender = new NoteSender();
    sender.delivered(sender.due({ ...body, cause: "probe" }, 0) as StepNote, 0);
    expect(sender.due({ ...body, cause: "probe" }, 1)).toBeUndefined();
    expect(sender.due({ ...body, cause: "budget" }, 2)).toMatchObject({ seq: 2, cause: "budget" });
  });
});

describe("causeOf", () => {
  it("takes a change's cause from what moved it, naming what pressure was down to", () => {
    expect(causeOf("capture")).toBe("capture");
    expect(causeOf("resume")).toBe("resume");
    expect(causeOf("probe")).toBe("probe");
    expect(causeOf("budget")).toBe("budget");
    expect(causeOf("pressure", "computer")).toBe("computer");
    expect(causeOf("pressure", "connection")).toBe("connection");
  });

  it("calls pressure with no recorded cause the connection, as `limited` does", () => {
    expect(causeOf("pressure")).toBe("connection");
  });
});

describe("causeText for an admin", () => {
  it("words each cause in the third person, naming both people", () => {
    const words = CHANGE_CAUSES.map((c) =>
      causeText(c, { side: "admin", streamer: "ana", viewer: "kira" }),
    );
    expect(words).toEqual([
      "Screen size changed",
      "Resumed",
      "Trying higher",
      "Streamer's upload is shared",
      "The connection between ana and kira",
      "Streamer's computer",
    ]);
  });
});

describe("causeText", () => {
  it("words each cause in plain language for the viewer", () => {
    expect(CHANGE_CAUSES.map((c) => causeText(c, { side: "viewer" }))).toEqual([
      "Screen size changed",
      "Resumed",
      "Trying higher",
      "Upload is shared",
      "The connection between you",
      "Streamer's computer",
    ]);
  });

  it("words them from the streamer's side, naming the viewer", () => {
    const mine = (c: (typeof CHANGE_CAUSES)[number]) =>
      causeText(c, { side: "streamer", viewer: "kira" });
    expect(mine("budget")).toBe("Your upload is shared");
    expect(mine("connection")).toBe("The connection between you and kira");
    expect(mine("computer")).toBe("Your computer");
    expect(mine("capture")).toBe("Screen size changed");
    expect(mine("resume")).toBe("Resumed");
    expect(mine("probe")).toBe("Trying higher");
  });
});

describe("applyNote", () => {
  const note = (seq: number, step = "1080p30"): StepNote => ({ ...body, seq, step });

  it("takes the first message", () => {
    expect(applyNote(undefined, note(1))).toEqual(note(1));
  });

  it("takes a newer message", () => {
    expect(applyNote(note(1), note(2, "720p30"))).toEqual(note(2, "720p30"));
  });

  it("ignores a stale or repeated one", () => {
    const current = note(5, "900p30");
    expect(applyNote(current, note(4))).toBe(current);
    expect(applyNote(current, note(5, "720p30"))).toBe(current);
  });
});

describe("decodeNote", () => {
  it("reads a message out of a signalling payload, whatever else the payload carries", () => {
    expect(
      decodeNote({ kind: "quality", session: "s", peerSession: "p", seq: 3, ...body }),
    ).toEqual({ seq: 3, ...body });
  });

  it("carries the cause of a step change when there is one, and refuses a cause it doesn't know", () => {
    expect(decodeNote({ kind: "quality", seq: 1, ...body })).not.toHaveProperty("cause");
    expect(decodeNote({ kind: "quality", seq: 1, ...body, cause: "capture" })).toEqual({
      seq: 1,
      ...body,
      cause: "capture",
    });
    expect(decodeNote({ kind: "quality", seq: 1, ...body, cause: "pressure" })).toBeUndefined();
    expect(decodeNote({ kind: "quality", seq: 1, ...body, cause: "x".repeat(40) })).toBeUndefined();
  });

  it("refuses what is not a message", () => {
    expect(decodeNote({ kind: "quality", seq: 0, ...body })).toBeUndefined();
    expect(decodeNote({ kind: "quality", seq: 1, ...body, reason: "because" })).toBeUndefined();
    expect(decodeNote({ kind: "quality", seq: 1, ...body, step: "" })).toBeUndefined();
    expect(decodeNote({ kind: "quality", seq: 1, ...body, maxBitrate: -1 })).toBeUndefined();
  });
});
