import { describe, expect, it } from "vitest";
import { BAN_REASON_MAX } from "./admin.ts";
import {
  BANNED_USER_ERROR,
  banNoticeHref,
  describeBan,
  isBanDescription,
  validateSignInErrorSearch,
} from "./ban.ts";

const EXPIRY = new Date("2031-01-02T03:04:00Z");

describe("isBanDescription", () => {
  it("accepts what describeBan produces, in every combination", () => {
    for (const banReason of ["spamming rooms", "multi\nline. with dots.", " ", null]) {
      for (const banExpires of [EXPIRY, new Date("2031-09-02T03:04:00Z"), null]) {
        expect(isBanDescription(describeBan({ banReason, banExpires }))).toBe(true);
      }
    }
    expect(isBanDescription(describeBan({ banReason: "x".repeat(BAN_REASON_MAX) }))).toBe(true);
  });

  it("refuses text that isn't a ban description", () => {
    for (const text of [
      "Your account is locked. Verify it at https://evil.example",
      "Reason: spam. Call 555-0100 to appeal.",
      "No reason was given.",
      "Reason: spam. The ban has no end date. Visit https://evil.example",
      `Reason: ${"x".repeat(BAN_REASON_MAX + 1)}. The ban has no end date.`,
      `Reason: spam. The ban ends ${"x".repeat(41)} UTC.`,
      "x".repeat(300_000),
      "",
    ]) {
      expect(isBanDescription(text)).toBe(false);
    }
  });
});

describe("validateSignInErrorSearch", () => {
  it("keeps a real ban notice's description, from a sign-in or a realtime disconnect", () => {
    const description = describeBan({ banReason: "spamming rooms", banExpires: EXPIRY });
    const search = Object.fromEntries(new URLSearchParams(banNoticeHref(description).slice(2)));
    expect(validateSignInErrorSearch(search)).toEqual({
      error: BANNED_USER_ERROR,
      error_description: description,
    });
  });

  it("drops a description that isn't a ban's, so only the generic notice shows", () => {
    const description = "Your session expired. Sign in again at https://evil.example";
    expect(
      validateSignInErrorSearch({ error: BANNED_USER_ERROR, error_description: description }),
    ).toEqual({ error: BANNED_USER_ERROR, error_description: undefined });
    // Other errors never show a description either.
    expect(
      validateSignInErrorSearch({
        error: "access_denied",
        error_description: describeBan({ banReason: "spam" }),
      }),
    ).toEqual({ error: "access_denied", error_description: undefined });
  });

  it("ignores values that aren't strings", () => {
    expect(validateSignInErrorSearch({ error: 1, error_description: ["a"] })).toEqual({
      error: undefined,
      error_description: undefined,
    });
  });
});
