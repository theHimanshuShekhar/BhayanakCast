import { describe, expect, it } from "vitest";
import {
  audioBlockedEvent,
  CONNECTION_BATCH_MAX,
  describeError,
  deviceErrorEvent,
  MAX_ERROR_MESSAGE,
  negotiationEvent,
  pairStateEvent,
  pathEvent,
  recoveryEvent,
  reportConnectionEventsInput,
  restartEvent,
} from "./connection-events";
import type { IcePath } from "./ice";

// What a browser tells the room timeline about its connections (#116): each happening in the Mesh
// or on a device mapped to one small event, with an error's name and trimmed message but never a
// device's label or id.

const domError = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("pairStateEvent", () => {
  it("maps the connection states worth a row, and skips the ones that aren't", () => {
    expect(pairStateEvent("bo", "connecting")).toEqual({
      kind: "pair_state",
      peerId: "bo",
      state: "connecting",
    });
    for (const state of ["connected", "disconnected", "failed"] as const) {
      expect(pairStateEvent("bo", state)).toMatchObject({ kind: "pair_state", state });
    }
    expect(pairStateEvent("bo", "new")).toBeUndefined();
    expect(pairStateEvent("bo", "closed")).toBeUndefined();
  });
});

describe("restartEvent and recoveryEvent", () => {
  it("say how a pair was restarted and why, and whether that recovered it", () => {
    expect(restartEvent("bo", "ice_restart", "timeout")).toEqual({
      kind: "pair_restart",
      peerId: "bo",
      how: "ice_restart",
      why: "timeout",
    });
    expect(restartEvent("bo", "start_over", "retry")).toMatchObject({ how: "start_over" });
    expect(recoveryEvent("bo", "ice_restart", false, 20_000)).toEqual({
      kind: "pair_recovery",
      peerId: "bo",
      how: "ice_restart",
      recovered: false,
      afterMs: 20_000,
    });
  });
});

describe("pathEvent", () => {
  const candidate = (type: "host" | "srflx" | "relay", relayProtocol?: "udp" | "tcp" | "tls") =>
    ({ type, protocol: "udp", ...(relayProtocol && { relayProtocol }) }) as const;

  it("says a pair between two non-relay candidates is direct, keeping their types", () => {
    const ice: IcePath = {
      selected: { local: candidate("host"), remote: candidate("srflx") },
      local: [candidate("host")],
      remote: [candidate("srflx")],
    };
    expect(pathEvent("bo", ice, "connect")).toEqual({
      kind: "pair_path",
      peerId: "bo",
      change: "connect",
      path: "direct",
      local: candidate("host"),
      remote: candidate("srflx"),
    });
  });

  it("says a pair with a relay end is relayed, and over which transport", () => {
    const ice: IcePath = {
      selected: { local: candidate("relay", "tls"), remote: candidate("srflx") },
      local: [],
      remote: [],
    };
    expect(pathEvent("bo", ice, "change")).toMatchObject({
      change: "change",
      path: "relay",
      local: { type: "relay", protocol: "udp", relayProtocol: "tls" },
    });
  });

  it("is unknown when the stats named no selected pair", () => {
    expect(pathEvent("bo", { local: [], remote: [] }, "connect")).toEqual({
      kind: "pair_path",
      peerId: "bo",
      change: "connect",
      path: "unknown",
    });
  });
});

describe("negotiationEvent", () => {
  it("keeps the step and the error's name and message", () => {
    expect(
      negotiationEvent("bo", "remote_description", domError("InvalidAccessError", "bad sdp")),
    ).toEqual({
      kind: "negotiation_error",
      peerId: "bo",
      step: "remote_description",
      name: "InvalidAccessError",
      message: "bad sdp",
    });
  });

  it("describes a negotiation that never finished without an error", () => {
    expect(negotiationEvent("bo", "never_finished")).toMatchObject({
      step: "never_finished",
      name: "Timeout",
      message: "",
    });
  });
});

