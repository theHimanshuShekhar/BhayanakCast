/**
 * The room page's live state from the realtime socket: `useRoomLive(roomId)` joins the room
 * while mounted and folds `room.snapshot`, `room.event`, `chat.message` and `feed.entry`
 * messages into `RoomLive` with `applyRoomMessage`. `useRoomReactions(roomId)` follows the
 * reactions floating on tiles. Later tickets extend `RoomLive` (host grace, …) and the reducer,
 * not the page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChatEntry,
  FEED_HISTORY_SIZE,
  type FeedEntry,
  MEDIA_OFF,
  type MediaState,
  type ReactionEmoji,
  type RoomParticipant,
  type RoomRole,
  type ServerMessage,
  type ServerMessageOf,
} from "./realtime";
import { getRealtimeClient } from "./realtime-client";
import type { ActivityItem, ChatMessage } from "./types";

/** Most chat lines (messages and system lines) the page keeps; older ones scroll away. */
export const CHAT_LINES_KEPT = 200;

export interface RoomLive {
  roomId: string;
  /** The room's name now: the host or an admin can rename it. */
  name: string;
  hostUserId: string | null;
  /** In order of arrival. */
  participants: RoomParticipant[];
  /**
   * Oldest first: the snapshot's history, then messages and join/leave system lines as they
   * happen here. System lines are this page's own; history carries messages only.
   */
  chat: ChatMessage[];
  /**
   * Set while the host is away (the host grace, ADR 14: "host reconnecting…"): when host
   * passes to someone else unless they return first.
   */
  hostGraceUntil?: string;
  /**
   * What happened in the room, newest first: the snapshot's recent entries, then new ones as
   * the server logs them (at most `FEED_HISTORY_SIZE`).
   */
  feed: FeedEntry[];
}

const by = (who: { username: string } | undefined) => (who ? ` by ${who.username}` : "");

/** A feed entry in words, for the feed tab: who it's about, and what happened. */
export function feedLine(entry: FeedEntry): ActivityItem {
  const item = (what: string): ActivityItem => ({
    id: entry.id,
    who: entry.username,
    what,
    at: entry.at,
  });
  switch (entry.kind) {
    case "joined":
      return item("joined");
    case "left":
      return item("left");
    case "reaction":
      return item(
        entry.target.userId === entry.userId
          ? `reacted ${entry.emoji}`
          : `reacted ${entry.emoji} to ${entry.target.username}`,
      );
    case "shareStarted":
      return item("started sharing");
    case "shareStopped":
      return item(entry.by ? `had their share stopped${by(entry.by)}` : "stopped sharing");
    case "roleChanged":
      return item(
        entry.role === "mod"
          ? `was made a mod${by(entry.by)}`
          : `is no longer a mod${by(entry.by)}`,
      );
    case "hostChanged":
      return item("is now the host");
    case "kicked":
      return item(`was removed${by(entry.by)}`);
  }
}

const chatLine = (entry: ChatEntry): ChatMessage => ({
  id: entry.id,
  userId: entry.userId,
  user: entry.username,
  role: entry.role,
  text: entry.text,
  at: entry.at,
});

const withLine = (chat: ChatMessage[], line: ChatMessage) =>
  [...chat, line].slice(-CHAT_LINES_KEPT);

