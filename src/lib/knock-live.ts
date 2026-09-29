/**
 * Knocking on a private room from its invite link (ADR 16), over the realtime socket.
 * `useKnock(inviteToken)` sends `knock.request` when asked (again after every reconnect until
 * decided) and folds the answers into `KnockState` with `applyKnockMessage`. Approvers answer
 * knocks from the room page (src/components/room/knock-toasts.tsx).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KnockStatus, ServerMessage } from "./realtime";
import { getRealtimeClient } from "./realtime-client";

/**
 * `idle` until the user knocks, `knocking` until the server answers, then the server's
 * `knock.status` for the room; `invalid` if the link no longer opens a live private room.
 */
export type KnockState =
  | { status: "idle" | "knocking" | "invalid" }
  | { status: KnockStatus; roomId: string }
  | { status: "error"; message: string };

/** `state` after `message`: the knock's answers and refusals, nothing else. */
export function applyKnockMessage(state: KnockState, message: ServerMessage): KnockState {
  if (message.type === "knock.status") return { status: message.status, roomId: message.roomId };
  if (message.type === "error" && message.re === "knock.request") {
    return message.code === "not_found"
      ? { status: "invalid" }
      : { status: "error", message: message.message };
  }
  return state;
}

/** Still waiting on the server or an approver: a reconnect sends the knock again. */
const undecided = (state: KnockState) => state.status === "knocking" || state.status === "waiting";

/** Knock on the private room `inviteToken` opens, and follow the answer. */
export function useKnock(inviteToken: string): { state: KnockState; knock: () => void } {
  const [state, setState] = useState<KnockState>({ status: "idle" });
  const current = useRef(state);
  const update = useCallback((next: KnockState) => {
    current.current = next;
    setState(next);
  }, []);
  useEffect(() => {
    const client = getRealtimeClient();
    return client.subscribe((message) => {
      if (message.type === "welcome" && undecided(current.current)) {
        client.send({ type: "knock.request", inviteToken });
        return;
      }
      const next = applyKnockMessage(current.current, message);
      if (next !== current.current) update(next);
    });
  }, [inviteToken, update]);
  const knock = useCallback(() => {
    update({ status: "knocking" });
    const client = getRealtimeClient();
    client.start();
    // Not connected yet: it goes out once welcomed (above).
    client.send({ type: "knock.request", inviteToken });
  }, [inviteToken, update]);
  return { state, knock };
}
