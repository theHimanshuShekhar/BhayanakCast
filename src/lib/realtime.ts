/**
 * The realtime protocol (ADR 4 addendum): every message on the room socket, as zod
 * discriminated unions on `type`. Client and server both import this module, so it stays
 * free of server-only and browser-only imports (relative imports only: server.prod.ts loads it
 * natively in Node).
 *
 * Conventions for adding messages (spec #3):
 * - `type` is `<area>.<verb>` (`room.join`, `chat.send`), except the `hello`/`welcome` handshake,
 *   `ping`/`pong` and `error`.
 * - Room changes after the snapshot travel as one `room.event` whose `event` is discriminated
 *   on `kind` (`joined`, `left`, later `stateChanged`, `roleChanged`, …).
 * - Timestamps are ISO strings stamped by the server clock; clients never send times (ADR 12).
 * - A breaking change bumps `PROTOCOL_VERSION`; the server refuses a `hello` with another one.
 * - A refused client message gets `error` with a code from `ERROR_CODES` and `re`, the refused
 *   message's type. The server never closes the socket for a bad message.
 */
import { z } from "zod";
import { inviteToken } from "./invites.ts";

export const PROTOCOL_VERSION = 1;

/** The WebSocket endpoint's path on the app server. */
export const REALTIME_PATH = "/ws";

/**
 * Largest client message the server reads, in bytes; bigger frames close the socket. The
 * largest messages are SDP offers: Chromium's with all four slots both ways (mic, camera,
 * screen, share audio: eight m-sections) is about 24 KB, so this leaves room for gathered
 * candidates and codecs added by browser updates (ADR 4 addendum).
 */
export const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;

const roomId = z.string().min(1).max(64);

/**
 * Heartbeats (ADR 9): the client sends `ping` about this often and the server answers `pong`,
 * which keeps idle sockets open through Cloudflare Tunnel.
 */
export const PING_INTERVAL_MS = 25_000;
/**
 * The server closes a socket it hasn't heard from (any frame) for this long, and the client
 * gives up on a server it hasn't heard from for this long and reconnects.
 */