/** `state` after `message`, for the room `roomId`. Messages about other rooms change nothing. */
export function applyRoomMessage(
  state: RoomLive | null,
  roomId: string,
  message: ServerMessage,
): RoomLive | null {
  if (message.type === "room.snapshot") {
    if (message.roomId !== roomId) return state;
    return {
      roomId,
      name: message.name,
      hostUserId: message.hostUserId,
      participants: message.participants,
      chat: message.chat.map(chatLine),
      feed: message.feed,
      ...(message.hostGraceUntil ? { hostGraceUntil: message.hostGraceUntil } : {}),
    };
  }
  if (message.type === "chat.message") {
    if (message.roomId !== roomId || !state) return state;
    return { ...state, chat: withLine(state.chat, chatLine(message.message)) };
  }
  if (message.type === "feed.entry") {
    if (message.roomId !== roomId || !state) return state;
    return { ...state, feed: [message.entry, ...state.feed].slice(0, FEED_HISTORY_SIZE) };
  }
  if (message.type !== "room.event" || message.roomId !== roomId || !state) return state;
  const { event, at } = message;
  switch (event.kind) {
    case "joined": {
      const { userId, username } = event.participant;
      const others = state.participants.filter((p) => p.userId !== userId);
      return {
        ...state,
        participants: [...others, event.participant],
        chat: withLine(state.chat, {
          id: `joined:${userId}:${at}`,
          system: true,
          text: `${username} joined`,
          at,
        }),
      };
    }
    case "left": {
      const leaving = state.participants.find((p) => p.userId === event.userId);
      return {
        ...state,
        participants: state.participants.filter((p) => p.userId !== event.userId),
        chat: leaving
          ? withLine(state.chat, {
              id: `left:${event.userId}:${at}`,
              system: true,
              text: `${leaving.username} left`,
              at,
            })
          : state.chat,
      };
    }
    case "stateChanged":
      return {
        ...state,
        participants: state.participants.map((p) =>
          p.userId === event.userId ? { ...p, media: event.media } : p,
        ),
      };
    case "hostChanged":
      return withHost(state, event.hostUserId, event.graceUntil, at);
    case "roleChanged":
      return {
        ...state,
        participants: state.participants.map((p) =>
          p.userId === event.userId ? { ...p, role: event.role } : p,
        ),
      };
    case "kicked": {
      const kicked = state.participants.find((p) => p.userId === event.userId);
      return {
        ...state,
        participants: state.participants.filter((p) => p.userId !== event.userId),
        chat: kicked
          ? withLine(state.chat, {
              id: `kicked:${event.userId}:${at}`,
              system: true,
              text: `${kicked.username} was removed by ${event.by.username}`,
              at,
            })
          : state.chat,
      };
    }
    case "renamed":
      return {
        ...state,
        name: event.name,
        chat: withLine(state.chat, {
          id: `renamed:${at}`,
          system: true,
          text: `${event.by.username} renamed the room to ${event.name}`,
          at,
        }),
      };
    case "ended":
      // The page leaves (`RoomLiveResult.ended`); the last state stays until it does.
      return state;
  }
}

/**
 * Send a moderation command (ADR 15) for the room this page is in; the server checks the
 * sender's role. False (and nothing sent) while the socket is reconnecting. The change shows up
 * when the server broadcasts it; a refusal comes back as `moderationError`.
 */
export function moderate(
  command:
    | { type: "mod.kick"; userId: string }
    | { type: "mod.stopShare"; userId: string }
    | { type: "mod.setRole"; userId: string; role: "mod" | "member" }
    | { type: "room.rename"; name: string },
): boolean {
  return getRealtimeClient().send(command);
}

const MODERATION_MESSAGES: ReadonlySet<string> = new Set([
  "mod.kick",
  "mod.stopShare",
  "mod.setRole",
  "room.rename",
  // Admitting or denying a knock (./knock-live.ts; the room page's knock toasts).
  "knock.decide",
]);

/** `state` with `hostUserId` as host (the previous one a member now), away until `graceUntil`. */
function withHost(
  state: RoomLive,
  hostUserId: string | null,
  graceUntil: string | null,
  at: string,
): RoomLive {
  const { hostGraceUntil: _, ...rest } = state;
  const participants = state.participants.map((p): RoomParticipant => {
    const role: RoomRole = p.userId === hostUserId ? "host" : p.role === "host" ? "member" : p.role;
    return role === p.role ? p : { ...p, role };
  });
  const newHost =
    hostUserId !== state.hostUserId ? participants.find((p) => p.userId === hostUserId) : undefined;
  return {
    ...rest,
    hostUserId,
    participants,
    ...(graceUntil ? { hostGraceUntil: graceUntil } : {}),
    chat: newHost
      ? withLine(state.chat, {
          id: `host:${newHost.userId}:${at}`,
          system: true,
          text: `${newHost.username} is the host now`,
          at,
        })
      : state.chat,
  };
}

