import type { BrowserContext } from "@playwright/test";
import { fakeDiscordId, setStats, signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// A user's Discord picture (#56) shows in their avatars, sized for the avatar; without one, or
// when it is stale or isn't Discord's, it is the gradient initials. No test reaches the real
// Discord CDN: its requests are answered here.

const PICTURE = "https://cdn.discordapp.com/avatars/900000000000000001/e2ehash.png";
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Discord's CDN answers with a picture (`status` 200) or with `status`, e.g. a stale hash's 404.
 * Returns the URLs requested.
 */
async function serveDiscordCdn(context: BrowserContext, status = 200) {
  const requested: string[] = [];
  await context.route("https://cdn.discordapp.com/**", (route) => {
    requested.push(route.request().url());
    return status === 200
      ? route.fulfill({ contentType: "image/png", body: PIXEL })
      : route.fulfill({ status });
  });
  return requested;
}

test("the picture shows in the rail, the profile, and the room's people and chat", async ({
  page,
  context,
}) => {
  const requested = await serveDiscordCdn(context);
  const userId = await signIn(context, { username: "pic.viewer", image: PICTURE });

  await page.goto("/");
  const menu = page.getByRole("button", { name: "Account menu" });
  await expect(menu.locator("img")).toHaveAttribute("src", `${PICTURE}?size=64`);
  await expect(menu).not.toContainText("PI");

  // The profile header's bigger avatar asks for a bigger picture.
  await page.goto(`/profile/${userId}`);
  await expect(page.getByRole("heading", { level: 1, name: "pic.viewer" })).toBeVisible();
  await expect(page.locator(`img[src="${PICTURE}?size=256"]`)).toBeVisible();

  // In a room: the people list from the server's roster, and chat looking the sender up in it.
  await createRoomOnPage(page, { name: uniqueRoomName("picture hang") });
  const chat = page.getByRole("tabpanel", { name: /chat/ });
  await page.getByRole("textbox", { name: "Chat message" }).fill("hello with a face");
  await page.getByRole("textbox", { name: "Chat message" }).press("Enter");
  await expect(chat).toContainText("hello with a face");
  const profileButton = page.getByRole("button", { name: "View pic.viewer's profile" });
  await expect(chat.locator(profileButton).locator("img")).toHaveAttribute(
    "src",
    `${PICTURE}?size=64`,
  );
  await page.getByRole("tab", { name: /people/ }).click();
  const people = page.getByRole("tabpanel", { name: /people/ });
  await expect(people.locator(profileButton).locator("img")).toHaveAttribute(
    "src",
    `${PICTURE}?size=64`,
  );

  expect(requested.length).toBeGreaterThan(0);
  expect(requested.every((url) => url.startsWith(PICTURE))).toBe(true);
});

test("overlapping pictures in a stack keep the ring that separates them", async ({
  page,
  context,
  browser,
}) => {
  await serveDiscordCdn(context);
  await signIn(context, { username: "stack.host", image: PICTURE });
  const roomName = uniqueRoomName("stack hang");
  const roomId = await createRoomOnPage(page, { name: roomName });

  const guestContext = await browser.newContext();
  try {
    await serveDiscordCdn(guestContext);
    await signIn(guestContext, { username: "stack.guest", image: PICTURE });
    await enterRoom(await newPage(guestContext), roomId);

    const home = await newPage(context);
    await home.goto("/");
    const pictures = home.getByRole("button", { name: `Join ${roomName}` }).locator("img");
    await expect(pictures).toHaveCount(2);
    // A picture paints over the avatar's own inset shadow, so an overlay above it repeats
    // the shadow: on the second avatar, the 2px ring in the page's colour between the two.
    const overlayShadow = (n: number) =>
      pictures
        .nth(n)
        .evaluate((img) => getComputedStyle(img.parentElement as Element, "::after").boxShadow);
    expect(await overlayShadow(0)).toContain("inset");
    expect(await overlayShadow(1)).toMatch(/2px inset/);
    // The overlay covers the whole circle, over the picture.
    const box = await pictures.nth(1).evaluate((img) => {
      const avatar = img.parentElement as Element;
      const after = getComputedStyle(avatar, "::after");
      return {
        position: after.position,
        avatar: avatar.getBoundingClientRect().width,
        overlay: Number.parseFloat(after.width),
      };
    });
    expect(box.position).toBe("absolute");
    expect(box.avatar).toBeGreaterThan(0);
    expect(box.overlay).toBe(box.avatar);
  } finally {
    await guestContext.close();
  }
});

test("a picture that starts far below the fold loads once scrolled to", async ({
  page,
  context,
  browser,
}) => {
  const requested = await serveDiscordCdn(context);
  // Pushes the profile's co-user list thousands of pixels down, past any lazy-loading distance.
  await context.addInitScript(() => {
    const addStyle = () => {
      const style = document.createElement("style");
      style.textContent = 'a.group[href^="/profile/"]:first-child { margin-top: 8000px }';
      document.documentElement.append(style);
    };
    // Chromium runs this before the document has a root element.
    if (document.documentElement) return addStyle();
    const rootWait = new MutationObserver(() => {
      if (!document.documentElement) return;
      rootWait.disconnect();
      addStyle();
    });
    rootWait.observe(document, { childList: true });
  });

  const friendId = fakeDiscordId("far.friend");
  const friendContext = await browser.newContext();
  const starId = fakeDiscordId("far.star");
  let starUserId: string;
  try {
    await signIn(friendContext, { username: "far.friend", discordId: friendId, image: PICTURE });
    starUserId = await signIn(friendContext, { username: "far.star", discordId: starId });
    await setStats(friendContext, starId, {
      cotime: [{ discordId: friendId, secondsTogether: 3600 }],
    });
  } finally {
    await friendContext.close();
  }

  await page.goto(`/profile/${starUserId}`);
  const row = page.getByRole("link", { name: /far\.friend/ });
  const picture = row.locator("img");
  // Server-rendered as a picture, and still one after hydration: not switched to initials.
  await expect(picture).toHaveAttribute("src", `${PICTURE}?size=64`);
  await expect(row).not.toContainText("FA");
  expect(await picture.evaluate((img) => img.getBoundingClientRect().top)).toBeGreaterThan(
    (page.viewportSize()?.height ?? 0) * 2,
  );

  // The browser is still deferring it (else this proves nothing): not loaded, not requested.
  expect(requested.some((url) => url.startsWith(PICTURE))).toBe(false);
  expect(await picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(0);

  await row.scrollIntoViewIfNeeded();
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect(picture).toBeVisible();
  await expect(row).not.toContainText("FA");
  expect(requested.some((url) => url.startsWith(PICTURE))).toBe(true);
});

test("a picture that no longer loads shows the initials, as before the picture", async ({
  page,
  context,
}) => {
  await serveDiscordCdn(context, 404);
  await signIn(context, { username: "kodama_jpg", image: PICTURE });

  await page.goto("/");
  const menu = page.getByRole("button", { name: "Account menu" });
  await expect(menu).toContainText("KO");
  await expect(menu.locator("img")).toHaveCount(0);
});

test("a picture that isn't on Discord's CDN is never requested", async ({ page, context }) => {
  const tracker = "https://tracker.example/pixel.png";
  const requested: string[] = [];
  await context.route("https://tracker.example/**", (route) => {
    requested.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: PIXEL });
  });
  await signIn(context, { username: "kodama_jpg", image: tracker });

  await page.goto("/");
  const menu = page.getByRole("button", { name: "Account menu" });
  await expect(menu).toContainText("KO");
  await expect(menu.locator("img")).toHaveCount(0);
  expect(requested).toEqual([]);
});
