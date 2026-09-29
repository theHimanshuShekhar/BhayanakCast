/**
 * Admin users table, bans, admin roles and the audit log (spec #7, ADR 6 addendum). Like
 * ./admin.ts, every function takes the database and the caller explicitly and refuses anyone
 * without the admin role before doing anything.
 *
 * Bans go through Better Auth's admin plugin as the calling admin (it records the reason and
 * expiry and revokes the user's sessions), then the live realtime hub disconnects the user so
 * any room they're in sees them leave at once. Promote and demote go through the plugin's
 * set-role (whose hook in src/lib/auth.ts refuses to demote an env admin), then the hub updates
 * the user's open sockets. Every action writes an `admin_actions` row (kept indefinitely, ADR 6
 * and 11 addenda).
 */
import { and, count, desc, eq, gt, isNull, max, notExists, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  type AdminActionKind,
  adminActions,
  presenceIntervals,
  user,
  userStats,
} from "../db/schema/index.ts";
import {
  ADMIN_USERS_PAGE_SIZE,
  type AdminBan,
  type AdminUsersPage,
  BAN_DURATIONS,
  type BanUserInput,
  banUserInput,
  type ListAdminUsersInput,
  listAdminUsersInput,
  type SetUserRoleInput,
  setUserRoleInput,
  toAdminRole,
  type UnbanUserInput,
  unbanUserInput,
} from "../lib/admin.ts";
import type { auth } from "../lib/auth.ts";
import { describeBan } from "../lib/ban.ts";
import { secondsToHours } from "../lib/profiles.ts";
import { type AdminCaller, type Caller, requireAdmin } from "./caller.ts";
import { escapeLike, username } from "./profiles.ts";
import type { RoomHub } from "./room-hub.ts";

/** Thrown when an admin tries to ban another admin: they must be demoted first. */
export class BanAdminError extends Error {
  constructor() {
    super("Admins can't be banned; demote them first");
    this.name = "BanAdminError";
  }
}

/** Thrown for a role change that isn't allowed: demoting yourself, or promoting a banned user. */
export class RoleChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleChangeError";
  }
}

/** What banning, unbanning and role changes need besides the database. */
export interface AdminUserDeps {
  /** Better Auth, whose admin plugin bans, unbans and sets roles. */
  auth: Pick<typeof auth, "api">;
  /** The calling admin's request headers: the plugin checks their session itself. */
  headers: Headers;
  /** The live realtime hub (./live-hub.ts); null when none runs in this process. */
  hub: Pick<RoomHub, "disconnectUser" | "setUserRole"> | null;
}

/** Log an admin action (who, what, on whom or which room, with what details). */
export async function recordAdminAction(
  db: Db,
  caller: AdminCaller,
  action: AdminActionKind,
  target: { userId?: string; roomId?: string },
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(adminActions).values({
    actorUserId: caller.user.id,
    action,
    targetUserId: target.userId ?? null,
    targetRoomId: target.roomId ?? null,
    details,
  });
}

/** Whether a ban in `banned`/`banExpires` is in force at `now` (an expired one isn't). */
const banInForce = (row: { banned: boolean | null; banExpires: Date | null }, now: Date): boolean =>
  !!row.banned && (!row.banExpires || row.banExpires > now);

/** SQL: `user` is banned at `now` (an expired ban no longer counts). */
const bannedAt = (now: Date) =>
  and(eq(user.banned, true), or(isNull(user.banExpires), gt(user.banExpires, now)));

/**
 * A page of users, newest first, whose username contains `q` (case-insensitive), with their
 * lifetime hours and when they were last in a room. `envAdminIds` are the Discord ids in
 * `ADMIN_DISCORD_IDS`, whose users are marked as env admins.
 */
export async function listAdminUsers(
  db: Db,
  caller: Caller,
  input: ListAdminUsersInput,
  envAdminIds: ReadonlySet<string>,
  now: Date = new Date(),
): Promise<AdminUsersPage> {
  requireAdmin(caller);
  const { q, banned, page } = listAdminUsersInput.parse(input);
  const where = and(
    q ? sql`${username} ilike ${`%${escapeLike(q)}%`}` : undefined,
    banned ? bannedAt(now) : undefined,
  );
  const lastSeen = db
    .select({
      userId: presenceIntervals.userId,
      at: max(
        sql<Date>`coalesce(${presenceIntervals.endedAt}, ${presenceIntervals.lastSeenAt})`,
      ).as("last_seen"),
    })
    .from(presenceIntervals)
    .groupBy(presenceIntervals.userId)
    .as("last_seen");
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: user.id,
        username,
        image: user.image,
        createdAt: user.createdAt,
        role: user.role,
        discordId: user.discordId,
        banned: user.banned,
        banReason: user.banReason,
        banExpires: user.banExpires,
        lastSeenAt: lastSeen.at,
        secondsStreamed: userStats.secondsStreamed,
        secondsWatched: userStats.secondsWatched,
      })
      .from(user)
      .leftJoin(userStats, eq(userStats.userId, user.id))
      .leftJoin(lastSeen, eq(lastSeen.userId, user.id))
      .where(where)
      .orderBy(desc(user.createdAt), desc(user.id))
      .limit(ADMIN_USERS_PAGE_SIZE)
      .offset((page - 1) * ADMIN_USERS_PAGE_SIZE),
    db.select({ n: count() }).from(user).where(where),
  ]);
  return {
    users: rows.map((row) => {
      const ban: AdminBan | null = banInForce(row, now)
        ? { reason: row.banReason, expiresAt: row.banExpires?.toISOString() ?? null }
        : null;
      const role = toAdminRole(row.role);
      return {
        id: row.id,
        username: row.username,
        image: row.image,
        joinedAt: row.createdAt.toISOString(),
        role,
        envAdmin: role === "admin" && row.discordId !== null && envAdminIds.has(row.discordId),
        ban,
        lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
        hours: secondsToHours((row.secondsStreamed ?? 0) + (row.secondsWatched ?? 0)),
      };
    }),
    total: totalRow?.n ?? 0,
    page,
    pageSize: ADMIN_USERS_PAGE_SIZE,
  };
}

