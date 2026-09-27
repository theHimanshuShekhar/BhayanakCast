/**
 * The room page's live state from the realtime socket: `useRoomLive(roomId)` joins the room
 * while mounted and folds `room.snapshot`, `room.event` and `chat.message` messages into
 * `RoomLive` with `applyRoomMessage`. Later tickets extend `RoomLive` (feed, media state, host grace)
 * and the reducer, not the page.
 */
import { useEffect, useState } from "react";
import type { ChatEntry, RoomParticipant, ServerMessage, ServerMessageOf } from "./realtime";
import { getRealtimeClient } from "./realtime-client";
import type { ChatMessage } from "./types";

/** Most chat lines (messages and system lines) the page keeps; older ones scroll away. */
export const CHAT_LINES_KEPT = 200;

export interface RoomLive {
  roomId: string;
  hostUserId: string | null;
  /** In order of arrival. */
  participants: RoomParticipant[];
  /**
   * Oldest first: the snapshot's history, then messages and join/leave system lines as they
   * happen here. System lines are this page's own; history carries messages only.
   */
  chat: ChatMessage[];
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
      hostUserId: message.hostUserId,
      participants: message.participants,
      chat: message.chat.map(chatLine),
    };
  }
  if (message.type === "chat.message") {
    if (message.roomId !== roomId || !state) return state;
    return { ...state, chat: withLine(state.chat, chatLine(message.message)) };
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
  }
}

export interface RoomLiveResult {
  /** Null until the server's snapshot arrives. */
  room: RoomLive | null;
  /** The server's refusal of this page's join (e.g. `not_found`), if any. */
  error: ServerMessageOf<"error"> | null;
  /**
   * The socket dropped and the client is reconnecting (with backoff). `room` is the last
   * known state until the server's fresh snapshot replaces it.
   */
  reconnecting: boolean;
  /** The server's latest refusal of a chat message (e.g. `rate_limited`); a new object each time. */
  chatError: ServerMessageOf<"error"> | null;
}

/**
 * Send a chat message to the room this page is in. False (and nothing sent) while the socket
 * is reconnecting. The message shows up when the server echoes it back as `chat.message`.
 */
export function sendChat(text: string): boolean {
  return getRealtimeClient().send({ type: "chat.send", text });
}

/** Be in `roomId` over the realtime socket while mounted, and follow who is there. */
export function useRoomLive(roomId: string): RoomLiveResult {
  const [result, setResult] = useState<Omit<RoomLiveResult, "reconnecting">>({
    room: null,
    error: null,
    chatError: null,
  });
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
        if (message.re === "room.join") setResult((r) => ({ ...r, error: message }));
        if (message.re === "chat.send") setResult((r) => ({ ...r, chatError: message }));
        return;
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
  }, [roomId]);
  return { ...result, reconnecting };
}
