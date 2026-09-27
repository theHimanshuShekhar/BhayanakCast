/**
 * The room hub: all live realtime state (ADRs 4, 12, 14, 15, 20, 21) behind three calls.
 *
 *   const connection = hub.connect(transport, caller); // a socket opened
 *   await hub.handle(connection, frame);                // it sent a frame (raw JSON)
 *   await hub.disconnect(connection);                   // it closed
 *
 * The WebSocket layer (./realtime.ts) is a thin adapter over these; tests drive the same
 * calls through real sockets (./realtime-harness.ts). The hub never touches `Date`, timers or
 * the database directly: it takes a `Clock` (./clock.ts) and a `RoomStore` persistence port
 * (./room-store.ts), so tests use a fake clock and PGlite.
 *
 * Every operation (message, disconnect, timer) runs on one serial queue, so state changes and
 * their DB writes never interleave; `idle()` resolves once the queue is drained.
 *
 * Adding a client message: add it to the protocol (src/lib/realtime.ts) and a handler to
 * `#handlers` below (the type checker insists). Refusals go through `#refuse(conn, code, …)`.
 */
import {
  CHAT_HISTORY_SIZE,
  CHAT_MAX_LENGTH,
  CHAT_RATE_LIMIT,
  type ChatEntry,
  type ClientMessage,
  type ClientMessageOf,
  type ClientMessageType,
  type ErrorCode,
  IDLE_CLOSE_CODE,
  IDLE_TIMEOUT_MS,
  PROTOCOL_VERSION,
  parseClientMessage,
  type RoomEvent,
  type RoomParticipant,
  type RoomRole,
  type ServerMessage,
} from "../lib/realtime.ts";
import type { Caller, SignedInCaller } from "./caller.ts";
import type { Clock, Timer } from "./clock.ts";
import type { PresenceSeen, RoomStore, StoredRoom } from "./room-store.ts";

/**
 * How long a participant whose socket closed stays in the room before it counts as leaving
 * (ADR 12). Rejoining within it continues the same presence interval, with no left/joined.
 */
export const RECONNECT_GRACE_MS = 30_000;
/** How often open presence intervals get their `last_seen_at` checkpoint (ADR 12). */
export const CHECKPOINT_INTERVAL_MS = 60_000;
/**
 * On boot, an open presence interval last seen longer ago than this is from a server that was
 * down too long to resume: it closes at its last-seen time straight away. Fresher ones wait
 * one reconnect grace for their user to come back (restart recovery, ADR 4 addendum).
 */
export const RESTORE_STALE_AFTER_MS = CHECKPOINT_INTERVAL_MS + RECONNECT_GRACE_MS;

/** How the hub talks to one socket. */
export interface Transport {
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** One open socket, as the hub hands it back from `connect`. Opaque apart from these. */
export interface Connection {
  readonly id: number;
  readonly caller: Caller;
}

export interface RoomHubDeps {
  clock: Clock;
  store: RoomStore;
  /** Where unexpected failures are reported. Defaults to `console.error`. */
  log?: (message: string, error: unknown) => void;
}

class HubConnection implements Connection {
  readonly id: number;
  readonly caller: Caller;
  readonly transport: Transport;
  /** Sent a valid `hello`. */
  greeted = false;
  closed = false;
  /** The room this connection is in, if any. */
  roomId: string | null = null;
  /** Closes the socket if it stays silent for `IDLE_TIMEOUT_MS` (heartbeats, ADR 9). */
  idle: Timer | null = null;

  constructor(id: number, caller: Caller, transport: Transport) {
    this.id = id;
    this.caller = caller;
    this.transport = transport;
  }
}

interface LiveParticipant {
  userId: string;
  username: string;
  joinedAt: Date;
  /** Their socket; a closed one while they're in the reconnect grace. */
  connection: HubConnection;
  /** Set while their socket is gone: since when, and the timer that ends their presence. */
  grace?: { since: Date; timer: Timer };
}

interface LiveRoom {
  id: string;
  hostUserId: string | null;
  roles: StoredRoom["roles"];
  /** By user id, in order of arrival. */
  participants: Map<string, LiveParticipant>;
  /** The last `CHAT_HISTORY_SIZE` chat messages, oldest first; memory only, gone with the room. */
  chat: ChatEntry[];
}

type Handler<T extends ClientMessageType> = (
  conn: HubConnection,
  message: ClientMessageOf<T>,
) => Promise<void> | void;

export class RoomHub {
  readonly #clock: Clock;
  readonly #store: RoomStore;
  readonly #log: (message: string, error: unknown) => void;
  readonly #connections = new Set<HubConnection>();
  readonly #rooms = new Map<string, LiveRoom>();
  #nextId = 1;
  #nextChatId = 1;
  /** Per user id, when (epoch ms) their recent accepted chat messages were sent. */
  readonly #chatSends = new Map<string, number[]>();
  #queue: Promise<void> = Promise.resolve();