/**
 * Ban a user (ADR 6) for `duration` with `reason`: they can't sign in, their sessions end, and
 * they are disconnected from the realtime server, leaving any room they're in. Admins can't be
 * banned (`BanAdminError`).
 */
export async function banUser(
  db: Db,
  caller: Caller,
  input: BanUserInput,
  deps: AdminUserDeps,
): Promise<void> {
  requireAdmin(caller);
  const { userId, reason, duration } = banUserInput.parse(input);
  const [target] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId));
  if (target?.role === "admin") throw new BanAdminError();
  const expiresIn = BAN_DURATIONS[duration];
  const { user: banned } = await deps.auth.api.banUser({
    body: { userId, banReason: reason, ...(expiresIn ? { banExpiresIn: expiresIn } : {}) },
    headers: deps.headers,
  });
  const expiresAt = banned.banExpires ? new Date(banned.banExpires) : null;
  // Disconnect before auditing, so a failed audit write can't leave a banned user in a room.
  await deps.hub?.disconnectUser(userId, describeBan({ banReason: reason, banExpires: expiresAt }));
  await recordAdminAction(
    db,
    caller,
    "ban",
    { userId },
    { reason, expiresAt: expiresAt?.toISOString() ?? null },
  );
}

/**
 * Lift a user's ban; the audit row keeps what was lifted. Unbanning someone with no ban in
 * force (a repeated click, an expired ban, an unknown id) does nothing and logs nothing.
 */
export async function unbanUser(
  db: Db,
  caller: Caller,
  input: UnbanUserInput,
  deps: AdminUserDeps,
  now: Date = new Date(),
): Promise<void> {
  requireAdmin(caller);
  const { userId } = unbanUserInput.parse(input);
  const [before] = await db
    .select({ banned: user.banned, banReason: user.banReason, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, userId));
  if (!before || !banInForce(before, now)) return;
  await deps.auth.api.unbanUser({ body: { userId }, headers: deps.headers });
  await recordAdminAction(
    db,
    caller,
    "unban",
    { userId },
    { reason: before.banReason, expiresAt: before.banExpires?.toISOString() ?? null },
  );
}

/**
 * Promote a user to admin or demote an admin (ADR 6 addendum) through the admin plugin's
 * set-role. Their open sockets gain or lose admin powers at once, and their next navigation
 * sees the new role. Refused: demoting yourself or the last admin, promoting a banned user
 * (admins can't be banned) and, by the set-role hook, demoting an env admin.
 * Giving someone the role they already have does nothing and logs nothing.
 */
export async function setUserRole(
  db: Db,
  caller: Caller,
  input: SetUserRoleInput,
  deps: AdminUserDeps,
  now: Date = new Date(),
): Promise<void> {
  requireAdmin(caller);
  const { userId, role } = setUserRoleInput.parse(input);
  if (role !== "admin" && userId === caller.user.id) {
    throw new RoleChangeError("You can't demote yourself; ask another admin");
  }
  const [target] = await db
    .select({ role: user.role, banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, userId));
  if (target && toAdminRole(target.role) === role) return;
  if (target && role === "admin" && banInForce(target, now)) {
    throw new RoleChangeError("Banned users can't be admins; unban them first");
  }
  // Refuses an unknown user and (the hook in src/lib/auth.ts) demoting an env admin.
  await deps.auth.api.setRole({ body: { userId, role }, headers: deps.headers });
  if (role === "user") {
    // Two admins demoting each other at once could leave none: whichever demote finds no admin
    // left is undone, in one conditional statement, so at least one admin always remains.
    const undone = await db
      .update(user)
      .set({ role: "admin" })
      .where(
        and(
          eq(user.id, userId),
          notExists(db.select({ id: user.id }).from(user).where(eq(user.role, "admin"))),
        ),
      )
      .returning({ id: user.id });
    if (undone.length) throw new RoleChangeError("They're the last admin, so they stay one");
  }
  await deps.hub?.setUserRole(userId, role);
  await recordAdminAction(db, caller, role === "admin" ? "promote" : "demote", { userId });
}
