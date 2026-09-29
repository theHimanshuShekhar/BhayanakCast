/**
 * The room hub: all live realtime state (ADRs 4, 12, 14, 15, 20, 21) behind three calls.
 *
 *   const connection = hub.connect(transport, caller); // a socket opened
 *   await hub.handle(connection, frame);                // it sent a frame (raw JSON)
 *   await hub.disconnect(connection);                   // it closed
 *
 * An admin ban reaches it as `hub.disconnectUser(userId, notice)`, an admin role change as
 * `hub.setUserRole(userId, role)`, an admin ending a room as `hub.endRoomByAdmin(roomId)`, and a
 * regenerated invite link as `hub.inviteRotated(roomId)`
 * (./live-hub.ts).
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

import type { AdminRole } from "../lib/admin.ts";
import { MAX_STREAMERS, ROOM_CAPACITY } from "../lib/format.ts";
import {
  BANNED_CLOSE_CODE,
  CHAT_HISTORY_SIZE,
  CHAT_MAX_LENGTH,
  CHAT_RATE_LIMIT,
  type ChatEntry,
  type ClientMessage,
  type ClientMessageOf,
  type ClientMessageType,
  type ErrorCode,
  FEED_HISTORY_SIZE,
  type FeedEntry,
  IDLE_CLOSE_CODE,
  IDLE_TIMEOUT_MS,
  KNOCK_EXPIRY_MS,
  type KnockStatus,
  type LobbyRoomChange,
  MEDIA_OFF,
  type MediaState,
  PROTOCOL_VERSION,
  parseClientMessage,
  REACTION_RATE_LIMIT,
  type RoomEvent,
  type RoomParticipant,
  type RoomRole,
  type ServerMessage,
  SIGNAL_RATE_LIMIT,
} from "../lib/realtime.ts";
import { createRoomInput, ROOM_NAME_MAX } from "../lib/rooms.ts";
import type { Caller, SignedInCaller } from "./caller.ts";
import type { Clock, Timer } from "./clock.ts";
import { withinRateLimit } from "./rate-limit.ts";
import type { RoomAnnouncement } from "./room-announcements.ts";
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
/**
 * How long a room waits for its host once they disconnect or leave (ADR 14): "host
 * reconnecting…". Back in time, they keep host; otherwise it passes on (`#handOverHost`).
 */
export const HOST_GRACE_MS = 30_000;
/**
 * How long an empty room waits for someone to join before it ends (ADR 14). It then ends at
 * the time it became empty and becomes a past stream. `RoomHubDeps.emptyRoomTimeoutMs`
 * overrides it (e2e runs use a short one).
 */
export const EMPTY_ROOM_TIMEOUT_MS = 5 * 60_000;

/** A knock whose invite link doesn't open a live private room is refused with this. */
const INVALID_INVITE = "This invite link is no longer valid";

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
  /** Defaults to `EMPTY_ROOM_TIMEOUT_MS`. */
  emptyRoomTimeoutMs?: number;
}

class HubConnection implements Connection {
  readonly id: number;
  /** Replaced when an admin promotes or demotes the user (`setUserRole`). */
  caller: Caller;
  readonly transport: Transport;
  /** Sent a valid `hello`. */
  greeted = false;
  /** Which visitor this anonymous socket counts as online (`#visitors`), once greeted. */
  visitorKey: string | null = null;
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
  /** Mic, camera and share as last announced; a share has an open stream interval. */
  media: MediaState;
  /**
   * Set when a new socket took over this presence (a return within the grace, a restart, a
   * second tab): when the old one was lost. Until the new socket re-announces its media, the
   * share is the old socket's; if the re-announcement drops it, it ended back then.
   */
  resumedAt?: Date;
}

interface LiveRoom {
  id: string;
  name: string;
  hostUserId: string | null;
  isPrivate: boolean;
  /**
   * Someone has been in it. Until then its creator stays host even while someone else is
   * the first to enter (they get the host grace, ADR 14).
   */
  occupied: boolean;
  roles: StoredRoom["roles"];
  /** By user id, in order of arrival. */
  participants: Map<string, LiveParticipant>;
  /** The last `CHAT_HISTORY_SIZE` chat messages, oldest first; memory only, gone with the room. */
  chat: ChatEntry[];
  /** The last `FEED_HISTORY_SIZE` feed entries, newest first; memory only, gone with the room. */
  feed: FeedEntry[];
  /** `hostUserId`'s host interval is known to be open (`RoomStore.setHost` has run). */
  hostRecorded: boolean;
  /** Set while the host is away (ADR 14): until when, and the timer that hands host on. */
  hostGrace?: { until: Date; timer: Timer };
  /** The latest time anyone left (a presence interval closed); where an emptied room ends. */
  lastLeftAt?: Date;
  /** Set while nobody is here (ADR 14): since when, and the timer that ends the room. */
  empty?: { since: Date; timer: Timer };
  /** Pending knocks on a private room (ADR 16), by knocker's user id; memory only. */
  knocks: Map<string, PendingKnock>;
}

/** Someone knocking on a private room (`knock.request`), until an approver decides. */
interface PendingKnock {
  userId: string;
  username: string;
  at: Date;
  /** The socket that knocked (the latest, if they knocked again): where the answer goes. */
  connection: HubConnection;
  /** What the knocker was last told while undecided. */
  status: "waiting" | "waiting_for_host";
  /** Ends the knock `KNOCK_EXPIRY_MS` after `at` (`expired`). */
  expiry: Timer;
  /**
   * Set while its socket is gone: withdraws the knock unless they knock again within
   * `RECONNECT_GRACE_MS` (as for participants, ADR 12).
   */
  grace?: Timer;
}

/** A feed entry to log: the hub stamps its id and time. */
type NewFeedEntry = FeedEntry extends infer E
  ? E extends FeedEntry
    ? Omit<E, "id" | "at">
    : never
  : never;

/** Someone named in a room event or feed entry. */
type FeedPerson = { userId: string; username: string };

/** What a moderator can do in a room (ADR 15); `admit` decides knocks (ADR 16). */
type ModPower = "kick" | "stopShare" | "setRole" | "rename" | "admit";

/** Which powers each room role has (ADR 15); an admin has them all in any room. */
const ROOM_POWERS: Record<RoomRole, ReadonlySet<ModPower>> = {
  host: new Set<ModPower>(["kick", "stopShare", "setRole", "rename", "admit"]),
  mod: new Set<ModPower>(["kick", "stopShare", "admit"]),
  member: new Set<ModPower>(),
};

/** Host and mods act only on people ranked below them; admins on anyone but themselves. */
const ROLE_RANK: Record<RoomRole, number> = { member: 0, mod: 1, host: 2 };

/**
 * What an anonymous (lobby-only) socket may send (ADR 20): the handshake and the heartbeat.
 * Anything else is refused with `forbidden`.
 */
const ANONYMOUS_MESSAGES: ReadonlySet<ClientMessageType> = new Set<ClientMessageType>([
  "hello",
  "ping",
]);

type Handler<T extends ClientMessageType> = (
  conn: HubConnection,
  message: ClientMessageOf<T>,
) => Promise<void> | void;