export const IDLE_TIMEOUT_MS = 60_000;
/** The close code the server uses for a socket that went silent past `IDLE_TIMEOUT_MS`. */
export const IDLE_CLOSE_CODE = 4000;
/** The close code the server uses for the sockets of a user an admin banned (after `banned`). */
export const BANNED_CLOSE_CODE = 4001;
/** Longest chat message after trimming, in UTF-16 code units (what an input's maxLength counts). */
export const CHAT_MAX_LENGTH = 500;
/** How many recent chat messages a live room keeps in memory for joiners (ADR 4 addendum). */
export const CHAT_HISTORY_SIZE = 50;
/** Chat rate limit per user: at most `messages` in any `windowMs` (server clock). */
export const CHAT_RATE_LIMIT = { messages: 5, windowMs: 5_000 } as const;
/** The reactions anyone can float on someone's tile; the server refuses anything else. */
export const REACTION_EMOJIS = ["🔥", "💯", "✨", "🎧", "⚡", "🫡"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
/** Reaction rate limit per user: at most `reactions` in any `windowMs` (server clock). */
export const REACTION_RATE_LIMIT = { reactions: 5, windowMs: 3_000 } as const;
/**
 * Signalling rate limit per user: at most `messages` relayed `signal`s in any `windowMs`
 * (server clock). Joining a full room is about 20 steps (a description and ICE candidates,
 * more with TURN) to each of 9 peers, so this leaves twice that for renegotiation while
 * capping a flood at 40 a second.
 */
export const SIGNAL_RATE_LIMIT = { messages: 400, windowMs: 10_000 } as const;
/** How many recent feed entries a live room keeps in memory for joiners. */
export const FEED_HISTORY_SIZE = 50;
/** A knock on a private room nobody decides within this long expires (ADR 16; server clock). */
export const KNOCK_EXPIRY_MS = 10 * 60_000;

/**
 * Someone's mic, camera and screen share, on or off, as announced. A share is on once the
 * server accepts it (3 streamers at most); the browser captures the screen only after that.
 */
export const mediaState = z.object({ mic: z.boolean(), cam: z.boolean(), share: z.boolean() });
export type MediaState = z.infer<typeof mediaState>;
/** Everything off: how everyone arrives (the lobby starts mic and camera off). */
export const MEDIA_OFF: MediaState = { mic: false, cam: false, share: false };

/**
 * The tracks one participant can send each peer, all over one connection per pair (ADR 1
 * addendum): the mic, the camera, the screen share and its tab or system audio.
 */
export const MEDIA_SLOTS = ["mic", "cam", "screen", "screenAudio"] as const;
export type MediaSlot = (typeof MEDIA_SLOTS)[number];

/** An SDP offer or answer, as `RTCSessionDescriptionInit`. */
const sessionDescription = z.object({
  type: z.enum(["offer", "answer", "pranswer", "rollback"]),
  sdp: z.string().max(MAX_CLIENT_MESSAGE_BYTES).optional(),
});
/** An ICE candidate, as `RTCIceCandidateInit`. */
const iceCandidate = z.object({
  candidate: z.string().max(1_024).optional(),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(1_024).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});
const pcSession = z.string().min(1).max(64);
/** The video codecs (MIME types) the sender can decode: the other side sends the best of them. */
const videoCodecs = z.array(z.string().min(1).max(48)).max(16);

/**
 * One WebRTC signalling step between two peers' connections (src/lib/mesh.ts), which the server
 * relays without reading. `session` names the sender's `RTCPeerConnection` for this pair and
 * `peerSession` the recipient's it is talking to, once known: a new `session` means the sender
 * started over (a reload, a rejoin), and a step for an older session of the recipient's is stale.
 */
export const signalPayload = z.discriminatedUnion("kind", [
  /**
   * A new connection's first word when it has no offer yet: a peer that had one to the sender's
   * old page starts over, and one whose offer was lost sends it again.
   */
  z.object({ kind: z.literal("hello"), session: pcSession, codecs: videoCodecs.optional() }),
  z.object({
    kind: z.literal("description"),
    session: pcSession,
    peerSession: pcSession.optional(),
    description: sessionDescription,
    /** Which of the sender's tracks each of its own transceivers (by `mid`) carries. */
    slots: z.record(z.string().max(32), z.enum(MEDIA_SLOTS)).optional(),
    /** The sender's decodable video codecs (ADR 2: the pair uses the best both have). */
    codecs: videoCodecs.optional(),
  }),
  z.object({
    kind: z.literal("candidate"),
    session: pcSession,
    peerSession: pcSession.optional(),
    /** Null: the sender finished gathering. */
    candidate: iceCandidate.nullable(),
  }),
  /**
   * Whether the sender shows the recipient's `slot` track (their camera) right now. While it
   * doesn't, the recipient stops sending that track to the sender (ADR 2 addendum).
   */
  z.object({
    kind: z.literal("visibility"),
    session: pcSession,
    peerSession: pcSession.optional(),
    slot: z.enum(MEDIA_SLOTS),
    visible: z.boolean(),
  }),
]);
export type SignalPayload = z.infer<typeof signalPayload>;

// ---------------------------------------------------------------------------------------------
// Client → server

export const helloMessage = z.object({ type: z.literal("hello"), v: z.number().int() });
export const roomJoinMessage = z.object({ type: z.literal("room.join"), roomId });
export const roomLeaveMessage = z.object({ type: z.literal("room.leave") });
/** Heartbeat; the server answers `pong`. */
export const pingMessage = z.object({ type: z.literal("ping") });
/**
 * Say something in the sender's room. The server trims `text`, refuses it empty or longer than
 * `CHAT_MAX_LENGTH` (`bad_request`) or over `CHAT_RATE_LIMIT` (`rate_limited`), and stamps the
 * time, sender and role itself.
 */
export const chatSendMessage = z.object({ type: z.literal("chat.send"), text: z.string() });
/**
 * The sender's whole media state in their room, sent on each toggle and again after every
 * (re)join. Turning `share` on is refused with `share_limit` when 3 others already share
 * (`MAX_STREAMERS`, ADR 2); the rest of the state still applies. Changes come back to everyone
 * in the room as `stateChanged`.
 */
export const mediaStateMessage = mediaState.extend({ type: z.literal("media.state") });
/**
 * Float `emoji` on `targetUserId`'s tile for everyone in the sender's room. The server refuses
 * a target who isn't in the room (`not_found`) or a sender over `REACTION_RATE_LIMIT`
 * (`rate_limited`). Reactions are never persisted; they only show in the room's feed.
 */
export const reactionSendMessage = z.object({
  type: z.literal("reaction.send"),
  emoji: z.enum(REACTION_EMOJIS),
  targetUserId: z.string().min(1).max(64),
});

const targetUserId = z.string().min(1).max(64);

/**
 * Moderation (ADR 15), in the sender's room, authorised against their role there: host and mods
 * may kick and stop shares, only the host may change roles or rename, and an admin may do all
 * of it in any room. Nobody acts on themselves, and host and mods act only on people below them
 * (a mod on members; the host on mods and members; an admin on anyone, the host included), never
 * on an admin unless they are one. Refusals: `forbidden` (not allowed), `not_found` (the target
 * isn't in the room), `bad_request` (nothing to do: they aren't sharing, the host's role).
 *
 * `mod.kick`: the target leaves at once (no reconnect grace), is told `kicked`, and can't
 * rejoin this room (`room_members.kicked`). Everyone else gets a `kicked` room event.
 */
export const modKickMessage = z.object({ type: z.literal("mod.kick"), userId: targetUserId });
/**
 * Force the target's share off: their stream interval closes, and everyone (them included)
 * gets `stateChanged` with `share: false` and `by`, so every client stops showing it.
 */
export const modStopShareMessage = z.object({
  type: z.literal("mod.stopShare"),
  userId: targetUserId,
});
/** Make the target a mod or a plain member again (host or admin only); `roleChanged` for all. */
export const modSetRoleMessage = z.object({
  type: z.literal("mod.setRole"),
  userId: targetUserId,
  role: z.enum(["mod", "member"]),
});
/**
 * Rename the sender's room (host or admin only). The server trims `name` and refuses it empty
 * or longer than a room name may be (`bad_request`); everyone gets `renamed`.
 */
export const roomRenameMessage = z.object({ type: z.literal("room.rename"), name: z.string() });
/**
 * WebRTC signalling for the peer `to` (ADR 1), relayed to them as `signal` with `from` stamped,
 * only between two people in the same room, the sender over their current connection. Refused
 * otherwise: `forbidden` when the sender isn't in a room here (never joined, left, kicked, taken
 * over), `not_found` when `to` isn't in the sender's room (or is the sender), and
 * `rate_limited` over `SIGNAL_RATE_LIMIT`. Dropped for a
 * recipient in their reconnect grace, who has no socket.
 */
export const signalMessage = z.object({
  type: z.literal("signal"),
  to: z.string().min(1).max(64),
  payload: signalPayload,
});

/**
 * Private rooms (ADR 16): ask to be let into the private room `inviteToken` opens. The server
 * answers `knock.status` (`waiting`, `waiting_for_host` while no host, mod or admin is
 * connected, or `approved` at once for someone already allowed in) and tells the host, mods
 * and admins present `knock.pending`. Sending it again keeps the same knock (its time and
 * expiry) and moves it to this socket: after a reconnect, or from another tab, which is then
 * told `elsewhere`. A knock whose socket closes stays pending for the reconnect grace (30s),
 * then is withdrawn unless knocked again; `knock.cancel` withdraws it at once. Undecided for
 * `KNOCK_EXPIRY_MS`, it expires (`expired`). An unknown token, or a public room's, is refused
 * with `not_found`, and so is a knock still pending when its room ends.
 */
export const knockRequestMessage = z.object({
  type: z.literal("knock.request"),
  inviteToken,
});
/**
 * Admit or deny `userId`'s pending knock on the sender's room (host, mods and admins in it).
 * Admitting approves them until the room ends (`room_members.approved`); either way the
 * knocker gets `knock.status` (`room_full` if admitted into a full room) and every approver
 * present `knock.resolved`. The first decision wins. Refusals: `forbidden` (not an approver
 * here), `not_found` (no such knock pending, e.g. another approver decided it first).
 */
export const knockDecideMessage = z.object({
  type: z.literal("knock.decide"),
  userId: targetUserId,
  admit: z.boolean(),
});
/**
 * Withdraw the knock pending from this socket, if any, at once (the knocker left the waiting
 * screen).
 */
export const knockCancelMessage = z.object({
  type: z.literal("knock.cancel"),
});

export const clientMessage = z.discriminatedUnion("type", [
  helloMessage,
  roomJoinMessage,
  roomLeaveMessage,
  pingMessage,
  chatSendMessage,
  mediaStateMessage,
  reactionSendMessage,
  modKickMessage,
  modStopShareMessage,
  modSetRoleMessage,
  roomRenameMessage,
  signalMessage,
  knockRequestMessage,
  knockDecideMessage,
  knockCancelMessage,
]);
export type ClientMessage = z.infer<typeof clientMessage>;
export type ClientMessageType = ClientMessage["type"];
/** The client message of type `T`. */
export type ClientMessageOf<T extends ClientMessageType> = Extract<ClientMessage, { type: T }>;

// ---------------------------------------------------------------------------------------------
// Server → client

export const ROOM_ROLES = ["host", "mod", "member"] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

/** Someone in a room, as every client in it sees them. */
export const roomParticipant = z.object({
  userId: z.string(),
  username: z.string(),
  role: z.enum(ROOM_ROLES),
  /** When this presence began (server clock), so "longest present" is the same for everyone. */
  joinedAt: z.iso.datetime(),
  /** Their mic, camera and share, as they last announced them. */
  media: mediaState,
});
export type RoomParticipant = z.infer<typeof roomParticipant>;

/** One chat message, as the server stamped it. Never persisted (ADR 4 addendum). */
export const chatEntry = z.object({
  /** Unique within the server process's lifetime. */
  id: z.string(),
  userId: z.string(),
  username: z.string(),
  /** The sender's room role when they sent it. */
  role: z.enum(ROOM_ROLES),
  text: z.string(),
  at: z.iso.datetime(),
});
export type ChatEntry = z.infer<typeof chatEntry>;

/** Someone named in a feed entry. */
const feedPerson = z.object({ userId: z.string(), username: z.string() });

/** What every feed entry has: an id, when, and who it's about (by their name at the time). */
const feedBase = {
  /** Unique within the server process's lifetime. */
  id: z.string(),
  at: z.iso.datetime(),
  userId: z.string(),
  username: z.string(),
};

/**
 * One line of a room's feed: what happened in the room, as the server logged it. Kept in
 * memory for the room's life (the last `FEED_HISTORY_SIZE`), never persisted. Adding a kind:
 * a member here, a `#feed(room, at, …)` call in the hub (src/server/room-hub.ts), and its
 * words in `feedLine` (src/lib/room-live.ts).
 */
export const feedEntry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("joined"), ...feedBase }),
  z.object({ kind: z.literal("left"), ...feedBase }),
  /** `username` reacted with `emoji` on `target`'s tile. */
  z.object({
    kind: z.literal("reaction"),
    ...feedBase,
    emoji: z.enum(REACTION_EMOJIS),
    target: feedPerson,
  }),
  z.object({ kind: z.literal("shareStarted"), ...feedBase }),
  /** `by`: the host or mod who force-stopped it, if it wasn't the streamer. */
  z.object({ kind: z.literal("shareStopped"), ...feedBase, by: feedPerson.optional() }),
  /** Promoted to mod or demoted to member, by `by`. */
  z.object({
    kind: z.literal("roleChanged"),
    ...feedBase,
    role: z.enum(["mod", "member"]),
    by: feedPerson.optional(),
  }),
  /** Became the host. */
  z.object({ kind: z.literal("hostChanged"), ...feedBase }),
  /** Removed from the room by `by`. */
  z.object({ kind: z.literal("kicked"), ...feedBase, by: feedPerson.optional() }),
]);
export type FeedEntry = z.infer<typeof feedEntry>;
export type FeedKind = FeedEntry["kind"];