export interface RoomLiveResult {
  /** Null until the server's snapshot arrives. */
  room: RoomLive | null;
  /**
   * Why this page isn't (or is no longer) in the room, if it isn't: the server's refusal of its
   * join (`not_found`; `room_full`, which the realtime client keeps retrying until a snapshot
   * clears it; `kicked`), `taken_over` once the same user joined a room from another tab or
   * device, or `kicked` once a host, mod or admin removed them.
   */
  error: ServerMessageOf<"error"> | null;
  /** An admin ended the room (ADR 6): nobody is in it any more. */
  ended: boolean;
  /**
   * The socket dropped and the client is reconnecting (with backoff). `room` is the last
   * known state until the server's fresh snapshot replaces it.
   */
  reconnecting: boolean;
  /** The server's latest refusal of a chat message (e.g. `rate_limited`); a new object each time. */
  chatError: ServerMessageOf<"error"> | null;
  /**
   * This page's own mic, camera and share: what it last asked for, so the controls answer at
   * once. The room's participants carry what the server accepted. A refused share start
   * (`share_limit`) turns `share` back off.
   */
  media: MediaState;
  /**
   * Turn this page's mic, camera or share on or off (announced to the room): the new state, or
   * a function of the latest one (for changes decided after an await).
   */
  setMedia: (media: MediaState | ((current: MediaState) => MediaState)) => void;
  /**
   * The server's latest refusal of a media change (e.g. `share_limit`), or word that a host,
   * mod or admin stopped this page's share; a new object each time.
   */
  mediaError: ServerMessageOf<"error"> | null;
  /** The server's latest refusal of a moderation command (`moderate`); a new object each time. */
  moderationError: ServerMessageOf<"error"> | null;
}

type RoomLiveState = Pick<
  RoomLiveResult,
  "room" | "error" | "ended" | "chatError" | "media" | "mediaError" | "moderationError"
>;

/**
 * Send a chat message to the room this page is in. False (and nothing sent) while the socket
 * is reconnecting. The message shows up when the server echoes it back as `chat.message`.
 */
export function sendChat(text: string): boolean {
  return getRealtimeClient().send({ type: "chat.send", text });
}

/**
 * Float `emoji` on `targetUserId`'s tile for everyone in the room. False (and nothing sent)
 * while the socket is reconnecting. It floats here too when the server relays it back.
 */
export function sendReaction(emoji: ReactionEmoji, targetUserId: string): boolean {
  return getRealtimeClient().send({ type: "reaction.send", emoji, targetUserId });
}

/** How long a reaction floats on a tile (the `bc-float` animation's length). */
export const REACTION_FLOAT_MS = 2_400;

/** A reaction floating on `targetUserId`'s tile, drifting `dx` pixels sideways. */
export interface FloatingReaction {
  id: string;
  emoji: string;
  targetUserId: string;
  dx: number;
}

/** The reactions currently floating in `roomId`, as the server relays them. */
export function useRoomReactions(roomId: string): FloatingReaction[] {
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsubscribe = getRealtimeClient().subscribe((message) => {
      if (message.type !== "reaction" || message.roomId !== roomId) return;
      const { id, emoji, targetUserId } = message.reaction;
      const floating = { id, emoji, targetUserId, dx: (Math.random() - 0.5) * 60 };
      setReactions((rs) => [...rs, floating]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setReactions((rs) => rs.filter((r) => r.id !== id));
      }, REACTION_FLOAT_MS);
      timers.add(timer);
    });
    return () => {
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
      setReactions([]);
    };
  }, [roomId]);
  return reactions;
}

/**
 * Be in `roomId` over the realtime socket while mounted, and follow who is there. `meId` (the
 * signed-in user) lets the page hear that a host, mod or admin stopped its share.
 * `initialMedia` is the mic and camera chosen in the lobby, announced with the join.
 */
