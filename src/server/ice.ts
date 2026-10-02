/**
 * ICE servers and ICE logging (ADR 3). Each signed-in user in (or about to join) a live room
 * they may enter gets STUN plus Cloudflare TURN credentials minted with the TURN key, which
 * never leaves the server; anyone else gets STUN only, so the relay can't be used outside the
 * app. Credentials are cached per user and minted again once they get close to expiry; pages
 * ask again before that (`refreshInSeconds`). Without a TURN key, or while Cloudflare is
 * failing, it's STUN only.
 *
 * Pages report pairs that relay or fail (`IceReport`: candidate types only, no addresses or
 * user ids), which are logged as `[ice] {…}` lines so double-NAT frequency can be measured.
 */
import { z } from "zod";
import { type IceReport, type IceServersGrant, STUN_SERVERS } from "~/lib/ice";
import { type Db, getDb } from "../db/client.ts";
import { type Caller, requireSignedIn, type SignedInCaller } from "./caller.ts";
import { type Clock, systemClock } from "./clock.ts";
import { env } from "./env.ts";
import { withinRateLimit } from "./rate-limit.ts";
import { createDbRoomStore } from "./room-store.ts";

/** How long minted TURN credentials last. */
export const TURN_CREDENTIAL_TTL_S = 4 * 60 * 60;
/** Cached credentials with less than this left are minted again (pages refresh at this point). */
export const TURN_REFRESH_MARGIN_S = 30 * 60;
/** When a page asks again without TURN configured (the answer can't change until a restart). */
const STUN_ONLY_REFRESH_S = 60 * 60;
/** When a page asks again after minting failed. */
const MINT_FAILED_REFRESH_S = 60;
/** When a page asks again after being refused TURN (the room may be live or open to them by then). */
const NOT_ENTITLED_REFRESH_S = 60;
/** Reports logged per user in any `windowMs`; more are dropped, so nobody can flood the log. */
export const ICE_REPORT_RATE_LIMIT = { reports: 30, windowMs: 10 * 60_000 } as const;

/** Mints short-lived TURN credentials (Cloudflare in production, a fake in tests). */
export interface TurnProvider {
  mint(ttlSeconds: number): Promise<RTCIceServer[]>;
}

const cloudflareResponse = z.object({
  iceServers: z.array(
    z.object({
      urls: z.union([z.string(), z.array(z.string())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  ),
});

/** Browsers block port 53, so those URLs only time out (Cloudflare's docs say to drop them). */
const PORT_53 = /:53(\?|$)/;

/** Cloudflare Realtime TURN: `generate-ice-servers` with the TURN key's id and API token. */
export function cloudflareTurn(options: {
  keyId: string;
  apiToken: string;
  fetch?: typeof fetch;
}): TurnProvider {
  const fetchFn = options.fetch ?? fetch;
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(options.keyId)}/credentials/generate-ice-servers`;
  return {
    async mint(ttlSeconds) {
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl: ttlSeconds }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Cloudflare TURN answered ${response.status}`);
      const { iceServers } = cloudflareResponse.parse(await response.json());
      return iceServers.flatMap((server) => {
        const urls = [server.urls].flat().filter((u) => !PORT_53.test(u));
        return urls.length > 0 ? [{ ...server, urls }] : [];
      });
    },
  };
}

interface CachedCredentials {
  /** Epoch ms. */
  expiresAt: number;
  /** Shared by concurrent requests while minting. */
  servers: Promise<RTCIceServer[]>;
}

/**
 * Whether `caller` may enter the live room `roomId`: it is live, visible to them (ADR 16) and
 * they weren't kicked from it (ADR 15), the same rules the realtime server applies on a join.
 */
export async function mayEnterRoom(
  db: Db,
  caller: SignedInCaller,
  roomId: string,
): Promise<boolean> {
  const store = createDbRoomStore(db);
  if (await store.isKicked(roomId, caller.user.id)) return false;
  return (await store.findRoomFor(caller, roomId)) !== null;
}

