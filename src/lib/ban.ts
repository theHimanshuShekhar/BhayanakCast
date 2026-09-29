/**
 * Bans (Better Auth admin plugin fields `banned`/`banReason`/`banExpires`).
 * A banned user can't sign in: the Discord callback lands on home with
 * `?error=BANNED_USER&error_description=<describeBan(...)>`, which home shows
 * as the ban notice. Shared by server and client; no server-only imports.
 */

/** Error code the admin plugin puts in the OAuth callback's `error` query param. */
export const BANNED_USER_ERROR = "BANNED_USER";

export interface BanFields {
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | string | null;
}

/** Whether a ban is in force at `now`: a ban whose expiry has passed no longer counts. */
export function isBanActive(user: BanFields, now: Date = new Date()): boolean {
  if (!user.banned) return false;
  if (!user.banExpires) return true;
  return new Date(user.banExpires).getTime() > now.getTime();
}

const UTC_DATE = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** The ban notice's detail line: the reason and when the ban ends, if they were given. */
export function describeBan(user: BanFields): string {
  const reason = user.banReason?.trim();
  const reasonText = reason ? `Reason: ${reason}.` : "No reason was given.";
  const expiryText = user.banExpires
    ? `The ban ends ${UTC_DATE.format(new Date(user.banExpires))} UTC.`
    : "The ban has no end date.";
  return `${reasonText} ${expiryText}`;
}

/**
 * Where a signed-in user an admin just banned goes (the realtime server tells them `banned`
 * with `describeBan` as the message): home, showing the ban notice like a refused sign-in.
 */
export function banNoticeHref(description: string): string {
  return `/?${new URLSearchParams({ error: BANNED_USER_ERROR, error_description: description })}`;
}

/** Home's search params for a failed Discord sign-in (Better Auth's error redirect). */
export interface SignInErrorSearch {
  error?: string;
  error_description?: string;
}

export function validateSignInErrorSearch(search: Record<string, unknown>): SignInErrorSearch {
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  return { error: text(search.error), error_description: text(search.error_description) };
}