describe("describeError", () => {
  it("trims the message to about 200 characters on one line", () => {
    const { message } = describeError(
      domError("NotReadableError", `${"x".repeat(150)}\n   ${"y".repeat(150)}`),
    );
    expect(message).toHaveLength(MAX_ERROR_MESSAGE);
    expect(message).not.toMatch(/\n/);
    expect(message.startsWith(`${"x".repeat(150)} yyy`)).toBe(true);
  });

  it("copes with things that aren't errors", () => {
    expect(describeError("plain text")).toEqual({ name: "Error", message: "plain text" });
    expect(describeError(undefined)).toEqual({ name: "Error", message: "" });
    expect(describeError({ name: 42, message: 7 })).toEqual({ name: "Error", message: "" });
  });
});

describe("deviceErrorEvent", () => {
  it("names the device kind, the error's name and its message", () => {
    expect(deviceErrorEvent("camera", domError("NotAllowedError", "Permission denied"))).toEqual({
      kind: "device_error",
      device: "camera",
      name: "NotAllowedError",
      message: "Permission denied",
    });
  });

  it("never carries a device label or id, even one the browser put in its message", () => {
    const label = "Logitech HD Webcam C920 (046d:082d)";
    const id = "9f1c0a77d3b84e5aa1d2c3b4e5f60718";
    const error = domError("OverconstrainedError", `Could not start "${label}" (id ${id})`);
    const event = deviceErrorEvent("camera", error, [label, id, ""]);
    expect(JSON.stringify(event)).not.toContain(label);
    expect(JSON.stringify(event)).not.toContain(id);
    expect(event).toMatchObject({ message: 'Could not start "[device]" (id [device])' });
    // And no field of the error itself rides along.
    expect(Object.keys(event).sort()).toEqual(["device", "kind", "message", "name"]);
  });
});

describe("audioBlockedEvent", () => {
  it("names whose audio was blocked, and whether it was their mic or their share", () => {
    expect(audioBlockedEvent("bo", false)).toEqual({
      kind: "audio_blocked",
      peerId: "bo",
      source: "mic",
    });
    expect(audioBlockedEvent("bo", true)).toMatchObject({ source: "share" });
  });
});

describe("reportConnectionEventsInput", () => {
  const event = { ...pairStateEvent("bo", "connected"), ageMs: 1_500 };

  it("takes events of every kind the Mesh and devices make", () => {
    const events = [
      event,
      { ...restartEvent("bo", "ice_restart", "failed"), ageMs: 0 },
      { ...recoveryEvent("bo", "ice_restart", true, 3_000), ageMs: 0 },
      { ...pathEvent("bo", { local: [], remote: [] }, "connect"), ageMs: 0 },
      { ...negotiationEvent("bo", "offer", domError("Error", "x")), ageMs: 0 },
      { ...deviceErrorEvent("mic", domError("NotFoundError", "no mic")), ageMs: 0 },
      { ...audioBlockedEvent("bo", false), ageMs: 0 },
    ];
    const parsed = reportConnectionEventsInput.parse({ roomId: "r1", events });
    expect(parsed.events).toHaveLength(events.length);
  });

  it("keeps the events that are well formed and drops each that isn't", () => {
    const odd = { kind: "pair_state", peerId: "bo", state: "exploded", ageMs: 0 };
    const extra = { ...event, label: "Logitech C920" };
    const parsed = reportConnectionEventsInput.parse({
      roomId: "r1",
      events: [odd, event, extra],
    });
    expect(parsed.events).toEqual([event]);
  });

  it("trims a long message and refuses a report with nothing valid in it", () => {
    const long = { ...deviceErrorEvent("mic", domError("E", "z".repeat(900))), ageMs: 0 };
    const parsed = reportConnectionEventsInput.parse({ roomId: "r1", events: [long] });
    expect(parsed.events[0]).toMatchObject({ message: "z".repeat(MAX_ERROR_MESSAGE) });
    expect(() => reportConnectionEventsInput.parse({ roomId: "r1", events: [{}] })).toThrow();
    expect(() => reportConnectionEventsInput.parse({ roomId: "r1", events: [] })).toThrow();
  });

  it("bounds a report's size, and refuses an event from the future", () => {
    const many = Array.from({ length: CONNECTION_BATCH_MAX + 1 }, () => event);
    expect(() => reportConnectionEventsInput.parse({ roomId: "r1", events: many })).toThrow();
    const negative = { ...event, ageMs: -1 };
    expect(() => reportConnectionEventsInput.parse({ roomId: "r1", events: [negative] })).toThrow();
  });
});
