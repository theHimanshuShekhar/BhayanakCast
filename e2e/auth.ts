import { type BrowserContext, expect } from "@playwright/test";

export interface FakeDiscordUser {
  discordId: string;
  username: string;
}

/**
 * Sign a fake Discord user into the browser context through the test-only
 * sign-in (needs `E2E_AUTH=1`, set by playwright.config.ts). The same Discord
 * id always maps to the same user. Returns the user's id.
 */
export async function signIn(context: BrowserContext, user: FakeDiscordUser): Promise<string> {
  const response = await context.request.post("/api/auth/test/sign-in", { data: user });
  expect(response.ok(), await response.text()).toBe(true);
  const { userId } = (await response.json()) as { userId: string };
  return userId;
}