export class RoomHub {
  readonly #clock: Clock;
  readonly #store: RoomStore;
  readonly #log: (message: string, error: unknown) => void;
  readonly #emptyRoomTimeoutMs: number;
  readonly #connections = new Set<HubConnection>();
  readonly #rooms = new Map<string, LiveRoom>();
  /** Open sockets per signed-in user id: the online users (ADR 20). */
  readonly #online = new Map<string, number>();
  /**
   * Greeted anonymous sockets per visitor key: the online visitors (ADR 20 addendum). The key
   * is the browser's `visitorId`, or the connection's own when it sent none. Memory only, never
   * logged or sent to a client.
   */
  readonly #visitors = new Map<string, number>();
  #nextId = 1;
  #nextChatId = 1;
  /** Per user id, when (epoch ms) their recent accepted chat messages were sent. */
  readonly #chatSends = new Map<string, number[]>();
  #nextReactionId = 1;
  #nextFeedId = 1;
  /** Per user id, when (epoch ms) their recent accepted reactions were sent. */
  readonly #reactionSends = new Map<string, number[]>();
  /** Per user id, when (epoch ms) their recent relayed signalling steps were sent. */
  readonly #signalSends = new Map<string, number[]>();
  /**
   * Per room an admin ended, who was in their reconnect grace then and so missed `ended`: their
   * rejoin is answered with it (once). Memory only; admin ends are rare.
   */
  readonly #endedWhileAway = new Map<string, Set<string>>();
  #queue: Promise<void> = Promise.resolve();

  constructor(deps: RoomHubDeps) {
    this.#clock = deps.clock;
    this.#store = deps.store;
    this.#log = deps.log ?? ((message, error) => console.error(`[realtime] ${message}`, error));
    this.#emptyRoomTimeoutMs = deps.emptyRoomTimeoutMs ?? EMPTY_ROOM_TIMEOUT_MS;
    // Restart recovery: the first thing on the queue, so joins wait for it.
    void this.#enqueue(() => this.#restore());
    this.#scheduleCheckpoint();
  }

