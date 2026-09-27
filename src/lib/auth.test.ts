import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { dailyPlatformStats, user } from "../db/schema/index.ts";
import { DEFAULT_USER_SETTINGS } from "../db/settings.ts";
import { createTestDb } from "../db/test-db.ts";
import { createAuth } from "./auth.ts";

const testEnv = {
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
