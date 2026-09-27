/**
 * Appearance settings on the user row (ADR 13 addendum). Better Auth can't write
 * the column (`input: false` in src/lib/auth.ts); these functions are the only
 * writers. They take a driver-agnostic `Db`, so tests run them on PGlite.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { user } from "../db/schema/index.ts";
import { settingsOrDefaults, type UserSettings, userSettingsSchema } from "../db/settings.ts";

/** The user's stored settings (defaults for anything missing), or null if there is no such user. */
export async function getUserSettings(db: Db, userId: string): Promise<UserSettings | null> {
  const [row] = await db.select({ settings: user.settings }).from(user).where(eq(user.id, userId));
  return row ? settingsOrDefaults(row.settings) : null;
}

/**
 * Validate and store a complete settings object for the user. Throws on invalid
 * input (a ZodError) or an unknown user; returns what was stored.
 */
export async function saveUserSettings(
  db: Db,
  userId: string,
  input: unknown,
): Promise<UserSettings> {
  const settings = userSettingsSchema.parse(input);
  const updated = await db
    .update(user)
    .set({ settings })
    .where(eq(user.id, userId))
    .returning({ id: user.id });
  if (updated.length === 0) throw new Error(`No user ${userId}`);
  return settings;
}
