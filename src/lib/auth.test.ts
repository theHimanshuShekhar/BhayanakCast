import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client.ts";
import { dailyPlatformStats, session, user, userCotime, userStats } from "../db/schema/index.ts";
import { DEFAULT_USER_SETTINGS } from "../db/settings.ts";
import { createTestDb } from "../db/test-db.ts";
import { CLIENT_IP_HEADER } from "../server/client-ip.ts";
import { resolveSession } from "../server/session.ts";
import { createAuth } from "./auth.ts";
import { BANNED_USER_ERROR } from "./ban.ts";

const testEnv = {
  NODE_ENV: "test" as const,
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
};

let db: Db;
let close: () => Promise<void>;
let auth: ReturnType<typeof createAuth>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  auth = createAuth(db, { env: testEnv, adminDiscordIds: new Set(["1000"]) });
});

afterEach(async () => {
  await close();
});

async function createDiscordUser(discordId: string) {
  const { internalAdapter } = await auth.$context;
  return internalAdapter.createUser(
    {
      name: `user ${discordId}`,
      email: `${discordId}@discord.invalid`,
      discordId,
      discordUsername: `u${discordId}`,
    },
    { method: "oauth" },
  );
}

function testSignInRequest(discordId: string, username: string, image?: string) {
  return auth.handler(
    new Request(`${testEnv.BETTER_AUTH_URL}/api/auth/test/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discordId, username, image }),
    }),
  );
}

/** Replays a response's Set-Cookie headers as a request Cookie header. */
function cookiesFrom(response: Response) {
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

async function roleOf(id: string) {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, id));
  return row?.role;
}

describe("auth database hooks", () => {
  it("creates users through the Drizzle adapter with default settings", async () => {
    const created = await createDiscordUser("2000");
    const [row] = await db.select().from(user).where(eq(user.id, created.id));
    expect(row).toMatchObject({
      discordId: "2000",
      discordUsername: "u2000",
      role: "user",
      banned: false,
      settings: DEFAULT_USER_SETTINGS,
    });
  });

  it("grants admin at sign-up to Discord ids in ADMIN_DISCORD_IDS", async () => {
    const admin = await createDiscordUser("1000");
    const regular = await createDiscordUser("2000");
    expect(await roleOf(admin.id)).toBe("admin");
    expect(await roleOf(regular.id)).toBe("user");
  });

  it("promotes existing users on their next sign-in once listed", async () => {
    const existing = await createDiscordUser("3000");
    expect(await roleOf(existing.id)).toBe("user");

    auth = createAuth(db, { env: testEnv, adminDiscordIds: new Set(["3000"]) });
    const { internalAdapter } = await auth.$context;
    await internalAdapter.createSession(existing.id);
    expect(await roleOf(existing.id)).toBe("admin");
  });

  it("changes roles only through set-role, not the admin plugin's update-user (#45)", async () => {
    const adminHeaders = cookiesFrom(await testSignInRequest("1000", "root"));
    const target = await createDiscordUser("2000");
    const update = (data: Record<string, unknown>) =>
      auth.api.adminUpdateUser({ body: { userId: target.id, data }, headers: adminHeaders });

    await expect(update({ role: "admin" })).rejects.toThrow(/set-role/);
    expect(await roleOf(target.id)).toBe("user");
    // Other fields still update.
    await update({ name: "renamed" });
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, target.id));
    expect(row?.name).toBe("renamed");

    await auth.api.setRole({ body: { userId: target.id, role: "admin" }, headers: adminHeaders });
    expect(await roleOf(target.id)).toBe("admin");
  });

  it("counts sign-ups in the daily platform stats", async () => {
    await createDiscordUser("2000");
    await createDiscordUser("2001");
    const rows = await db.select().from(dailyPlatformStats);
    expect(rows.reduce((sum, r) => sum + r.newUsers, 0)).toBe(2);
  });
});

describe("test-only sign-in", () => {
  it("signs in a named fake user with a valid session cookie", async () => {
    const response = await testSignInRequest("4000", "kodama_jpg");
    expect(response.status).toBe(200);
    const session = await auth.api.getSession({ headers: cookiesFrom(response) });
    expect(session?.user).toMatchObject({ discordId: "4000", discordUsername: "kodama_jpg" });
  });

  it("reuses the user for the same Discord id, even when signed in concurrently", async () => {
    const [first, second] = await Promise.all([
      testSignInRequest("4000", "kodama_jpg"),
      testSignInRequest("4000", "kodama_jpg"),
    ]);
    const userIdOf = async (response: Response) =>
      ((await response.json()) as { userId: string }).userId;
    expect(await userIdOf(second)).toBe(await userIdOf(first));
    expect(await db.select().from(user)).toHaveLength(1);
  });

  it("gives a fake user whose Discord id is in ADMIN_DISCORD_IDS the admin role", async () => {
    const admin = await testSignInRequest("1000", "admin_jpg");
    const regular = await testSignInRequest("4000", "kodama_jpg");
    const roleIn = async (response: Response) =>
      (await auth.api.getSession({ headers: cookiesFrom(response) }))?.user.role;
    expect(await roleIn(admin)).toBe("admin");
    expect(await roleIn(regular)).toBe("user");
  });

  it("seeds stats and one-way co-time through the test-only stats endpoint", async () => {
    await testSignInRequest("4000", "kodama_jpg");
    await testSignInRequest("4001", "bitreverb");
    const setStats = (body: object) =>
      auth.handler(
        new Request(`${testEnv.BETTER_AUTH_URL}/api/auth/test/stats`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const seed = {
      stats: { secondsStreamed: 7200, peakViewers: 4 },
      cotime: [{ discordId: "4000", secondsTogether: 600 }],
    };

    expect((await setStats({ discordId: "4001", ...seed })).status).toBe(200);
    // Again, to update in place.
    expect((await setStats({ discordId: "4001", ...seed })).status).toBe(200);
    const idOf = async (discordId: string) =>
      (await db.select().from(user).where(eq(user.discordId, discordId)))[0]?.id ?? "";
    const [a, b] = [await idOf("4000"), await idOf("4001")].sort();
    expect(await db.select().from(userStats)).toEqual([
      expect.objectContaining({
        userId: await idOf("4001"),
        secondsStreamed: 7200,
        peakViewers: 4,
      }),
    ]);
    expect(await db.select().from(userCotime)).toEqual([
      { userA: a, userB: b, secondsTogether: 600 },
    ]);
    expect((await setStats({ discordId: "9999" })).status).toBe(404);
  });

  it.each([
    { NODE_ENV: "production" as const, E2E_AUTH: "1" },
    { NODE_ENV: "development" as const, E2E_AUTH: undefined },
  ])("is refused with NODE_ENV=$NODE_ENV and E2E_AUTH=$E2E_AUTH", async (flags) => {
    auth = createAuth(db, { env: { ...testEnv, ...flags }, adminDiscordIds: new Set() });
    const response = await testSignInRequest("4000", "kodama_jpg");
    expect(response.status).toBe(404);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await db.select().from(user)).toHaveLength(0);
  });
});

/** Better Auth's own `/update-user` as the signed-in user of `signedIn`'s cookies. */
function updateUserRequest(signedIn: Response, body: object) {
  const headers = cookiesFrom(signedIn);
  headers.set("content-type", "application/json");
  headers.set("origin", testEnv.BETTER_AUTH_URL);
  return auth.handler(
    new Request(`${testEnv.BETTER_AUTH_URL}/api/auth/update-user`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("settings column", () => {
  it("can't be written through Better Auth's /update-user", async () => {
    const signedIn = await testSignInRequest("4000", "kodama_jpg");
    const { userId } = (await signedIn.clone().json()) as { userId: string };
    const updateUser = (body: object) => updateUserRequest(signedIn, body);
    const rowOf = async () => {
      const [row] = await db.select().from(user).where(eq(user.id, userId));
      return row;
    };
    await updateUser({ settings: { ...DEFAULT_USER_SETTINGS, theme: "light" } });
    expect((await rowOf())?.settings).toEqual(DEFAULT_USER_SETTINGS);
  });
});

describe("name column", () => {
  it("can't be written through Better Auth's /update-user", async () => {
    const signedIn = await testSignInRequest("4300", "kodama_jpg");
    const { userId } = (await signedIn.clone().json()) as { userId: string };
    const nameOf = async () => {
      const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
      return row?.name;
    };
    const before = await nameOf();

    // The display name shows in profiles and search: not an unbounded or borrowed one.
    for (const name of ["x".repeat(300_000), "someone else"]) {
      expect((await updateUserRequest(signedIn, { name })).status).toBe(403);
    }
    expect(await nameOf()).toBe(before);
  });
});

describe("Discord columns", () => {
  it("can't be written through Better Auth's /update-user", async () => {
    const signedIn = await testSignInRequest("4200", "kodama_jpg");
    const { userId } = (await signedIn.clone().json()) as { userId: string };
    // An env admin's Discord id would make the next sign-in an admin's.
    for (const body of [{ discordId: "1000" }, { discordUsername: "someone_else" }]) {
      expect((await updateUserRequest(signedIn, body)).status).toBe(403);
    }
    const [row] = await db.select().from(user).where(eq(user.id, userId));
    expect(row).toMatchObject({ discordId: "4200", discordUsername: "kodama_jpg" });
  });
});

/** A POST to `/api/auth<path>` with the cookies of `signedIn`. */
function postAuth(signedIn: Response, path: string, body: object = {}) {
  const headers = cookiesFrom(signedIn);
  headers.set("content-type", "application/json");
  headers.set("origin", testEnv.BETTER_AUTH_URL);
  return auth.handler(
    new Request(`${testEnv.BETTER_AUTH_URL}/api/auth${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("endpoints closed over HTTP (#58)", () => {
  // Admin actions go through src/server/admin-users.ts, which enforces the app's rules and
  // writes the audit log. Better Auth's own admin routes skip both.
  it("404s an admin on the admin plugin's routes and changes nothing", async () => {
    const admin = await testSignInRequest("1000", "root");
    const target = await createDiscordUser("2000");
    const targetRow = async () => (await db.select().from(user).where(eq(user.id, target.id)))[0];
    const before = await targetRow();
    const usersBefore = await db.select().from(user);
    const sessionsBefore = await db.select().from(session);

    const attempts: [string, object][] = [
      ["/admin/ban-user", { userId: target.id }],
      ["/admin/unban-user", { userId: target.id }],
      ["/admin/set-role", { userId: target.id, role: "admin" }],
      // discordId only: an env admin's id would make the target an admin at their next sign-in.
      ["/admin/update-user", { userId: target.id, data: { discordId: "1000" } }],
      ["/admin/impersonate-user", { userId: target.id }],
      [
        "/admin/create-user",
        { email: "new@discord.invalid", password: "password-1234", name: "new", role: "admin" },
      ],
      ["/admin/set-user-password", { userId: target.id, newPassword: "password-1234" }],
      ["/admin/revoke-user-sessions", { userId: target.id }],
      ["/admin/remove-user", { userId: target.id }],
    ];
    for (const [path, body] of attempts) {
      expect((await postAuth(admin, path, body)).status, path).toBe(404);
    }

    expect(await targetRow()).toEqual(before);
    expect(await db.select().from(user)).toEqual(usersBefore);
    expect(await db.select().from(session)).toEqual(sessionsBefore);
  });

  it("404s a signed-in user on account linking and session editing", async () => {
    const signedIn = await testSignInRequest("4000", "kodama_jpg");
    for (const path of ["/link-social", "/unlink-account", "/update-session"]) {
      expect((await postAuth(signedIn, path, { provider: "discord" })).status, path).toBe(404);
    }
  });

  it("leaves no admin plugin route open", () => {
    const adminPaths = Object.values(auth.api)
      .map((endpoint) => (endpoint as { path?: string }).path)
      .filter((path): path is string => path?.startsWith("/admin/") ?? false);
    // Guards against the filter going stale, so the check below can't pass on an empty list.
    expect(adminPaths.length).toBeGreaterThanOrEqual(15);
    expect(auth.options.disabledPaths).toEqual(expect.arrayContaining(adminPaths));
  });

  it("still lets the server call the admin API, as the dashboard does", async () => {
    const adminHeaders = cookiesFrom(await testSignInRequest("1000", "root"));
    const target = await createDiscordUser("2000");
    const bannedOf = async () =>
      (await db.select({ banned: user.banned }).from(user).where(eq(user.id, target.id)))[0]
        ?.banned;

    await auth.api.banUser({ body: { userId: target.id }, headers: adminHeaders });
    expect(await bannedOf()).toBe(true);
    await auth.api.unbanUser({ body: { userId: target.id }, headers: adminHeaders });
    expect(await bannedOf()).toBe(false);
    await auth.api.setRole({ body: { userId: target.id, role: "admin" }, headers: adminHeaders });
    expect(await roleOf(target.id)).toBe("admin");
  });

  it("still serves the routes the app uses", async () => {
    const signedIn = await testSignInRequest("4000", "kodama_jpg");
    const get = (path: string, headers?: Headers) =>
      auth.handler(new Request(`${testEnv.BETTER_AUTH_URL}/api/auth${path}`, { headers }));

    expect((await get("/ok")).status).toBe(200);
    expect((await get("/error")).status).toBe(200);
    const sessionResponse = await get("/get-session", cookiesFrom(signedIn));
    expect(((await sessionResponse.json()) as { user: { discordId: string } }).user.discordId).toBe(
      "4000",
    );
    expect((await postAuth(signedIn, "/sign-out")).status).toBe(200);
  });
});

describe("image column", () => {
  it("can't be written through Better Auth's /update-user", async () => {
    const signedIn = await testSignInRequest("4100", "kodama_jpg");
    const { userId } = (await signedIn.clone().json()) as { userId: string };
    const rowOf = async () => {
      const [row] = await db
        .select({ name: user.name, image: user.image })
        .from(user)
        .where(eq(user.id, userId));
      return row;
    };
    const before = await rowOf();

    // Anyone shown this picture would load it: a URL of the user's own would log their IPs.
    const image = "https://tracker.example/pixel.png";
    const response = await updateUserRequest(signedIn, { image });
    expect(response.status).toBe(403);
    expect(await rowOf()).toEqual({ ...before, image: null });
  });

  it("keeps the Discord picture a user signed in with, whatever they send", async () => {
    const stored = "https://cdn.discordapp.com/avatars/4101/abcd.png";
    const signedIn = await testSignInRequest("4101", "kodama_jpg", stored);
    const { userId } = (await signedIn.clone().json()) as { userId: string };
    for (const image of [stored, "https://cdn.discordapp.com/avatars/4101/other.png", null]) {
      expect((await updateUserRequest(signedIn, { image })).status).toBe(403);
    }
    const [row] = await db.select({ image: user.image }).from(user).where(eq(user.id, userId));
    expect(row?.image).toBe(stored);
  });
});

describe("bans", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function ban(discordId: string, fields: { banReason?: string; banExpires?: Date }) {
    await db
      .update(user)
      .set({ banned: true, banReason: null, banExpires: null, ...fields })
      .where(eq(user.discordId, discordId));
  }

  it("gives a signed-in user who gets banned no session on their next request", async () => {
    const headers = cookiesFrom(await testSignInRequest("5000", "soon_banned"));
    expect(await resolveSession(auth, headers)).not.toBeNull();

    await ban("5000", { banReason: "spam" });
    expect(await resolveSession(auth, headers)).toBeNull();
  });

  it("honours ban expiry for an existing session", async () => {
    const headers = cookiesFrom(await testSignInRequest("5000", "soon_banned"));
    await ban("5000", { banExpires: new Date(Date.now() + DAY) });
    expect(await resolveSession(auth, headers)).toBeNull();

    await ban("5000", { banExpires: new Date(Date.now() - DAY) });
    expect((await resolveSession(auth, headers))?.user.discordId).toBe("5000");
  });

  it("refuses sign-in to a banned user and creates no session", async () => {
    await testSignInRequest("5000", "banned_user");
    await ban("5000", { banReason: "spam" });
    const sessionsBefore = await db.select().from(session);

    const response = await testSignInRequest("5000", "banned_user");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: BANNED_USER_ERROR });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await db.select().from(session)).toHaveLength(sessionsBefore.length);
  });

  it("lets a user whose ban has expired sign in again, and lifts the ban", async () => {
    await testSignInRequest("5000", "was_banned");
    await ban("5000", { banReason: "spam", banExpires: new Date(Date.now() - DAY) });

    const response = await testSignInRequest("5000", "was_banned");
    expect(response.status).toBe(200);
    expect((await resolveSession(auth, cookiesFrom(response)))?.user.discordId).toBe("5000");
    const [row] = await db.select().from(user).where(eq(user.discordId, "5000"));
    expect(row).toMatchObject({ banned: false, banReason: null, banExpires: null });
  });

  it("bans and unbans through the test-only ban endpoint", async () => {
    const headers = cookiesFrom(await testSignInRequest("5000", "test_banned"));
    const setBan = (body: object) =>
      auth.handler(
        new Request(`${testEnv.BETTER_AUTH_URL}/api/auth/test/ban`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ discordId: "5000", ...body }),
        }),
      );

    expect((await setBan({ banned: true, reason: "spam" })).status).toBe(200);
    expect(await resolveSession(auth, headers)).toBeNull();
    expect((await setBan({ banned: false })).status).toBe(200);
    expect(await resolveSession(auth, headers)).not.toBeNull();
  });

  describe("Discord sign-in", () => {
    let discordProfile: Record<string, string | null>;

    beforeEach(() => {
      discordProfile = {
        id: "5000",
        username: "discord_user",
        global_name: null,
        avatar: null,
        discriminator: "0",
      };
      // Stand in for Discord's token and user endpoints.
      const realFetch = globalThis.fetch;
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith("https://discord.com/api/oauth2/token")) {
          return Response.json({ access_token: "token", token_type: "Bearer", expires_in: 3600 });
        }
        if (url.startsWith("https://discord.com/api/users/")) {
          return Response.json(discordProfile);
        }
        return realFetch(input, init);
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /**
     * Starts Discord sign-in the way the app's button does, then completes Discord's callback.
     * `ip` gives the requests their own sign-in rate-limit bucket.
     */
    async function completeDiscordSignIn({ callbackURL = "/", ip = "" } = {}) {
      const start = await auth.handler(
        new Request(`${testEnv.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(ip && { [CLIENT_IP_HEADER]: ip }) },
          body: JSON.stringify({ provider: "discord", callbackURL, errorCallbackURL: "/" }),
        }),
      );
      expect(start.status).toBe(200);
      const { url } = (await start.json()) as { url: string };
      const callback = new URL(`${testEnv.BETTER_AUTH_URL}/api/auth/callback/discord`);
      callback.searchParams.set("code", "code");
      callback.searchParams.set("state", new URL(url).searchParams.get("state") ?? "");
      return auth.handler(new Request(callback, { headers: cookiesFrom(start) }));
    }

    it("signs the user in and returns to home", async () => {
      const response = await completeDiscordSignIn();
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/");
      const signedIn = await resolveSession(auth, cookiesFrom(response));
      expect(signedIn?.user.discordUsername).toBe("discord_user");
    });

    it("stores the Discord picture, or Discord's default one, and refreshes it on the next sign-in", async () => {
      // Sign-in is rate limited per IP, and other tests here sign in from the default one.
      let signIns = 0;
      const imageOf = async () => {
        const response = await completeDiscordSignIn({ ip: `10.56.0.${++signIns}` });
        return (await resolveSession(auth, cookiesFrom(response)))?.user.image;
      };
      // No custom picture: Discord's default avatar for the id (5000 >> 22 = 0, one of 6).
      expect(await imageOf()).toBe("https://cdn.discordapp.com/embed/avatars/0.png");

      discordProfile.avatar = "abc123";
      expect(await imageOf()).toBe("https://cdn.discordapp.com/avatars/5000/abc123.png");

      discordProfile.avatar = "a_abc123";
      expect(await imageOf()).toBe("https://cdn.discordapp.com/avatars/5000/a_abc123.gif");
    });

    it("keeps the display name current from Discord on every sign-in", async () => {
      // Sign-in is rate limited per IP, and other tests here sign in from the default one.
      let signIns = 0;
      const nameOf = async () => {
        const response = await completeDiscordSignIn({ ip: `10.57.0.${++signIns}` });
        return (await resolveSession(auth, cookiesFrom(response)))?.user.name;
      };
      expect(await nameOf()).toBe("discord_user");

      discordProfile.global_name = "Discord User";
      expect(await nameOf()).toBe("Discord User");
    });

    it("returns to the invite link signed in from, not home (ADR 16)", async () => {
      const response = await completeDiscordSignIn({
        callbackURL: "/join/some-token",
        ip: "10.43.0.1",
      });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/join/some-token");
    });

    it("sends a banned user home with the ban notice and creates no session", async () => {
      await completeDiscordSignIn();
      await ban("5000", {
        banReason: "spamming rooms",
        banExpires: new Date("2031-01-02T03:04:00Z"),
      });
      const sessionsBefore = await db.select().from(session);

      const response = await completeDiscordSignIn();
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location") ?? "", "http://app.invalid");
      expect(location.pathname).toBe("/");
      expect(location.searchParams.get("error")).toBe(BANNED_USER_ERROR);
      expect(location.searchParams.get("error_description")).toBe(
        "Reason: spamming rooms. The ban ends 2 Jan 2031, 03:04 UTC.",
      );
      expect(await resolveSession(auth, cookiesFrom(response))).toBeNull();
      expect(await db.select().from(session)).toHaveLength(sessionsBefore.length);
    });
  });
});
