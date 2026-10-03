import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, test } from "./fixtures";
import { createRoomOnPage, uniqueRoomName } from "./rooms";

// A mic or camera that goes away mid-call (#79): the room says so and offers another device.
// A fake device can't be unplugged, so the page records the tracks the app sets an `onended`
// handler on (the very objects its handler is on, in either browser) and the test fires `ended`
// on them, as the browser does for an unplugged or revoked device. The app uses `onended`:
// in Playwright's Firefox, a script-dispatched `ended` on a track reaches `onended` but not
// `addEventListener` listeners (Chromium runs both), so the spec can't rely on listeners.

/** Keep every track something sets `onended` on in `window.__tracks`. */
async function recordTracks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __tracks: Set<MediaStreamTrack> };
    w.__tracks = new Set();
    const native = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, "onended");
    if (!native?.set || !native.get) throw new Error("MediaStreamTrack has no onended");
    const { get, set } = native;
    Object.defineProperty(MediaStreamTrack.prototype, "onended", {
      configurable: true,
      enumerable: true,
      get() {
        return get.call(this);
      },
      set(handler) {
        w.__tracks.add(this);
        set.call(this, handler);
      },
    });
  });
}

/**
 * End the live `kind` ("audio" or "video") tracks the page listens to, and how many that was
 * (none means the recording missed the app's track, not that the app ignored it).
 */
const endTracks = (page: Page, kind: "audio" | "video") =>
  page.evaluate((k) => {
    const tracks = (window as unknown as { __tracks: Set<MediaStreamTrack> }).__tracks;
    let ended = 0;
    for (const track of tracks) {
      if (track.kind !== k || track.readyState !== "live") continue;
      track.stop();
      track.dispatchEvent(new Event("ended"));
      ended++;
    }
    return ended;
  }, kind);

test("a camera that goes away is announced, and another can be picked in the room", async ({
  page,
  context,
}) => {
  await recordTracks(page);
  await signIn(context, { username: "loss.cam" });
  await createRoomOnPage(page, { name: uniqueRoomName("device loss cam") });

  await page.getByRole("button", { name: "Turn camera on" }).click();
  const camera = page.getByRole("button", { name: "Turn camera off" });
  await expect(camera).toHaveAttribute("aria-pressed", "true");

  expect(await endTracks(page, "video")).toBeGreaterThan(0);

  // The room turns the camera off, says why, and offers the pre-join device picker.
  const notice = page.getByRole("region", { name: "camera disconnected" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("alert")).toContainText("your camera was disconnected");
  await expect(page.getByRole("button", { name: "Turn camera on" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Another device: the camera is on again, and the notice is gone.
  const devices = notice.getByLabel("camera device");
  await expect.poll(() => devices.locator("option").count()).toBeGreaterThan(1);
  await devices.selectOption({ index: 1 });
  await expect(page.getByRole("button", { name: "Turn camera off" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(notice).toHaveCount(0);
});

test("a lost mic can be dismissed, and turned on again from its control", async ({
  page,
  context,
}) => {
  await recordTracks(page);
  await signIn(context, { username: "loss.mic" });
  await createRoomOnPage(page, { name: uniqueRoomName("device loss mic") });

  await page.getByRole("button", { name: "Unmute mic" }).click();
  await expect(page.getByRole("button", { name: "Mute mic" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  expect(await endTracks(page, "audio")).toBeGreaterThan(0);
  const notice = page.getByRole("region", { name: "microphone disconnected" });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("button", { name: "Unmute mic" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await notice.getByRole("button", { name: "dismiss microphone notice" }).click();
  await expect(notice).toHaveCount(0);

  await page.getByRole("button", { name: "Unmute mic" }).click();
  await expect(page.getByRole("button", { name: "Mute mic" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(notice).toHaveCount(0);
});
