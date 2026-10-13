import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_BATCH_MAX, type ConnectionEvent, pairStateEvent } from "./connection-events";
import {
  CONNECTION_FLUSH_DELAY_MS,
  CONNECTION_QUEUE_MAX,
  CONNECTION_RETRY_DELAY_MS,
  ConnectionReporter,
} from "./connection-reporter";

// How a page gets its connection events to the server (#116): batched, in a retry queue of the
// newest 200, with what is left handed to `sendBeacon` as the page closes.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

const event = (peer = "bo"): ConnectionEvent =>
  pairStateEvent(peer, "connected") as ConnectionEvent;

function reporter(overrides: { sendFails?: () => boolean } = {}) {
  const sent: { roomId: string; events: { peerId?: string; ageMs: number }[] }[] = [];
  const beacons: typeof sent = [];
  const options = {
    send: vi.fn(async (report: (typeof sent)[number]) => {
      if (overrides.sendFails?.()) throw new Error("offline");
      sent.push(report);
    }),
    beacon: vi.fn((report: (typeof sent)[number]) => {
      beacons.push(report);
      return true;
    }),
    log: vi.fn(),
  };
  const r = new ConnectionReporter(options as never);
  r.setRoom("r1");
  return { r, sent, beacons, options };
}

describe("ConnectionReporter", () => {
  it("sends events together after a short wait, each saying how old it is", async () => {
    const { r, sent } = reporter();
    r.add(event("bo"));
    await vi.advanceTimersByTimeAsync(1_000);
    r.add(event("cy"));
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(CONNECTION_FLUSH_DELAY_MS - 1_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.roomId).toBe("r1");
    expect(sent[0]?.events.map((e) => [e.peerId, e.ageMs])).toEqual([
      ["bo", CONNECTION_FLUSH_DELAY_MS],
      ["cy", CONNECTION_FLUSH_DELAY_MS - 1_000],
    ]);
    expect(r.queued).toBe(0);
  });

  it("reports each event against the room it happened in, such as the one being joined", async () => {
    const { r, sent } = reporter();
    r.add(event("bo"));
    r.setRoom("r2");
    r.add(event("cy"));
    await r.flush();
    expect(sent.map((s) => [s.roomId, s.events.length])).toEqual([
      ["r1", 1],
      ["r2", 1],
    ]);
  });

  it("drops events that happen outside any room", async () => {
    const { r, sent } = reporter();
    r.setRoom(null);
    r.add(event());
    await r.flush();
    expect(sent).toEqual([]);
    expect(r.queued).toBe(0);
  });

  it("splits what is queued into reports of at most the batch size", async () => {
    const { r, sent } = reporter();
    for (let i = 0; i < CONNECTION_BATCH_MAX * 2 + 3; i++) r.add(event());
    await r.flush();
    expect(sent.map((s) => s.events.length)).toEqual([
      CONNECTION_BATCH_MAX,
      CONNECTION_BATCH_MAX,
      3,
    ]);
  });

  it("keeps what failed to send, and sends it again with the next batch, oldest first", async () => {
    let down = true;
    const { r, sent } = reporter({ sendFails: () => down });
    r.add(event("bo"));
    await vi.advanceTimersByTimeAsync(CONNECTION_FLUSH_DELAY_MS);
    expect(sent).toEqual([]);
    expect(r.queued).toBe(1);

    down = false;
    r.add(event("cy"));
    await r.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.events.map((e) => e.peerId)).toEqual(["bo", "cy"]);
    // Dated again at the retry: bo's event is as old as the wait it already sat out.
    expect(sent[0]?.events[0]?.ageMs).toBe(CONNECTION_FLUSH_DELAY_MS);
  });

  it("tries again by itself after a while when nothing new comes", async () => {
    let down = true;
    const { r, sent, options } = reporter({ sendFails: () => down });
    r.add(event());
    await vi.advanceTimersByTimeAsync(CONNECTION_FLUSH_DELAY_MS);
    expect(options.send).toHaveBeenCalledTimes(1);
    down = false;
    await vi.advanceTimersByTimeAsync(CONNECTION_RETRY_DELAY_MS);
    expect(sent).toHaveLength(1);
    expect(r.queued).toBe(0);
  });

  it("stops at the first report that fails and keeps it and the rest", async () => {
    let calls = 0;
    const { r, sent } = reporter({ sendFails: () => ++calls === 2 });
    for (let i = 0; i < CONNECTION_BATCH_MAX * 3; i++) r.add(event());
    await r.flush();
    expect(sent).toHaveLength(1);
    expect(r.queued).toBe(CONNECTION_BATCH_MAX * 2);
  });

  it("holds the newest events while sends fail, and no more than the bound", async () => {
    const { r } = reporter({ sendFails: () => true });
    for (let i = 0; i < CONNECTION_QUEUE_MAX + 40; i++) r.add(event(`p${i}`));
    expect(r.queued).toBe(CONNECTION_QUEUE_MAX);
    await r.flush();
    expect(r.queued).toBe(CONNECTION_QUEUE_MAX);
  });

  it("keeps the newest when a failed report goes back behind newer events", async () => {
    let down = true;
    const { r, sent } = reporter({ sendFails: () => down });
    for (let i = 0; i < CONNECTION_QUEUE_MAX; i++) r.add(event(`old${i}`));
    const failing = r.flush();
    r.add(event("new"));
    await failing;
    down = false;
    await r.flush();
    const peers = sent.flatMap((s) => s.events.map((e) => e.peerId));
    expect(peers).toHaveLength(CONNECTION_QUEUE_MAX);
    expect(peers.at(-1)).toBe("new");
    expect(peers[0]).toBe("old1");
  });

  it("hands everything queued to the beacon when the page closes", async () => {
    const { r, sent, beacons } = reporter();
    for (let i = 0; i < CONNECTION_BATCH_MAX + 2; i++) r.add(event());
    r.setRoom("r2");
    r.add(event("cy"));
    r.flushOnClose();
    expect(sent).toEqual([]);
    expect(beacons.map((b) => [b.roomId, b.events.length])).toEqual([
      ["r1", CONNECTION_BATCH_MAX],
      ["r1", 2],
      ["r2", 1],
    ]);
    expect(r.queued).toBe(0);
    // Nothing queued, no beacon.
    r.flushOnClose();
    expect(beacons).toHaveLength(3);
  });

  it("has nothing left for its pending timer once the beacon took the queue", async () => {
    const { r, sent, beacons } = reporter();
    r.add(event());
    r.flushOnClose();
    await vi.advanceTimersByTimeAsync(CONNECTION_FLUSH_DELAY_MS * 2);
    expect(sent).toEqual([]);
    expect(beacons).toHaveLength(1);
  });
});