  constructor(deps: RoomHubDeps) {
    this.#clock = deps.clock;
    this.#store = deps.store;
    this.#log = deps.log ?? ((message, error) => console.error(`[realtime] ${message}`, error));
    // Restart recovery: the first thing on the queue, so joins wait for it.
    void this.#enqueue(() => this.#restore());
    this.#scheduleCheckpoint();
  }

  /** Register a newly opened socket for `caller` (a visitor for an anonymous socket). */
  connect(transport: Transport, caller: Caller): Connection {
    const conn = new HubConnection(this.#nextId++, caller, transport);
    this.#connections.add(conn);
    this.#armIdle(conn);
    return conn;
  }

  /**
   * Handle one frame from `connection`: a JSON string (or decoded value). Invalid or refused
   * messages are answered with `error`; nothing a client sends makes this reject.
   */
  handle(connection: Connection, data: unknown): Promise<void> {
    const conn = this.#own(connection);
    // Any frame counts as a sign of life.
    if (!conn.closed) this.#armIdle(conn);
    return this.#enqueue(async () => {
      if (conn.closed) return;
      const parsed = parseClientMessage(data);
      if (!parsed.ok) return this.#refuse(conn, "bad_request", parsed.error, parsed.type);
      const message = parsed.message;
      if (message.type !== "hello" && !conn.greeted) {
        return this.#refuse(conn, "bad_request", "Send hello first", message.type);
      }
      try {
        await this.#dispatch(conn, message);
      } catch (error) {
        this.#log(`${message.type} failed`, error);
        this.#refuse(conn, "internal", "Something went wrong, try again", message.type);
      }
    });
  }

  /**
   * The socket closed. Its user stays in their room for the reconnect grace
   * (`RECONNECT_GRACE_MS`); rejoining within it resumes their presence.
   */
  disconnect(connection: Connection): Promise<void> {
    const conn = this.#own(connection);
    return this.#enqueue(() => this.#drop(conn));
  }

  /** Resolves once every queued operation (messages, disconnects, timers) has finished. */
  async idle(): Promise<void> {
    for (;;) {
      const queue = this.#queue;
      await queue;
      if (queue === this.#queue) return;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Message handlers

  readonly #handlers: { [T in ClientMessageType]: Handler<T> } = {
    hello: (conn, message) => {
      if (message.v !== PROTOCOL_VERSION) {
        return this.#refuse(
          conn,
          "unsupported_version",
          `This server speaks protocol ${PROTOCOL_VERSION}; reload the page`,
          message.type,
        );
      }
      conn.greeted = true;
      const user = conn.caller.user;
      this.#send(conn, {
        type: "welcome",
        v: PROTOCOL_VERSION,
        user: user ? { id: user.id, username: user.username } : null,
      });
    },

