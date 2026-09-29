import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client.ts";
import {
  adminActions,
  presenceIntervals,
  rooms,
  session,
  user,
  userStats,
} from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { ADMIN_USERS_PAGE_SIZE } from "../lib/admin.ts";
import { createAuth } from "../lib/auth.ts";
import { describeBan } from "../lib/ban.ts";
import {
  type AdminUserDeps,
  BanAdminError,
  banUser,
  listAdminUsers,
  RoleChangeError,
  setUserRole,
  unbanUser,
} from "./admin-users.ts";
import { AdminRequiredError, type Caller } from "./caller.ts";
import type { RoomHub } from "./room-hub.ts";
import { callerFromSession, resolveSession } from "./session.ts";

const testEnv = {
  NODE_ENV: "test" as const,
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
};
const ADMIN_DISCORD_ID = "1000";
/** A listed Discord id that no test signs in with. */
const LISTED_DISCORD_ID = "4000";
/** `ADMIN_DISCORD_IDS`. */
const ENV_ADMINS: ReadonlySet<string> = new Set([ADMIN_DISCORD_ID, LISTED_DISCORD_ID]);

let db: Db;
let close: () => Promise<void>;
let auth: ReturnType<typeof createAuth>;
let admin: Caller;
let adminHeaders: Headers;
let targetId: string;
let disconnectUser: ReturnType<typeof vi.fn<RoomHub["disconnectUser"]>>;
let setHubRole: ReturnType<typeof vi.fn<RoomHub["setUserRole"]>>;
let deps: AdminUserDeps;

const visitor: Caller = { user: null, role: "visitor" };

