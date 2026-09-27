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
