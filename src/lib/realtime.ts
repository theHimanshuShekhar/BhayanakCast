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

export const PROTOCOL_VERSION = 1;

/** The WebSocket endpoint's path on the app server. */
export const REALTIME_PATH = "/ws";

/** Largest client message the server reads, in bytes; bigger frames close the socket. */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;

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
/** Longest chat message after trimming, in UTF-16 code units (what an input's maxLength counts). */
export const CHAT_MAX_LENGTH = 500;
/** How many recent chat messages a live room keeps in memory for joiners (ADR 4 addendum). */
export const CHAT_HISTORY_SIZE = 50;
/** Chat rate limit per user: at most `messages` in any `windowMs` (server clock). */
export const CHAT_RATE_LIMIT = { messages: 5, windowMs: 5_000 } as const;

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

export const clientMessage = z.discriminatedUnion("type", [
  helloMessage,
  roomJoinMessage,
  roomLeaveMessage,
  pingMessage,
  chatSendMessage,
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
  hostUserId: z.string().nullable(),
  /** In order of arrival. Includes the joiner. */
  participants: z.array(roomParticipant),
  /** The room's last `CHAT_HISTORY_SIZE` chat messages at most, oldest first. */
  chat: z.array(chatEntry),
});

export const roomEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("joined"), participant: roomParticipant }),
  z.object({ kind: z.literal("left"), userId: z.string() }),
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

export const LOBBY_ROOM_CHANGES = ["created", "ended", "count"] as const;

/** A public live room that was created, ended, or whose participant count changed. */
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
  "kicked",
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
  errorMessage,
  pongMessage,
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
