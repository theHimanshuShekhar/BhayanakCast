import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AdminRequiredError, SignInRequiredError } from "./caller.ts";
import { log, withRequestLog } from "./logger.ts";
import { ReadRateLimitedError } from "./read-limit.ts";
import { logRouteError, logServerFnError } from "./request-errors.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";
import { InvalidThumbnailError, NotStreamingError } from "./thumbnails.ts";

let logs: CapturedLogs;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => logs.restore());

describe("a server function that throws", () => {
  it("is logged at error with the function, the route, the user and the stack", () => {
    withRequestLog({ requestId: "req-1", route: "/_serverFn/abc" }, () => {
      logServerFnError(new TypeError("cannot read x"), { name: "createRoomFn", userId: "u1" });
    });
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]).toMatchObject({
      level: "error",
      event: "server_fn.failed",
      serverFn: "createRoomFn",
      route: "/_serverFn/abc",
      userId: "u1",
      requestId: "req-1",
      err: { name: "TypeError", message: "cannot read x" },
    });
    expect(logs.entries[0]?.err?.stack).toContain("TypeError");
  });

  it("is logged at warn when it is a refusal the app throws on purpose", () => {
    const refusals = [
      new SignInRequiredError(),
      new AdminRequiredError(),
      new NotStreamingError(),
      new InvalidThumbnailError("bad", "type"),
      z.string().safeParse(1).error,
    ];
    for (const error of refusals) logServerFnError(error, { name: "someFn", sampleKey: "k" });
    expect(logs.entries.map((entry) => entry.level)).toEqual(refusals.map(() => "warn"));
    expect(logs.entries.every((entry) => entry.event === "server_fn.refused")).toBe(true);
  });

  it("leaves a read refused over the limit to the line that refusal wrote itself", () => {
    logServerFnError(new ReadRateLimitedError(), { name: "searchUsersFn" });
    expect(logs.entries).toEqual([]);
  });

  it("is logged at warn when its input didn't validate (Start throws the issues as an Error)", () => {
    const issues = z.object({ userId: z.string().max(3) }).safeParse({ userId: "toolong" })
      .error?.issues;
    logServerFnError(new Error(JSON.stringify(issues, null, 2)), { name: "getProfileFn" });
    expect(logs.entries[0]).toMatchObject({
      level: "warn",
      event: "server_fn.refused",
      serverFn: "getProfileFn",
    });
    // A plain error that merely looks like JSON isn't one.
    logServerFnError(new Error('["not", "issues"]'), { name: "otherFn" });
    expect(logs.entries[1]).toMatchObject({ level: "error", event: "server_fn.failed" });
  });

  it("is not logged for a redirect or a not-found the router throws", () => {
    logServerFnError(new Response(null, { status: 302 }), { name: "someFn" });
    logServerFnError({ isNotFound: true, routeId: "__root__" }, { name: "someFn" });
    expect(logs.entries).toEqual([]);
  });

  it("is not logged twice when the code that failed already logged it", () => {
    const error = new Error("insert failed");
    log.error("quality.write_failed", "storing quality samples failed", { err: error });
    logServerFnError(error, { name: "reportQualityFn" });
    expect(logs.entries.map((entry) => entry.event)).toEqual(["quality.write_failed"]);
  });
});

describe("a route that throws", () => {
  it("is logged at error with the route (never the query or an invite token) and the user", () => {
    logRouteError(
      new Error("render failed"),
      "http://app.example/join/inv-secret-token?code=abc",
      "u2",
    );
    expect(logs.entries[0]).toMatchObject({
      level: "error",
      event: "http.unhandled",
      route: "/join/:token",
      userId: "u2",
      err: { message: "render failed" },
    });
    expect(logs.lines.join("")).not.toContain("inv-secret-token");
    expect(logs.lines.join("")).not.toContain("code=abc");
  });

  it("is not logged twice", () => {
    const error = new Error("render failed");
    logRouteError(error, "http://app.example/x");
    logRouteError(error, "http://app.example/x");
    expect(logs.entries).toHaveLength(1);
  });
});
