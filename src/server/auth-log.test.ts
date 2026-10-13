import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logAuthApiError, logAuthMessage } from "./auth-log.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

let logs: CapturedLogs;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => logs.restore());

describe("logAuthMessage (Better Auth's own log lines, sign-in failures among them)", () => {
  it("writes an error as error and a warning as warn, under auth.log", () => {
    logAuthMessage("error", "Failed to parse state", []);
    logAuthMessage("warn", "Code not found", []);
    expect(logs.entries).toMatchObject([
      { level: "error", event: "auth.log", msg: "Failed to parse state" },
      { level: "warn", event: "auth.log", msg: "Code not found" },
    ]);
  });

  it("keeps the error it was given, with its code", () => {
    const error = Object.assign(new Error("State mismatch: verification not found"), {
      name: "StateError",
      code: "state_mismatch",
    });
    logAuthMessage("error", "Failed to parse state", [error]);
    expect(logs.entries[0]).toMatchObject({
      code: "state_mismatch",
      err: { name: "StateError", message: "State mismatch: verification not found" },
    });
  });

  it("drops the other arguments, which can hold OAuth state, tokens or profiles", () => {
    logAuthMessage("error", "Unable to get user info", [
      { state: "oauth-state-nonce", accessToken: "tok_secret", profile: { id: "42" } },
    ]);
    expect(logs.lines.join("")).not.toContain("oauth-state-nonce");
    expect(logs.lines.join("")).not.toContain("tok_secret");
  });

  it("leaves debug and info lines out", () => {
    logAuthMessage("debug", "x", []);
    logAuthMessage("info", "y", []);
    expect(logs.entries).toEqual([]);
  });
});

describe("logAuthApiError", () => {
  it("writes a refusal (4xx) at warn with its status and code", () => {
    logAuthApiError(
      new APIError("UNAUTHORIZED", { message: "Session expired", code: "SESSION_EXPIRED" }),
    );
    expect(logs.entries[0]).toMatchObject({
      level: "warn",
      event: "auth.api_refused",
      status: 401,
      code: "SESSION_EXPIRED",
      msg: "Session expired",
    });
  });

  it("writes a banned user's refused sign-in", () => {
    logAuthApiError(
      new APIError("FORBIDDEN", { message: "You have been banned", code: "BANNED_USER" }),
    );
    expect(logs.entries[0]).toMatchObject({ status: 403, code: "BANNED_USER" });
  });

  it("writes a server error (5xx) at error with the stack", () => {
    logAuthApiError(new APIError("INTERNAL_SERVER_ERROR", { message: "boom" }));
    expect(logs.entries[0]).toMatchObject({
      level: "error",
      event: "auth.api_error",
      status: 500,
      err: { message: "boom" },
    });
  });

  it("writes anything else that throws as an error", () => {
    logAuthApiError(new TypeError("cannot read x"));
    expect(logs.entries[0]).toMatchObject({
      level: "error",
      event: "auth.api_error",
      err: { name: "TypeError" },
    });
  });

  it("ignores the redirects Better Auth throws to steer", () => {
    logAuthApiError(new APIError("FOUND", { message: "redirect" }));
    expect(logs.entries).toEqual([]);
  });
});
