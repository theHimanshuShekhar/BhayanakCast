import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PING_INTERVAL_MS, PROTOCOL_VERSION, type ServerMessage } from "./realtime";
import { RealtimeClient, type RealtimeStatus } from "./realtime-client";

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
    this.serverSends({ type: "welcome", v: PROTOCOL_VERSION, user: { id: "u", username: "u" } });
  }
}

const latest = (): FakeSocket => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error("No socket opened yet");
  return socket;
};

let client: RealtimeClient;
let statuses: RealtimeStatus[];

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  client = new RealtimeClient("ws://test/ws", {
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    backoff: (attempt) => 1_000 * 2 ** attempt,
  });
  statuses = [];
  client.onStatus((status) => statuses.push(status));
});

afterEach(() => {
  client.stop();
  vi.useRealTimers();
});

describe("RealtimeClient", () => {
  it("pings every interval once welcomed, while the server answers", () => {
    client.start();
    latest().handshake();
    expect(latest().sent).toEqual([{ type: "hello", v: PROTOCOL_VERSION }]);

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
    expect(second.sent).toEqual([
      { type: "hello", v: PROTOCOL_VERSION },
      { type: "room.join", roomId: "r1" },
    ]);
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

  it("is closed, not reconnecting, once stopped", () => {
    client.start();
    latest().close();
    client.stop();
    expect(client.status).toBe("closed");
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