  /** Register a newly opened socket for `caller` (a visitor for an anonymous socket). */
  connect(transport: Transport, caller: Caller): Connection {
    const conn = new HubConnection(this.#nextId++, caller, transport);
    this.#connections.add(conn);
    const userId = caller.user?.id;
    if (userId) {
      void this.#enqueue(() => this.#countOnline(this.#online, userId));
    }
    this.#armIdle(conn);
    return conn;
  }

  /**
   * A room change made outside the hub (./room-announcements.ts). A new thumbnail tells the
   * lobby (public rooms only). A created room is live and
   * empty from now: it ends unless someone enters in time (ADR 14), even if its creator closes
   * the page in the pre-join lobby.
   */
  announce(announcement: RoomAnnouncement): Promise<void> {
    return this.#enqueue(async () => {
      if (announcement.kind === "thumbnail") {
        const room = this.#rooms.get(announcement.roomId);
        if (room && !room.isPrivate) {
          this.#lobbyChanged({
            roomId: room.id,
            change: "thumbnail",
            participantCount: room.participants.size,
          });
        }
        return;
      }
      const { roomId, name, hostUserId, isPrivate } = announcement;
      if (!this.#rooms.has(roomId)) {
        const room = this.#addRoom({
          id: roomId,
          name,
          hostUserId,
          isPrivate,
          occupied: false,
          roles: new Map([[hostUserId, "host"]]),
        });
        await this.#roomEmptied(room, this.#clock.now());
      }
      if (isPrivate) return;
      this.#lobbyChanged({ roomId, change: "created", participantCount: 0 });
    });
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

  /**
   * The socket closed. Its user stays in their room for the reconnect grace
   * (`RECONNECT_GRACE_MS`); rejoining within it resumes their presence.
   */
  disconnect(connection: Connection): Promise<void> {
    const conn = this.#own(connection);
    return this.#enqueue(() => this.#drop(conn));
  }

  /**
   * An admin banned `userId` (ADR 6): they leave any room at once (no reconnect grace; a host
   * hands host on straight away, as for a kick), which the room sees as `left`, and every socket
   * of theirs is told `banned` with `notice` (the ban's reason and end) and closed.
   */
  disconnectUser(userId: string, notice: string): Promise<void> {
    return this.#enqueue(async () => {
      const at = this.#clock.now();
      for (const room of [...this.#rooms.values()]) {
        const participant = room.participants.get(userId);
        if (!participant) continue;
        if (userId === room.hostUserId) {
          this.#cancelHostGrace(room);
          await this.#handOverHost(room, at);
        }
        participant.connection.roomId = null;
        // Someone in their reconnect grace was last here when their socket closed.
        await this.#removeParticipant(room, participant, participant.grace?.since ?? at);
      }
      for (const conn of [...this.#connections]) {
        if (conn.caller.user?.id !== userId) continue;
        conn.roomId = null;
        this.#refuse(conn, "banned", notice);
        try {
          conn.transport.close(BANNED_CLOSE_CODE, "banned");
        } catch (error) {
          this.#log("closing a banned user's socket failed", error);
        }
        await this.#drop(conn);
      }
    });
  }

  /**
   * The host regenerated `roomId`'s invite link (ADR 16): knocks pending through the old one end,
   * their knockers told it's no longer valid, as when the room ends.
   */
  inviteRotated(roomId: string): Promise<void> {
    return this.#enqueue(async () => {
      const room = this.#rooms.get(roomId);
      if (room) this.#invalidateKnocks(room);
    });
  }

  /**
   * An admin promoted `userId` to admin or demoted them (ADR 6 addendum): their open sockets
   * gain or lose admin powers from their next message, without reconnecting. A new admin in a
   * room gets the knocks already pending there, as a new mod would.
   */
  setUserRole(userId: string, role: AdminRole): Promise<void> {
    return this.#enqueue(() => {
      const inRooms = [...this.#rooms.values()].flatMap((room) => {
        const participant = room.participants.get(userId);
        return participant
          ? [{ room, participant, approved: this.#approves(room, participant) }]
          : [];
      });
      for (const conn of this.#connections) {
        if (conn.caller.user?.id === userId) conn.caller = { ...conn.caller, role };
      }
      for (const { room, participant, approved } of inRooms) {
        if (!approved) this.#sendPendingKnocks(room, participant);
        // An approver may have arrived (promoted) or gone (demoted): knockers wait accordingly.
        this.#updateKnockers(room);
      }
    });
  }

  /**
   * An admin ended `roomId` (ADR 6): everyone in it is told `ended` and is out of it (their
   * sockets stay open for the lobby), their intervals close now (or when their socket closed,
   * for anyone in their reconnect grace), and the room ends now as an empty room would, knocks
   * refused and stats rolled up. Anyone in their reconnect grace hears `ended` when they rejoin.
   * A live room this hub doesn't hold (not loaded) ends in the database only, on the same queue
   * as joins, so none can load it meanwhile. True if this call ended the room; false if it
   * wasn't live (already ended, say by its empty-room timer, or unknown).
   */
  async endRoomByAdmin(roomId: string): Promise<boolean> {
    let ended = false;
    await this.#enqueue(async () => {
      const at = this.#clock.now();
      const room = this.#rooms.get(roomId);
      if (!room) {
        ended = await this.#endStoredRoom(roomId, at);
        return;
      }
      this.#broadcast(room, { kind: "ended", reason: "admin" }, at);
      const away = new Set<string>();
      for (const participant of room.participants.values()) {
        const leftAt = participant.grace?.since ?? at;
        if (participant.grace) away.add(participant.userId);
        this.#cancelGrace(participant);
        participant.connection.roomId = null;
        await this.#store.closePresence(room.id, participant.userId, leftAt);
        if (participant.media.share) {
          await this.#store.closeStream(room.id, participant.userId, leftAt);
        }
      }
      if (away.size) this.#endedWhileAway.set(room.id, away);
      room.participants.clear();
      ended = await this.#endRoom(room, at);
    });
    return ended;
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
      const user = conn.caller.user;
      // Before `greeted`, so the others hear of a new visitor and this socket only the snapshot.
      if (!user) this.#visitorOnline(conn, message.visitorId);
      conn.greeted = true;
      this.#send(conn, {
        type: "welcome",
        v: PROTOCOL_VERSION,
        user: user ? { id: user.id, username: user.username } : null,
      });
      this.#send(conn, { type: "lobby.snapshot", online: this.#onlineCount() });
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

      // Back from a reconnect grace during which an admin ended the room: tell them now.
      const away = this.#endedWhileAway.get(roomId);
      if (away?.delete(user.id)) {
        if (away.size === 0) this.#endedWhileAway.delete(roomId);
        return this.#send(conn, {
          type: "room.event",
          roomId,
          at: this.#clock.now().toISOString(),
          event: { kind: "ended", reason: "admin" },
        });
      }

      // Kicked is for good (ADR 15), admins included.
      if (await this.#store.isKicked(roomId, user.id)) {
        return this.#refuse(conn, "kicked", "You were removed from this room", message.type);
      }
      const stored = await this.#store.findRoomFor(caller, roomId);
      if (!stored) {
        // A live private room they weren't approved into: in only by knocking (ADR 16).
        if (this.#rooms.get(roomId)?.isPrivate) {
          return this.#refuse(
            conn,
            "forbidden",
            "This room is private: knock with its invite link",
            message.type,
          );
        }
        return this.#refuse(conn, "not_found", "That room isn't live", message.type);
      }
      const room = this.#rooms.get(roomId) ?? this.#addRoom(stored);
      // A room known only from its creation announcement: the database is the fuller picture
      // (e.g. roles given before anyone entered).
      if (!room.occupied) {
        room.name = stored.name;
        room.hostUserId = stored.hostUserId;
        room.roles = stored.roles;
      }
      const existing = room.participants.get(user.id);
      // Capacity (ADRs 2, 21) counts everyone present, including those in reconnect grace.
      if (!existing && room.participants.size >= ROOM_CAPACITY) {
        return this.#refuse(
          conn,
          "room_full",
          `This room is full (${room.participants.size}/${ROOM_CAPACITY})`,
          message.type,
        );
      }
      await this.#takeOverElsewhere(user.id, roomId);
      await this.#endGraceElsewhere(user.id, roomId);

      if (existing) {
        // The same user from another socket (a second tab or device, a reload racing its old
        // socket's close, or a return within the reconnect grace): the new socket takes over
        // the presence and its open interval, with no leave/join churn (takeover, ADR 21).
        if (existing.connection !== conn) this.#tellTakenOver(existing.connection);
        // Its share carries on only if the new socket re-announces it (#announceMedia).
        existing.resumedAt = existing.grace?.since ?? this.#clock.now();
        this.#cancelGrace(existing);
        existing.connection.roomId = null;
        existing.connection = conn;
        conn.roomId = roomId;
        if (await this.#hostBack(room, user.id)) this.#announceHost(room, this.#clock.now(), conn);
        return this.#sendSnapshot(conn, roomId);
      }

      // Joining an empty room keeps it from ending (ADR 14).
      await this.#roomOccupied(room);
      const joinedAt = this.#clock.now();
      await this.#store.openPresence(roomId, user.id, joinedAt);
      const participant: LiveParticipant = {
        userId: user.id,
        username: user.username,
        joinedAt,
        connection: conn,
        media: { ...MEDIA_OFF },
      };
      // Whoever joins an empty (or hostless) room becomes its host (ADR 14), except that a new
      // room's creator (maybe still in the pre-join lobby) gets the host grace to come in.
      const awaitsCreator =
        !room.occupied && room.hostUserId !== null && room.hostUserId !== user.id;
      const takesHost =
        !awaitsCreator && (room.participants.size === 0 || room.hostUserId === null);
      room.occupied = true;
      room.participants.set(user.id, participant);
      conn.roomId = roomId;
      let back = false;
      let newHost = false;
      if (takesHost) newHost = await this.#takeHost(room, user.id, joinedAt);
      else if (awaitsCreator) this.#startHostGrace(room, joinedAt);
      else back = await this.#hostBack(room, user.id);
      this.#sendSnapshot(conn, roomId);
      this.#broadcast(
        room,
        { kind: "joined", participant: this.#view(room, participant) },
        joinedAt,
        conn,
      );
      this.#feed(room, joinedAt, { kind: "joined", userId: user.id, username: user.username });
      // Someone else's room, left empty or hostless, is theirs now.
      if (newHost) {
        this.#feed(room, joinedAt, {
          kind: "hostChanged",
          userId: user.id,
          username: user.username,
        });
      }
      if (back) this.#announceHost(room, joinedAt, conn);
      this.#lobbyRoomCount(room);
    },

    "room.leave": async (conn) => {
      await this.#leaveRoom(conn);
    },

    ping: (conn) => {
      this.#send(conn, { type: "pong" });
    },

    "chat.send": (conn, message) => this.#chat(conn, message),

    "media.state": (conn, message) => this.#announceMedia(conn, message),

    "reaction.send": (conn, message) => this.#react(conn, message),

    "mod.kick": (conn, message) => this.#kick(conn, message),

    "mod.stopShare": (conn, message) => this.#stopShare(conn, message),

    "mod.setRole": (conn, message) => this.#setRole(conn, message),

    "room.rename": (conn, message) => this.#rename(conn, message),

    signal: (conn, message) => this.#signal(conn, message),

    "knock.request": (conn, message) => this.#knock(conn, message),

    "knock.decide": (conn, message) => this.#decideKnock(conn, message),

    "knock.cancel": (conn) => this.#withdrawKnocks(conn),
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
      name: stored.name,
      hostUserId: stored.hostUserId,
      isPrivate: stored.isPrivate,
      occupied: stored.occupied,
      roles: stored.roles,
      participants: new Map(),
      chat: [],
      feed: [],
      hostRecorded: false,
      knocks: new Map(),
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
   * an expired reconnect grace): tell everyone and close the presence interval at `at`. With
   * `kickedBy`, they didn't leave but were kicked (`mod.kick`), and everyone hears that instead.
   */
  async #removeParticipant(
    room: LiveRoom,
    participant: LiveParticipant,
    at: Date,
    kickedBy?: FeedPerson,
  ): Promise<void> {
    this.#cancelGrace(participant);
    room.participants.delete(participant.userId);
    const who = { userId: participant.userId, username: participant.username };
    if (kickedBy) {
      this.#broadcast(room, { kind: "kicked", userId: who.userId, by: kickedBy }, at);
      this.#feed(room, at, { kind: "kicked", ...who, by: kickedBy });
    } else {
      this.#broadcast(room, { kind: "left", userId: participant.userId }, at);
      this.#feed(room, at, {
        kind: "left",
        userId: participant.userId,
        username: participant.username,
      });
    }
    await this.#store.closePresence(room.id, participant.userId, at);
    if (participant.media.share) await this.#store.closeStream(room.id, participant.userId, at);
    if (!room.lastLeftAt || at > room.lastLeftAt) room.lastLeftAt = at;
    if (participant.userId === room.hostUserId) this.#hostGone(room);
    this.#updateKnockers(room);
    if (room.participants.size === 0) await this.#roomEmptied(room, room.lastLeftAt);
    this.#lobbyRoomCount(room);
  }

  // -------------------------------------------------------------------------------------------
  // Room lifecycle (ADR 14): an empty room ends after `EMPTY_ROOM_TIMEOUT_MS`

  /**
   * Nobody is left in `room`, the last of them since `since`: record it (`rooms.lastEmptyAt`)
   * and start the timer that ends the room unless someone joins first.
   */
  async #roomEmptied(room: LiveRoom, since: Date): Promise<void> {
    this.#cancelEmpty(room);
    // Nobody is here to hand host to (e.g. a new room's first visitor left before its creator
    // came): whoever joins next settles it.
    this.#cancelHostGrace(room);
    await this.#store.markRoomEmpty(room.id, since);
    const timer = this.#setTimer(this.#emptyRoomTimeoutMs, async () => {
      if (room.empty?.timer !== timer || this.#rooms.get(room.id) !== room) return;
      if (room.participants.size > 0) return;
      await this.#endRoom(room, since);
    });
    room.empty = { since, timer };
  }

  /** Someone is joining `room`: if it was empty, it no longer ends. */
  async #roomOccupied(room: LiveRoom): Promise<void> {
    if (!room.empty) return;
    this.#cancelEmpty(room);
    await this.#store.markRoomOccupied(room.id);
  }

  #cancelEmpty(room: LiveRoom): void {
    room.empty?.timer.cancel();
    room.empty = undefined;
  }

  /**
   * `room` ends at `endedAt` and is a past stream from now on: when it became empty if nobody
   * joined in time, or now if an admin ended it (`endRoomByAdmin`). Its intervals close, stats
   * roll up (ADR 11), and its chat and feed go with it (memory only, ADR 4 addendum). True if
   * this ended it (it was still live in the database).
   */
  async #endRoom(room: LiveRoom, endedAt: Date): Promise<boolean> {
    this.#cancelEmpty(room);
    this.#cancelHostGrace(room);
    this.#rooms.delete(room.id);
    room.chat = [];
    room.feed = [];
    // Its invite link opens nothing now.
    this.#invalidateKnocks(room);
    const ended = await this.#endStoredRoom(room.id, endedAt);
    if (!room.isPrivate) {
      this.#lobbyChanged({ roomId: room.id, change: "ended", participantCount: 0 });
    }
    return ended;
  }

  /**
   * End `roomId` at `endedAt` in the database: its host interval and any open presence and
   * stream intervals close, and its stats roll up. True if it was live until now.
   */
  async #endStoredRoom(roomId: string, endedAt: Date): Promise<boolean> {
    await this.#store.closeHostInterval(roomId, endedAt);
    if (!(await this.#store.endRoom(roomId, endedAt))) return false;
    await this.#store.rollupEndedRoom(roomId, this.#clock.now());
    return true;
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
    // Online follows open sockets (ADR 20), so this is immediate; the room count waits out the
    // grace (#removeParticipant).
    this.#goOffline(conn);
    // A knock outlives its socket for the reconnect grace (#holdKnocks).
    this.#holdKnocks(conn);
    const room = conn.roomId ? this.#rooms.get(conn.roomId) : undefined;
    const userId = conn.caller.user?.id;
    const participant = room && userId ? room.participants.get(userId) : undefined;
    if (!room || !participant || participant.connection !== conn) return;
    const since = this.#clock.now();
    this.#startGrace(room, participant, since);
    if (participant.userId === room.hostUserId) this.#hostGone(room);
    // An approver in their reconnect grace can't answer knocks.
    this.#updateKnockers(room);
    // If the server dies during the grace, the interval closes here, not at an older checkpoint.
    await this.#store.checkpointPresence([
      { roomId: room.id, userId: participant.userId, at: since },
    ]);
    if (participant.media.share) {
      await this.#store.checkpointStreams([
        { roomId: room.id, userId: participant.userId, at: since },
      ]);
    }
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

  // -------------------------------------------------------------------------------------------
  // Host lifecycle (ADRs 11, 14): host intervals, the 30s host grace, and handover

  /**
   * `userId` (present in `room`) is its host from `at`: persist it, opening their host interval
   * (nothing to write for a host whose interval is already open). Callers tell the room.
   * True if host moved to someone else (worth a feed entry), not just (re)confirmed.
   */
  async #takeHost(room: LiveRoom, userId: string, at: Date): Promise<boolean> {
    this.#cancelHostGrace(room);
    if (room.hostUserId === userId && room.hostRecorded) return false;
    await this.#store.setHost(room.id, userId, at);
    const previous = room.hostUserId;
    if (previous && previous !== userId) room.roles.delete(previous);
    room.roles.set(userId, "host");
    room.hostUserId = userId;
    room.hostRecorded = true;
    // Room cards show the host.
    if (previous !== userId && !room.isPrivate) {
      this.#lobbyChanged({
        roomId: room.id,
        change: "host",
        participantCount: room.participants.size,
      });
    }
    return previous !== userId;
  }

  /**
   * The host just disconnected from or left `room`: unless nobody is left (whoever joins next
   * becomes host), start the host grace if it isn't running yet, and tell everyone.
   */
  #hostGone(room: LiveRoom): void {
    if (room.participants.size === 0) {
      // Empty: the host interval stays open until someone joins and takes host, or the room
      // ends (`#endRoom` closes it at the end time).
      this.#cancelHostGrace(room);
      return;
    }
    if (room.hostGrace) return;
    const at = this.#clock.now();
    this.#startHostGrace(room, at);
    this.#announceHost(room, at);
  }

  /** Wait `HOST_GRACE_MS` from `at` for the absent host, then hand host on. Callers tell the room. */
  #startHostGrace(room: LiveRoom, at: Date): void {
    this.#cancelHostGrace(room);
    const timer = this.#setTimer(HOST_GRACE_MS, async (firedAt) => {
      if (room.hostGrace?.timer !== timer || this.#rooms.get(room.id) !== room) return;
      room.hostGrace = undefined;
      await this.#handOverHost(room, firedAt);
    });
    room.hostGrace = { until: new Date(at.getTime() + HOST_GRACE_MS), timer };
  }

  /**
   * `userId` is (back) in `room`: if they're its host, the host grace ends and they keep host.
   * True if a grace was running, so the caller tells the others.
   */
  async #hostBack(room: LiveRoom, userId: string): Promise<boolean> {
    if (room.hostUserId !== userId) return false;
    const wasAway = room.hostGrace !== undefined;
    await this.#takeHost(room, userId, this.#clock.now());
    return wasAway;
  }

  /**
   * The host grace ran out: host passes to whoever has been present longest, mods first
   * (ADR 14), preferring people with a socket over people in their reconnect grace. The old
   * host doesn't get it back by returning later.
   */
  async #handOverHost(room: LiveRoom, at: Date): Promise<void> {
    const isMod = (p: LiveParticipant) => room.roles.get(p.userId) === "mod";
    const next = [...room.participants.values()]
      .filter((p) => p.userId !== room.hostUserId)
      .map((p, order) => ({ p, order }))
      .sort(
        (x, y) =>
          Number(!!x.p.grace) - Number(!!y.p.grace) ||
          Number(isMod(y.p)) - Number(isMod(x.p)) ||
          x.p.joinedAt.getTime() - y.p.joinedAt.getTime() ||
          x.order - y.order,
      )[0]?.p;
    const changed = next ? await this.#takeHost(room, next.userId, at) : false;
    // With nobody else here, the old host (in their reconnect grace) simply stays host.
    this.#announceHost(room, at);
    if (next && changed) {
      this.#feed(room, at, { kind: "hostChanged", userId: next.userId, username: next.username });
      this.#sendPendingKnocks(room, next);
      this.#updateKnockers(room);
    }
    // A new host who is away themselves gets a host grace of their own.
    if (next?.grace) this.#hostGone(room);
  }

  #cancelHostGrace(room: LiveRoom): void {
    room.hostGrace?.timer.cancel();
    room.hostGrace = undefined;
  }

  /** Tell everyone in `room` (but `except`) who the host is, and whether they're away. */
  #announceHost(room: LiveRoom, at: Date, except?: HubConnection): void {
    this.#broadcast(
      room,
      {
        kind: "hostChanged",
        hostUserId: room.hostUserId,
        graceUntil: room.hostGrace?.until.toISOString() ?? null,
      },
      at,
      except,
    );
  }

  // -------------------------------------------------------------------------------------------
  // Takeover (ADR 21): a user is in at most one room, over one connection

  /**
   * `userId` is joining `roomId` from another connection: an open connection of theirs in a
   * different room is told `taken_over` and leaves that room now.
   */
  async #takeOverElsewhere(userId: string, roomId: string): Promise<void> {
    for (const room of this.#rooms.values()) {
      if (room.id === roomId) continue;
      const participant = room.participants.get(userId);
      if (!participant || participant.grace) continue;
      this.#tellTakenOver(participant.connection);
      await this.#removeParticipant(room, participant, this.#clock.now());
    }
  }

  /** `conn` no longer holds its room: another connection of its user joined one. */
  #tellTakenOver(conn: HubConnection): void {
    conn.roomId = null;
    this.#refuse(conn, "taken_over", "You joined a room from another tab or device");
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
    const streaming: PresenceSeen[] = [];
    for (const room of this.#rooms.values()) {
      for (const participant of room.participants.values()) {
        // Someone in grace was last seen when their socket closed, which #drop wrote.
        if (participant.grace) continue;
        const mark = { roomId: room.id, userId: participant.userId, at };
        seen.push(mark);
        if (participant.media.share) streaming.push(mark);
      }
    }
    await this.#store.checkpointPresence(seen);
    await this.#store.checkpointStreams(streaming);
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
        if (!room.lastLeftAt || presence.lastSeenAt > room.lastLeftAt) {
          room.lastLeftAt = presence.lastSeenAt;
        }
        if (now.getTime() - presence.lastSeenAt.getTime() > RESTORE_STALE_AFTER_MS) {
          await this.#store.closePresence(room.id, presence.userId, presence.lastSeenAt);
          if (presence.sharing) {
            await this.#store.closeStream(room.id, presence.userId, presence.lastSeenAt);
          }
          continue;
        }
        const participant: LiveParticipant = {
          userId: presence.userId,
          username: presence.username,
          joinedAt: presence.startedAt,
          connection: this.#goneConnection(presence.userId, presence.username),
          // Their share lasts until they re-announce on return, or ends with the grace.
          media: { ...MEDIA_OFF, share: presence.sharing },
        };
        room.participants.set(participant.userId, participant);
        this.#startGrace(room, participant, presence.lastSeenAt);
      }
      // Nobody has a socket yet, the host included (if they're here at all): the room waits
      // one host grace for them, as if they had just disconnected.
      this.#hostGone(room);
      // A room restored with nobody to wait for ends unless someone joins in time, at its
      // last-seen time (ADR 14): when it became empty, else when its last presence was seen,
      // else (nobody ever came) when it was created. One whose restored people never return
      // empties when their graces run out (#removeParticipant).
      if (room.participants.size === 0) {
        await this.#roomEmptied(room, stored.lastEmptyAt ?? room.lastLeftAt ?? stored.createdAt);
      }
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
      media: { ...participant.media },
    };
  }

  /** `room.snapshot` for `conn`, which is in `roomId`; then, for an approver, pending knocks. */
  #sendSnapshot(conn: HubConnection, roomId: string): void {
    const room = this.#rooms.get(roomId);
    if (!room) return;
    this.#send(conn, {
      type: "room.snapshot",
      roomId,
      name: room.name,
      hostUserId: room.hostUserId,
      participants: [...room.participants.values()].map((p) => this.#view(room, p)),
      chat: [...room.chat],
      feed: [...room.feed],
      ...(room.hostGrace ? { hostGraceUntil: room.hostGrace.until.toISOString() } : {}),
    });
    const participant = conn.caller.user && room.participants.get(conn.caller.user.id);
    if (participant?.connection !== conn) return;
    this.#sendPendingKnocks(room, participant);
    // They may be the first approver here (joined, or back from their reconnect grace).
    this.#updateKnockers(room);
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
  // Lobby (ADR 20): the online count and public room changes, for every greeted socket

  /** The online count: distinct signed-in users plus distinct visitors. */
  #onlineCount(): number {
    return this.#online.size + this.#visitors.size;
  }

  /**
   * An anonymous `conn` said hello: it counts as `visitorId`'s browser, or on its own without a
   * valid one. The first socket of a visitor changes the count. A repeated hello changes nothing.
   */
  #visitorOnline(conn: HubConnection, visitorId: string | undefined): void {
    if (conn.visitorKey) return;
    // Visitor ids are UUIDs, so a per-connection key can't collide with one.
    const key = visitorId?.toLowerCase() ?? `connection:${conn.id}`;
    conn.visitorKey = key;
    this.#countOnline(this.#visitors, key);
  }

  /** One more open socket for `key` in `openSockets`; the lobby hears of its first. */
  #countOnline(openSockets: Map<string, number>, key: string): void {
    const sockets = openSockets.get(key) ?? 0;
    openSockets.set(key, sockets + 1);
    if (sockets === 0) this.#lobbyChanged();
  }

  /**
   * `conn` closed: one socket fewer for its user or visitor, who goes offline with their last
   * one. A visitor who signs in has their anonymous socket close as the authenticated one opens
   * (ADR 20), so the count settles on one for them either way round.
   */
  #goOffline(conn: HubConnection): void {
    const userId = conn.caller.user?.id;
    if (userId) this.#countOffline(this.#online, userId);
    else if (conn.visitorKey) this.#countOffline(this.#visitors, conn.visitorKey);
  }

  /** One socket fewer for `key` in `openSockets`; the lobby hears of its last. */
  #countOffline(openSockets: Map<string, number>, key: string): void {
    const sockets = (openSockets.get(key) ?? 1) - 1;
    if (sockets > 0) {
      openSockets.set(key, sockets);
      return;
    }
    openSockets.delete(key);
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
      online: this.#onlineCount(),
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
  // Media state (#29): mic/cam/share flags, the 3-streamer limit (ADR 2), stream intervals

  async #announceMedia(conn: HubConnection, message: ClientMessageOf<"media.state">) {
    const userId = conn.caller.user?.id;
    const room = conn.roomId ? this.#rooms.get(conn.roomId) : undefined;
    const participant = userId ? room?.participants.get(userId) : undefined;
    if (!room || !participant || participant.connection !== conn) {
      return this.#refuse(conn, "forbidden", "Join the room first", message.type);
    }
    const next: MediaState = { mic: message.mic, cam: message.cam, share: message.share };
    if (next.share && !participant.media.share) {
      const streamers = [...room.participants.values()].filter((p) => p.media.share).length;
      if (streamers >= MAX_STREAMERS) {
        next.share = false;
        this.#refuse(
          conn,
          "share_limit",
          `${MAX_STREAMERS} people are already sharing`,
          message.type,
        );
      }
    }
    // The first announcement from a socket that took over: a share it doesn't carry on ended
    // when the old socket was lost.
    const shareEndedAt = participant.resumedAt;
    participant.resumedAt = undefined;
    await this.#setMedia(room, participant, next, shareEndedAt);
  }

  /**
   * Change `participant`'s media to `next`, opening or closing their stream interval (now, or
   * a stopped share at `shareEndedAt`), and tell everyone in `room`, them included. `by`: the
   * host, mod or admin who forced the change (`mod.stopShare`).
   */
  async #setMedia(
    room: LiveRoom,
    participant: LiveParticipant,
    next: MediaState,
    shareEndedAt?: Date,
    by?: FeedPerson,
  ): Promise<void> {
    const was = participant.media;
    if (was.mic === next.mic && was.cam === next.cam && was.share === next.share) return;
    const at = this.#clock.now();
    if (next.share && !was.share) await this.#store.openStream(room.id, participant.userId, at);
    if (!next.share && was.share) {
      await this.#store.closeStream(room.id, participant.userId, shareEndedAt ?? at);
    }
    participant.media = { ...next };
    this.#broadcast(
      room,
      {
        kind: "stateChanged",
        userId: participant.userId,
        media: { ...next },
        ...(by ? { by } : {}),
      },
      at,
    );
    // Room cards show who is streaming.
    if (next.share !== was.share && !room.isPrivate) {
      this.#lobbyChanged({
        roomId: room.id,
        change: "streamers",
        participantCount: room.participants.size,
      });
    }
    if (next.share !== was.share) {
      const who = { userId: participant.userId, username: participant.username };
      if (next.share) this.#feed(room, at, { kind: "shareStarted", ...who });
      else this.#feed(room, at, { kind: "shareStopped", ...who, ...(by ? { by } : {}) });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Reactions (never stored) and the feed (the last 50 per room, in memory only)

  #react(conn: HubConnection, message: ClientMessageOf<"reaction.send">) {
    const { room, participant } = this.#participantOf(conn);
    if (!room || !participant) {
      return this.#refuse(conn, "forbidden", "Join the room to react", message.type);
    }
    const target = room.participants.get(message.targetUserId);
    if (!target) {
      return this.#refuse(conn, "not_found", "They're not in this room", message.type);
    }
    const at = this.#clock.now();
    const { reactions, windowMs } = REACTION_RATE_LIMIT;
    if (!withinRateLimit(this.#reactionSends, participant.userId, reactions, windowMs, at)) {
      return this.#refuse(
        conn,
        "rate_limited",
        "You're reacting too fast; wait a moment",
        message.type,
      );
    }

    const out: ServerMessage = {
      type: "reaction",
      roomId: room.id,
      reaction: {
        id: `r${this.#nextReactionId++}`,
        userId: participant.userId,
        username: participant.username,
        targetUserId: target.userId,
        emoji: message.emoji,
        at: at.toISOString(),
      },
    };
    for (const p of room.participants.values()) this.#send(p.connection, out);
    this.#feed(room, at, {
      kind: "reaction",
      userId: participant.userId,
      username: participant.username,
      emoji: message.emoji,
      target: { userId: target.userId, username: target.username },
    });
  }

  /**
   * Log `entry` in `room`'s feed at `at` and send it to everyone there. Anything the feed
   * should show (joins, leaves, reactions, shares, role and host changes, kicks) calls this
   * once, after the change itself went out.
   */
  #feed(room: LiveRoom, at: Date, entry: NewFeedEntry): void {
    const logged = { ...entry, id: `f${this.#nextFeedId++}`, at: at.toISOString() } as FeedEntry;
    room.feed.unshift(logged);
    if (room.feed.length > FEED_HISTORY_SIZE) room.feed.length = FEED_HISTORY_SIZE;
    const out: ServerMessage = { type: "feed.entry", roomId: room.id, entry: logged };
    for (const p of room.participants.values()) this.#send(p.connection, out);
  }

  // -------------------------------------------------------------------------------------------
  // Moderation (ADR 15): kick, stop share, roles and rename, authorised against room roles

  /**
   * The sender and their room if they may use `power` there (their room role's powers, or any
   * as an admin); otherwise refuse `re` and return nothing.
   */
  #moderator(
    conn: HubConnection,
    power: ModPower,
    re: string,
  ): { room: LiveRoom; actor: LiveParticipant } | undefined {
    const { room, participant: actor } = this.#participantOf(conn);
    if (!room || !actor) {
      this.#refuse(conn, "forbidden", "Join the room first", re);
      return;
    }
    if (!isAdmin(conn) && !ROOM_POWERS[this.#roleOf(room, actor.userId)].has(power)) {
      const who = ROOM_POWERS.mod.has(power) ? "the host or a mod" : "the host";
      this.#refuse(conn, "forbidden", `Only ${who} can do that`, re);
      return;
    }
    return { room, actor };
  }

  /**
   * The participant `userId` in `room` if `actor` may act on them: someone else, ranked below
   * the actor (anyone, for an admin), and not an admin unless the actor is one.
   */
  #target(
    conn: HubConnection,
    room: LiveRoom,
    actor: LiveParticipant,
    userId: string,
    re: string,
  ): LiveParticipant | undefined {
    const target = room.participants.get(userId);
    if (!target) {
      this.#refuse(conn, "not_found", "They're not in this room", re);
      return;
    }
    if (target.userId === actor.userId) {
      this.#refuse(conn, "bad_request", "You can't do that to yourself", re);
      return;
    }
    if (isAdmin(conn)) return target;
    const role = this.#roleOf(room, target.userId);
    if (ROLE_RANK[role] >= ROLE_RANK[this.#roleOf(room, actor.userId)]) {
      this.#refuse(conn, "forbidden", `You can't moderate the ${role}`, re);
      return;
    }
    if (target.connection.caller.role === "admin") {
      this.#refuse(conn, "forbidden", "You can't moderate an admin", re);
      return;
    }
    return target;
  }

  /** `mod.kick`: out now (no grace), for good. */
  async #kick(conn: HubConnection, message: ClientMessageOf<"mod.kick">) {
    const mod = this.#moderator(conn, "kick", message.type);
    if (!mod) return;
    const { room, actor } = mod;
    const target = this.#target(conn, room, actor, message.userId, message.type);
    if (!target) return;
    const at = this.#clock.now();
    // A kicked host isn't coming back: host passes on now, not after a host grace (ADR 14).
    if (target.userId === room.hostUserId) {
      this.#cancelHostGrace(room);
      await this.#handOverHost(room, at);
    }
    await this.#store.kick(room.id, target.userId);
    room.roles.delete(target.userId);
    const theirs = target.connection;
    if (theirs.roomId === room.id) theirs.roomId = null;
    this.#refuse(theirs, "kicked", "You were removed from this room");
    // Someone in their reconnect grace was last here when their socket closed.
    await this.#removeParticipant(room, target, target.grace?.since ?? at, person(actor));
  }

  /** `mod.stopShare`: their share ends now, and every client stops showing it. */
  async #stopShare(conn: HubConnection, message: ClientMessageOf<"mod.stopShare">) {
    const mod = this.#moderator(conn, "stopShare", message.type);
    if (!mod) return;
    const { room, actor } = mod;
    const target = this.#target(conn, room, actor, message.userId, message.type);
    if (!target) return;
    if (!target.media.share) {
      return this.#refuse(conn, "bad_request", "They aren't sharing", message.type);
    }
    await this.#setMedia(room, target, { ...target.media, share: false }, undefined, person(actor));
  }

  /** `mod.setRole`: promote to mod or demote to member. */
  async #setRole(conn: HubConnection, message: ClientMessageOf<"mod.setRole">) {
    const mod = this.#moderator(conn, "setRole", message.type);
    if (!mod) return;
    const { room, actor } = mod;
    const target = this.#target(conn, room, actor, message.userId, message.type);
    if (!target) return;
    if (target.userId === room.hostUserId) {
      return this.#refuse(
        conn,
        "bad_request",
        "The host stays host until it passes on",
        message.type,
      );
    }
    if (this.#roleOf(room, target.userId) === message.role) return;
    await this.#store.setRole(room.id, target.userId, message.role);
    if (message.role === "mod") room.roles.set(target.userId, "mod");
    else room.roles.delete(target.userId);
    const at = this.#clock.now();
    this.#broadcast(room, { kind: "roleChanged", userId: target.userId, role: message.role }, at);
    this.#sendPendingKnocks(room, target);
    // A promoted mod can answer knocks now; a demoted one may have been the last who could.
    this.#updateKnockers(room);
    this.#feed(room, at, {
      kind: "roleChanged",
      ...person(target),
      role: message.role,
      by: person(actor),
    });
  }

  /** `room.rename`: a new name, validated like a new room's. */
  async #rename(conn: HubConnection, message: ClientMessageOf<"room.rename">) {
    const mod = this.#moderator(conn, "rename", message.type);
    if (!mod) return;
    const { room, actor } = mod;
    const parsed = createRoomInput.shape.name.safeParse(message.name);
    if (!parsed.success) {
      return this.#refuse(
        conn,
        "bad_request",
        `Room names are 1 to ${ROOM_NAME_MAX} characters`,
        message.type,
      );
    }
    const name = parsed.data;
    if (name === room.name) return;
    await this.#store.renameRoom(room.id, name);
    room.name = name;
    this.#broadcast(room, { kind: "renamed", name, by: person(actor) }, this.#clock.now());
    // Room cards show the name.
    if (!room.isPrivate) {
      this.#lobbyChanged({
        roomId: room.id,
        change: "renamed",
        participantCount: room.participants.size,
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Signalling (ADR 1): relayed opaquely, only between two people in the same room

  /**
   * `signal`: pass the payload to `to`, stamped with the sender. Both must be in the room the
   * sender is in over this connection, so someone who left, was kicked or was taken over can't
   * reach anyone there. A recipient in their reconnect grace has no socket, so it's dropped.
   * Over `SIGNAL_RATE_LIMIT` it's refused, so nobody can flood the room through the relay.
   */
  #signal(conn: HubConnection, message: ClientMessageOf<"signal">) {
    const { room, participant: sender } = this.#participantOf(conn);
    if (!room || !sender) {
      return this.#refuse(conn, "forbidden", "Join the room first", message.type);
    }
    const target = room.participants.get(message.to);
    if (!target || target === sender) {
      return this.#refuse(conn, "not_found", "They're not in this room", message.type);
    }
    const { messages, windowMs } = SIGNAL_RATE_LIMIT;
    if (!withinRateLimit(this.#signalSends, sender.userId, messages, windowMs, this.#clock.now())) {
      return this.#refuse(conn, "rate_limited", "Too much signalling; wait a moment", message.type);
    }
    this.#send(target.connection, {
      type: "signal",
      roomId: room.id,
      from: sender.userId,
      payload: message.payload,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Private rooms (ADR 16): knock with the invite link, and the host, a mod or an admin admits

  /** `knock.request`: wait at the private room's door, or walk in if already allowed. */
  async #knock(conn: HubConnection, message: ClientMessageOf<"knock.request">) {
    const caller = conn.caller;
    if (!isSignedIn(caller)) return;
    const stored = await this.#store.findInvitedRoom(message.inviteToken);
    // Every live room is in memory (created: `announce`; after a restart: `#restore`).
    const room = stored && this.#rooms.get(stored.id);
    if (!room) return this.#refuse(conn, "not_found", INVALID_INVITE, message.type);
    const { id: userId, username } = caller.user;
    // Kicked is for good (ADR 15): the link doesn't bring them back, admins included.
    if (await this.#store.isKicked(room.id, userId)) {
      return this.#refuse(conn, "kicked", "You were removed from this room", message.type);
    }
    // The host, an approved member, a mod or an admin: nothing to ask.
    if (await this.#store.findRoomFor(caller, room.id)) {
      return this.#send(conn, { type: "knock.status", roomId: room.id, status: "approved" });
    }
    // Knocking again (a reconnect within the grace, another tab) keeps the same knock, its time
    // and its expiry, now answered on this socket. A tab it moved away from is told so.
    let knock = room.knocks.get(userId);
    if (knock) {
      knock.grace?.cancel();
      knock.grace = undefined;
      if (knock.connection !== conn) {
        this.#send(knock.connection, {
          type: "knock.status",
          roomId: room.id,
          status: "elsewhere",
        });
      }
      knock.connection = conn;
    } else {
      const fresh: PendingKnock = {
        userId,
        username,
        at: this.#clock.now(),
        connection: conn,
        status: "waiting",
        expiry: this.#setTimer(KNOCK_EXPIRY_MS, () => {
          if (this.#rooms.get(room.id) === room && room.knocks.get(userId) === fresh) {
            this.#endKnock(room, fresh, "expired");
          }
        }),
      };
      knock = fresh;
      room.knocks.set(userId, knock);
    }
    knock.status = this.#knockerStatus(room);
    this.#send(conn, { type: "knock.status", roomId: room.id, status: knock.status });
    this.#tellApprovers(room, knockPending(room, knock));
  }

  /**
   * `knock.decide`: admit (approved until the room ends) or deny a pending knock. The queue
   * runs one decision at a time, so the first wins and a later one finds no knock.
   */
  async #decideKnock(conn: HubConnection, message: ClientMessageOf<"knock.decide">) {
    const mod = this.#moderator(conn, "admit", message.type);
    if (!mod) return;
    const { room } = mod;
    const knock = room.knocks.get(message.userId);
    if (!knock) {
      return this.#refuse(conn, "not_found", "Nobody is knocking by that name", message.type);
    }
    let status: KnockStatus = "denied";
    if (message.admit) {
      // Stays pending if the approval can't be stored.
      await this.#store.approve(room.id, knock.userId);
      // Approved all the same: they get in once a spot frees (ADR 21's cap holds).
      status = room.participants.size >= ROOM_CAPACITY ? "room_full" : "approved";
    }
    this.#endKnock(room, knock, status);
  }

  /**
   * `knock` is over: tell its knocker `status` (nothing if they withdrew it), and every approver
   * present that it's gone.
   */
  #endKnock(room: LiveRoom, knock: PendingKnock, status?: KnockStatus): void {
    knock.expiry.cancel();
    knock.grace?.cancel();
    room.knocks.delete(knock.userId);
    if (status) this.#send(knock.connection, { type: "knock.status", roomId: room.id, status });
    this.#tellApprovers(room, { type: "knock.resolved", roomId: room.id, userId: knock.userId });
  }

  /** `room`'s invite link opens nothing now: every pending knock ends, refused as invalid. */
  #invalidateKnocks(room: LiveRoom): void {
    for (const knock of [...room.knocks.values()]) {
      this.#endKnock(room, knock);
      this.#refuse(knock.connection, "not_found", INVALID_INVITE, "knock.request");
    }
  }

  /** The knocks pending from `conn`, in their rooms. */
  #knocksOf(conn: HubConnection): [LiveRoom, PendingKnock][] {
    const userId = conn.caller.user?.id;
    if (!userId) return [];
    return [...this.#rooms.values()].flatMap((room): [LiveRoom, PendingKnock][] => {
      const knock = room.knocks.get(userId);
      return knock?.connection === conn ? [[room, knock]] : [];
    });
  }

  /** `knock.cancel`: withdraw the knocks pending from `conn` now. */
  #withdrawKnocks(conn: HubConnection): void {
    for (const [room, knock] of this.#knocksOf(conn)) this.#endKnock(room, knock);
  }

  /**
   * `conn` closed: its knocks stay pending (approvers see no change) for `RECONNECT_GRACE_MS`,
   * then are withdrawn unless a `knock.request` from their user took them over.
   */
  #holdKnocks(conn: HubConnection): void {
    for (const [room, knock] of this.#knocksOf(conn)) {
      const timer = this.#setTimer(RECONNECT_GRACE_MS, () => {
        if (knock.grace === timer && room.knocks.get(knock.userId) === knock) {
          this.#endKnock(room, knock);
        }
      });
      knock.grace = timer;
    }
  }

  /** What a knocker on `room` waits for: an approver who is connected, or one to arrive. */
  #knockerStatus(room: LiveRoom): PendingKnock["status"] {
    for (const participant of room.participants.values()) {
      if (!participant.grace && this.#approves(room, participant)) return "waiting";
    }
    return "waiting_for_host";
  }

  /** Approvers came or went in `room`: tell its knockers if that changes what they wait for. */
  #updateKnockers(room: LiveRoom): void {
    const status = this.#knockerStatus(room);
    for (const knock of room.knocks.values()) {
      if (knock.status === status) continue;
      knock.status = status;
      this.#send(knock.connection, { type: "knock.status", roomId: room.id, status });
    }
  }

  /** Send `message` to everyone in `room` who may decide knocks: host, mods and admins. */
  #tellApprovers(room: LiveRoom, message: ServerMessage): void {
    for (const participant of room.participants.values()) {
      if (this.#approves(room, participant)) this.#send(participant.connection, message);
    }
  }

  /**
   * `participant` just became able to decide knocks (joined, came back, made mod or host): the
   * knocks already pending, which they missed.
   */
  #sendPendingKnocks(room: LiveRoom, participant: LiveParticipant): void {
    if (!this.#approves(room, participant)) return;
    for (const knock of room.knocks.values()) {
      this.#send(participant.connection, knockPending(room, knock));
    }
  }

  #approves(room: LiveRoom, participant: LiveParticipant): boolean {
    return (
      isAdmin(participant.connection) ||
      ROOM_POWERS[this.#roleOf(room, participant.userId)].has("admit")
    );
  }

  // -------------------------------------------------------------------------------------------
  // Plumbing

  /**
   * The room this connection is in and its sender there, if they are in it over this connection
   * (not one they left, were kicked from, or were taken over from); otherwise nothing.
   */
  #participantOf(conn: HubConnection): { room?: LiveRoom; participant?: LiveParticipant } {
    const userId = conn.caller.user?.id;
    const room = conn.roomId ? this.#rooms.get(conn.roomId) : undefined;
    const participant = userId ? room?.participants.get(userId) : undefined;
    if (!room || !participant || participant.connection !== conn) return {};
    return { room, participant };
  }

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

/** `knock` as its approvers see it. */
function knockPending(room: LiveRoom, knock: PendingKnock): ServerMessage {
  const { userId, username, at } = knock;
  return {
    type: "knock.pending",
    roomId: room.id,
    knock: { userId, username, at: at.toISOString() },
  };
}

/** A site admin: moderation powers in any room (ADR 15). */
function isAdmin(conn: HubConnection): boolean {
  return conn.caller.role === "admin";
}

/** Who `participant` is, for room events and the feed. */
function person(participant: LiveParticipant): FeedPerson {
  return { userId: participant.userId, username: participant.username };
}