/** A fake Discord user signed in through the test-only sign-in: their id and session cookie. */
async function signIn(discordId: string, username: string) {
  const response = await auth.handler(
    new Request(`${testEnv.BETTER_AUTH_URL}/api/auth/test/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discordId, username }),
    }),
  );
  const { userId } = (await response.json()) as { userId: string };
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { id: userId, headers: new Headers({ cookie }) };
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  auth = createAuth(db, { env: testEnv, adminDiscordIds: ENV_ADMINS });
  const signedIn = await signIn(ADMIN_DISCORD_ID, "admin_jpg");
  admin = { user: { id: signedIn.id, username: "admin_jpg", image: null }, role: "admin" };
  adminHeaders = signedIn.headers;
  targetId = (await signIn("2000", "spammer")).id;
  disconnectUser = vi.fn(async () => {});
  setHubRole = vi.fn(async () => {});
  deps = { auth, headers: adminHeaders, hub: { disconnectUser, setUserRole: setHubRole } };
});

afterEach(async () => {
  await close();
});

async function userRow(id: string) {
  const [row] = await db.select().from(user).where(eq(user.id, id));
  return row;
}

const auditRows = () =>
  db
    .select({
      actorUserId: adminActions.actorUserId,
      action: adminActions.action,
      targetUserId: adminActions.targetUserId,
      targetRoomId: adminActions.targetRoomId,
      details: adminActions.details,
    })
    .from(adminActions)
    .orderBy(adminActions.at);

describe("admin user functions refuse non-admins", () => {
  const plainUser = (): Caller => ({
    user: { id: targetId, username: "spammer", image: null },
    role: "user",
  });
  const calls: [string, (caller: Caller) => Promise<unknown>][] = [
    ["listAdminUsers", (caller) => listAdminUsers(db, caller, {}, ENV_ADMINS)],
    [
      "banUser",
      (caller) =>
        banUser(db, caller, { userId: targetId, reason: "spam", duration: "permanent" }, deps),
    ],
    ["unbanUser", (caller) => unbanUser(db, caller, { userId: targetId }, deps)],
    ["setUserRole", (caller) => setUserRole(db, caller, { userId: targetId, role: "admin" }, deps)],
  ];
  for (const [name, call] of calls) {
    it(`${name} rejects visitors and users before doing anything`, async () => {
      await expect(call(visitor)).rejects.toBeInstanceOf(AdminRequiredError);
      await expect(call(plainUser())).rejects.toBeInstanceOf(AdminRequiredError);
      await expect(call({ user: null, role: "admin" })).rejects.toBeInstanceOf(AdminRequiredError);
      expect(await userRow(targetId)).toMatchObject({ banned: false, role: "user" });
      expect(await auditRows()).toEqual([]);
      expect(disconnectUser).not.toHaveBeenCalled();
      expect(setHubRole).not.toHaveBeenCalled();
    });
  }
});

describe("banUser", () => {
  it("records a ban with its reason and expiry, revokes sessions, disconnects and audits", async () => {
    const before = Date.now();
    await banUser(db, admin, { userId: targetId, reason: "  spam  ", duration: "7d" }, deps);

    const row = await userRow(targetId);
    expect(row).toMatchObject({ banned: true, banReason: "spam" });
    const expires = row?.banExpires?.getTime() ?? 0;
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(expires).toBeGreaterThanOrEqual(before + week);
    expect(expires).toBeLessThanOrEqual(Date.now() + week);
    // Better Auth's admin plugin revoked every session of theirs.
    expect(await db.select().from(session).where(eq(session.userId, targetId))).toEqual([]);

    expect(disconnectUser).toHaveBeenCalledExactlyOnceWith(
      targetId,
      describeBan({ banReason: "spam", banExpires: row?.banExpires }),
    );
    expect(await auditRows()).toEqual([
      {
        actorUserId: admin.user?.id,
        action: "ban",
        targetUserId: targetId,
        targetRoomId: null,
        details: { reason: "spam", expiresAt: row?.banExpires?.toISOString() },
      },
    ]);
  });

  it("disconnects the user before writing the audit row", async () => {
    let auditedFirst: boolean | undefined;
    disconnectUser.mockImplementation(async () => {
      auditedFirst = (await auditRows()).length > 0;
    });
    await banUser(db, admin, { userId: targetId, reason: "spam", duration: "1d" }, deps);
    expect(auditedFirst).toBe(false);
    expect(await auditRows()).toHaveLength(1);
  });

  it("refuses to ban another admin, writing nothing", async () => {
    const other = await signIn("3000", "other_admin");
    await db.update(user).set({ role: "admin" }).where(eq(user.id, other.id));
    await expect(
      banUser(db, admin, { userId: other.id, reason: "rogue", duration: "permanent" }, deps),
    ).rejects.toBeInstanceOf(BanAdminError);
    expect(await userRow(other.id)).toMatchObject({ banned: false });
    expect(await db.select().from(session).where(eq(session.userId, other.id))).not.toEqual([]);
    expect(await auditRows()).toEqual([]);
    expect(disconnectUser).not.toHaveBeenCalled();
  });

  it("records a permanent ban with no expiry", async () => {
    await banUser(db, admin, { userId: targetId, reason: "abuse", duration: "permanent" }, deps);
    expect(await userRow(targetId)).toMatchObject({ banned: true, banExpires: null });
    expect((await auditRows())[0]?.details).toEqual({ reason: "abuse", expiresAt: null });
  });

  it("still bans when no realtime hub is running", async () => {
    await banUser(
      db,
      admin,
      { userId: targetId, reason: "spam", duration: "1d" },
      { ...deps, hub: null },
    );
    expect(await userRow(targetId)).toMatchObject({ banned: true });
    expect(await auditRows()).toHaveLength(1);
  });

  it("refuses a bad input, an unknown user and the admin themselves, writing nothing", async () => {
    await expect(
      banUser(db, admin, { userId: targetId, reason: " ", duration: "7d" }, deps),
    ).rejects.toThrow();
    await expect(
      banUser(db, admin, { userId: "nobody", reason: "spam", duration: "7d" }, deps),
    ).rejects.toThrow();
    await expect(
      banUser(db, admin, { userId: admin.user?.id ?? "", reason: "oops", duration: "7d" }, deps),
    ).rejects.toThrow();
    expect(await auditRows()).toEqual([]);
    expect(disconnectUser).not.toHaveBeenCalled();
  });
});

describe("unbanUser", () => {
  it("lifts the ban and audits it with what was lifted", async () => {
    await banUser(db, admin, { userId: targetId, reason: "spam", duration: "permanent" }, deps);
    disconnectUser.mockClear();

    await unbanUser(db, admin, { userId: targetId }, deps);

    expect(await userRow(targetId)).toMatchObject({
      banned: false,
      banReason: null,
      banExpires: null,
    });
    expect(disconnectUser).not.toHaveBeenCalled();
    expect((await auditRows()).map((r) => [r.action, r.targetUserId, r.details])).toEqual([
      ["ban", targetId, { reason: "spam", expiresAt: null }],
      ["unban", targetId, { reason: "spam", expiresAt: null }],
    ]);
  });

  it("does nothing, and logs nothing, for a user with no ban in force", async () => {
    await unbanUser(db, admin, { userId: targetId }, deps);
    await unbanUser(db, admin, { userId: "nobody" }, deps);
    // An expired ban no longer counts.
    await db
      .update(user)
      .set({ banned: true, banReason: "old", banExpires: new Date(Date.now() - 60_000) })
      .where(eq(user.id, targetId));
    await unbanUser(db, admin, { userId: targetId }, deps);
    expect(await auditRows()).toEqual([]);
  });

  it("logs one unban for a repeated click", async () => {
    await banUser(db, admin, { userId: targetId, reason: "spam", duration: "7d" }, deps);
    await unbanUser(db, admin, { userId: targetId }, deps);
    await unbanUser(db, admin, { userId: targetId }, deps);
    expect((await auditRows()).map((r) => r.action)).toEqual(["ban", "unban"]);
  });
});

describe("setUserRole", () => {
  /** What `headers`' session resolves to now, as the next navigation would see it. */
  const callerFor = async (headers: Headers) =>
    callerFromSession(await resolveSession(auth, headers));

  it("promotes and demotes a user round-trip, updating live sockets and auditing each", async () => {
    const target = await signIn("2000", "spammer");
    expect((await callerFor(target.headers)).role).toBe("user");

    await setUserRole(db, admin, { userId: targetId, role: "admin" }, deps);
    expect(await userRow(targetId)).toMatchObject({ role: "admin" });
    expect(setHubRole).toHaveBeenLastCalledWith(targetId, "admin");
    expect((await callerFor(target.headers)).role).toBe("admin");

    await setUserRole(db, admin, { userId: targetId, role: "user" }, deps);
    expect(await userRow(targetId)).toMatchObject({ role: "user" });
    expect(setHubRole).toHaveBeenLastCalledWith(targetId, "user");
    // Still signed in, but no longer an admin: /admin sends them home on their next navigation.
    expect(await callerFor(target.headers)).toMatchObject({ user: { id: targetId }, role: "user" });

    expect(await auditRows()).toEqual([
      {
        actorUserId: admin.user?.id,
        action: "promote",
        targetUserId: targetId,
        targetRoomId: null,
        details: {},
      },
      {
        actorUserId: admin.user?.id,
        action: "demote",
        targetUserId: targetId,
        targetRoomId: null,
        details: {},
      },
    ]);
  });

  it("refuses to demote an env admin, even for another admin, writing nothing", async () => {
    const other = await signIn("3000", "other_admin");
    await setUserRole(db, admin, { userId: other.id, role: "admin" }, deps);
    setHubRole.mockClear();
    const otherAdmin: Caller = {
      user: { id: other.id, username: "other_admin", image: null },
      role: "admin",
    };

    await expect(
      setUserRole(
        db,
        otherAdmin,
        { userId: admin.user?.id ?? "", role: "user" },
        { ...deps, headers: other.headers },
      ),
    ).rejects.toThrow(/ADMIN_DISCORD_IDS/);
    expect(await userRow(admin.user?.id ?? "")).toMatchObject({ role: "admin" });
    expect(setHubRole).not.toHaveBeenCalled();
    expect((await auditRows()).map((r) => r.action)).toEqual(["promote"]);
  });

  it("refuses to demote yourself, so an admin always remains", async () => {
    const other = await signIn("3000", "other_admin");
    await setUserRole(db, admin, { userId: other.id, role: "admin" }, deps);
    const otherAdmin: Caller = {
      user: { id: other.id, username: "other_admin", image: null },
      role: "admin",
    };

    await expect(
      setUserRole(
        db,
        otherAdmin,
        { userId: other.id, role: "user" },
        { ...deps, headers: other.headers },
      ),
    ).rejects.toBeInstanceOf(RoleChangeError);
    expect(await userRow(other.id)).toMatchObject({ role: "admin" });
    expect((await auditRows()).map((r) => r.action)).toEqual(["promote"]);
  });

  it("undoes a demote that left no admin at all, as two admins demoting each other would", async () => {
    const other = await signIn("3000", "other_admin");
    await setUserRole(db, admin, { userId: other.id, role: "admin" }, deps);
    setHubRole.mockClear();
    // The other admin demotes the caller at the same moment (as if ADMIN_DISCORD_IDS were
    // empty): it lands just after the caller's own demote of them went through.
    const racing: AdminUserDeps["auth"] = {
      api: {
        ...auth.api,
        setRole: async (request: Parameters<typeof auth.api.setRole>[0]) => {
          const result = await auth.api.setRole(request);
          await db
            .update(user)
            .set({ role: "user" })
            .where(eq(user.id, admin.user?.id ?? ""));
          return result;
        },
      } as typeof auth.api,
    };

    await expect(
      setUserRole(db, admin, { userId: other.id, role: "user" }, { ...deps, auth: racing }),
    ).rejects.toThrow(/last admin/);
    expect(await userRow(other.id)).toMatchObject({ role: "admin" });
    expect(setHubRole).not.toHaveBeenCalled();
    expect((await auditRows()).map((r) => r.action)).toEqual(["promote"]);
  });

  it("refuses to promote a banned user: admins can't be banned", async () => {
    await banUser(db, admin, { userId: targetId, reason: "spam", duration: "7d" }, deps);
    await expect(
      setUserRole(db, admin, { userId: targetId, role: "admin" }, deps),
    ).rejects.toBeInstanceOf(RoleChangeError);
    expect(await userRow(targetId)).toMatchObject({ role: "user" });
    expect(setHubRole).not.toHaveBeenCalled();
    expect((await auditRows()).map((r) => r.action)).toEqual(["ban"]);
  });

  it("does nothing for the role someone already has, and refuses an unknown user", async () => {
    await setUserRole(db, admin, { userId: targetId, role: "user" }, deps);
    await setUserRole(db, admin, { userId: admin.user?.id ?? "", role: "admin" }, deps);
    await expect(
      setUserRole(db, admin, { userId: "nobody", role: "admin" }, deps),
    ).rejects.toThrow();
    expect(setHubRole).not.toHaveBeenCalled();
    expect(await auditRows()).toEqual([]);
  });

  it("still changes the role when no realtime hub is running", async () => {
    await setUserRole(db, admin, { userId: targetId, role: "admin" }, { ...deps, hub: null });
    expect(await userRow(targetId)).toMatchObject({ role: "admin" });
    expect((await auditRows()).map((r) => r.action)).toEqual(["promote"]);
  });
});

describe("listAdminUsers", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const HOUR = 3600;

  beforeEach(async () => {
    await db.delete(user);
    await db.insert(user).values(
      ["amber", "bo", "cy", "banned_bo", "was_banned"].map((name, i) => ({
        id: name,
        name,
        email: `${name}@discord.invalid`,
        discordUsername: name,
        // amber is an env admin; cy is listed too but hasn't signed in since, so isn't one yet.
        discordId: name === "amber" ? ADMIN_DISCORD_ID : name === "cy" ? LISTED_DISCORD_ID : null,
        role: name === "amber" ? "admin" : "user",
        createdAt: minutesAgo(1000 - i),
        banned: name.includes("banned"),
        banReason: name.includes("banned") ? "spam" : null,
        // An expired ban no longer counts.
        banExpires: name === "was_banned" ? minutesAgo(1) : null,
      })),
    );
    await db.insert(userStats).values([
      { userId: "bo", secondsStreamed: 2 * HOUR, secondsWatched: HOUR / 2 },
      { userId: "cy", secondsWatched: HOUR },
    ]);
    await db.insert(rooms).values({
      id: "r",
      name: "r",
      hostUserId: "bo",
      createdBy: "bo",
      createdAt: minutesAgo(120),
    });
    await db.insert(presenceIntervals).values([
      // bo: an earlier stay, and one still open (last seen at the latest checkpoint).
      {
        roomId: "r",
        userId: "bo",
        startedAt: minutesAgo(120),
        endedAt: minutesAgo(100),
        lastSeenAt: minutesAgo(100),
      },
      { roomId: "r", userId: "bo", startedAt: minutesAgo(30), lastSeenAt: minutesAgo(1) },
      {
        roomId: "r",
        userId: "cy",
        startedAt: minutesAgo(60),
        endedAt: minutesAgo(50),
        lastSeenAt: minutesAgo(55),
      },
    ]);
  });

  it("lists users newest first with role, ban, last seen and lifetime hours", async () => {
    const page = await listAdminUsers(db, admin, {}, ENV_ADMINS, now);
    expect(page).toMatchObject({ total: 5, page: 1, pageSize: ADMIN_USERS_PAGE_SIZE });
    expect(page.users.map((u) => u.id)).toEqual(["was_banned", "banned_bo", "cy", "bo", "amber"]);
    const byId = new Map(page.users.map((u) => [u.id, u]));
    expect(byId.get("bo")).toEqual({
      id: "bo",
      username: "bo",
      image: null,
      joinedAt: minutesAgo(999).toISOString(),
      role: "user",
      envAdmin: false,
      ban: null,
      lastSeenAt: minutesAgo(1).toISOString(),
      hours: 2.5,
    });
    expect(byId.get("cy")).toMatchObject({ lastSeenAt: minutesAgo(50).toISOString(), hours: 1 });
    expect(byId.get("amber")).toMatchObject({
      role: "admin",
      envAdmin: true,
      lastSeenAt: null,
      hours: 0,
    });
    expect(byId.get("cy")).toMatchObject({ role: "user", envAdmin: false });
    expect(byId.get("banned_bo")?.ban).toEqual({ reason: "spam", expiresAt: null });
    expect(byId.get("was_banned")?.ban).toBeNull();
  });

  it("searches usernames case-insensitively, literally", async () => {
    const found = await listAdminUsers(db, admin, { q: "BO" }, ENV_ADMINS, now);
    expect(found.users.map((u) => u.id)).toEqual(["banned_bo", "bo"]);
    expect(found.total).toBe(2);
    expect(
      (await listAdminUsers(db, admin, { q: "_" }, ENV_ADMINS, now)).users.map((u) => u.id),
    ).toEqual(["was_banned", "banned_bo"]);
    expect((await listAdminUsers(db, admin, { q: "%" }, ENV_ADMINS, now)).total).toBe(0);
  });

  it("lists only users banned now", async () => {
    const banned = await listAdminUsers(db, admin, { banned: true }, ENV_ADMINS, now);
    expect(banned.users.map((u) => u.id)).toEqual(["banned_bo"]);
    expect(banned.total).toBe(1);
  });

  it("pages through users", async () => {
    await db.insert(user).values(
      Array.from({ length: ADMIN_USERS_PAGE_SIZE }, (_, i) => ({
        id: `old${String(i).padStart(2, "0")}`,
        name: `old${i}`,
        email: `old${i}@discord.invalid`,
        createdAt: minutesAgo(5000 + i),
      })),
    );
    const first = await listAdminUsers(db, admin, { page: 1 }, ENV_ADMINS, now);
    const second = await listAdminUsers(db, admin, { page: 2 }, ENV_ADMINS, now);
    expect(first.total).toBe(5 + ADMIN_USERS_PAGE_SIZE);
    expect(first.users).toHaveLength(ADMIN_USERS_PAGE_SIZE);
    expect(second.users.map((u) => u.id)).toEqual(["old20", "old21", "old22", "old23", "old24"]);
    expect((await listAdminUsers(db, admin, { page: 3 }, ENV_ADMINS, now)).users).toEqual([]);
  });
});
