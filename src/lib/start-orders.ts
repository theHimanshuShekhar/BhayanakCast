/**
 * The order this page sends its share and its camera in (ADR 2, codecs addendum), chosen before
 * the Mesh gets the tracks, so that no sender is made before it is known and a share's screen
 * and its audio go out in one negotiation. An order is kept for as long as its kind is on, so a
 * Mesh made again during a share has it at once and the page asks the browser only once.
 */
import { NORMAL_START, type StartOrder } from "./codecs";
import type { VideoSlot } from "./mesh";

interface Entry {
  /** Set once it is chosen. */
  order?: StartOrder;
  chosen: Promise<StartOrder>;
}

export class StartOrders {
  readonly #choose: (slot: VideoSlot, track: MediaStreamTrack) => Promise<StartOrder>;
  readonly #entries = new Map<VideoSlot, Entry>();

  /** `choose` asks for the order of a kind from its new track (`chooseStartOrder`). */
  constructor(choose: (slot: VideoSlot, track: MediaStreamTrack) => Promise<StartOrder>) {
    this.#choose = choose;
  }

  /** The order of `slot`, if it is on (it has a track) and the order is chosen. */
  chosen(slot: VideoSlot, track: MediaStreamTrack | null): StartOrder | undefined {
    return track ? this.#entries.get(slot)?.order : undefined;
  }

  /**
   * Call `ready` with the order of `slot` once `track` can be sent: at once if the slot is off
   * (`track` null: its order is forgotten and `ready` gets none) or its order is chosen, else
   * when the choice is in (a failed one is the normal order). A different track of a slot that
   * stays on keeps its order. Returns a function that cancels `ready`.
   */
  whenChosen(
    slot: VideoSlot,
    track: MediaStreamTrack | null,
    ready: (order?: StartOrder) => void,
  ): () => void {
    if (!track) {
      this.#entries.delete(slot);
      ready();
      return () => {};
    }
    let entry = this.#entries.get(slot);
    if (!entry) {
      const made: Entry = {
        chosen: new Promise<StartOrder>((resolve) => resolve(this.#choose(slot, track))).catch(
          () => NORMAL_START,
        ),
      };
      made.chosen.then((order) => {
        made.order = order;
      });
      this.#entries.set(slot, made);
      entry = made;
    }
    if (entry.order) {
      ready(entry.order);
      return () => {};
    }
    let live = true;
    entry.chosen.then((order) => {
      if (live) ready(order);
    });
    return () => {
      live = false;
    };
  }
}
