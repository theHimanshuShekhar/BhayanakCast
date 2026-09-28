/**
 * Which IP a request comes from (ADR 9). Behind the shared Cloudflare Tunnel every connection
 * arrives from the cloudflared host, which names the real client in `cf-connecting-ip`. The app
 * also listens on the LAN, where anyone can send that header, so it's trusted only when the
 * direct peer is a configured trusted proxy (`TRUSTED_PROXY_IPS`); otherwise the peer's own
 * address is the client IP.
 */
import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";

/** The header Cloudflare sets to the visitor's IP; Better Auth reads it too (src/lib/auth.ts). */
export const CLIENT_IP_HEADER = "cf-connecting-ip";

/** Whether `entry` is an IP address or a CIDR range (`10.1.1.0/24`, `fd00::/8`). */
export function isTrustedProxyEntry(entry: string): boolean {
  return parseEntry(entry) !== null;
}

export interface ClientIpResolverOptions {
  /**
   * Called once per untrusted peer that sends `cf-connecting-ip` (which is then ignored), so a
   * misconfigured `TRUSTED_PROXY_IPS` shows up in the logs with the address to add.
   */
  warn?: (message: string) => void;
}

/** Resolves a connection's client IP from its peer address and its `cf-connecting-ip` header. */
export type ClientIpResolver = (
  peerAddress: string | undefined,
  forwarded: string | string[] | undefined,
) => string;

/** Distinct untrusted peers remembered for warning once; past this, warnings stop. */
const MAX_WARNED_PEERS = 100;

export function createClientIpResolver(
  trustedProxies: readonly string[],
  options: ClientIpResolverOptions = {},
): ClientIpResolver {
  const trusted = new BlockList();
  for (const entry of trustedProxies) {
    const parsed = parseEntry(entry);
    if (!parsed) throw new Error(`Invalid trusted proxy "${entry}": expected an IP or CIDR range`);
    trusted.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }
  const warned = new Set<string>();

  return (peerAddress, forwarded) => {
    const peer = peerAddress ? unmapIPv4(peerAddress) : undefined;
    const header = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.trim();
    if (!peer) return "unknown";
    if (!header) return peer;
    if (trusted.check(peer, familyOf(peer))) {
      const client = unmapIPv4(header);
      return isIP(client) ? client : peer;
    }
    if (options.warn && !warned.has(peer) && warned.size < MAX_WARNED_PEERS) {
      warned.add(peer);
      options.warn(
        `Ignoring ${CLIENT_IP_HEADER} from ${peer}, which isn't in TRUSTED_PROXY_IPS. ` +
          "If this is the cloudflared host, add it there (docs/deploy.md).",
      );
    }
    return peer;
  };
}

/**
 * Rewrite a request's `cf-connecting-ip` to its resolved client IP before any handler reads it,
 * so libraries that only look at headers (Better Auth's rate limiter) can't be fooled by a LAN
 * client that sends its own. Rewrites both `headers` and `rawHeaders`, since the request's web
 * `Headers` view may be built from either.
 */
export function rewriteClientIpHeader(request: IncomingMessage, clientIp: string): void {
  const raw = request.rawHeaders;
  for (let i = raw.length - 2; i >= 0; i -= 2) {
    if (raw[i]?.toLowerCase() === CLIENT_IP_HEADER) raw.splice(i, 2);
  }
  raw.push(CLIENT_IP_HEADER, clientIp);
  request.headers[CLIENT_IP_HEADER] = clientIp;
}

function familyOf(ip: string): "ipv4" | "ipv6" {
  return isIP(ip) === 6 ? "ipv6" : "ipv4";
}

/** `::ffff:10.1.1.5` (an IPv4 peer on a dual-stack socket) → `10.1.1.5`. */
function unmapIPv4(ip: string): string {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return match?.[1] && isIP(match[1]) === 4 ? match[1] : ip;
}

function parseEntry(
  entry: string,
): { address: string; prefix: number; family: "ipv4" | "ipv6" } | null {
  const [rawAddress, rawPrefix, ...rest] = entry.trim().split("/");
  if (!rawAddress || rest.length > 0) return null;
  const address = unmapIPv4(rawAddress);
  const version = isIP(address);
  if (version === 0) return null;
  const maxPrefix = version === 4 ? 32 : 128;
  if (rawPrefix === undefined) {
    return { address, prefix: maxPrefix, family: version === 4 ? "ipv4" : "ipv6" };
  }
  if (!/^\d{1,3}$/.test(rawPrefix)) return null;
  const prefix = Number(rawPrefix);
  if (prefix > maxPrefix) return null;
  return { address, prefix, family: version === 4 ? "ipv4" : "ipv6" };
}
