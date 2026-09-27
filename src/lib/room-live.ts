/**
 * The room page's live state from the realtime socket: `useRoomLive(roomId)` joins the room
 * while mounted and folds `room.snapshot` and `room.event` messages into `RoomLive` with
 * `applyRoomMessage`. Later tickets extend `RoomLive` (chat, feed, media state, host grace)
 * and the reducer, not the page.
 */
import { useEffect, useState } from "react";
import type { RoomParticipant, ServerMessage, ServerMessageOf } from "./realtime";
import { getRealtimeClient } from "./realtime-client";

export interface RoomLive {
  roomId: string;
  hostUserId: string | null;
  /** In order of arrival. */
  participants: RoomParticipant[];
}

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
    };
  }
  if (message.type !== "room.event" || message.roomId !== roomId || !state) return state;
  const { event } = message;
  switch (event.kind) {
    case "joined": {
      const others = state.participants.filter((p) => p.userId !== event.participant.userId);
      return { ...state, participants: [...others, event.participant] };
    }
    case "left":
      return {
        ...state,
        participants: state.participants.filter((p) => p.userId !== event.userId),
      };
  }
}

export interface RoomLiveResult {
  /** Null until the server's snapshot arrives. */
  room: RoomLive | null;
  /** The server's refusal of this page's join (e.g. `not_found`), if any. */
  error: ServerMessageOf<"error"> | null;
}

/** Be in `roomId` over the realtime socket while mounted, and follow who is there. */
export function useRoomLive(roomId: string): RoomLiveResult {
  const [result, setResult] = useState<RoomLiveResult>({ room: null, error: null });
  useEffect(() => {
    const client = getRealtimeClient();
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "error") {
        if (message.re === "room.join") setResult((r) => ({ ...r, error: message }));
        return;
      }
      setResult((r) => {
        const room = applyRoomMessage(r.room, roomId, message);
        return room === r.room ? r : { room, error: null };
      });
    });
    client.joinRoom(roomId);
    return () => {
      unsubscribe();
      client.leaveRoom(roomId);
    };
  }, [roomId]);
  return result;
}
