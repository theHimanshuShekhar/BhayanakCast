import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client.ts";
import { dailyPlatformStats, session, user } from "../db/schema/index.ts";
import { DEFAULT_USER_SETTINGS } from "../db/settings.ts";
import { createTestDb } from "../db/test-db.ts";
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

function testSignInRequest(discordId: string, username: string) {
  return auth.handler(
    new Request(`${testEnv.BETTER_AUTH_URL}/api/auth/test/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discordId, username }),
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
    const discordProfile = {
      id: "5000",
      username: "discord_user",
      global_name: null,
      avatar: null,
      discriminator: "0",
    };

    beforeEach(() => {
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

    /** Starts Discord sign-in the way the app's button does, then completes Discord's callback. */
    async function completeDiscordSignIn() {
      const start = await auth.handler(
        new Request(`${testEnv.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "discord", callbackURL: "/", errorCallbackURL: "/" }),
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
