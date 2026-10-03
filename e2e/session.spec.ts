import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, uniqueRoomName } from "./rooms";

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

test("signing out in another tab takes a room page out of the room and releases its media", async ({
  page,
  context,
}) => {
  // Every track the page gets from `getUserMedia`, to see whether the camera is let go.
  await context.addInitScript(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    const devices = navigator.mediaDevices;
    const getUserMedia = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      w.__tracks.push(...stream.getTracks());
      return stream;
    };
  });
  const liveTracks = () =>
    page.evaluate(
      () =>
        (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter(
          (t) => t.readyState === "live",
        ).length,
    );
  await signIn(context, { username: "signed.out.room" });
  await createRoomOnPage(page, { name: uniqueRoomName("signed out room") });
  await page.getByRole("button", { name: "Turn camera on" }).click();
  await expect(page.getByRole("button", { name: "Turn camera off" })).toBeEnabled();
  expect(await liveTracks()).toBeGreaterThan(0);

  // The same browser's other tab signs out: the cookie, and so the room tab's session, is gone.
  const other = await newPage(context);
  await other.goto("/");
  await other.getByRole("button", { name: "Account menu" }).click();
  await other.getByRole("menuitem", { name: /sign out/ }).click();
  await expect(other.getByRole("button", { name: "Account menu" })).toHaveCount(0);

  const notice = page.getByRole("alert").filter({ hasText: "you were signed out" });
  await expect(notice).toBeVisible();
  // Out of the room: the camera is released, not left capturing behind the notice.
  await expect.poll(liveTracks).toBe(0);

  // It stays out (the page doesn't rejoin as a visitor), and the notice links home as a visitor.
  await notice.getByRole("link", { name: "back to rooms" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("navigation").getByRole("button", { name: /sign in with discord/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
});
