import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomAs, createRoomOnPage, uniqueRoomName } from "./rooms";

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

test("signing out in another tab takes a room page out of the room, and signing in again recovers it", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    // Every track the page gets from `getUserMedia`, to see whether the camera is let go.
    const w = window as unknown as {
      __tracks: MediaStreamTrack[];
      __sockets: { welcomes: number; joins: number };
    };
    w.__tracks = [];
    const devices = navigator.mediaDevices;
    const getUserMedia = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      w.__tracks.push(...stream.getTracks());
      return stream;
    };
    // The realtime socket's welcomes received and `room.join`s sent, over every socket the page opens.
    w.__sockets = { welcomes: 0, joins: 0 };
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener("message", (event) => {
          if (typeof event.data === "string" && event.data.includes('"type":"welcome"')) {
            w.__sockets.welcomes++;
          }
        });
      }
      send(data: Parameters<WebSocket["send"]>[0]) {
        if (typeof data === "string" && data.includes('"type":"room.join"')) w.__sockets.joins++;
        super.send(data);
      }
    };
  });
  const liveTracks = () =>
    page.evaluate(
      () =>
        (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter(
          (t) => t.readyState === "live",
        ).length,
    );
  const sockets = () =>
    page.evaluate(
      () => (window as unknown as { __sockets: { welcomes: number; joins: number } }).__sockets,
    );
  const user = { username: "signed.out.room" };
  await signIn(context, user);
  const roomName = uniqueRoomName("signed out room");
  const roomId = await createRoomOnPage(page, { name: roomName });
  await page.getByRole("button", { name: "Turn camera on" }).click();
  await expect(page.getByRole("button", { name: "Turn camera off" })).toBeEnabled();
  expect(await liveTracks()).toBeGreaterThan(0);
  const { joins: joinsBefore, welcomes: welcomesBefore } = await sockets();

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

  // The client reconnects as a visitor (a fresh welcome) and stays out: no `room.join` goes out.
  await expect.poll(async () => (await sockets()).welcomes).toBeGreaterThan(welcomesBefore);
  await page.waitForTimeout(500);
  expect((await sockets()).joins).toBe(joinsBefore);
  await expect(notice).toBeVisible();

  // Signed in again from the other tab, the room tab goes home as that user, and its socket
  // carries the new session: a room can be joined from there.
  await signIn(context, user);
  await notice.getByRole("link", { name: "back to rooms" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  await page.getByRole("button", { name: `Join ${roomName}` }).click();
  await expect(page).toHaveURL(new RegExp(`/room/${roomId}$`));
  await page.getByRole("button", { name: "Enter room" }).click();
  await expect(
    page.getByRole("button", { name: /^(Turn camera on|Turn camera off)$/ }),
  ).toBeEnabled();
  await expect(page.getByRole("alert").filter({ hasText: "you were signed out" })).toHaveCount(0);
});

test("signing out in another tab while in a room's pre-join lobby sends this tab to sign in", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "signed.out.lobby" });
  const roomId = await createRoomAs(browser, "signed.out.host", {
    name: uniqueRoomName("signed out lobby"),
  });
  await page.goto(`/room/${roomId}`);
  await expect(page.getByRole("button", { name: "Enter room" })).toBeVisible();

  const other = await newPage(context);
  await other.goto("/");
  await other.getByRole("button", { name: "Account menu" }).click();
  await other.getByRole("menuitem", { name: /sign out/ }).click();
  await expect(other.getByRole("button", { name: "Account menu" })).toHaveCount(0);

  // The session reloads at once, and the room route's guard sends a visitor to sign in: no frozen
  // lobby whose "Enter room" would be refused.
  await expect(page).toHaveURL(new RegExp(`join=${roomId}`));
  await expect(page.getByRole("button", { name: "Enter room" })).toHaveCount(0);
});
