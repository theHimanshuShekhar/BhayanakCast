/**
 * The room page's peer-to-peer media (spec #4): `useRoomMesh` runs this page's Mesh (./mesh.ts)
 * while it is in the room, relays its signalling over the realtime socket, sends this page's
 * mic, and reports everyone else's tracks. `useSpeakers` measures who is
 * speaking (./speaking.ts).
 *
 * Leaving (unmount) or losing the room (`active` false: taken over, kicked, the room gone)
 * closes every peer connection. The page's own tracks belong to ./local-media.ts, which the
 * room releases at the same moments.
 */
import { useEffect, useRef, useState } from "react";
import { Mesh } from "./mesh";
import type { MediaSlot, RoomParticipant } from "./realtime";
import { getRealtimeClient } from "./realtime-client";
import { speakingContext, watchSpeaking } from "./speaking";

/** One peer's tracks, by slot. */
export type PeerTracks = Partial<Record<MediaSlot, MediaStreamTrack>>;

export interface RoomMesh {
  /** Everyone else's tracks, by user id. */
  remote: Record<string, PeerTracks>;
}

/**
 * The Mesh for `roomId` as `meId` while `active`: it connects to everyone in `roster` (the
 * room's people from the socket) and sends them `mic` (null: nothing).
 */
export function useRoomMesh(
  roomId: string,
  meId: string | null,
  roster: readonly RoomParticipant[] | undefined,
  mic: MediaStreamTrack | null,
  active: boolean,
): RoomMesh {
  const mesh = useRef<Mesh | null>(null);
  const [remote, setRemote] = useState<Record<string, PeerTracks>>({});
  // The latest roster and mic, for a Mesh made after they last changed.
  const latest = useRef({ roster, mic });
  latest.current = { roster, mic };

  useEffect(() => {
    if (!meId || !active) return;
    const client = getRealtimeClient();
    const current = new Mesh({
      selfId: meId,
      // Dropped while the socket reconnects: established pairs keep their media meanwhile.
      send: (to, payload) => void client.send({ type: "signal", to, payload }),
    });
    mesh.current = current;
    const unsubscribeMesh = current.subscribe((event) => {
      if (event.type === "track") {
        setRemote((r) => ({
          ...r,
          [event.userId]: { ...r[event.userId], [event.slot]: event.track },
        }));
      } else if (event.type === "closed") {
        // TODO(#37, #38): per-peer connection state (`state` events) for "can't connect".
        setRemote(({ [event.userId]: _, ...rest }) => rest);
      }
    });
    const unsubscribeSocket = client.subscribe((message) => {
      if (message.type === "signal" && message.roomId === roomId) {
        current.receive(message.from, message.payload);
      }
    });
    current.setLocalTracks({ mic: latest.current.mic });
    if (latest.current.roster) current.join(latest.current.roster);
    return () => {
      unsubscribeSocket();
      unsubscribeMesh();
      current.close();
      mesh.current = null;
      setRemote({});
    };
  }, [roomId, meId, active]);

  useEffect(() => {
    if (roster) mesh.current?.join(roster);
  }, [roster]);

  useEffect(() => {
    mesh.current?.setLocalTracks({ mic });
  }, [mic]);

  return { remote };
}

/** Who (by the keys of `tracks`) is speaking now, from each audio track's level. */
export function useSpeakers(
  tracks: Readonly<Record<string, MediaStreamTrack | undefined>>,
): ReadonlySet<string> {
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(() => new Set());
  const watched = useRef(new Map<string, { track: MediaStreamTrack; stop: () => void }>());

  useEffect(() => {
    for (const [id, watch] of watched.current) {
      if (tracks[id] === watch.track) continue;
      watch.stop();
      watched.current.delete(id);
    }
    for (const [id, track] of Object.entries(tracks)) {
      if (!track || watched.current.has(id)) continue;
      const stop = watchSpeaking(track, (on) =>
        setSpeaking((s) => {
          if (s.has(id) === on) return s;
          const next = new Set(s);
          if (on) next.add(id);
          else next.delete(id);
          return next;
        }),
      );
      watched.current.set(id, { track, stop });
    }
  }, [tracks]);

  useEffect(() => {
    // Made now, so the user's next click (e.g. unmuting) lets it run before anyone speaks.
    speakingContext();
    const all = watched.current;
    return () => {
      for (const watch of all.values()) watch.stop();
      all.clear();
    };
  }, []);

  return speaking;
}
