/**
 * The browser's one realtime socket (ADR 4). `getRealtimeClient()` returns the page's single
 * `RealtimeClient`, which connects on first use, says `hello`, reconnects with backoff when
 * the socket drops, and re-joins the room the page is in after every reconnect. It pings every
 * `PING_INTERVAL_MS` (heartbeats keep the socket alive through Cloudflare Tunnel, ADR 9) and
 * treats a server that doesn't answer before the next ping as gone. A join refused as
 * `room_full` is asked again when the lobby reports a free spot, and on a slow poll, until it
 * succeeds (ADR 21: no waitlist); after `taken_over` (the user
 * joined a room elsewhere, ADR 21) the client stops wanting its room. Components
 * don't touch the socket: they subscribe to server messages and call `joinRoom`/`leaveRoom`
 * (see ./room-live.ts for the room page's hook).
 *
 * Browser-only: call it from effects and event handlers, never during render.
 */
import { ROOM_CAPACITY } from "./format";
import {
  type ClientMessage,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  parseServerMessage,
  REALTIME_PATH,
  type ServerMessage,
} from "./realtime";

/**
 * `connecting` the first time, `open` once welcomed, `reconnecting` after losing the socket
 * (until welcomed again), `closed` when stopped.
 */
export type RealtimeStatus = "connecting" | "open" | "reconnecting" | "closed";

type Listener<T> = (value: T) => void;

export interface RealtimeClientOptions {
  /** Delay before reconnect attempt `attempt` (0-based), in ms. */
  backoff?: (attempt: number) => number;
  /** How often to ping once welcomed, in ms. */
  pingIntervalMs?: number;
  /** Delay before asking a full room again for the `attempt`th time (0-based), in ms. */
  fullRoomBackoff?: (attempt: number) => number;
  /** For tests. */
  WebSocket?: typeof WebSocket;
}

/** 0.5s, 1s, 2s, … capped at 15s, with ±20% jitter so clients don't reconnect in lockstep. */
export const defaultBackoff = (attempt: number) =>
  Math.min(15_000, 500 * 2 ** attempt) * (0.8 + Math.random() * 0.4);

/**
 * The fallback poll of a full room: 5s, 7.5s, 11s, … capped at 30s, with ±20% jitter. A public
 * room is asked again as soon as the lobby reports a free spot (ADR 20); the poll is for
 * private rooms, which the lobby never mentions, and for a lobby message missed in a reconnect.
 */
export const defaultFullRoomBackoff = (attempt: number) =>
  Math.min(30_000, 5_000 * 1.5 ** attempt) * (0.8 + Math.random() * 0.4);

export class RealtimeClient {
  readonly #url: string;
  readonly #backoff: (attempt: number) => number;
  readonly #pingIntervalMs: number;
  readonly #WebSocket: typeof WebSocket;
  readonly #messageListeners = new Set<Listener<ServerMessage>>();
  readonly #statusListeners = new Set<Listener<RealtimeStatus>>();
  #ws: WebSocket | null = null;
  #status: RealtimeStatus = "closed";
  #welcomed = false;
  #attempt = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  /** A ping went out and nothing has come back since. */
  #awaitingPong = false;
  #stopped = true;
  /** The room this page wants to be in; re-joined after every reconnect. */
  #roomId: string | null = null;
  readonly #fullRoomBackoff: (attempt: number) => number;
  /** The next ask of a full room (`room_full`), and how many asks have been refused so far. */
  #fullRetry: ReturnType<typeof setTimeout> | null = null;
  #fullAttempt = 0;

