import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

test("home lists live rooms and past streams", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/BhayanakCast/);
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Join / }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past Streams" })).toBeVisible();
});

test("search filters rooms and surfaces users", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Search rooms and users").fill("rust");
  await expect(page.getByRole("button", { name: "Join rust pair programming" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Join / })).toHaveCount(1);
});

test("start a room from the rail and land in it as host", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a Room" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("room name").fill("e2e hang");
  await dialog.getByRole("button", { name: /start hang/ }).click();
  await expect(page).toHaveURL(/\/room\/r\d+/);
  await expect(page.getByRole("heading", { name: "e2e hang" })).toBeVisible();
  await expect(page.getByText("nelly.jpg (you)")).toHaveCount(1);
});

test("room chat sends a message", async ({ page }) => {
  await page.goto("/room/r2");
  await page.getByLabel("Chat message").fill("hello from e2e");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("hello from e2e")).toBeVisible();
});

test("settings dialog changes theme", async ({ page, context }) => {
  await signIn(context, { discordId: "900000000000000100", username: "nelly.jpg" });
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /settings/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("profile, recap and admin pages render", async ({ page }) => {
  await page.goto("/profile/usr_kodama_jpg");
  await expect(page.getByRole("heading", { level: 1, name: "kodama_jpg" })).toBeVisible();
  // co-user links resolve by id, never by (renameable) username
  await page
    .getByRole("link", { name: /bitreverb/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/profile\/usr_bitreverb$/);
  await expect(page.getByRole("heading", { level: 1, name: "bitreverb" })).toBeVisible();
  await page.goto("/past/p3");
  await expect(page.getByRole("heading", { name: "who streamed" })).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});
