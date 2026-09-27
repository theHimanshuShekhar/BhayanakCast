import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./auth";

const railSignIn = (page: Page) =>
  page.getByRole("navigation").getByRole("button", { name: /sign in with discord/i });
const panelSignIn = (page: Page) =>
  page
    .getByRole("region", { name: "Sign in" })
    .getByRole("button", { name: /sign in with discord/i });

test("a visitor sees the sign-in button in the rail and the home sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(railSignIn(page)).toBeVisible();
  await expect(panelSignIn(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
});

for (const [where, button] of [
  ["rail", railSignIn],
  ["home sidebar", panelSignIn],
] as const) {
  test(`the ${where} sign-in button goes straight to Discord's consent page`, async ({ page }) => {
    // Never leave for the real Discord: stand in for its authorize page.
    await page.route("https://discord.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>discord consent</h1>" }),
    );
    // Better Auth rate-limits /sign-in* per client IP (the header Cloudflare sets in
    // production); give each test its own so parallel runs don't share one bucket.
    const octet = () => Math.floor(Math.random() * 254) + 1;
    await page.setExtraHTTPHeaders({ "cf-connecting-ip": `10.${octet()}.${octet()}.${octet()}` });
    await page.goto("/");
    const signInResponse = page.waitForResponse("**/api/auth/sign-in/social");
    await button(page).click();

    const response = await signInResponse;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({
      provider: "discord",
      callbackURL: "/",
    });
    await page.waitForURL("https://discord.com/**");
    const authorize = new URL(page.url());
    expect(authorize.origin + authorize.pathname).toBe("https://discord.com/api/oauth2/authorize");
    expect(authorize.searchParams.get("scope")).toBe("identify");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      new URL("/api/auth/callback/discord", test.info().project.use.baseURL).href,
    );
  });
}

test("a signed-in user sees the account menu and no sign-in buttons", async ({ page, context }) => {
  await signIn(context, { discordId: "900000000000000010", username: "sign_in_panel" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in with discord/i })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Sign in" })).toHaveCount(0);
});

test("sign out ends the session and lands on the visitor home", async ({ page, context }) => {
  await signIn(context, { discordId: "900000000000000011", username: "sign_out_user" });
  await page.goto("/past/p3");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /sign out/ }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(railSignIn(page)).toBeVisible();
  await expect(panelSignIn(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);

  // The session is really gone, not just hidden on the client.
  await page.reload();
  await expect(railSignIn(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
});
