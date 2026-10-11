/**
 * Why a screen share sits at the step it does (ADR 2 addendum: the quality modal). The streamer's
 * Mesh knows, from its controller's state, and tells each viewer in a small per-pair step message
 * (`StepNote`, at the end); both ends then word it the same five ways, from their own side.
 *
 * Free of browser and server code (relative imports only, with their extension): `realtime.ts`
 * takes the reasons and the message's shape from here, and the server validates the message with
 * them.
 */
import { z } from "zod";
import { type StatsSample, strained } from "./quality.ts";
import type { RungReason } from "./quality-telemetry.ts";

/** The five plain reasons, in the order the modal's legend lists them. */
export const STEP_REASONS = ["best", "shared", "connection", "computer", "starting"] as const;
export type StepReason = (typeof STEP_REASONS)[number];

/** What pressure on a pair is down to, as far as its stats can tell. */
export type PressureCause = "connection" | "computer";

/** What the mapping reads of one pair's screen sender. */
export interface ReasonState {
  /** It sits on the highest step the capture feeds. */
  atTop: boolean;
  /** It stepped up and hasn't yet shown the new step holds. */
  probing: boolean;
  /** `LadderState.limited`: it stepped down under pressure and no higher step has held since. */
  limited: boolean;
  /** What that pressure was down to, recorded when it stepped down. */
  cause?: PressureCause;
  /** What the newest sample shows now, if it shows pressure. */
  pressure?: PressureCause;
  /** What the step above this one targets (absent at the top), bits per second. */
  nextBitrate?: number;
  /** The pair's ceiling: the lower of its fair share of the budget and what its link carries. */
  ceiling?: number;
}

/**
 * The reason for a pair's step, the first that applies:
 *
 * 1. **best**: it is on the top step. Nothing is held back, whatever the stats say this second.
 * 2. **starting**: a probe up is out, or it is ramping up.
 * 3. **connection / computer**: the newest sample shows pressure, or the pair stepped down under
 *    it and no higher step has held since (`limited`). Strain (loss, a long round trip, a bandwidth
 *    limit the estimate backs) is the pair's own link; a CPU limit is the streamer's encoder.
 * 4. **shared**: the next step costs more than the pair's ceiling, so the streamer's upload (the
 *    budget, or this viewer's fair share of it) is what holds it. A pair held down by its own link
 *    is already answered by 3: the ceiling of such a pair is what it targets now.
 * 5. **starting**: nothing holds it but the wait for the next probe.
 */
export function reasonOf(state: ReasonState): StepReason {
  if (state.atTop) return "best";
  if (state.probing) return "starting";
  const held = state.pressure ?? (state.limited ? (state.cause ?? "connection") : undefined);
  if (held) return held;
  if (
    state.nextBitrate !== undefined &&
    state.ceiling !== undefined &&
    state.nextBitrate > state.ceiling
  ) {
    return "shared";
  }
  return "starting";
}

/**
 * What the samples that made a sender step down were down to: the connection if any of them
 * shows strain (a CPU limit shows on every pair at once; strain is this pair's own), else the
 * computer. Undefined if none shows pressure.
 */
export function pressureCause(...samples: StatsSample[]): PressureCause | undefined {
  if (samples.some(strained)) return "connection";
  return samples.some((sample) => sample.limit === "cpu") ? "computer" : undefined;
}

/** A reason in words, for the chip and the line under it. */
export interface ReasonText {
  label: string;
  explanation: string;
}

/**
 * Words for `reason` from one end: the viewer's ("Streamer's upload is shared") or the
 * streamer's own ("Your upload is shared", naming `viewer`). Undefined is a viewer that hasn't
 * heard from the streamer yet: it knows only what it receives.
 */
export function reasonText(
  reason: StepReason | undefined,
  from: { side: "viewer" } | { side: "streamer"; viewer: string },
): ReasonText {
  const mine = from.side === "streamer";
  switch (reason) {
    case "best":
      return {
        label: "Best quality",
        explanation: mine
          ? "This viewer gets the top step your screen allows."
          : "At the top step this screen allows.",
      };
    case "shared":
      return {
        label: mine ? "Your upload is shared" : "Streamer's upload is shared",
        explanation: mine
          ? "Held by your upload budget, or by this viewer's fair share of it. More viewers means a thinner slice each."
          : "Held by the streamer's upload budget, or by your fair share of it. More viewers means a thinner slice each.",
      };
    case "connection":
      return {
        label: mine
          ? `The connection between you and ${from.viewer}`
          : "The connection between you",
        explanation:
          "This pair showed loss, a long round trip or a bandwidth limit. It may be either end or the route between them.",
      };
    case "computer":
      return {
        label: mine ? "Your computer" : "Streamer's computer",
        explanation: mine
          ? "Your encoder is CPU-limited."
          : "The streamer's encoder is CPU-limited.",
      };
    case "starting":
      return {
        label: "Getting started / trying higher",
        explanation: "This pair is ramping up, or briefly probing a higher step.",
      };
    default:
      return {
        label: "Streamer's side unknown",
        explanation:
          "Nothing yet from the streamer's computer about why. This is what you receive.",
      };
  }
}

