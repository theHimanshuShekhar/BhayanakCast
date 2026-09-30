/** Browser-side Better Auth client (ADR 7). Sign in with `signInWithDiscord()`. */
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from "./auth.ts";

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
});

export const { useSession, signOut } = authClient;

/**
 * A failed sign-in (e.g. a banned user) also returns to home, with Better Auth's
 * `?error=…&error_description=…`, which home turns into a notice.
 */
export function signInWithDiscord(callbackURL = "/") {
  return authClient.signIn.social({ provider: "discord", callbackURL, errorCallbackURL: "/" });
}
