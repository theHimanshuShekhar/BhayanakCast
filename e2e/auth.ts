// Not ./fixtures: playwright.config.ts imports this module.
import { type APIResponse, type BrowserContext, expect, test } from "@playwright/test";

export interface FakeDiscordUser {
  /** Defaults to `fakeDiscordId(username)`: a user of this test alone. */
  discordId?: string;
  username: string;
  /** The picture Discord's sign-in would store (a Discord CDN URL); none by default. */
  image?: string;
}

/**
 * The fake Discord id that playwright.config.ts lists in `ADMIN_DISCORD_IDS`. The only
 * id shared between tests, so never ban it or change its user.
 */
export const E2E_ADMIN_DISCORD_ID = "900000000000000999";

/**
 * A fake Discord id unique to the running test attempt (project + file + title, retry and
 * repeat index) and `username`. Tests run in parallel against one server and the same id
 * always maps to the same user, so a per-attempt id keeps one test's changes (a ban, the
 * stored username, saved settings) out of another test and out of its own retries.
 * Ids start with 8, so they never meet `E2E_ADMIN_DISCORD_ID`.
 */
export function fakeDiscordId(username: string): string {
  const { project, titlePath, retry, repeatEachIndex } = test.info();
  const key = [project.name, ...titlePath, retry, repeatEachIndex, username].join("\u0000");
  // FNV-1a, 64-bit.
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(key)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `8${(hash % 10n ** 17n).toString().padStart(17, "0")}`;
}

/**
 * POST to a test-only Better Auth endpoint from the browser context. Sends an
 * Origin header, which Better Auth requires once the context holds a session cookie.
 */
export function postTestAuth(
  context: BrowserContext,
  path: string,
  data: object,
): Promise<APIResponse> {
  const origin = new URL(test.info().project.use.baseURL ?? "").origin;
  return context.request.post(`/api/auth/test/${path}`, { data, headers: { origin } });
}

/** Test-only sign-in without asserting success (e.g. to see a banned user refused). */
export function trySignIn(context: BrowserContext, user: FakeDiscordUser): Promise<APIResponse> {
  const { username, discordId = fakeDiscordId(username), image } = user;
  return postTestAuth(context, "sign-in", { discordId, username, image });
}

/**
 * Sign a fake Discord user into the browser context through the test-only
 * sign-in (needs `E2E_AUTH=1`, set by playwright.config.ts). The same Discord
 * id always maps to the same user; leave `discordId` out to get a user of this
 * test alone. Returns the user's id.
 */
export async function signIn(context: BrowserContext, user: FakeDiscordUser): Promise<string> {
  const response = await trySignIn(context, user);
  expect(response.ok(), await response.text()).toBe(true);
  const { userId } = (await response.json()) as { userId: string };
  return userId;
}

export interface SeededStats {
  stats?: Partial<{
    secondsStreamed: number;
    secondsWatched: number;
    roomsHosted: number;
    roomsJoined: number;
    peakViewers: number;
  }>;
  /** Seconds together with other fake users, by their Discord ids. */
  cotime?: { discordId: string; secondsTogether: number }[];
}

/**
 * Set a fake user's lifetime stats and co-time through the test-only stats endpoint, as
 * the stats roll-up would leave them. Only seed users of the calling test.
 */
export async function setStats(
  context: BrowserContext,
  discordId: string,
  seed: SeededStats,
): Promise<void> {
  const response = await postTestAuth(context, "stats", { discordId, ...seed });
  expect(response.ok(), await response.text()).toBe(true);
}

export interface Ban {
  reason?: string;
  /** ISO timestamp; omit for a ban with no end date. */
  expiresAt?: string;
}

/**
 * Ban (or, with `null`, unban) a fake user by Discord id through the test-only ban
 * endpoint. It edits the user row directly and leaves their sessions in place.
 * Only ban a user of the calling test (`fakeDiscordId`), never a shared id.
 */
export async function setBan(
  context: BrowserContext,
  discordId: string,
  ban: Ban | null,
): Promise<void> {
  const response = await postTestAuth(context, "ban", {
    discordId,
    banned: ban !== null,
    ...ban,
  });
  expect(response.ok(), await response.text()).toBe(true);
}