/** A reaction as the server relays it. */
export const reactionEntry = z.object({
  /** Unique within the server process's lifetime. */
  id: z.string(),
  userId: z.string(),
  username: z.string(),
  targetUserId: z.string(),
  emoji: z.enum(REACTION_EMOJIS),
  at: z.iso.datetime(),
});
export type ReactionEntry = z.infer<typeof reactionEntry>;

export const welcomeMessage = z.object({
  type: z.literal("welcome"),
  v: z.number().int(),
  /** Null for an anonymous (lobby-only) socket (ADR 20). */
  user: z.object({ id: z.string(), username: z.string() }).nullable(),
});

/** Everything about the room the joiner needs, sent to them on join. Later fields are added. */
export const roomSnapshotMessage = z.object({
  type: z.literal("room.snapshot"),
  roomId,
  /** The room's name now (the host can rename it). */
  name: z.string(),
  hostUserId: z.string().nullable(),
  /** In order of arrival. Includes the joiner. */
  participants: z.array(roomParticipant),
  /** The room's last `CHAT_HISTORY_SIZE` chat messages at most, oldest first. */
  chat: z.array(chatEntry),
  /** The room's last `FEED_HISTORY_SIZE` feed entries at most, newest first. */
  feed: z.array(feedEntry),
  /**
   * Set while the host is away (the host grace, ADR 14): when host passes to someone else
   * unless the host returns first. Absent otherwise.
   */
  hostGraceUntil: z.iso.datetime().optional(),
});

