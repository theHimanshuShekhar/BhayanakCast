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
  type LobbyRoomChange,
  PROTOCOL_VERSION,
  parseClientMessage,
  type RoomEvent,
  type RoomParticipant,
  type RoomRole,
  type ServerMessage,
} from "../lib/realtime.ts";
import type { Caller, SignedInCaller } from "./caller.ts";
import type { Clock } from "./clock.ts";
import type { RoomAnnouncement } from "./room-announcements.ts";
import type { RoomStore, StoredRoom } from "./room-store.ts";

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
  connection: HubConnection;
}

interface LiveRoom {
  id: string;
  hostUserId: string | null;
  isPrivate: boolean;
  roles: StoredRoom["roles"];
  /** By user id, in order of arrival. */
  participants: Map<string, LiveParticipant>;
  /** The last `CHAT_HISTORY_SIZE` chat messages, oldest first; memory only, gone with the room. */
  chat: ChatEntry[];
}

/**
 * What an anonymous (lobby-only) socket may send (ADR 20): the handshake and the heartbeat
 * (`ping`, #25). Anything else is refused with `forbidden`.
 */
const ANONYMOUS_MESSAGES: ReadonlySet<string> = new Set(["hello", "ping"]);

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
  /** Open sockets per signed-in user id: the online users (ADR 20). */
  readonly #online = new Map<string, number>();
  #nextId = 1;
  #nextChatId = 1;
  /** Per user id, when (epoch ms) their recent accepted chat messages were sent. */
  readonly #chatSends = new Map<string, number[]>();
  #queue: Promise<void> = Promise.resolve();

  constructor(deps: RoomHubDeps) {
    this.#clock = deps.clock;
    this.#store = deps.store;
    this.#log = deps.log ?? ((message, error) => console.error(`[realtime] ${message}`, error));
  }

  /** Register a newly opened socket for `caller` (a visitor for an anonymous socket). */
  connect(transport: Transport, caller: Caller): Connection {
    const conn = new HubConnection(this.#nextId++, caller, transport);
    this.#connections.add(conn);
    const userId = caller.user?.id;
    if (userId) {
      void this.#enqueue(() => {
        const sockets = this.#online.get(userId) ?? 0;
        this.#online.set(userId, sockets + 1);
        if (sockets === 0) this.#lobbyChanged();
      });
    }
    return conn;
  }

  /** A room change made outside the hub (./room-announcements.ts), for the lobby. */
  announce(announcement: RoomAnnouncement): Promise<void> {
    return this.#enqueue(() => {
      if (announcement.isPrivate) return;
      this.#lobbyChanged({ roomId: announcement.roomId, change: "created", participantCount: 0 });
    });
  }

  /**
   * Handle one frame from `connection`: a JSON string (or decoded value). Invalid or refused
   * messages are answered with `error`; nothing a client sends makes this reject.
   */
  handle(connection: Connection, data: unknown): Promise<void> {
    const conn = this.#own(connection);
    return this.#enqueue(async () => {
      if (conn.closed) return;
      const parsed = parseClientMessage(data);
      if (!parsed.ok) return this.#refuse(conn, "bad_request", parsed.error, parsed.type);
      const message = parsed.message;
      if (!conn.caller.user && !ANONYMOUS_MESSAGES.has(message.type)) {
        return this.#refuse(conn, "forbidden", "Sign in first", message.type);
      }
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

  /** The socket closed. Leaves its room (immediately for now; the reconnect grace is #25). */
  disconnect(connection: Connection): Promise<void> {
    const conn = this.#own(connection);
    return this.#enqueue(async () => {
      if (conn.closed) return;
      conn.closed = true;
      this.#connections.delete(conn);
      this.#goOffline(conn);
      await this.#leaveRoom(conn);
    });
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
      this.#send(conn, { type: "lobby.snapshot", online: this.#online.size });
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

      const existing = room.participants.get(user.id);
      if (existing) {
        // The same user from another socket (a reload racing its old socket's close): the new
        // socket takes over the presence, with no leave/join churn. Takeover notices are #26.
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
      this.#lobbyRoomCount(room);
    },

    "room.leave": async (conn) => {
      await this.#leaveRoom(conn);
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
      isPrivate: stored.isPrivate,
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
    room.participants.delete(participant.userId);
    // Lifecycle (#31) keeps empty rooms around for 5 minutes; for now they're dropped.
    if (room.participants.size === 0) this.#rooms.delete(room.id);
    const at = this.#clock.now();
    this.#broadcast(room, { kind: "left", userId: participant.userId }, at);
    await this.#store.closePresence(room.id, participant.userId, at);
    this.#lobbyRoomCount(room);
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
  // Lobby (ADR 20): online users and public room changes, for every greeted socket

  /** `conn` closed: one socket fewer for its user, who goes offline with their last one. */
  #goOffline(conn: HubConnection): void {
    const userId = conn.caller.user?.id;
    if (!userId) return;
    const sockets = (this.#online.get(userId) ?? 1) - 1;
    if (sockets > 0) {
      this.#online.set(userId, sockets);
      return;
    }
    this.#online.delete(userId);
    this.#lobbyChanged();
  }

  /**
   * Tell the lobby `room`'s participant count changed. Call it after the presence write, so a
   * list refetched on this word already shows the change. Private rooms stay out of it.
   */
  #lobbyRoomCount(room: LiveRoom): void {
    if (room.isPrivate) return;
    this.#lobbyChanged({
      roomId: room.id,
      change: "count",
      participantCount: room.participants.size,
    });
  }

  /** Send the online count, and `room`'s change if given, to every greeted socket. */
  #lobbyChanged(room?: LobbyRoomChange): void {
    const message: ServerMessage = {
      type: "lobby.changed",
      online: this.#online.size,
      ...(room ? { room } : {}),
    };
    for (const conn of this.#connections) if (conn.greeted) this.#send(conn, message);
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
