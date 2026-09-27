import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { createRoomAs, createRoomOnPage, uniqueRoomName } from "./rooms";

test("home lists live rooms and past streams", async ({ page, browser }) => {
  const name = uniqueRoomName("smoke room");
  await createRoomAs(browser, "smoke.host", { name });
  await page.goto("/");
  await expect(page).toHaveTitle(/BhayanakCast/);
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Join ${name}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past Streams" })).toBeVisible();
});

test("search filters rooms by name, host, #tag and kind", async ({ page, browser }) => {
  const name = uniqueRoomName("rust pair programming");
  const token = name.split(" ").at(-1) ?? name;
  await createRoomAs(browser, "ferris.searcher", { name });
  await page.goto("/");
  const search = page.getByLabel("Search rooms and users");
  await search.fill(token);
  await expect(page.getByRole("button", { name: `Join ${name}` })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Join / })).toHaveCount(1);
  // The create dialog's defaults: kind "gaming", tag "chill".
  for (const term of ["ferris.searcher", "#chill", "gaming"]) {
    await search.fill(term);
    await expect(page.getByRole("button", { name: `Join ${name}` })).toBeVisible();
  }
  await search.fill("#no-such-tag");
  await expect(page.getByRole("button", { name: `Join ${name}` })).toHaveCount(0);
});

test("a created room survives a reload and opens with its host", async ({ page, context }) => {
  await signIn(context, { username: "room.starter" });
  const name = uniqueRoomName("e2e hang");
  const roomId = await createRoomOnPage(page, { name });
  await expect(page.getByText("room.starter (you)")).toHaveCount(1);

  await page.goto("/");
  await page.reload();
  await page.getByRole("button", { name: `Join ${name}` }).click();
  await expect(page).toHaveURL(new RegExp(`/room/${roomId}$`));
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("an unknown room id shows not found", async ({ page, context }) => {
  await signIn(context, { username: "lost.user" });
  await page.goto("/room/no-such-room");
  await expect(page.getByRole("heading", { name: "room not found" })).toBeVisible();
});

test("a private room is listed for its host but never for visitors", async ({
  page,
  context,
  browser,
}) => {
  const name = uniqueRoomName("secret hang");
  await signIn(context, { username: "private.host" });
  const roomId = await createRoomOnPage(page, { name, isPrivate: true });
  await page.goto("/");
  await expect(page.getByRole("button", { name: `Join ${name}` })).toBeVisible();

  const visitor = await browser.newContext();
  try {
    const visitorPage = await visitor.newPage();
    await visitorPage.goto("/");
    await expect(
      visitorPage.getByRole("heading", { level: 1, name: "Active Rooms" }),
    ).toBeVisible();
    await expect(visitorPage.getByRole("button", { name: `Join ${name}` })).toHaveCount(0);
    // Its URL's "sign in to join" prompt doesn't reveal the name either.
    await visitorPage.goto(`/room/${roomId}`);
    await expect(visitorPage.getByRole("dialog", { name: "sign in to join" })).toBeVisible();
    await expect(visitorPage.getByText(name)).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});

test("room chat sends a message", async ({ page, context }) => {
  await signIn(context, { username: "chatter" });
  await createRoomOnPage(page, { name: uniqueRoomName("chat room") });
  await page.getByLabel("Chat message").fill("hello from e2e");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("hello from e2e")).toBeVisible();
});

test("settings dialog changes theme", async ({ page, context }) => {
  await signIn(context, { username: "nelly.jpg" });
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /settings/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("profile and recap pages render", async ({ page }) => {
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
});
