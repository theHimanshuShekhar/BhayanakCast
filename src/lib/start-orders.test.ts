import { describe, expect, it, vi } from "vitest";
import { FIREFOX_START, HARDWARE_VP9_START, NORMAL_START, type StartOrder } from "./codecs";
import { StartOrders } from "./start-orders";

const track = (id: string) => ({ id }) as unknown as MediaStreamTrack;
const flush = () => new Promise((resolve) => setTimeout(resolve));

/** A chooser whose answers the test gives, one call at a time. */
function chooser() {
  const answers: { resolve: (order: StartOrder) => void; reject: (error: Error) => void }[] = [];
  const choose = vi.fn(
    () =>
      new Promise<StartOrder>((resolve, reject) => {
        answers.push({ resolve, reject });
      }),
  );
  return { choose, answers };
}

describe("StartOrders", () => {
  it("holds a track until its order is chosen, then hands both over", async () => {
    const { choose, answers } = chooser();
    const orders = new StartOrders(choose);
    const ready = vi.fn();
    const screen = track("s");
    orders.whenChosen("screen", screen, ready);
    await flush();
    expect(ready).not.toHaveBeenCalled();
    expect(orders.chosen("screen", screen)).toBeUndefined();
    answers[0]?.resolve(FIREFOX_START);
    await flush();
    expect(ready).toHaveBeenCalledExactlyOnceWith(FIREFOX_START);
    expect(orders.chosen("screen", screen)).toBe(FIREFOX_START);
  });

  it("answers at once for a slot that is off, and forgets its order", async () => {
    const { choose, answers } = chooser();
    const orders = new StartOrders(choose);
    const cam = track("c");
    orders.whenChosen("cam", cam, () => {});
    answers[0]?.resolve(HARDWARE_VP9_START);
    await flush();
    const ready = vi.fn();
    orders.whenChosen("cam", null, ready);
    expect(ready).toHaveBeenCalledExactlyOnceWith();
    expect(orders.chosen("cam", null)).toBeUndefined();
    // On again: asked again.
    orders.whenChosen("cam", track("c2"), () => {});
    await flush();
    expect(choose).toHaveBeenCalledTimes(2);
  });

  it("asks once for a slot that stays on, whatever its track, and at once the next time", async () => {
    const { choose, answers } = chooser();
    const orders = new StartOrders(choose);
    orders.whenChosen("screen", track("s1"), () => {});
    answers[0]?.resolve(HARDWARE_VP9_START);
    await flush();
    const ready = vi.fn();
    orders.whenChosen("screen", track("s2"), ready);
    // A Mesh made again, or the share's audio arriving: no wait and no new question.
    expect(ready).toHaveBeenCalledExactlyOnceWith(HARDWARE_VP9_START);
    expect(choose).toHaveBeenCalledOnce();
  });

  it("keeps the kinds apart", async () => {
    const { choose, answers } = chooser();
    const orders = new StartOrders(choose);
    const [screen, cam] = [track("s"), track("c")];
    orders.whenChosen("screen", screen, () => {});
    orders.whenChosen("cam", cam, () => {});
    answers[1]?.resolve(HARDWARE_VP9_START);
    answers[0]?.resolve(FIREFOX_START);
    await flush();
    expect(orders.chosen("screen", screen)).toBe(FIREFOX_START);
    expect(orders.chosen("cam", cam)).toBe(HARDWARE_VP9_START);
  });

  it("takes the normal order when choosing fails", async () => {
    const { choose, answers } = chooser();
    const orders = new StartOrders(choose);
    const ready = vi.fn();
    orders.whenChosen("screen", track("s"), ready);
    answers[0]?.reject(new Error("no"));
    await flush();
    expect(ready).toHaveBeenCalledExactlyOnceWith(NORMAL_START);
  });

  it("drops a wait that was cancelled", async () => {
    const { choose, answers } = chooser();
    const orders = new StartOrders(choose);
    const ready = vi.fn();
    const cancel = orders.whenChosen("screen", track("s"), ready);
    cancel();
    answers[0]?.resolve(FIREFOX_START);
    await flush();
    expect(ready).not.toHaveBeenCalled();
    // The order is still kept for the next one.
    const next = vi.fn();
    orders.whenChosen("screen", track("s"), next);
    expect(next).toHaveBeenCalledExactlyOnceWith(FIREFOX_START);
  });
});
