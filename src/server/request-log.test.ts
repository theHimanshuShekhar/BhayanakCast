import type { ServerRequest } from "srvx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { log } from "./logger.ts";
import { requestIdOf, requestLogging } from "./request-log.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

let logs: CapturedLogs;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => logs.restore());

const run = (url: string, headers: Record<string, string> = {}) =>
  requestLogging(new Request(url, { headers }) as ServerRequest, async () => {
    log.warn("test.inside", "written while answering");
    return new Response("ok");
  });

describe("requestLogging", () => {
  it("gives the lines written while a request is answered its id and route", async () => {
    await run("http://app.example/api/health?probe=1");
    expect(logs.find("test.inside")).toMatchObject({ route: "/api/health" });
    expect(logs.find("test.inside")?.requestId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("uses the request id the proxy sent, so a line can be matched to Cloudflare's log", async () => {
    await run("http://app.example/", { "cf-ray": "9a1b2c3d4e5f-AMS" });
    expect(logs.find("test.inside")?.requestId).toBe("9a1b2c3d4e5f-AMS");
  });

  it("never writes an address a client sent as its request id", async () => {
    await run("http://app.example/", { "x-request-id": "203.0.113.9" });
    expect(logs.lines.join("")).not.toContain("203.0.113.9");
  });

  it("gives each request its own", async () => {
    await run("http://app.example/");
    await run("http://app.example/");
    const ids = logs.all("test.inside").map((line) => line.requestId);
    expect(new Set(ids).size).toBe(2);
  });

  it("hands the response on untouched", async () => {
    const response = await run("http://app.example/");
    expect(await response.text()).toBe("ok");
  });
});

describe("requestIdOf", () => {
  it("prefers x-request-id, then cf-ray, and ignores a value that isn't a plain id", () => {
    const of = (headers: Record<string, string>) => requestIdOf(new Headers(headers));
    expect(of({ "x-request-id": "abc-123", "cf-ray": "ray" })).toBe("abc-123");
    expect(of({ "cf-ray": "ray-1" })).toBe("ray-1");
    expect(of({ "x-request-id": "has spaces and 10.0.0.1" })).toMatch(/^[0-9a-f]{16}$/);
    expect(of({ "x-request-id": "x".repeat(200) })).toMatch(/^[0-9a-f]{16}$/);
  });
});
