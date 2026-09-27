import type { Browser } from "@playwright/test";
import { fakeDiscordId, type SeededStats, setStats, signIn } from "./auth";

/**
 * A username no other test (or browser project) uses: every test shares one database, so
 * a username search finds everyone's users. Search for the returned name, not `base`.
 */
export function uniqueUsername(base: string): string {
  return `${base}.${Math.random().toString(36).slice(2, 8)}`;
}

export interface SeededUser {
  id: string;
  discordId: string;
  username: string;
}

/**
 * Create a fake user of this test (signing them in from a throwaway browser context) and
 * optionally seed their lifetime stats and co-time. Returns their user id.
 */
export async function createUser(
  browser: Browser,
  username: string,
  seed?: SeededStats,
): Promise<SeededUser> {
  const context = await browser.newContext();
  try {
    const discordId = fakeDiscordId(username);
    const id = await signIn(context, { username, discordId });
    if (seed) await setStats(context, discordId, seed);
    return { id, discordId, username };
  } finally {
    await context.close();
  }
}
