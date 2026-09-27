import { signIn } from "./auth";
import { expect, test } from "./fixtures";

test("a visitor's rail shows no account", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Admin Dashboard" })).toHaveCount(0);
});

test("after test sign-in the rail shows the signed-in user", async ({ page, context }) => {
  await signIn(context, { username: "kodama_jpg" });
  await page.goto("/");
  const account = page.getByRole("button", { name: "Account menu" });
  await expect(account).toHaveText("KO");
  await account.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByText("kodama_jpg", { exact: true })).toBeVisible();
});

test("the session survives client-side navigation", async ({ page, context }) => {
  await signIn(context, { username: "bit reverb" });
  await page.goto("/past/no-such-room");
  await page.getByRole("link", { name: "Active Rooms" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveText("BR");
});
