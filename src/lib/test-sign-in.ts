/**
 * Test-only sign-in (Better Auth plugin): `POST /api/auth/test/sign-in` with a
 * fake Discord id and username creates or reuses that user and sets a real
 * session cookie, so browser tests don't depend on Discord. Only registered
 * when `isTestSignInEnabled` allows it; production startup refuses the flag.
 * It goes through the normal user/session hooks, so admin env ids and bans apply.
 * `POST /api/auth/test/ban` bans or unbans a fake user by Discord id (test-only too).
 * `POST /api/auth/test/stats` sets a fake user's lifetime stats and co-time (test-only too).
 */
import type { BetterAuthPlugin, User } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { userCotime, userStats, user as userTable } from "../db/schema/index.ts";

export const TEST_SIGN_IN_PATH = "/test/sign-in";
export const TEST_BAN_PATH = "/test/ban";
export const TEST_STATS_PATH = "/test/stats";

const count = z.number().int().nonnegative();

export function testSignIn(db: Db) {
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
      // Bans or unbans a fake user by Discord id, straight on the user row, the way a
      // test would edit the DB: sessions are left in place so tests see the ban take
      // effect on the next request. (Real bans go through the admin plugin, spec #7.)
      testSetBan: createAuthEndpoint(
        TEST_BAN_PATH,
        {
          method: "POST",
          body: z.object({
            discordId: z.string().min(1),
            banned: z.boolean(),
            reason: z.string().optional(),
            expiresAt: z.iso.datetime().optional(),
          }),
        },
        async (ctx) => {
          const { discordId, banned, reason, expiresAt } = ctx.body;
          const updated = await ctx.context.adapter.update<User>({
            model: "user",
            where: [{ field: "discordId", value: discordId }],
            update: {
              banned,
              banReason: banned ? (reason ?? null) : null,
              banExpires: banned && expiresAt ? new Date(expiresAt) : null,
            },
          });
          if (!updated)
            throw new APIError("NOT_FOUND", { message: "No user with that Discord id" });
          return ctx.json({ userId: updated.id });
        },
      ),
      // Seeds the persistent aggregates the way the stats roll-up would leave them, so
      // browser tests can show real profile stats without playing out whole rooms.
      testSetStats: createAuthEndpoint(
        TEST_STATS_PATH,
        {
          method: "POST",
          body: z.object({
            discordId: z.string().min(1),
            stats: z
              .object({
                secondsStreamed: count,
                secondsWatched: count,
                roomsHosted: count,
                roomsJoined: count,
                peakViewers: count,
              })
              .partial()
              .default({}),
            cotime: z
              .array(z.object({ discordId: z.string().min(1), secondsTogether: count }))
              .default([]),
          }),
        },
        async (ctx) => {
          const { discordId, stats, cotime } = ctx.body;
          const rows = await db
            .select({ id: userTable.id, discordId: userTable.discordId })
            .from(userTable)
            .where(inArray(userTable.discordId, [discordId, ...cotime.map((c) => c.discordId)]));
          const userIdOf = new Map(rows.map((row) => [row.discordId, row.id]));
          const userId = userIdOf.get(discordId);
          if (!userId || cotime.some((c) => !userIdOf.has(c.discordId)))
            throw new APIError("NOT_FOUND", { message: "No user with that Discord id" });
          await db
            .insert(userStats)
            .values({ userId, ...stats })
            .onConflictDoUpdate({ target: userStats.userId, set: { ...stats, userId } });
          for (const { discordId: otherDiscordId, secondsTogether } of cotime) {
            const other = userIdOf.get(otherDiscordId) ?? "";
            // One row per pair, userA < userB, as the roll-up stores it.
            const [userA, userB] = userId < other ? [userId, other] : [other, userId];
            await db
              .insert(userCotime)
              .values({ userA, userB, secondsTogether })
              .onConflictDoUpdate({
                target: [userCotime.userA, userCotime.userB],
                set: { secondsTogether },
              });
          }
          return ctx.json({ userId });
        },
      ),
    },
    // Every parallel browser test signs in from the same IP; don't throttle them.
    rateLimit: [
      {
        pathMatcher: (path) =>
          path === TEST_SIGN_IN_PATH || path === TEST_BAN_PATH || path === TEST_STATS_PATH,
        window: 60,
        max: 10_000,
      },
    ],
  } satisfies BetterAuthPlugin;
}