export interface IceServiceOptions {
  /** Null: no TURN configured, STUN only. */
  turn: TurnProvider | null;
  /** Whether a signed-in caller may enter the room they ask about (`mayEnterRoom`). */
  mayEnter: (caller: SignedInCaller, roomId: string) => Promise<boolean>;
  clock?: Clock;
  /** Where minting failures and ICE reports go. Defaults to the console. */
  log?: (line: string, error?: unknown) => void;
}

export class IceService {
  readonly #turn: TurnProvider | null;
  readonly #mayEnter: IceServiceOptions["mayEnter"];
  readonly #clock: Clock;
  readonly #log: (line: string, error?: unknown) => void;
  readonly #cache = new Map<string, CachedCredentials>();
  readonly #reports = new Map<string, number[]>();

  constructor(options: IceServiceOptions) {
    this.#turn = options.turn;
    this.#mayEnter = options.mayEnter;
    this.#clock = options.clock ?? systemClock;
    this.#log =
      options.log ?? ((line, error) => (error ? console.error(line, error) : console.info(line)));
  }

  /**
   * The signed-in caller's ICE servers for `roomId`: cached TURN credentials, or fresh ones near
   * expiry, but only if they may enter that live room; otherwise STUN only. The cache is per
   * user, not per room: the room only decides whether credentials are handed out.
   */
  async serversFor(caller: Caller, roomId: string): Promise<IceServersGrant> {
    requireSignedIn(caller);
    const userId = caller.user.id;
    if (!this.#turn) return { iceServers: STUN_SERVERS, refreshInSeconds: STUN_ONLY_REFRESH_S };
    if (!(await this.#mayEnter(caller, roomId))) {
      return { iceServers: STUN_SERVERS, refreshInSeconds: NOT_ENTITLED_REFRESH_S };
    }
    const now = this.#clock.now().getTime();
    for (const [id, cached] of this.#cache) if (cached.expiresAt <= now) this.#cache.delete(id);
    let cached = this.#cache.get(userId);
    if (!cached || cached.expiresAt - now <= TURN_REFRESH_MARGIN_S * 1_000) {
      cached = {
        expiresAt: now + TURN_CREDENTIAL_TTL_S * 1_000,
        servers: this.#turn.mint(TURN_CREDENTIAL_TTL_S),
      };
      this.#cache.set(userId, cached);
    }
    try {
      const iceServers = await cached.servers;
      const refreshAt = cached.expiresAt - TURN_REFRESH_MARGIN_S * 1_000;
      return { iceServers, refreshInSeconds: Math.max(60, Math.ceil((refreshAt - now) / 1_000)) };
    } catch (error) {
      // Not cached: the next request tries again.
      if (this.#cache.get(userId) === cached) this.#cache.delete(userId);
      this.#log("[ice] minting TURN credentials failed; STUN only", error);
      return { iceServers: STUN_SERVERS, refreshInSeconds: MINT_FAILED_REFRESH_S };
    }
  }

  /** Log `report` from the signed-in caller's page, unless they're over `ICE_REPORT_RATE_LIMIT`. */
  report(caller: Caller, report: IceReport): boolean {
    requireSignedIn(caller);
    const now = this.#clock.now();
    const { reports, windowMs } = ICE_REPORT_RATE_LIMIT;
    // Users with nothing left in the window are forgotten.
    for (const [id, sent] of this.#reports) {
      if ((sent.at(-1) ?? 0) <= now.getTime() - windowMs) this.#reports.delete(id);
    }
    if (!withinRateLimit(this.#reports, caller.user.id, reports, windowMs, now)) return false;
    this.#log(`[ice] ${JSON.stringify(report)}`);
    return true;
  }
}

let service: IceService | undefined;

/** The server's `IceService`, with Cloudflare TURN when its key is configured. */
export function getIceService(): IceService {
  const { CLOUDFLARE_TURN_KEY_ID: keyId, CLOUDFLARE_TURN_API_TOKEN: apiToken } = env;
  service ??= new IceService({
    turn: keyId && apiToken ? cloudflareTurn({ keyId, apiToken }) : null,
    mayEnter: (caller, roomId) => mayEnterRoom(getDb(), caller, roomId),
  });
  return service;
}