    "room.join": async (conn, message) => {
      const caller = conn.caller;
      if (!isSignedIn(caller)) {
        return this.#refuse(conn, "forbidden", "Sign in to join rooms", message.type);
      }
      const { roomId } = message;
      const user = caller.user;
      const current = this.#rooms.get(roomId)?.participants.get(user.id);
      if (conn.roomId === roomId && current?.connection === conn) {
        // Already here: a repeated join just resends the snapshot.
        return this.#sendSnapshot(conn, roomId);
      }
      await this.#leaveRoom(conn);

      const stored = await this.#store.findRoomFor(caller, roomId);
      if (!stored) return this.#refuse(conn, "not_found", "That room isn't live", message.type);
      const room = this.#rooms.get(roomId) ?? this.#addRoom(stored);
      await this.#endGraceElsewhere(user.id, roomId);

      const existing = room.participants.get(user.id);
      if (existing) {
        // The same user from another socket (a reload racing its old socket's close, or a
        // return within the reconnect grace): the new socket takes over the presence and its
        // open interval, with no leave/join churn. Takeover notices are #26.
        this.#cancelGrace(existing);
        existing.connection.roomId = null;
        existing.connection = conn;
        conn.roomId = roomId;
        return this.#sendSnapshot(conn, roomId);
      }

      const joinedAt = this.#clock.now();
      await this.#store.openPresence(roomId, user.id, joinedAt);
      const participant: LiveParticipant = {
        userId: user.id,
        username: user.username,
        joinedAt,
        connection: conn,
      };
      room.participants.set(user.id, participant);
      conn.roomId = roomId;
      this.#sendSnapshot(conn, roomId);
      this.#broadcast(
        room,
        { kind: "joined", participant: this.#view(room, participant) },
        joinedAt,
        conn,
      );
    },

    "room.leave": async (conn) => {
      await this.#leaveRoom(conn);
    },

    ping: (conn) => {
      this.#send(conn, { type: "pong" });
    },

