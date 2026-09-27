import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./auth";

const activeRooms = { level: 1, name: "Active Rooms" } as const;
const joinPrompt = (page: Page) => page.getByRole("dialog", { name: "sign in to join" });
const createPrompt = (page: Page) => page.getByRole("dialog", { name: "sign in to start a room" });
const fillingUp = (page: Page) =>
  page.getByRole("region", { name: "Filling Up" }).getByRole("button").first();

test.describe("a visitor", () => {
  test("browses home, a profile and a past-stream recap", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", activeRooms)).toBeVisible();
    await page.goto("/profile/usr_kodama_jpg");
    await expect(page.getByRole("heading", { level: 1, name: "kodama_jpg" })).toBeVisible();
    await page.goto("/past/p3");
    await expect(page.getByRole("heading", { name: "who streamed" })).toBeVisible();
  });

  test("clicking a live room card opens the sign-in prompt and stays home", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Join midnight speedrun club" }).click();
    const dialog = joinPrompt(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("midnight speedrun club")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /sign in with discord/i })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    await dialog.getByRole("button", { name: "not now" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });

  test('clicking a "Filling Up" entry opens the sign-in prompt', async ({ page }) => {
    await page.goto("/");
    await fillingUp(page).click();
    await expect(joinPrompt(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("opening a room URL lands on home with the prompt open", async ({ page }) => {
    await page.goto("/room/r1");
    await expect(page).toHaveURL(/\/\?join=r1$/);
    const dialog = joinPrompt(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("midnight speedrun club")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /sign in with discord/i })).toBeVisible();

    // Closing the prompt drops the param (so a reload doesn't reopen it) and shows home.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", activeRooms)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", activeRooms)).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test('"Start a Room" asks to sign in instead of opening the create dialog', async ({ page }) => {
    await page.goto("/profile/usr_kodama_jpg");
    await page.getByRole("button", { name: "Start a Room" }).click();
    const dialog = createPrompt(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /sign in with discord/i })).toBeVisible();
    await expect(page.getByLabel("room name")).toHaveCount(0);
  });

  test("the prompt's Discord button goes to Discord's consent page", async ({ page }) => {
    await page.route("https://discord.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>discord consent</h1>" }),
    );
    // Own rate-limit bucket per test (see sign-in.spec.ts).
    const octet = () => Math.floor(Math.random() * 254) + 1;
    await page.setExtraHTTPHeaders({ "cf-connecting-ip": `10.${octet()}.${octet()}.${octet()}` });
    await page.goto("/room/r2");
    const signInResponse = page.waitForResponse("**/api/auth/sign-in/social");
    await joinPrompt(page)
      .getByRole("button", { name: /sign in with discord/i })
      .click();
    expect((await signInResponse).request().postDataJSON()).toMatchObject({
      provider: "discord",
      callbackURL: "/",
    });
    await page.waitForURL("https://discord.com/**");
  });
});

test.describe("a signed-in user", () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, { discordId: "900000000000000301", username: "gate.keeper" });
  });

  test("browses home, a profile and a past-stream recap", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", activeRooms)).toBeVisible();
    await page.goto("/profile/usr_kodama_jpg");
    await expect(page.getByRole("heading", { level: 1, name: "kodama_jpg" })).toBeVisible();
    await page.goto("/past/p3");
    await expect(page.getByRole("heading", { name: "who streamed" })).toBeVisible();
  });

  test("clicking a live room card enters the room", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Join midnight speedrun club" }).click();
    await expect(page).toHaveURL(/\/room\/r1$/);
    await expect(page.getByRole("heading", { name: "midnight speedrun club" })).toBeVisible();
    await expect(joinPrompt(page)).toHaveCount(0);
  });

  test('clicking a "Filling Up" entry enters the room', async ({ page }) => {
    await page.goto("/");
    await fillingUp(page).click();
    await expect(page).toHaveURL(/\/room\/r\d+$/);
    await expect(joinPrompt(page)).toHaveCount(0);
  });

  test("opening a room URL shows the room", async ({ page }) => {
    await page.goto("/room/r1");
    await expect(page).toHaveURL(/\/room\/r1$/);
    await expect(page.getByRole("heading", { name: "midnight speedrun club" })).toBeVisible();
    await expect(joinPrompt(page)).toHaveCount(0);
  });

  test('"Start a Room" opens the create dialog', async ({ page }) => {
    await page.goto("/profile/usr_kodama_jpg");
    await page.getByRole("button", { name: "Start a Room" }).click();
    const dialog = page.getByRole("dialog", { name: "start a hang" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("room name")).toBeVisible();
    await expect(createPrompt(page)).toHaveCount(0);
  });
});
