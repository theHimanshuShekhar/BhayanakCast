import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_IP_HEADER,
  createClientIpResolver,
  isTrustedProxyEntry,
  rewriteClientIpHeader,
} from "./client-ip.ts";

describe("trusted proxy entries", () => {
  it("accepts IPs and CIDR ranges, IPv4 and IPv6", () => {
    for (const entry of [
      "10.1.1.5",
      "10.1.1.0/24",
      "0.0.0.0/0",
      "::1",
      "fd00::/8",
      "::ffff:10.1.1.5",
    ]) {
      expect(isTrustedProxyEntry(entry), entry).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const entry of [
      "",
      "cloudflared",
      "10.1.1",
      "10.1.1.0/33",
      "::1/129",
      "10.1.1.0/",
      "10.0.0.0/8/8",
      "10.1.1.0/x",
    ]) {
      expect(isTrustedProxyEntry(entry), entry).toBe(false);
    }
    expect(() => createClientIpResolver(["nope"])).toThrow(/nope/);
  });
});

describe("resolving the client IP", () => {
  const resolve = createClientIpResolver(["10.1.1.5", "172.18.0.0/16", "::1"]);

  it("trusts cf-connecting-ip from a trusted proxy", () => {
    expect(resolve("10.1.1.5", "203.0.113.7")).toBe("203.0.113.7");
    expect(resolve("172.18.3.4", "203.0.113.7")).toBe("203.0.113.7");
    expect(resolve("::1", "2001:db8::1")).toBe("2001:db8::1");
    expect(resolve("10.1.1.5", ["203.0.113.7", "198.51.100.1"])).toBe("203.0.113.7");
  });

  it("matches IPv4 peers reported as IPv4-mapped IPv6", () => {
    expect(resolve("::ffff:10.1.1.5", "203.0.113.7")).toBe("203.0.113.7");
    expect(resolve("::ffff:10.1.1.9", "203.0.113.7")).toBe("10.1.1.9");
  });

  it("ignores cf-connecting-ip from anyone else and uses the peer address", () => {
    expect(resolve("10.1.1.9", "203.0.113.7")).toBe("10.1.1.9");
    expect(resolve("172.19.0.1", "203.0.113.7")).toBe("172.19.0.1");
  });

  it("uses the peer address when there's no usable header", () => {
    expect(resolve("10.1.1.9", undefined)).toBe("10.1.1.9");
    expect(resolve("10.1.1.5", undefined)).toBe("10.1.1.5");
    expect(resolve("10.1.1.5", "  ")).toBe("10.1.1.5");
    expect(resolve("10.1.1.5", "not-an-ip")).toBe("10.1.1.5");
    expect(resolve(undefined, "203.0.113.7")).toBe("unknown");
  });

  it("trusts nobody when no proxies are configured", () => {
    expect(createClientIpResolver([])("127.0.0.1", "203.0.113.7")).toBe("127.0.0.1");
  });

  it("warns once per untrusted peer that sends the header", () => {
    const warn = vi.fn();
    const resolveWithWarn = createClientIpResolver(["10.1.1.5"], { warn });
    resolveWithWarn("10.1.1.9", "203.0.113.7");
    resolveWithWarn("10.1.1.9", "203.0.113.8");
    resolveWithWarn("10.1.1.10", undefined);
    resolveWithWarn("10.1.1.5", "203.0.113.7");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("10.1.1.9");
  });
});

describe("rewriting the header on a request", () => {
  it("replaces every cf-connecting-ip in headers and rawHeaders before handlers read it", async () => {
    const resolve = createClientIpResolver(["203.0.113.250"]);
    const seen: { header?: string | string[]; raw: string[]; web: string | null }[] = [];
    const server = createServer((request, response) => {
      const web = new Headers();
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        web.append(request.rawHeaders[i] ?? "", request.rawHeaders[i + 1] ?? "");
      }
      seen.push({
        header: request.headers[CLIENT_IP_HEADER],
        raw: request.rawHeaders.filter(
          (_, i, raw) => raw[i - 1]?.toLowerCase() === CLIENT_IP_HEADER,
        ),
        web: web.get(CLIENT_IP_HEADER),
      });
      response.end();
    });
    server.prependListener("request", (request: IncomingMessage) => {
      rewriteClientIpHeader(
        request,
        resolve(request.socket.remoteAddress, request.headers[CLIENT_IP_HEADER]),
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const { port } = server.address() as AddressInfo;
      await fetch(`http://127.0.0.1:${port}/`, {
        headers: { [CLIENT_IP_HEADER]: "198.51.100.66" },
      });
      await fetch(`http://127.0.0.1:${port}/`);
    } finally {
      await new Promise((done) => server.close(done));
    }
    // 127.0.0.1 isn't trusted: the spoofed value is replaced by the socket address.
    expect(seen).toEqual([
      { header: "127.0.0.1", raw: ["127.0.0.1"], web: "127.0.0.1" },
      { header: "127.0.0.1", raw: ["127.0.0.1"], web: "127.0.0.1" },
    ]);
  });
});
