/**
 * Knocking on a private room from its invite link (ADR 16), over the realtime socket.
 * `useKnock(inviteToken)` sends `knock.request` when asked (again after every reconnect until
 * decided), withdraws it (`knock.cancel`) when the waiting screen goes away undecided, and
 * folds the answers into `KnockState` with `applyKnockMessage`. Approvers follow the knocks
 * pending on their room with `usePendingKnocks` and answer with `decideKnock` (the room page's
 * knock toasts and people tab).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KnockEntry, KnockStatus, ServerMessage } from "./realtime";
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
const undecided = (state: KnockState) =>
  state.status === "knocking" || state.status === "waiting" || state.status === "waiting_for_host";

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
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "welcome" && undecided(current.current)) {
        client.send({ type: "knock.request", inviteToken });
        return;
      }
      const next = applyKnockMessage(current.current, message);
      if (next !== current.current) update(next);
    });
    return () => {
      unsubscribe();
      // Leaving the waiting screen withdraws the knock (a closed socket does too).
      if (undecided(current.current)) client.send({ type: "knock.cancel" });
    };
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

/**
 * `knocks` (pending on `roomId`, oldest first) after `message`. A snapshot starts over: the
 * server follows it with every knock still pending.
 */
export function applyPendingKnock(
  knocks: KnockEntry[],
  roomId: string,
  message: ServerMessage,
): KnockEntry[] {
  if (!("roomId" in message) || message.roomId !== roomId) return knocks;
  switch (message.type) {
    case "room.snapshot":
      return knocks.length === 0 ? knocks : [];
    case "knock.pending": {
      // The same knock again (they reconnected) stays where it was.
      const at = knocks.findIndex((k) => k.userId === message.knock.userId);
      if (at === -1) return [...knocks, message.knock];
      return knocks.map((k, i) => (i === at ? message.knock : k));
    }
    case "knock.resolved":
      return knocks.some((k) => k.userId === message.userId)
        ? knocks.filter((k) => k.userId !== message.userId)
        : knocks;
    default:
      return knocks;
  }
}

/** The knocks pending on `roomId`, as the server tells its approvers (nothing for others). */
export function usePendingKnocks(roomId: string): KnockEntry[] {
  const [knocks, setKnocks] = useState<KnockEntry[]>([]);
  useEffect(
    () =>
      getRealtimeClient().subscribe((message) =>
        setKnocks((current) => applyPendingKnock(current, roomId, message)),
      ),
    [roomId],
  );
  return knocks;
}

/**
 * Admit or deny `userId`'s knock. The knock goes away (everywhere) when the server says it
 * was handled, by anyone.
 */
export function decideKnock(userId: string, admit: boolean): void {
  getRealtimeClient().send({ type: "knock.decide", userId, admit });
}
