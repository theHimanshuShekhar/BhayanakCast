import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

test("a visitor's rail shows no account and no mock user", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Admin Dashboard" })).toHaveCount(0);
});

test("after test sign-in the rail shows the signed-in user", async ({ page, context }) => {
  await signIn(context, { discordId: "900000000000000001", username: "kodama_jpg" });
  await page.goto("/");
  const account = page.getByRole("button", { name: "Account menu" });
  await expect(account).toHaveText("KO");
  await account.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByText("kodama_jpg", { exact: true })).toBeVisible();
  await expect(menu.getByText("nelly.jpg")).toHaveCount(0);
});

test("the session survives client-side navigation", async ({ page, context }) => {
  await signIn(context, { discordId: "900000000000000002", username: "bit reverb" });
  await page.goto("/past/p3");
  await page.getByRole("link", { name: "Active Rooms" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveText("BR");
});
