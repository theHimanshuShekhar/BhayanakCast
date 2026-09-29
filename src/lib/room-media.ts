/**
 * The room page's peer-to-peer media (spec #4): `useRoomMesh` runs this page's Mesh (./mesh.ts)
 * while it is in the room, relays its signalling over the realtime socket, sends this page's
 * mic and camera, pauses the cameras this page isn't showing, and reports everyone else's
 * tracks. `useSpeakers` measures who is speaking (./speaking.ts).
 *
 * Leaving (unmount) or losing the room (`active` false: taken over, kicked, the room gone)
 * closes every peer connection. The page's own tracks belong to ./local-media.ts, which the
 * room releases at the same moments.
 *
 * The Mesh starts once the ICE servers (STUN plus TURN, ADR 3) have come from the server, and
 * gets fresh ones before their credentials expire. Pairs that relay or fail are reported to the
 * server's log (anonymised candidate types).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { keepIceServersFresh } from "./ice";
import { getIceServersFn, reportIceFn } from "./ice.functions";
import { Mesh, type PeerState } from "./mesh";
import type { MediaSlot, RoomParticipant } from "./realtime";
import { getRealtimeClient } from "./realtime-client";
import { speakingContext, watchSpeaking } from "./speaking";

/** One peer's tracks, by slot. */
export type PeerTracks = Partial<Record<MediaSlot, MediaStreamTrack>>;

export interface RoomMesh {
  /** Everyone else's tracks, by user id. */
  remote: Record<string, PeerTracks>;
  /** Each connection's state, by user id. */
  states: Record<string, PeerState>;
  /** Start the connection to `userId` over (after it `failed`). */
  retry: (userId: string) => void;
}

/** What this page sends everyone (null: nothing). */
export interface OwnTracks {
  mic: MediaStreamTrack | null;
  cam: MediaStreamTrack | null;
}

/**
 * The Mesh for `roomId` as `meId` while `active`: it connects to everyone in `roster` (the
 * room's people from the socket) and sends them `own`. Everyone else's camera is paused towards
 * this page unless their user id is in `shownCams` (their camera is on screen here).
 */
export function useRoomMesh(
  roomId: string,
  meId: string | null,
  roster: readonly RoomParticipant[] | undefined,
  own: OwnTracks,
  shownCams: ReadonlySet<string>,
  active: boolean,
): RoomMesh {
  const { mic, cam } = own;
  const mesh = useRef<Mesh | null>(null);
  const [remote, setRemote] = useState<Record<string, PeerTracks>>({});
  const [states, setStates] = useState<Record<string, PeerState>>({});
  const [iceServers, setIceServers] = useState<RTCIceServer[] | null>(null);
  const iceReady = iceServers !== null;
  // The latest inputs (roster, tracks, shown cameras, ICE servers), for a Mesh made after they
  // last changed.
  const latest = useRef({ roster, mic, cam, shownCams, iceServers });
  latest.current = { roster, mic, cam, shownCams, iceServers };

  useEffect(() => {
    if (!meId || !active) return;
    const stop = keepIceServersFresh(() => getIceServersFn(), setIceServers);
    return () => {
      stop();
      setIceServers(null);
    };
  }, [meId, active]);

  useEffect(() => {
    if (!meId || !active || !iceReady) return;
    const client = getRealtimeClient();
    const current = new Mesh({
      selfId: meId,
      // Dropped while the socket reconnects: established pairs keep their media meanwhile.
      send: (to, payload) => void client.send({ type: "signal", to, payload }),
      iceServers: latest.current.iceServers ?? undefined,
    });
    mesh.current = current;
    const unsubscribeMesh = current.subscribe((event) => {
      if (event.type === "track") {
        setRemote((r) => ({
          ...r,
          [event.userId]: { ...r[event.userId], [event.slot]: event.track },
        }));
      } else if (event.type === "state") {
        setStates((s) => ({ ...s, [event.userId]: event.state }));
        // Without `ice` it never got as far as ICE (a signalling stall): not a NAT data point.
        if ((event.state === "relayed" || event.state === "failed") && event.ice) {
          reportIceFn({ data: { outcome: event.state, path: event.ice } }).catch((error: unknown) =>
            console.warn("[ice] reporting failed", error),
          );
        }
      } else if (event.type === "closed") {
        setRemote(({ [event.userId]: _, ...rest }) => rest);
        setStates(({ [event.userId]: _, ...rest }) => rest);
      }
    });
    const unsubscribeSocket = client.subscribe((message) => {
      if (message.type === "signal" && message.roomId === roomId) {
        current.receive(message.from, message.payload);
      }
    });
    current.setLocalTracks({ mic: latest.current.mic, cam: latest.current.cam });
    if (latest.current.roster) {
      showCams(current, meId, latest.current.roster, latest.current.shownCams);
      current.join(latest.current.roster);
    }
    return () => {
      unsubscribeSocket();
      unsubscribeMesh();
      current.close();
      mesh.current = null;
      setRemote({});
      setStates({});
    };
  }, [roomId, meId, active, iceReady]);

  useEffect(() => {
    if (roster) mesh.current?.join(roster);
  }, [roster]);

  useEffect(() => {
    if (mesh.current && meId && roster) showCams(mesh.current, meId, roster, shownCams);
  }, [meId, roster, shownCams]);

  useEffect(() => {
    mesh.current?.setLocalTracks({ mic });
  }, [mic]);

  useEffect(() => {
    if (iceServers) mesh.current?.setIceServers(iceServers);
  }, [iceServers]);

  useEffect(() => {
    mesh.current?.setLocalTracks({ cam });
  }, [cam]);

  const retry = useCallback((userId: string) => mesh.current?.retry(userId), []);

  return { remote, states, retry };
}

/** Tell `mesh` whose cameras (of everyone else in `roster`) this page is showing. */
function showCams(
  mesh: Mesh,
  meId: string,
  roster: readonly RoomParticipant[],
  shown: ReadonlySet<string>,
): void {
  for (const { userId } of roster) {
    if (userId !== meId) mesh.setVisible(userId, "cam", shown.has(userId));
  }
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
