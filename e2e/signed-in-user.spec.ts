import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { createRoomAs, uniqueRoomName } from "./rooms";

test('"my profile" opens the signed-in user\'s own id URL', async ({ page, context }) => {
  const userId = await signIn(context, {
    username: "self.viewer",
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menu").getByText("self.viewer", { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: /my profile/ }).click();
  await expect(page).toHaveURL(new RegExp(`/profile/${userId}$`));
  // Profile content is still mock data (spec #2), so a real user has no profile yet.
  await expect(page.getByRole("heading", { level: 1, name: "user not found" })).toBeVisible();
});

test("someone else's profile offers favorite, not edit", async ({ page, context }) => {
  await signIn(context, { username: "nelly.jpg" });
  await page.goto("/profile/usr_nellyjpg");
  // Same username as the mock profile, different user id: not "you".
  await expect(page.getByRole("heading", { level: 1, name: "nelly.jpg" })).toBeVisible();
  await expect(page.getByText("YOU", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /edit profile/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /favorite/ })).toBeVisible();
});

test("the room marks the signed-in user, by id, as (you)", async ({ page, context, browser }) => {
  const name = uniqueRoomName("midnight speedrun club");
  const roomId = await createRoomAs(browser, "room.host", { name });
  await signIn(context, { username: "kodama_jpg" });
  await page.goto(`/room/${roomId}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("kodama_jpg (you)")).toHaveCount(1);
  // The host is someone else.
  await expect(page.getByText("room.host (you)")).toHaveCount(0);
});