export const roomEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("joined"), participant: roomParticipant }),
  z.object({ kind: z.literal("left"), userId: z.string() }),
  /**
   * The host role changed (ADR 14): `hostUserId` is the host now, and `graceUntil` is set
   * while they're away (the host grace: "host reconnecting…") and null once they're back or
   * host has passed on. A new host was a mod or member until now; the previous one is a
   * member now.
   */
  z.object({
    kind: z.literal("hostChanged"),
    hostUserId: z.string().nullable(),
    graceUntil: z.iso.datetime().nullable(),
  }),
  /**
   * Someone's media state changed; sent to them too, which confirms a share start. `by` is set
   * when a host, mod or admin forced it (`mod.stopShare`): their own client turns the share off.
   */
  z.object({
    kind: z.literal("stateChanged"),
    userId: z.string(),
    media: mediaState,
    by: feedPerson.optional(),
  }),
  /** Promoted to mod or demoted to member (`mod.setRole`). */
  z.object({ kind: z.literal("roleChanged"), userId: z.string(), role: z.enum(["mod", "member"]) }),
  /** Removed by a host, mod or admin (`mod.kick`): gone from the room, like `left`. */
  z.object({ kind: z.literal("kicked"), userId: z.string(), by: feedPerson }),
  /** The room has a new name (`room.rename`). */
  z.object({ kind: z.literal("renamed"), name: z.string(), by: feedPerson }),
  /**
   * The room is over: `admin`, an admin ended it (ADR 6). Nobody is in it any more (their sockets
   * stay open for the lobby) and it's a past stream: a join is refused `not_found`. Someone who
   * was in their reconnect grace then gets this once instead, as the answer to their rejoin.
   */
  z.object({ kind: z.literal("ended"), reason: z.enum(["admin"]) }),
]);
export type RoomEvent = z.infer<typeof roomEvent>;