// ---------------------------------------------------------------------------------------------
// What made a step change

/**
 * What moved a sender to its step, for the timeline: the controller's `RungReason` with
 * `pressure` named for what it was down to (`pressureCause`). The telemetry's own reasons
 * (src/lib/quality-telemetry.ts) stay as they are.
 */
export const CHANGE_CAUSES = [
  "capture",
  "resume",
  "probe",
  "budget",
  "connection",
  "computer",
] as const;
export type ChangeCause = (typeof CHANGE_CAUSES)[number];

/**
 * The cause of a change the controller made for `reason`. `pressure` takes the cause recorded
 * from the samples that moved it, and is the connection if none was (as `limited` is).
 */
export function causeOf(reason: RungReason, pressure?: PressureCause): ChangeCause {
  return reason === "pressure" ? (pressure ?? "connection") : reason;
}

/** A cause in words, for one step change on the timeline. */
export function causeText(
  cause: ChangeCause,
  from: { side: "viewer" } | { side: "streamer"; viewer: string },
): string {
  const mine = from.side === "streamer";
  switch (cause) {
    case "capture":
      return "Screen size changed";
    case "resume":
      return "Resumed";
    case "probe":
      return "Trying higher";
    case "budget":
      return mine ? "Your upload is shared" : "Upload is shared";
    case "connection":
      return mine ? `The connection between you and ${from.viewer}` : "The connection between you";
    case "computer":
      return mine ? "Your computer" : "Streamer's computer";
  }
}

// ---------------------------------------------------------------------------------------------
// The step message

/**
 * The part of a `quality` signalling step that is the streamer's word about one pair: the step
 * its screen sender is on (the label `screenSteps` gives it), that step's `maxBitrate`, and why.
 * `seq` counts the streamer's messages on this connection, so a viewer can tell a late one from
 * a newer one. The bounds are the server's validation (`signalPayload`): a label is at most
 * `2968×1242@60` long in practice, a bitrate far under a gigabit.
 */
export const stepNoteFields = {
  seq: z.number().int().min(1),
  step: z.string().min(1).max(32),
  maxBitrate: z.number().int().min(0).max(1_000_000_000),
  reason: z.enum(STEP_REASONS),
  /** What made the sender move to this step (the latest change); absent before it ever moved. */
  cause: z.enum(CHANGE_CAUSES).optional(),
};
const stepNote = z.object(stepNoteFields);
export type StepNote = z.infer<typeof stepNote>;

// The step message goes over the room socket's `signal` relay, as one more kind of step next to
// `visibility`, and not over an `RTCDataChannel`. Why: ADR 2, "Addendum: the quality modal".

/** An unchanged state is told again this often: the viewer may have been away (ADR 4 grace). */
export const NOTE_REFRESH_MS = 30_000;

/** What a note says apart from its number. */
export type StepBody = Omit<StepNote, "seq">;

const same = (a: StepBody, b: StepBody) =>
  a.step === b.step &&
  a.maxBitrate === b.maxBitrate &&
  a.reason === b.reason &&
  a.cause === b.cause;

/**
 * The streamer's side of one pair: decides when the viewer is told. A note is due when the state
 * differs from what was last delivered, again whenever the pair (re)connects (`reset`), and every
 * `NOTE_REFRESH_MS` for a viewer that may have missed it. The caller sends what `due` returns
 * and says so with `delivered`, if the send went out (it doesn't while the page's own socket is
 * reconnecting): until then the same note, under the same number, is due again.
 */
export class NoteSender {
  #seq = 0;
  #told: { body: StepBody; at: number } | undefined;

  due(body: StepBody, now: number): StepNote | undefined {
    const told = this.#told;
    if (told && same(told.body, body) && now - told.at < NOTE_REFRESH_MS) return undefined;
    return { seq: this.#seq + 1, ...body };
  }

  delivered(note: StepNote, now: number): void {
    this.#seq = Math.max(this.#seq, note.seq);
    const { seq: _, ...body } = note;
    this.#told = { body, at: now };
  }

  /** The viewer's side is new (the pair connected, or a share began): tell it all again. */
  reset(): void {
    this.#told = undefined;
  }
}

/**
 * The viewer's side: `current` once `note` has been heard. A note that isn't newer than the one
 * held (a late or repeated one) changes nothing: the same object comes back. Nothing held yet is
 * the streamer's side unknown.
 */
export function applyNote(current: StepNote | undefined, note: StepNote): StepNote {
  return current && note.seq <= current.seq ? current : note;
}

/** The note in a signalling payload, or undefined if it isn't a valid one. */
export function decodeNote(payload: unknown): StepNote | undefined {
  const parsed = stepNote.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}
