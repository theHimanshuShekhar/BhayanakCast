import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMiddleware, ServerRequest } from "srvx";
import { staticMiddleware } from "srvx/static";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CSP_NONCE_KEY } from "../lib/csp-nonce.ts";
import {
  contentSecurityPolicy,
  hashedAssetCaching,
  securityHeaders,
  withPrivateCaching,
} from "./security-headers.ts";

// The server as server.prod.ts wires it: the same middleware around a stand-in for the app.
let clientDir: string;
const seenNonces: unknown[] = [];

const html = () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } });

/** What the app answers by path; the real one is TanStack Start's handler. */
function app(request: Request): Response {
  const { pathname } = new URL(request.url);
  seenNonces.push((request as ServerRequest).context?.[CSP_NONCE_KEY]);
  if (pathname.startsWith("/_serverFn/")) return Response.json({ rooms: ["private one"] });
  if (pathname.startsWith("/api/thumbnails/")) {
    return new Response("png", {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=0, must-revalidate",
      },
    });
  }
  if (pathname.startsWith("/api/auth/")) {
    return Response.json(null, { headers: { "cache-control": "max-age=600" } });
  }
  if (pathname === "/boom") throw new Error("the app fell over");
  if (pathname === "/moved") return Response.redirect("http://localhost/elsewhere", 302);
  return html();
}

async function get(path: string): Promise<Response> {
  const request = new Request(`http://localhost${path}`);
  const chain: ServerMiddleware[] = [
    securityHeaders,
    hashedAssetCaching,
    staticMiddleware({ dir: clientDir }),
  ];
  const handler = withPrivateCaching(app);
  const run = (index: number): Promise<Response> | Response =>
    index < chain.length
      ? (chain[index] as ServerMiddleware)(request as ServerRequest, () => run(index + 1))
      : handler(request);
  return run(0);
}

beforeAll(async () => {
  clientDir = await mkdtemp(join(tmpdir(), "bc-client-"));
  await mkdir(join(clientDir, "assets"));
  await writeFile(join(clientDir, "assets", "app-abc123.js"), "console.log(1);\n");
  await writeFile(join(clientDir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
});

afterAll(async () => {
  await rm(clientDir, { recursive: true, force: true });
});

describe("the Content-Security-Policy", () => {
  const policy = contentSecurityPolicy("N0nce");
  const directive = (name: string) =>
    policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("allows scripts from self and the request's nonce, never unsafe-inline", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-N0nce'");
  });

  it("allows only what the app loads, and no framing", () => {
    expect(directive("img-src")).toBe("img-src 'self' data: https://cdn.discordapp.com");
    expect(directive("media-src")).toBe("media-src 'self'");
    expect(directive("connect-src")).toBe("connect-src 'self'");
    expect(directive("style-src")).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive("font-src")).toBe("font-src 'self'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
  });
});

describe("an HTML page", () => {
  it("is private, no-store, with the policy, nosniff and a referrer policy", async () => {
    const response = await get("/room/abc");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toMatch(
      /^default-src 'self'; script-src 'self' 'nonce-[\w+/=]+';/,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("gets a new nonce per request, and the app is handed the same one the policy names", async () => {
    seenNonces.length = 0;
    const first = await get("/");
    const second = await get("/");
    const nonceOf = (r: Response) =>
      /'nonce-([^']+)'/.exec(r.headers.get("content-security-policy") ?? "")?.[1];
    expect(nonceOf(first)).toBeTruthy();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
    expect(seenNonces).toEqual([nonceOf(first), nonceOf(second)]);
  });

  it("sends no referrer at all from an invite page, whose URL is a bearer token", async () => {
    expect((await get("/join/secret-token")).headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("stays private even if the handler asked for a shared cache", async () => {
    const cacheable = withPrivateCaching(
      () =>
        new Response("<html>", {
          headers: { "content-type": "text/html", "cache-control": "public, max-age=600" },
        }),
    );
    const response = await cacheable(new Request("http://localhost/"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("a server function response", () => {
  it("is private, no-store, with the security headers", async () => {
    const response = await get("/_serverFn/abc123");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});

describe("/api", () => {
  it("makes auth responses private, no-store whatever the handler said", async () => {
    const response = await get("/api/auth/get-session");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("leaves a thumbnail's own private caching alone", async () => {
    const response = await get("/api/thumbnails/room/user");
    expect(response.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("a static asset", () => {
  it("keeps a long cache and is not marked no-store", async () => {
    const response = await get("/assets/app-abc123.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("does not cache a missing one for a year", async () => {
    const response = await get("/assets/gone-ffffff.js");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("gets no year-long cache outside /assets", async () => {
    const response = await get("/favicon.svg");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("an unhandled error in the app", () => {
  it("is answered as a 500 that still has the security headers, and is logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await get("/boom");
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Internal Server Error");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});

describe("a redirect", () => {
  it("gets the headers though Response.redirect's own are read-only", async () => {
    const response = await get("/moved");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/elsewhere");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