/** A change to a room, sent to everyone in it except whoever caused it when they already know. */
export const roomEventMessage = z.object({
  type: z.literal("room.event"),
  roomId,
  at: z.iso.datetime(),
  event: roomEvent,
});

/**
 * The lobby channel (ADR 20): list-level facts every socket gets, signed in or not. Never
 * anything about private rooms.
 */
export const lobbySnapshotMessage = z.object({
  type: z.literal("lobby.snapshot"),
  /** Online users: distinct signed-in users with at least one open socket. */
  online: z.number().int().min(0),
});

/**
 * `ended`: the room sat empty for 5 minutes (ADR 14) or an admin ended it, and is a past stream
 * now.
 * `host`: its host changed (handover, or an empty room's joiner), so room cards' host is stale.
 * `thumbnail`: a streamer's screen thumbnail was replaced (ADR 10), so cards' images are stale.
 */
export const LOBBY_ROOM_CHANGES = [
  "created",
  "ended",
  "count",
  "streamers",
  "renamed",
  "host",
  "thumbnail",
] as const;

/**
 * A public live room that was created, ended or renamed, or whose participant count, streamers
 * or host
 * changed.
 */
export const lobbyRoomChange = z.object({
  roomId,
  change: z.enum(LOBBY_ROOM_CHANGES),
  participantCount: z.number().int().min(0),
});
export type LobbyRoomChange = z.infer<typeof lobbyRoomChange>;

