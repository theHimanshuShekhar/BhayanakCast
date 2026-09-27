/** Browser-side Better Auth client (ADR 7). Sign in with `signInWithDiscord()`. */
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from "./auth.ts";

export const authClient = createAuthClient({
  plugins: [adminClient(), inferAdditionalFields<typeof auth>()],
});

export const { useSession, signOut } = authClient;

export function signInWithDiscord(callbackURL = "/") {
  return authClient.signIn.social({ provider: "discord", callbackURL });
}
