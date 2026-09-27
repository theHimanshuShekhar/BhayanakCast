/**
 * The browser's one realtime socket (ADR 4). `getRealtimeClient()` returns the page's single
 * `RealtimeClient`, which connects on first use, says `hello`, reconnects with backoff when
 * the socket drops, and re-joins the room the page is in after every reconnect. Components
 * don't touch the socket: they subscribe to server messages and call `joinRoom`/`leaveRoom`
 * (see ./room-live.ts for the room page's hook).
 *
 * Browser-only: call it from effects and event handlers, never during render.
 */
import {
  type ClientMessage,
  PROTOCOL_VERSION,
  parseServerMessage,
  REALTIME_PATH,
  type ServerMessage,
} from "./realtime";

export type RealtimeStatus = "connecting" | "open" | "closed";

type Listener<T> = (value: T) => void;

export interface RealtimeClientOptions {
  /** Delay before reconnect attempt `attempt` (0-based), in ms. */
  backoff?: (attempt: number) => number;
  /** For tests. */
  WebSocket?: typeof WebSocket;
}

/** 0.5s, 1s, 2s, … capped at 15s, with ±20% jitter so clients don't reconnect in lockstep. */
export const defaultBackoff = (attempt: number) =>
  Math.min(15_000, 500 * 2 ** attempt) * (0.8 + Math.random() * 0.4);

export class RealtimeClient {
  readonly #url: string;
  readonly #backoff: (attempt: number) => number;
  readonly #WebSocket: typeof WebSocket;
  readonly #messageListeners = new Set<Listener<ServerMessage>>();
  readonly #statusListeners = new Set<Listener<RealtimeStatus>>();
  #ws: WebSocket | null = null;
  #status: RealtimeStatus = "closed";
  #welcomed = false;
  #attempt = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #stopped = true;
  /** The room this page wants to be in; re-joined after every reconnect. */
  #roomId: string | null = null;

  constructor(url: string, options: RealtimeClientOptions = {}) {
    this.#url = url;
    this.#backoff = options.backoff ?? defaultBackoff;
    this.#WebSocket = options.WebSocket ?? WebSocket;
  }

  get status(): RealtimeStatus {
    return this.#status;
  }

  /** Connect (if not already), and keep reconnecting until `stop()`. */
  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#open();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = null;
    this.#ws?.close(1000, "stopped");
  }

  /** Every server message, in order. Returns an unsubscribe function. */
  subscribe(listener: Listener<ServerMessage>): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onStatus(listener: Listener<RealtimeStatus>): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  /** Be in `roomId`: join now if connected, and again after every reconnect. */
  joinRoom(roomId: string): void {
    this.#roomId = roomId;
    this.start();
    this.send({ type: "room.join", roomId });
  }

  /** Stop being in `roomId` (a no-op if the page has since moved to another room). */
  leaveRoom(roomId: string): void {
    if (this.#roomId !== roomId) return;
    this.#roomId = null;
    this.send({ type: "room.leave" });
  }

  /** Send now if the handshake is done; returns false (and drops it) otherwise. */
  send(message: ClientMessage): boolean {
    if (!this.#ws || !this.#welcomed || this.#ws.readyState !== this.#WebSocket.OPEN) return false;
    this.#ws.send(JSON.stringify(message));
    return true;
  }

  #setStatus(status: RealtimeStatus): void {
    if (status === this.#status) return;
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }

  #open(): void {
    this.#retry = null;
    this.#setStatus("connecting");
    const ws = new this.#WebSocket(this.#url);
    this.#ws = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "hello", v: PROTOCOL_VERSION } satisfies ClientMessage));
    });
    ws.addEventListener("message", (event) => {
      const parsed = parseServerMessage(typeof event.data === "string" ? event.data : null);
      if (!parsed.ok) {
        console.warn("[realtime] ignoring an invalid server message", parsed.error);
        return;
      }
      this.#receive(parsed.message);
    });
    ws.addEventListener("close", () => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#welcomed = false;
      this.#setStatus("closed");
      if (this.#stopped) return;
      this.#retry = setTimeout(() => this.#open(), this.#backoff(this.#attempt++));
    });
  }

  #receive(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.#welcomed = true;
      this.#attempt = 0;
      this.#setStatus("open");
      if (this.#roomId) this.send({ type: "room.join", roomId: this.#roomId });
    }
    for (const listener of this.#messageListeners) listener(message);
  }
}

let client: RealtimeClient | null = null;

/** The page's realtime client, created on first call. Browser-only. */
export function getRealtimeClient(): RealtimeClient {
  if (!client) {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    client = new RealtimeClient(`${scheme}://${window.location.host}${REALTIME_PATH}`);
  }
  return client;
}
