import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomAs, enterRoom, uniqueRoomName } from "./rooms";

// Thumbnails (#39): when someone starts sharing, their room card on home shows the real screen
// (a 480x270 still). Chromium shares its fake screen; Firefox, which can't capture a screen
// headless, a stand-in (e2e/fixtures.ts).

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

    // The card gets the image once it is uploaded (live refresh is #40: reload until it is).
    const image = card.getByRole("img", { name: "thumb.streamer's screen" });
    await expect(async () => {
      await home.reload();
      await expect(image).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]))
      .toEqual([480, 270]);
    await expect(card.getByText("thumb.streamer", { exact: true })).toBeVisible();

    // The route serves the stored bytes as an image.
    const src = await image.getAttribute("src");
    expect(src).toContain(`/api/thumbnails/${roomId}/${streamerId}?t=`);
    const served = await request.get(src ?? "");
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toMatch(/^image\/(webp|jpeg)$/);

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
