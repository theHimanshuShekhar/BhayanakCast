/**
 * Test-only sign-in (Better Auth plugin): `POST /api/auth/test/sign-in` with a
 * fake Discord id and username creates or reuses that user and sets a real
 * session cookie, so browser tests don't depend on Discord. Only registered
 * when `isTestSignInEnabled` allows it; production startup refuses the flag.
 * It goes through the normal user/session hooks, so admin env ids and bans apply.
 */
import type { BetterAuthPlugin, User } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

export const TEST_SIGN_IN_PATH = "/test/sign-in";

export function testSignIn() {
  return {
    id: "test-sign-in",
    endpoints: {
      testSignIn: createAuthEndpoint(
        TEST_SIGN_IN_PATH,
        {
          method: "POST",
          body: z.object({ discordId: z.string().min(1), username: z.string().min(1) }),
        },
        async (ctx) => {
          const { discordId, username } = ctx.body;
          const { adapter, internalAdapter } = ctx.context;
          const find = () =>
            adapter.findOne<User>({
              model: "user",
              where: [{ field: "discordId", value: discordId }],
            });
          const create = () =>
            internalAdapter.createUser(
              {
                name: username,
                email: `${discordId}@discord.invalid`,
                discordId,
                discordUsername: username,
              },
              { method: "test-sign-in" },
            );
          // Parallel tests may sign in the same fake user at once; the loser of
          // the unique-discordId race reuses the winner's row.
          const user = (await find()) ?? (await create().catch(find));
          if (!user) throw new APIError("INTERNAL_SERVER_ERROR");
          const session = await internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ userId: user.id });
        },
      ),
    },
    // Every parallel browser test signs in from the same IP; don't throttle them.
    rateLimit: [{ pathMatcher: (path) => path === TEST_SIGN_IN_PATH, window: 60, max: 10_000 }],
  } satisfies BetterAuthPlugin;
}
