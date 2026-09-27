import { expect, test } from "@playwright/test";
import { E2E_ADMIN_DISCORD_ID, signIn } from "./auth";

const dashboard = { level: 1, name: "Dashboard" } as const;

test("a visitor opening /admin is sent home", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(page.getByRole("heading", dashboard)).toHaveCount(0);
});

test("a non-admin has no Admin Dashboard rail item and /admin sends them home", async ({
  page,
  context,
}) => {
  await signIn(context, { username: "plain_user" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin Dashboard" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(page.getByRole("heading", dashboard)).toHaveCount(0);
});

test("an ADMIN_DISCORD_IDS user sees the rail item and opens the dashboard", async ({
  page,
  context,
}) => {
  await signIn(context, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
  await page.goto("/");
  await page.getByRole("link", { name: "Admin Dashboard" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", dashboard)).toBeVisible();
});