/** The online count changed, or a public room did (then `room` says which), or both. */
export const lobbyChangedMessage = z.object({
  type: z.literal("lobby.changed"),
  online: z.number().int().min(0),
  room: lobbyRoomChange.optional(),
});

/** A chat message, sent to everyone in the room (the sender included, as confirmation). */
export const chatMessageMessage = z.object({
  type: z.literal("chat.message"),
  roomId,
  message: chatEntry,
});

/** A reaction, sent to everyone in the room (the sender included, as confirmation). */
export const reactionMessage = z.object({
  type: z.literal("reaction"),
  roomId,
  reaction: reactionEntry,
});

/** Signalling from `from`, who is in the same room (`signal`). */
export const signalRelayMessage = z.object({
  type: z.literal("signal"),
  roomId,
  from: z.string(),
  payload: signalPayload,
});

/** A new feed entry, sent to everyone in the room. */
export const feedEntryMessage = z.object({
  type: z.literal("feed.entry"),
  roomId,
  entry: feedEntry,
});

/** Someone knocking on a private room, as its approvers see them. */
export const knockEntry = z.object({
  userId: z.string(),
  username: z.string(),
  /** When they knocked (server clock). */
  at: z.iso.datetime(),
});
export type KnockEntry = z.infer<typeof knockEntry>;

/** Someone knocked (`knock.request`): sent to the host, mods and admins present in the room. */
export const knockPendingMessage = z.object({
  type: z.literal("knock.pending"),
  roomId,
  knock: knockEntry,
});

/**
 * `userId`'s knock is gone (decided, withdrawn, expired, or its socket closed and nobody knocked
 * again within the reconnect grace): sent to every approver present.
 */
export const knockResolvedMessage = z.object({
  type: z.literal("knock.resolved"),
  roomId,
  userId: z.string(),
});