    "chat.send": (conn, message) => this.#chat(conn, message),
  };

  #dispatch(conn: HubConnection, message: ClientMessage): Promise<void> | void {
    const handler = this.#handlers[message.type] as Handler<typeof message.type>;
    return handler(conn, message);
  }

  // -------------------------------------------------------------------------------------------
  // Rooms

  #addRoom(stored: StoredRoom): LiveRoom {
    const room: LiveRoom = {
      id: stored.id,
      hostUserId: stored.hostUserId,
      roles: stored.roles,
      participants: new Map(),
      chat: [],
    };
    this.#rooms.set(room.id, room);
    return room;
  }

  /** Take `conn` out of its room, closing the presence interval and telling everyone left. */
  async #leaveRoom(conn: HubConnection): Promise<void> {
    const roomId = conn.roomId;
    if (!roomId) return;
    conn.roomId = null;
    const room = this.#rooms.get(roomId);
    const userId = conn.caller.user?.id;
    const participant = userId ? room?.participants.get(userId) : undefined;
    if (!room || !participant || participant.connection !== conn) return;
    await this.#removeParticipant(room, participant, this.#clock.now());
  }

  /**
   * `participant` left `room` at `at` (now for an explicit leave; when their socket closed for
   * an expired reconnect grace): tell everyone and close the presence interval at `at`.
   */
  async #removeParticipant(room: LiveRoom, participant: LiveParticipant, at: Date): Promise<void> {
    this.#cancelGrace(participant);
    room.participants.delete(participant.userId);
    // Lifecycle (#31) keeps empty rooms around for 5 minutes; for now they're dropped.
    if (room.participants.size === 0) this.#rooms.delete(room.id);
    this.#broadcast(room, { kind: "left", userId: participant.userId }, at);
    await this.#store.closePresence(room.id, participant.userId, at);
  }

  // -------------------------------------------------------------------------------------------
  // Resilience (#25): reconnect grace, heartbeats, checkpoints and restart recovery

  /** `conn`'s socket is gone: forget it, and start its user's reconnect grace in their room. */
  async #drop(conn: HubConnection): Promise<void> {
    if (conn.closed) return;
    conn.closed = true;
    conn.idle?.cancel();
    conn.idle = null;
    this.#connections.delete(conn);
    const room = conn.roomId ? this.#rooms.get(conn.roomId) : undefined;
    const userId = conn.caller.user?.id;
    const participant = room && userId ? room.participants.get(userId) : undefined;
    if (!room || !participant || participant.connection !== conn) return;
    const since = this.#clock.now();
    this.#startGrace(room, participant, since);
    // If the server dies during the grace, the interval closes here, not at an older checkpoint.
    await this.#store.checkpointPresence([
      { roomId: room.id, userId: participant.userId, at: since },
    ]);
  }

  /** Keep `participant` in `room` for the reconnect grace, as gone since `since`. */
  #startGrace(room: LiveRoom, participant: LiveParticipant, since: Date): void {
    this.#cancelGrace(participant);
    const timer = this.#setTimer(RECONNECT_GRACE_MS, async () => {
      if (participant.grace?.timer !== timer) return;
      if (this.#rooms.get(room.id)?.participants.get(participant.userId) !== participant) return;
      await this.#removeParticipant(room, participant, since);
    });
    participant.grace = { since, timer };
  }

  #cancelGrace(participant: LiveParticipant): void {
    participant.grace?.timer.cancel();
    participant.grace = undefined;
  }

  /** `userId` is joining `roomId`: a presence of theirs left in grace elsewhere ends now. */
  async #endGraceElsewhere(userId: string, roomId: string): Promise<void> {
    for (const room of this.#rooms.values()) {
      if (room.id === roomId) continue;
      const participant = room.participants.get(userId);
      if (participant?.grace)
        await this.#removeParticipant(room, participant, participant.grace.since);
    }
  }

  /** (Re)start `conn`'s idle timer: silent for `IDLE_TIMEOUT_MS`, it's closed and dropped. */
  #armIdle(conn: HubConnection): void {
    conn.idle?.cancel();
    const timer = this.#setTimer(IDLE_TIMEOUT_MS, async () => {
      if (conn.idle !== timer || conn.closed) return;
      try {
        conn.transport.close(IDLE_CLOSE_CODE, "idle timeout");
      } catch (error) {
        this.#log("closing an idle socket failed", error);
      }
      await this.#drop(conn);
    });
    conn.idle = timer;
  }

  #scheduleCheckpoint(): void {
    // Rescheduled when it fires, not when the queue gets to it, so it doesn't drift.
    this.#clock.setTimer(CHECKPOINT_INTERVAL_MS, () => {
      const at = this.#clock.now();
      this.#scheduleCheckpoint();
      void this.#enqueue(() => this.#checkpoint(at));
    });
  }

  /** Write `last_seen_at = at` for everyone present with a socket (ADR 12). */
  async #checkpoint(at: Date): Promise<void> {
    const seen: PresenceSeen[] = [];
    for (const room of this.#rooms.values()) {
      for (const participant of room.participants.values()) {
        // Someone in grace was last seen when their socket closed, which #drop wrote.
        if (!participant.grace) seen.push({ roomId: room.id, userId: participant.userId, at });
      }
    }
    await this.#store.checkpointPresence(seen);
  }

  /**
   * Restart recovery (ADR 4 addendum): reload live rooms with their roles, and treat everyone
   * whose presence interval the last server left open as having just disconnected. Those who
   * come back within the reconnect grace continue their interval; the rest close at their
   * last-seen checkpoint (ADR 12). Intervals too old to resume close at once.
   */
  async #restore(): Promise<void> {
    const now = this.#clock.now();
    for (const stored of await this.#store.loadLiveRooms()) {
      if (this.#rooms.has(stored.id)) continue;
      const room = this.#addRoom(stored);
      for (const presence of stored.presences) {
        if (now.getTime() - presence.lastSeenAt.getTime() > RESTORE_STALE_AFTER_MS) {
          await this.#store.closePresence(room.id, presence.userId, presence.lastSeenAt);
          continue;
        }
        const participant: LiveParticipant = {
          userId: presence.userId,
          username: presence.username,
          joinedAt: presence.startedAt,
          connection: this.#goneConnection(presence.userId, presence.username),
        };
        room.participants.set(participant.userId, participant);
        this.#startGrace(room, participant, presence.lastSeenAt);
      }
      // Room ending (#31): a room restored with nobody to wait for (or whose restored people
      // never return, via #removeParticipant) must end 5 minutes after boot at its last-seen
      // time (ADR 14): `rooms.lastEmptyAt`, else the latest `presences[].lastSeenAt`.
      if (room.participants.size === 0) this.#rooms.delete(room.id);
    }
  }

  /** A stand-in, already-closed socket for someone restored from the DB with none yet. */
  #goneConnection(userId: string, username: string): HubConnection {
    const conn = new HubConnection(
      this.#nextId++,
      { user: { id: userId, username }, role: "user" },
      { send: () => {}, close: () => {} },
    );
    conn.closed = true;
    return conn;
  }

  #roleOf(room: LiveRoom, userId: string): RoomRole {
    if (room.hostUserId === userId) return "host";
    return room.roles.get(userId) ?? "member";
  }

  #view(room: LiveRoom, participant: LiveParticipant): RoomParticipant {
    return {
      userId: participant.userId,
      username: participant.username,
      role: this.#roleOf(room, participant.userId),
      joinedAt: participant.joinedAt.toISOString(),
    };
  }

  #sendSnapshot(conn: HubConnection, roomId: string): void {
    const room = this.#rooms.get(roomId);
    if (!room) return;
    this.#send(conn, {
      type: "room.snapshot",
      roomId,
      hostUserId: room.hostUserId,
      participants: [...room.participants.values()].map((p) => this.#view(room, p)),
      chat: [...room.chat],
    });
  }

  /** Send `event` to everyone in `room` except `except`. */
  #broadcast(room: LiveRoom, event: RoomEvent, at: Date, except?: HubConnection): void {
    const message: ServerMessage = {
      type: "room.event",
      roomId: room.id,
      at: at.toISOString(),
      event,
    };
    for (const participant of room.participants.values()) {
      if (participant.connection !== except) this.#send(participant.connection, message);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Chat (ADR 4 addendum: the last 50 per room, in memory only, never persisted)

  #chat(conn: HubConnection, message: ClientMessageOf<"chat.send">) {
    const userId = conn.caller.user?.id;
    const room = conn.roomId ? this.#rooms.get(conn.roomId) : undefined;
    const participant = userId ? room?.participants.get(userId) : undefined;
    if (!room || !participant || participant.connection !== conn) {
      return this.#refuse(conn, "forbidden", "Join the room to chat", message.type);
    }
    const text = message.text.trim();
    if (!text) return this.#refuse(conn, "bad_request", "Say something first", message.type);
    if (text.length > CHAT_MAX_LENGTH) {
      return this.#refuse(
        conn,
        "bad_request",
        `Chat messages are at most ${CHAT_MAX_LENGTH} characters`,
        message.type,
      );
    }

    const at = this.#clock.now();
    const since = at.getTime() - CHAT_RATE_LIMIT.windowMs;
    const recent = (this.#chatSends.get(participant.userId) ?? []).filter((t) => t > since);
    if (recent.length >= CHAT_RATE_LIMIT.messages) {
      this.#chatSends.set(participant.userId, recent);
      return this.#refuse(
        conn,
        "rate_limited",
        "You're sending messages too fast; wait a moment",
        message.type,
      );
    }
    recent.push(at.getTime());
    this.#chatSends.set(participant.userId, recent);

    const entry: ChatEntry = {
      id: `c${this.#nextChatId++}`,
      userId: participant.userId,
      username: participant.username,
      role: this.#roleOf(room, participant.userId),
      text,
      at: at.toISOString(),
    };
    room.chat.push(entry);
    if (room.chat.length > CHAT_HISTORY_SIZE)
      room.chat.splice(0, room.chat.length - CHAT_HISTORY_SIZE);
    const out: ServerMessage = { type: "chat.message", roomId: room.id, message: entry };
    for (const p of room.participants.values()) this.#send(p.connection, out);
  }

  // -------------------------------------------------------------------------------------------
  // Plumbing

  #own(connection: Connection): HubConnection {
    if (!(connection instanceof HubConnection)) throw new Error("Not a hub connection");
    return connection;
  }

  #enqueue(operation: () => Promise<void> | void): Promise<void> {
    const run = this.#queue.then(operation).catch((error: unknown) => {
      this.#log("operation failed", error);
    });
    this.#queue = run;
    return run;
  }

  /**
   * Run `operation` on the queue after `ms` (hub timers never run outside it). It gets the
   * time the timer fired: by the time the queue reaches it the clock may have moved on.
   */
  #setTimer(ms: number, operation: (firedAt: Date) => Promise<void> | void): Timer {
    return this.#clock.setTimer(ms, () => {
      const firedAt = this.#clock.now();
      void this.#enqueue(() => operation(firedAt));
    });
  }

  #send(conn: HubConnection, message: ServerMessage): void {
    if (conn.closed) return;
    try {
      conn.transport.send(message);
    } catch (error) {
      this.#log(`send ${message.type} failed`, error);
    }
  }

  #refuse(conn: HubConnection, code: ErrorCode, message: string, re?: string): void {
    this.#send(conn, { type: "error", code, message, ...(re ? { re } : {}) });
  }
}

function isSignedIn(caller: Caller): caller is SignedInCaller {
  return caller.user !== null;
}
