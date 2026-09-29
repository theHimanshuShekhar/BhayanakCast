import type { Locator } from "@playwright/test";
import { E2E_ADMIN_DISCORD_ID, signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomAs, endRoom, enterRoom, uniqueRoomName } from "./rooms";

// Thumbnails (#39, #40): when someone starts sharing, their room card on home shows the real
// screen (a 480x270 still), refreshed while the share lasts (every 8s here, playwright.config.ts)
// and kept, desaturated, once the room ends. Chromium shares its fake screen; Firefox, which
// can't capture a screen headless, a stand-in (e2e/fixtures.ts).

const naturalSize = (image: Locator) =>
  image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);

test("a live card shows the streamer's real screen once they share", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const name = uniqueRoomName("thumb");
  const roomId = await createRoomAs(browser, "thumb.host", { name });

  const streamerContext = await browser.newContext();
  const watcherContext = await browser.newContext();
  try {
    const streamerId = await signIn(streamerContext, { username: "thumb.streamer" });
    await signIn(watcherContext, { username: "thumb.watcher" });
    const streamer = await newPage(streamerContext);
    await enterRoom(streamer, roomId);

    // The watcher's card lists the room with a placeholder: nothing is shared yet.
    const home = await newPage(watcherContext);
    await home.goto("/");
    const card = home.getByRole("button", { name: `Join ${name}` });
    await expect(card).toBeVisible();
    await expect(card.locator("img")).toHaveCount(0);

    await streamer.getByRole("button", { name: "Share screen" }).click();
    await expect(streamer.getByRole("button", { name: "Stop sharing" })).toBeEnabled();

    // The card gets the image once it is uploaded, without a reload (the lobby says so).
    const image = card.getByRole("img", { name: "thumb.streamer's screen" });
    await expect(image).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => naturalSize(image)).toEqual([480, 270]);
    await expect(card.getByText("thumb.streamer", { exact: true })).toBeVisible();
    await expect(card.getByText(/^updated /)).toBeVisible();

    // The route serves the stored bytes as an image, with an ETag a repeat request matches.
    const src = (await image.getAttribute("src")) ?? "";
    expect(src).toContain(`/api/thumbnails/${roomId}/${streamerId}?t=`);
    const served = await request.get(src);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toMatch(/^image\/(webp|jpeg)$/);
    const etag = served.headers().etag ?? "";
    expect(etag).toMatch(/^"\d+"$/);
    expect((await request.get(src, { headers: { "if-none-match": etag } })).status()).toBe(304);

    // The share re-captures on its interval: the card's image changes, again without a reload.
    await expect(image).not.toHaveAttribute("src", src, { timeout: 60_000 });
    await expect.poll(() => naturalSize(image)).toEqual([480, 270]);

    // Someone who isn't streaming can't upload one.
    const refused = await watcherContext.request.post(`/api/thumbnails/${roomId}`, {
      headers: { "content-type": "image/webp" },
      data: Buffer.from("RIFF0000WEBPVP8 "),
    });
    expect(refused.status()).toBe(403);
  } finally {
    await streamerContext.close();
    await watcherContext.close();
  }
});

test("an ended room's card and recap keep the last thumbnail, desaturated", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const name = uniqueRoomName("thumb ended");
  const roomId = await createRoomAs(browser, "thumb.ended.host", { name });

  const streamerContext = await browser.newContext();
  const adminContext = await browser.newContext();
  try {
    const streamerId = await signIn(streamerContext, { username: "thumb.ended.streamer" });
    await signIn(adminContext, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
    const streamer = await newPage(streamerContext);
    await enterRoom(streamer, roomId);
    await streamer.getByRole("button", { name: "Share screen" }).click();
    await expect(streamer.getByRole("button", { name: "Stop sharing" })).toBeEnabled();

    const home = await newPage(adminContext);
    await home.goto("/");
    const live = home.getByRole("button", { name: `Join ${name}` });
    await expect(live.getByRole("img", { name: "thumb.ended.streamer's screen" })).toBeVisible({
      timeout: 60_000,
    });
    const admin = await newPage(adminContext);
    await admin.goto("/admin");
    await endRoom(admin, name);

    // Under Past Streams: the last thumbnail, marked ended and cached.
    const past = home.getByRole("button", { name: `View recap of ${name}` });
    await expect(past).toBeVisible();
    const image = past.getByRole("img", { name: "thumb.ended.streamer's screen" });
    await expect(image).toBeVisible();
    await expect.poll(() => naturalSize(image)).toEqual([480, 270]);
    await expect(past.getByText("ended", { exact: true })).toBeVisible();
    await expect(past.getByText(/^cached · /)).toBeVisible();
    await expect(past.locator('[class*="saturate-"]')).toHaveCount(1);

    // The recap's mosaic shows it too, and the route still serves it (a public room).
    await past.click();
    await expect(home).toHaveURL(new RegExp(`/past/${roomId}$`));
    // Not the cards of other rooms that may still be on screen while the recap loads.
    const recapImage = home.locator(`img[alt="thumb.ended.streamer's screen"]:not(button img)`);
    await expect(recapImage).toBeVisible();
    await expect.poll(() => naturalSize(recapImage)).toEqual([480, 270]);
    await expect(home.getByText(/^cached · /)).toBeVisible();
    const served = await request.get(`/api/thumbnails/${roomId}/${streamerId}`);
    expect(served.status()).toBe(200);
  } finally {
    await streamerContext.close();
    await adminContext.close();
  }
});
