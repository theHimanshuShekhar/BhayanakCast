/**
 * Who is calling a server function: a visitor, a user or an admin. Server code
 * takes the caller as an argument (tests pass one in); server functions get it
 * from the session with `getCaller()` (./request-caller.ts), never from ids the
 * client sends.
 */
import type { CurrentSession } from "~/lib/current-user";

/** The caller as the server sees it. Same shape the UI gets in router context. */
export type Caller = CurrentSession;

/** A caller who is signed in. */
export type SignedInCaller = Caller & { user: NonNullable<Caller["user"]> };

/** Thrown when a visitor calls something that needs sign-in. */
export class SignInRequiredError extends Error {
  constructor() {
    super("Sign in to do that");
    this.name = "SignInRequiredError";
  }
}

export function requireSignedIn(caller: Caller): asserts caller is SignedInCaller {
  if (!caller.user) throw new SignInRequiredError();
}

/** A signed-in caller with the admin role. */
export type AdminCaller = SignedInCaller & { role: "admin" };

/** Thrown when a visitor or non-admin calls something that needs the admin role (ADR 6). */
export class AdminRequiredError extends Error {
  constructor() {
    super("Only admins can do that");
    this.name = "AdminRequiredError";
  }
}

export function requireAdmin(caller: Caller): asserts caller is AdminCaller {
  if (!caller.user || caller.role !== "admin") throw new AdminRequiredError();
}