/**
 * Where a knocker stands: `waiting` for an approver, `waiting_for_host` (no host, mod or admin
 * is connected; it turns `waiting` when one arrives, and back when the last goes), `approved`
 * (send `room.join` now; the approval lasts until the room ends), `room_full` (approved, but
 * the room is full: `room.join` is refused `room_full` until a spot frees), `denied`,
 * `expired` (undecided for `KNOCK_EXPIRY_MS`; knock again), or `elsewhere` (the same user
 * knocked from another socket, which gets the answer now; knocking here takes it back).
 */
export const KNOCK_STATUSES = [
  "waiting",
  "waiting_for_host",
  "approved",
  "room_full",
  "denied",
  "expired",
  "elsewhere",
] as const;
export type KnockStatus = (typeof KNOCK_STATUSES)[number];

/** The knocker's answer to `knock.request`, and again once their knock is decided. */
export const knockStatusMessage = z.object({
  type: z.literal("knock.status"),
  roomId,
  status: z.enum(KNOCK_STATUSES),
});

export const ERROR_CODES = [
  /** Not valid JSON, not a known message, or not allowed at this point (e.g. before `hello`). */
  "bad_request",
  /** `hello` carried a protocol version this server doesn't speak. */
  "unsupported_version",
  "not_found",
  /** `room.join` refused: the room already holds `ROOM_CAPACITY` people (grace included). */
  "room_full",
  "share_limit",
  "forbidden",
  "rate_limited",
  /**
   * Unprompted (no `re`): the same user joined a room from another connection, so this one is
   * no longer in its room (ADR 21). It stays open for the lobby.
   */
  "taken_over",
  /**
   * Unprompted (no `re`): a host, mod or admin removed this connection from its room. As the
   * answer to `room.join`: this user was kicked from that room and can't come back (ADR 15).
   */
  "kicked",
  /**
   * Unprompted (no `re`): an admin banned this user (ADR 6). `message` is the ban notice (its
   * reason and end), and the server then closes every socket of theirs (`BANNED_CLOSE_CODE`).
   */
  "banned",
  /** The server failed; the request may be retried. */
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorMessage = z.object({
  type: z.literal("error"),
  code: z.enum(ERROR_CODES),
  message: z.string(),
  /** The type of the client message that was refused, when there was one. */
  re: z.string().optional(),
});

/** The answer to `ping`. */
export const pongMessage = z.object({ type: z.literal("pong") });

export const serverMessage = z.discriminatedUnion("type", [
  welcomeMessage,
  lobbySnapshotMessage,
  lobbyChangedMessage,
  roomSnapshotMessage,
  roomEventMessage,
  chatMessageMessage,
  reactionMessage,
  feedEntryMessage,
  signalRelayMessage,
  errorMessage,
  pongMessage,
  knockPendingMessage,
  knockResolvedMessage,
  knockStatusMessage,
]);
export type ServerMessage = z.infer<typeof serverMessage>;
export type ServerMessageType = ServerMessage["type"];
/** The server message of type `T`. */
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

// ---------------------------------------------------------------------------------------------
// Parsing

export type Parsed<T> = { ok: true; message: T } | { ok: false; error: string; type?: string };

function parseWith<T>(schema: z.ZodType<T>, data: unknown): Parsed<T> {
  let json: unknown;
  try {
    json = typeof data === "string" ? JSON.parse(data) : data;
  } catch {
    return { ok: false, error: "Message is not valid JSON" };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, message: result.data };
  const type =
    typeof json === "object" && json !== null && "type" in json && typeof json.type === "string"
      ? json.type.slice(0, 64)
      : undefined;
  return { ok: false, error: z.prettifyError(result.error), type };
}

/** Parse a raw frame (a JSON string) or an already-decoded value from a client. */
export function parseClientMessage(data: unknown): Parsed<ClientMessage> {
  return parseWith(clientMessage, data);
}

/** Parse a raw frame (a JSON string) or an already-decoded value from the server. */
export function parseServerMessage(data: unknown): Parsed<ServerMessage> {
  return parseWith(serverMessage, data);
}
