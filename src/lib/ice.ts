/**
 * NAT traversal (ADR 3 and its addendum), shared by the client and the server: the ICE servers
 * a page's Mesh uses, how it keeps them fresh, and the anonymised candidate details it reports
 * when a pair relays or fails (no addresses, only candidate types and transports).
 */
import { z } from "zod";

/** STUN only: what a page uses before (or without) TURN credentials from the server. */
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

/** The ICE servers for the signed-in caller (`getIceServersFn`), and when to ask again. */
export interface IceServersGrant {
  iceServers: RTCIceServer[];
  /** Ask again after this long: before the TURN credentials in `iceServers` expire. */
  refreshInSeconds: number;
}

/** How long a page waits to ask again after asking failed. */
export const ICE_SERVERS_RETRY_MS = 60_000;

/**
 * Fetch the ICE servers now and again whenever the last grant says, handing each set to
 * `onServers`. A failed fetch hands over STUN only (if nothing came before) and retries later.
 * Returns a function that stops refreshing.
 */
export function keepIceServersFresh(
  fetchGrant: () => Promise<IceServersGrant>,
  onServers: (servers: RTCIceServer[]) => void,
): () => void {
  let stopped = false;
  let received = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const load = async () => {
    let delay = ICE_SERVERS_RETRY_MS;
    try {
      const grant = await fetchGrant();
      if (stopped) return;
      received = true;
      onServers(grant.iceServers);
      delay = grant.refreshInSeconds * 1_000;
    } catch (error) {
      if (stopped) return;
      console.warn("[ice] fetching ICE servers failed", error);
      if (!received) onServers(STUN_SERVERS);
    }
    timer = setTimeout(() => void load(), delay);
  };
  void load();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

const candidateType = z.enum(["host", "srflx", "prflx", "relay"]);

/** One ICE candidate, anonymised: its type and transport, never its address. */
export const iceCandidateInfo = z.object({
  type: candidateType,
  protocol: z.enum(["udp", "tcp"]),
  /** How a relay candidate reaches the TURN server (UDP, TCP, or TLS on 443). */
  relayProtocol: z.enum(["udp", "tcp", "tls"]).optional(),
});
export type IceCandidateInfo = z.infer<typeof iceCandidateInfo>;

/** At most this many distinct candidate kinds per side in an `IcePath`. */
const ICE_PATH_MAX_CANDIDATES = 16;

/** A connection's candidates (each kind once) and, once connected, the pair it uses. */
export const icePath = z.object({
  selected: z.object({ local: iceCandidateInfo, remote: iceCandidateInfo }).optional(),
  local: z.array(iceCandidateInfo).max(ICE_PATH_MAX_CANDIDATES),
  remote: z.array(iceCandidateInfo).max(ICE_PATH_MAX_CANDIDATES),
});
export type IcePath = z.infer<typeof icePath>;

/** What a page tells the server about one pair (`reportIceFn`), for the server log. */
export const iceReport = z.object({
  outcome: z.enum(["relayed", "failed"]),
  path: icePath,
});
export type IceReport = z.infer<typeof iceReport>;

/** A stats entry, as far as candidates and pairs go (browsers differ in what they fill in). */
interface StatsEntry {
  id: string;
  type: string;
  candidateType?: string;
  protocol?: string;
  relayProtocol?: string;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  state?: string;
  nominated?: boolean;
  /** Firefox's flag for the pair in use (it has no `transport` stats). */
  selected?: boolean;
}

/** The anonymised ICE path of a connection, from its `getStats()`. */
export function icePathOf(report: RTCStatsReport): IcePath {
  const entries = [...(report as Map<string, StatsEntry>).values()];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const info = (entry: StatsEntry | undefined): IceCandidateInfo | undefined => {
    const parsed = iceCandidateInfo.safeParse({
      type: entry?.candidateType,
      protocol: entry?.protocol?.toLowerCase(),
      // Only relay candidates have one (and not every browser says).
      relayProtocol:
        entry?.candidateType === "relay" ? entry.relayProtocol?.toLowerCase() : undefined,
    });
    return parsed.success ? parsed.data : undefined;
  };
  const distinct = (type: string) => {
    const seen = new Map<string, IceCandidateInfo>();
    for (const entry of entries) {
      const candidate = entry.type === type ? info(entry) : undefined;
      if (candidate) seen.set(JSON.stringify(candidate), candidate);
    }
    return [...seen.values()].slice(0, ICE_PATH_MAX_CANDIDATES);
  };
  const pairId = entries.find(
    (e) => e.type === "transport" && e.selectedCandidatePairId,
  )?.selectedCandidatePairId;
  const pair =
    (pairId ? byId.get(pairId) : undefined) ??
    entries.find((e) => e.type === "candidate-pair" && e.selected) ??
    entries.find((e) => e.type === "candidate-pair" && e.nominated && e.state === "succeeded");
  const local = info(pair?.localCandidateId ? byId.get(pair.localCandidateId) : undefined);
  const remote = info(pair?.remoteCandidateId ? byId.get(pair.remoteCandidateId) : undefined);
  return {
    ...(local && remote ? { selected: { local, remote } } : {}),
    local: distinct("local-candidate"),
    remote: distinct("remote-candidate"),
  };
}

/** Whether the pair in use goes through a TURN relay (either end a relay candidate). */
export const isRelayed = (path: IcePath) =>
  path.selected?.local.type === "relay" || path.selected?.remote.type === "relay";
