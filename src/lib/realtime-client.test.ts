import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PING_INTERVAL_MS, PROTOCOL_VERSION, type ServerMessage } from "./realtime";
import { getVisitorId, RealtimeClient, type RealtimeStatus } from "./realtime-client";

/** Just enough of the browser WebSocket for the client, driven by the test. */
class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {
    super();
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  // Test controls
  serverOpens() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  serverSends(message: ServerMessage) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  /** Open, then welcome after the client's hello. */
  handshake() {
    this.serverOpens();
    this.serverSends({
      type: "welcome",
      v: PROTOCOL_VERSION,
      user: { id: "u", username: "u", image: null },
    });
  }
}

const latest = (): FakeSocket => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error("No socket opened yet");
  return socket;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The hello a client sends, whatever its visitor id. */
const HELLO = { type: "hello", v: PROTOCOL_VERSION, visitorId: expect.stringMatching(UUID) };

/** A localStorage that holds what it's given. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
  } as Storage;
}

let client: RealtimeClient;
let statuses: RealtimeStatus[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", fakeStorage());
  FakeSocket.instances = [];
  client = new RealtimeClient("ws://test/ws", {
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    backoff: (attempt) => 1_000 * 2 ** attempt,
    fullRoomBackoff: (attempt) => 2_000 + 1_000 * attempt,
  });
  statuses = [];
  client.onStatus((status) => statuses.push(status));
});

afterEach(() => {
  client.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RealtimeClient", () => {
  it("pings every interval once welcomed, while the server answers", () => {
    client.start();
    latest().handshake();
    expect(latest().sent).toEqual([HELLO]);

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(PING_INTERVAL_MS);
      latest().serverSends({ type: "pong" });
    }
    expect(latest().sent.filter((m) => (m as { type: string }).type === "ping")).toHaveLength(3);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.status).toBe("open");
  });

  it("gives up on a silent server and reconnects, rejoining its room", () => {
    client.joinRoom("r1");
    const first = latest();
    first.handshake();
    expect(first.sent).toContainEqual({ type: "room.join", roomId: "r1" });

    vi.advanceTimersByTime(PING_INTERVAL_MS); // ping, never answered
    vi.advanceTimersByTime(PING_INTERVAL_MS); // still nothing: the socket is dead
    expect(first.readyState).toBe(FakeSocket.CLOSED);
    expect(client.status).toBe("reconnecting");

    vi.advanceTimersByTime(1_000);
    const second = latest();
    expect(second).not.toBe(first);
    second.handshake();
    expect(second.sent).toEqual([HELLO, { type: "room.join", roomId: "r1" }]);
    expect(statuses).toEqual(["connecting", "open", "reconnecting", "open"]);
  });

  it("backs off exponentially while the server is unreachable, and resets once welcomed", () => {
    client.start();
    latest().close();
    expect(client.status).toBe("reconnecting");

    const opensAfter = (ms: number) => {
      const before = FakeSocket.instances.length;
      vi.advanceTimersByTime(ms - 1);
      expect(FakeSocket.instances).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.instances).toHaveLength(before + 1);
    };
    opensAfter(1_000);
    latest().close();
    opensAfter(2_000);
    latest().close();
    opensAfter(4_000);
    // Status stays "reconnecting" through the retries until a welcome.
    expect(statuses).toEqual(["connecting", "reconnecting"]);

    latest().handshake();
    expect(client.status).toBe("open");
    latest().close();
    opensAfter(1_000);
  });

  it("keeps asking a full room with backoff until it gets in, or when the lobby says a spot freed", () => {
    const joins = () =>
      latest().sent.filter((m) => (m as { type: string }).type === "room.join").length;
    const full = () =>
      latest().serverSends({
        type: "error",
        code: "room_full",
        message: "This room is full (10/10)",
        re: "room.join",
      });
    client.joinRoom("r1");
    latest().handshake();
    expect(joins()).toBe(1);

    full();
    vi.advanceTimersByTime(1_999);
    expect(joins()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(joins()).toBe(2);

    full();
    vi.advanceTimersByTime(3_000);
    expect(joins()).toBe(3);

    // The lobby says a spot freed in this room: ask again at once. Other rooms, or the room
    // still full, don't count.
    full();
    const count = (roomId: string, participantCount: number) =>
      latest().serverSends({
        type: "lobby.changed",
        online: 12,
        room: { roomId, change: "count", participantCount },
      });
    count("r2", 3);
    count("r1", 10);
    expect(joins()).toBe(3);
    count("r1", 9);
    expect(joins()).toBe(4);
    count("r1", 8); // not waiting on a refusal: nothing
    expect(joins()).toBe(4);

    latest().serverSends({
      type: "room.snapshot",
      roomId: "r1",
      name: "room",
      hostUserId: null,
      participants: [],
      chat: [],
      feed: [],
    });
    vi.advanceTimersByTime(15_000); // (within one ping interval: the socket stays up)
    expect(joins()).toBe(4);
  });

  it.each(["taken_over", "banned"] as const)(
    "stops wanting its room once told %s, even across reconnects",
    (code) => {
      client.joinRoom("r1");
      const first = latest();
      first.handshake();
      first.serverSends({ type: "error", code, message: "elsewhere" });
      first.close();
      vi.advanceTimersByTime(1_000);
      latest().handshake();
      expect(latest().sent).toEqual([HELLO]);
    },
  );

  it("stops wanting its room once an admin ended it, even across reconnects", () => {
    client.joinRoom("r1");
    const first = latest();
    first.handshake();
    first.serverSends({
      type: "room.event",
      roomId: "r1",
      at: "2026-09-01T12:00:00.000Z",
      event: { kind: "ended", reason: "admin" },
    });
    first.close();
    vi.advanceTimersByTime(1_000);
    latest().handshake();
    expect(latest().sent).toEqual([HELLO]);
  });

  it("is closed, not reconnecting, once stopped", () => {
    client.start();
    latest().close();
    client.stop();
    expect(client.status).toBe("closed");
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe("the visitor id", () => {
  const sentId = () => (latest().sent[0] as { visitorId?: string }).visitorId;

  it("is made once, kept in localStorage and sent in every hello", () => {
    client.start();
    latest().serverOpens();
    const id = sentId();
    expect(id).toBeDefined();
    expect(localStorage.getItem("bc_visitor_id")).toBe(id);

    latest().close();
    vi.advanceTimersByTime(1_000);
    latest().serverOpens();
    expect(sentId()).toBe(id);
  });

  it("is the one another tab of the browser stored", () => {
    const stored = "2f1d5c3e-8a47-4b8e-9d0a-6c1f0e7b3a52";
    vi.stubGlobal("localStorage", fakeStorage({ bc_visitor_id: stored }));
    client.start();
    latest().serverOpens();
    expect(sentId()).toBe(stored);
  });

  it("replaces a stored value that isn't a UUID", () => {
    const storage = fakeStorage({ bc_visitor_id: "not-an-id" });
    vi.stubGlobal("localStorage", storage);
    const id = getVisitorId();
    expect(id).not.toBe("not-an-id");
    expect(storage.getItem("bc_visitor_id")).toBe(id);
  });

  it("falls back to one id for the page when localStorage throws", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    const id = getVisitorId();
    expect(id).toMatch(UUID);
    expect(getVisitorId()).toBe(id);
  });
});