  constructor(url: string, options: RealtimeClientOptions = {}) {
    this.#url = url;
    this.#backoff = options.backoff ?? defaultBackoff;
    this.#fullRoomBackoff = options.fullRoomBackoff ?? defaultFullRoomBackoff;
    this.#pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
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
    this.#stopHeartbeat();
    this.#stopFullRetry();
    if (this.#ws) this.#ws.close(1000, "stopped");
    else this.#setStatus("closed");
  }

  /**
   * Drop the socket and connect again now, e.g. once the session changed: the server reads the
   * session cookie at the upgrade only (ADR 20: an anonymous socket becomes authenticated by
   * reconnecting after sign-in). The room the page is in is re-joined as after any reconnect.
   * A no-op while stopped.
   */
  restart(): void {
    if (this.#stopped) return;
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = null;
    const old = this.#ws;
    this.#ws = null;
    this.#welcomed = false;
    this.#attempt = 0;
    old?.close(1000, "restarting");
    this.#open();
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
    this.#stopFullRetry();
    this.#roomId = roomId;
    this.start();
    this.send({ type: "room.join", roomId });
  }

  /** Stop being in `roomId` (a no-op if the page has since moved to another room). */
  leaveRoom(roomId: string): void {
    if (this.#roomId !== roomId) return;
    this.#stopFullRetry();
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
    if (this.#status !== "reconnecting") this.#setStatus("connecting");
    const ws = new this.#WebSocket(this.#url);
    this.#ws = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "hello", v: PROTOCOL_VERSION } satisfies ClientMessage));
    });
    ws.addEventListener("message", (event) => {
      if (this.#ws !== ws) return; // A socket `restart` dropped.
      this.#awaitingPong = false;
      const parsed = parseServerMessage(typeof event.data === "string" ? event.data : null);
      if (!parsed.ok) {
        console.warn("[realtime] ignoring an invalid server message", parsed.error);
        return;
      }
      this.#receive(parsed.message);
    });
    ws.addEventListener("close", () => this.#lost(ws));
  }

  /** `ws` closed or went silent: reconnect (with backoff) unless stopped. */
  #lost(ws: WebSocket): void {
    if (this.#ws !== ws) return;
    this.#ws = null;
    this.#welcomed = false;
    this.#stopHeartbeat();
    if (this.#stopped) {
      this.#setStatus("closed");
      return;
    }
    this.#setStatus("reconnecting");
    this.#retry = setTimeout(() => this.#open(), this.#backoff(this.#attempt++));
  }

  #startHeartbeat(ws: WebSocket): void {
    this.#stopHeartbeat();
    this.#heartbeat = setInterval(() => {
      if (this.#awaitingPong) {
        // Nothing back for a whole interval: the connection is dead even if the browser
        // hasn't noticed yet (a half-open socket after a network change).
        this.#lost(ws);
        ws.close();
        return;
      }
      this.#awaitingPong = this.send({ type: "ping" });
    }, this.#pingIntervalMs);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    this.#awaitingPong = false;
  }

  #receive(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.#welcomed = true;
      this.#attempt = 0;
      this.#setStatus("open");
      if (this.#ws) this.#startHeartbeat(this.#ws);
      if (this.#roomId) {
        this.#stopFullRetry();
        this.send({ type: "room.join", roomId: this.#roomId });
      }
    } else if (message.type === "room.snapshot" && message.roomId === this.#roomId) {
      this.#stopFullRetry();
      this.#fullAttempt = 0;
    } else if (message.type === "error" && message.code === "room_full" && this.#roomId) {
      // No waitlist (ADR 21): keep asking until a spot frees up.
      this.#stopFullRetry();
      const roomId = this.#roomId;
      this.#fullRetry = setTimeout(
        () => {
          this.#fullRetry = null;
          if (this.#roomId === roomId) this.send({ type: "room.join", roomId });
        },
        this.#fullRoomBackoff(this.#fullAttempt++),
      );
    } else if (
      message.type === "error" &&
      (message.code === "taken_over" || message.code === "kicked" || message.code === "banned")
    ) {
      // This user joined a room elsewhere, was kicked from this one (ADR 15) or was banned
      // (ADR 6): never rejoin from here, even after a reconnect.
      this.#stopFullRetry();
      this.#roomId = null;
    } else if (
      message.type === "room.event" &&
      message.event.kind === "ended" &&
      message.roomId === this.#roomId
    ) {
      // An admin ended the room: there's nothing to rejoin.
      this.#roomId = null;
    } else if (
      message.type === "lobby.changed" &&
      message.room?.roomId === this.#roomId &&
      (message.room.change === "ended" || message.room.participantCount < ROOM_CAPACITY)
    ) {
      // The full room we're waiting on has a free spot (or ended, which the join will say).
      this.#retryFullJoin();
    }
    for (const listener of this.#messageListeners) listener(message);
  }

  /** Ask the room refused as full again now, not at the next poll. A no-op unless waiting. */
  #retryFullJoin(): void {
    if (!this.#fullRetry || !this.#roomId) return;
    this.#stopFullRetry();
    this.send({ type: "room.join", roomId: this.#roomId });
  }

  #stopFullRetry(): void {
    if (this.#fullRetry) clearTimeout(this.#fullRetry);
    this.#fullRetry = null;
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
