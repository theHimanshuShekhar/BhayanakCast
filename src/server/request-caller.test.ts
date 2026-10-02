import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
  status: undefined as number | undefined,
  responseHeaders: {} as Record<string, string | string[]>,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => request.headers[name],
  getRequestHeaders: () => new Headers(request.headers),
  setResponseStatus: (code: number) => {
    request.status = code;
  },
  setResponseHeader: (name: string, value: string | string[]) => {
    request.responseHeaders[name] = value;
  },
}));

const { limitPublicRead } = await import("./request-caller.ts");
const { PUBLIC_READ_LIMITS, ReadRateLimitedError } = await import("./read-limit.ts");

/** Read `kind` `count` times as `ip`; how many were refused. */
function refusals(kind: "profile" | "search" | "home", ip: string, count: number) {
  request.headers = { "cf-connecting-ip": ip };
  let refused = 0;
  for (let i = 0; i < count; i++) {
    try {
      limitPublicRead(kind);
    } catch (error) {
      expect(error).toBeInstanceOf(ReadRateLimitedError);
      refused++;
    }
  }
  return refused;
}

beforeEach(() => {
  request.headers = {};
  request.status = undefined;
  request.responseHeaders = {};
});

describe("limitPublicRead", () => {
  it("lets a client IP read up to the limit, then refuses with a 429 and Retry-After", () => {
    expect(refusals("search", "203.0.113.10", PUBLIC_READ_LIMITS.search)).toBe(0);
    expect(request.status).toBeUndefined();

    expect(refusals("search", "203.0.113.10", 1)).toBe(1);
    expect(request.status).toBe(429);
    expect(request.responseHeaders["retry-after"]).toBe("60");
  });

  it("limits profile and home at their own budgets", () => {
    expect(refusals("profile", "203.0.113.11", PUBLIC_READ_LIMITS.profile + 5)).toBe(5);
    expect(refusals("home", "203.0.113.11", PUBLIC_READ_LIMITS.home + 5)).toBe(5);
  });

  it("keys on the client IP header, so one IP's reads don't use another's budget", () => {
    expect(refusals("search", "203.0.113.12", PUBLIC_READ_LIMITS.search + 1)).toBe(1);
    expect(refusals("search", "203.0.113.13", 1)).toBe(0);
  });

  it("counts requests without the header as one client", () => {
    request.headers = {};
    for (let i = 0; i < PUBLIC_READ_LIMITS.search; i++) limitPublicRead("search");
    expect(() => limitPublicRead("search")).toThrow(ReadRateLimitedError);
  });
});
