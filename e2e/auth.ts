import { type APIResponse, type BrowserContext, expect, test } from "@playwright/test";

export interface FakeDiscordUser {
  discordId: string;
  username: string;
}

/** The fake Discord id that playwright.config.ts lists in `ADMIN_DISCORD_IDS`. */
export const E2E_ADMIN_DISCORD_ID = "900000000000000999";

/**
 * POST to a test-only Better Auth endpoint from the browser context. Sends an
 * Origin header, which Better Auth requires once the context holds a session cookie.
 */
function postTestAuth(context: BrowserContext, path: string, data: object): Promise<APIResponse> {
  const origin = new URL(test.info().project.use.baseURL ?? "").origin;
  return context.request.post(`/api/auth/test/${path}`, { data, headers: { origin } });
}

/** Test-only sign-in without asserting success (e.g. to see a banned user refused). */
export function trySignIn(context: BrowserContext, user: FakeDiscordUser): Promise<APIResponse> {
  return postTestAuth(context, "sign-in", user);
}

/**
 * Sign a fake Discord user into the browser context through the test-only
 * sign-in (needs `E2E_AUTH=1`, set by playwright.config.ts). The same Discord
 * id always maps to the same user. Returns the user's id.
 */
export async function signIn(context: BrowserContext, user: FakeDiscordUser): Promise<string> {
  const response = await trySignIn(context, user);
  expect(response.ok(), await response.text()).toBe(true);
  const { userId } = (await response.json()) as { userId: string };
  return userId;
}

export interface Ban {
  reason?: string;
  /** ISO timestamp; omit for a ban with no end date. */
  expiresAt?: string;
}

/**
 * Ban (or, with `null`, unban) a fake user by Discord id through the test-only ban
 * endpoint. It edits the user row directly and leaves their sessions in place.
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