export function useRoomLive(
  roomId: string,
  meId: string | null = null,
  initialMedia: MediaState = MEDIA_OFF,
): RoomLiveResult {
  const [result, setResult] = useState<RoomLiveState>({
    room: null,
    error: null,
    ended: false,
    chatError: null,
    // What the lobby chose (mic and camera start off there); nobody arrives sharing.
    media: { ...initialMedia, share: false },
    mediaError: null,
    moderationError: null,
  });
  // The media this page wants, re-announced after every (re)join: a reconnect keeps its share
  // (and stream interval) going, while a reloaded page goes through the lobby again.
  const media = useRef<MediaState>({ ...initialMedia, share: false });
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    const client = getRealtimeClient();
    setReconnecting(client.status === "reconnecting");
    return client.onStatus((status) => setReconnecting(status === "reconnecting"));
  }, []);
  useEffect(() => {
    const client = getRealtimeClient();
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "error") {
        if (
          message.re === "room.join" ||
          message.code === "taken_over" ||
          (message.code === "kicked" && !message.re)
        ) {
          setResult((r) => ({ ...r, error: message }));
        }
        if (message.re === "chat.send") setResult((r) => ({ ...r, chatError: message }));
        // A knock someone else decided first (or that went away) is no news: it's gone here too.
        const knockGone = message.re === "knock.decide" && message.code === "not_found";
        if (message.re && MODERATION_MESSAGES.has(message.re) && !knockGone) {
          setResult((r) => ({ ...r, moderationError: message }));
        }
        if (message.re === "media.state") {
          if (message.code === "share_limit") media.current = { ...media.current, share: false };
          setResult((r) => ({ ...r, media: media.current, mediaError: message }));
        }
        return;
      }
      if (message.type === "room.snapshot" && message.roomId === roomId) {
        client.send({ type: "media.state", ...media.current });
      }
      if (
        message.type === "room.event" &&
        message.roomId === roomId &&
        message.event.kind === "ended"
      ) {
        setResult((r) => ({ ...r, ended: true }));
        return;
      }
      if (
        message.type === "room.event" &&
        message.roomId === roomId &&
        message.event.kind === "stateChanged" &&
        message.event.by &&
        message.event.userId === meId &&
        !message.event.media.share
      ) {
        // A host, mod or admin stopped this page's share: it stays off (ADR 15).
        media.current = { ...media.current, share: false };
        const stopped: ServerMessageOf<"error"> = {
          type: "error",
          code: "forbidden",
          message: `${message.event.by.username} stopped your share`,
        };
        setResult((r) => ({ ...r, media: media.current, mediaError: stopped }));
      }
      setResult((r) => {
        const room = applyRoomMessage(r.room, roomId, message);
        return room === r.room ? r : { ...r, room, error: null };
      });
    });
    client.joinRoom(roomId);
    return () => {
      unsubscribe();
      client.leaveRoom(roomId);
    };
  }, [roomId, meId]);
  const setMedia = useCallback((change: MediaState | ((current: MediaState) => MediaState)) => {
    const next = typeof change === "function" ? change(media.current) : change;
    if (next === media.current) return;
    media.current = next;
    setResult((r) => ({ ...r, media: next }));
    // While reconnecting it goes out with the re-join instead.
    getRealtimeClient().send({ type: "media.state", ...next });
  }, []);
  return { ...result, reconnecting, setMedia };
}

const enteredKey = (roomId: string) => `bc.entered.${roomId}`;

/**
 * This tab went through the lobby into `roomId` and hasn't left it since, so a reload goes
 * straight back in (a reload within the reconnect grace isn't leaving, ADR 12). Per tab
 * (sessionStorage); false wherever storage is unavailable.
 */
export function wasInRoom(roomId: string): boolean {
  try {
    return window.sessionStorage.getItem(enteredKey(roomId)) === "1";
  } catch {
    return false;
  }
}

/** Remember (on "Enter room") or forget (leave, back, kicked, taken over, ended) `roomId`. */
export function markInRoom(roomId: string, inRoom: boolean): void {
  try {
    if (inRoom) window.sessionStorage.setItem(enteredKey(roomId), "1");
    else window.sessionStorage.removeItem(enteredKey(roomId));
  } catch {
    // Blocked storage: a reload just shows the lobby again.
  }
}
