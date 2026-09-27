import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { dailyPlatformStats, user } from "../db/schema/index.ts";
import { DEFAULT_USER_SETTINGS } from "../db/settings.ts";
import { createTestDb } from "../db/test-db.ts";
import { createAuth } from "./auth.ts";

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
