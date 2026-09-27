/**
 * Test-only sign-in (Better Auth plugin): `POST /api/auth/test/sign-in` with a
 * fake Discord id and username creates or reuses that user and sets a real
 * session cookie, so browser tests don't depend on Discord. Only registered
 * when `isTestSignInEnabled` allows it; production startup refuses the flag.
 * It goes through the normal user/session hooks, so admin env ids and bans apply.
 * `POST /api/auth/test/ban` bans or unbans a fake user by Discord id (test-only too).
 * `POST /api/auth/test/seed-room` inserts a room with its presence/stream intervals and
 * end time as given, so browser tests can build past streams without the realtime server.
 */
import type { BetterAuthPlugin, User } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { presenceIntervals, roomMembers, rooms, streamIntervals } from "../db/schema/index.ts";
import { ROOM_KINDS } from "./rooms.ts";

export const TEST_SIGN_IN_PATH = "/test/sign-in";
export const TEST_BAN_PATH = "/test/ban";
export const TEST_SEED_ROOM_PATH = "/test/seed-room";

const seedInterval = z.object({
  userId: z.string().min(1),
  startedAt: z.iso.datetime(),
  /** Omit or null for an interval still open (read as closed at `lastSeenAt`). */
  endedAt: z.iso.datetime().nullish(),
  /** Defaults to `endedAt`, else `startedAt`. */
  lastSeenAt: z.iso.datetime().optional(),
});

const seedRoomBody = z.object({
  name: z.string().min(1),
  hostUserId: z.string().min(1),
  kind: z.enum(ROOM_KINDS).default("chat"),
  tags: z.array(z.string()).default([]),
  isPrivate: z.boolean().default(false),
  createdAt: z.iso.datetime(),
  /** Null or omitted: the room is still live. */
  endedAt: z.iso.datetime().nullish(),
  /** Members besides the host, who always gets a host membership. */
  members: z
    .array(
      z.object({
        userId: z.string().min(1),
        role: z.enum(["mod", "member"]).default("member"),
        approved: z.boolean().default(true),
      }),
    )
    .default([]),
  presence: z.array(seedInterval).default([]),
  streams: z.array(seedInterval).default([]),
});
/** What `POST /api/auth/test/seed-room` takes. User ids come from test sign-ins. */
export type SeedRoom = z.input<typeof seedRoomBody>;

/** Insert a seeded room and its rows in one transaction; returns the room id. */
async function seedRoom(db: Db, body: z.output<typeof seedRoomBody>): Promise<string> {
  const { hostUserId, members, presence, streams, ...room } = body;
  const date = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(rooms)
      .values({
        ...room,
        createdBy: hostUserId,
        hostUserId,
        createdAt: new Date(room.createdAt),
        endedAt: date(room.endedAt),
      })
      .returning({ id: rooms.id });
    if (!row) throw new APIError("INTERNAL_SERVER_ERROR");
    const roomId = row.id;
    const toRows = (spans: z.output<typeof seedInterval>[]) =>
      spans.map((span) => ({
        roomId,
        userId: span.userId,
        startedAt: new Date(span.startedAt),
        endedAt: date(span.endedAt),
        lastSeenAt: new Date(span.lastSeenAt ?? span.endedAt ?? span.startedAt),
      }));
    await tx
      .insert(roomMembers)
      .values([
        { roomId, userId: hostUserId, role: "host" as const },
        ...members.map((member) => ({ roomId, ...member })),
      ]);
    if (presence.length) await tx.insert(presenceIntervals).values(toRows(presence));
    if (streams.length) await tx.insert(streamIntervals).values(toRows(streams));
    return roomId;
  });
}

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
      testSeedRoom: createAuthEndpoint(
        TEST_SEED_ROOM_PATH,
        { method: "POST", body: seedRoomBody },
        async (ctx) => ctx.json({ roomId: await seedRoom(db, ctx.body) }),
      ),
    },
    // Every parallel browser test signs in from the same IP; don't throttle them.
    rateLimit: [
      {
        pathMatcher: (path) =>
          path === TEST_SIGN_IN_PATH || path === TEST_BAN_PATH || path === TEST_SEED_ROOM_PATH,
        window: 60,
        max: 10_000,
      },
    ],
  } satisfies BetterAuthPlugin;
}
