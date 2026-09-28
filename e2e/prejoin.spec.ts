import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, uniqueRoomName } from "./rooms";

// The pre-join lobby (#33): pick and preview mic and camera before entering a room. Chromium
// and Firefox run with fake media devices (playwright.config.ts).

const cameraSwitch = (page: Page) => page.getByRole("switch", { name: "Camera" });
const micSwitch = (page: Page) => page.getByRole("switch", { name: "Microphone" });
const enter = (page: Page) => page.getByRole("button", { name: "Enter room" });

/** Leave the room with its leave button (the next visit in this tab shows the lobby). */
async function leaveRoom(page: Page) {
  await page.getByRole("button", { name: /^leave$/ }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** The room's people tab, opened. */
async function peopleTab(page: Page) {
  await page.getByRole("tab", { name: /people/ }).click();
  return page.getByRole("tabpanel", { name: /people/ });
}

test("the lobby shows who's inside, and entering joins muted with the camera off", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "pj.host" });
  const name = uniqueRoomName("prejoin hang");
  const roomId = await createRoomOnPage(page, { name });
  const hostPeople = await peopleTab(page);

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "pj.guest" });
    const guest = await newPage(guestContext);
    await guest.goto(`/room/${roomId}`);
    await expect(guest.getByRole("heading", { name })).toBeVisible();
    await expect(guest.getByText("pj.host is inside")).toBeVisible();
    await expect(cameraSwitch(guest)).toHaveAttribute("aria-checked", "false");
    await expect(micSwitch(guest)).toHaveAttribute("aria-checked", "false");
    // Nothing is sent to the room from the lobby.
    await guest.waitForTimeout(500);
    await expect(hostPeople).not.toContainText("pj.guest");

    await enter(guest).click();
    await expect(hostPeople).toContainText("pj.guest");
    await expect(guest.getByRole("button", { name: "Turn camera on" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(guest.getByRole("button", { name: "Unmute mic" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  } finally {
    await guestContext.close();
  }
});

test("back leaves the lobby for home without joining", async ({ page, context, browser }) => {
  await signIn(context, { username: "pj.back.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("prejoin back") });
  const hostPeople = await peopleTab(page);

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "pj.back.guest" });
    const guest = await newPage(guestContext);
    await guest.goto(`/room/${roomId}`);
    await guest.getByRole("button", { name: "back", exact: true }).click();
    await expect(guest).toHaveURL(/\/$/);
    await expect(hostPeople).not.toContainText("pj.back.guest");
  } finally {
    await guestContext.close();
  }
});

test("the lobby lists the devices, previews the camera, and enters with them on", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "pj.dev.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("prejoin devices") });

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "pj.dev.guest" });
    const guest = await newPage(guestContext);
    await guest.goto(`/room/${roomId}`);
    await expect(guest.getByLabel("camera preview")).toHaveCount(0);

    await cameraSwitch(guest).click();
    await expect(cameraSwitch(guest)).toHaveAttribute("aria-checked", "true");
    // The fake camera's frames reach the preview.
    const preview = guest.getByLabel("camera preview");
    await expect
      .poll(() => preview.evaluate((v: HTMLVideoElement) => v.videoWidth))
      .toBeGreaterThan(0);
    // With permission given, the fake devices are listed by name next to "system default".
    const cameras = guest.getByLabel("camera device").locator("option");
    await expect.poll(() => cameras.count()).toBeGreaterThan(1);
    await expect(cameras.nth(1)).not.toHaveText(/^camera \d+$/);

    await micSwitch(guest).click();
    await expect(micSwitch(guest)).toHaveAttribute("aria-checked", "true");
    const mics = guest.getByLabel("mic device").locator("option");
    await expect.poll(() => mics.count()).toBeGreaterThan(1);
    await expect(guest.getByRole("meter", { name: "mic level" })).toBeVisible();

    await enter(guest).click();
    await expect(guest.getByRole("button", { name: "Turn camera off" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(guest.getByRole("button", { name: "Mute mic" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The room sees them on: the guest's tile has its camera.
    await expect(page.getByRole("group", { name: "pj.dev.guest", exact: true })).toBeVisible();

    // Turning the camera off in the room stops it for everyone.
    await guest.getByRole("button", { name: "Turn camera off" }).click();
    await expect(guest.getByRole("button", { name: "Turn camera on" })).toBeEnabled();
  } finally {
    await guestContext.close();
  }
});

test("the chosen device is remembered, but mic and camera start off again", async ({
  page,
  context,
}) => {
  await signIn(context, { username: "pj.remember" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("prejoin remember") });
  await leaveRoom(page);
  await page.goto(`/room/${roomId}`);
  await cameraSwitch(page).click();
  const picker = page.getByLabel("camera device");
  await expect.poll(() => picker.locator("option").count()).toBeGreaterThan(1);
  const chosen = await picker.locator("option").nth(1).getAttribute("value");
  if (!chosen) throw new Error("no camera listed");
  await picker.selectOption(chosen);
  await expect(cameraSwitch(page)).toHaveAttribute("aria-checked", "true");

  await page.reload();
  await expect(cameraSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(micSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(picker).toHaveValue(chosen);
});

test("a denied permission is explained in the lobby", async ({ page, context }) => {
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await signIn(context, { username: "pj.denied" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("prejoin denied") });
  await leaveRoom(page);
  await page.goto(`/room/${roomId}`);
  await cameraSwitch(page).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "camera access is blocked" }),
  ).toBeVisible();
  await expect(cameraSwitch(page)).toHaveAttribute("aria-checked", "false");
  // It still enters, with the camera off.
  await enter(page).click();
  await expect(page.getByRole("button", { name: "Turn camera on" })).toBeEnabled();
});

test("a reload goes straight back into the room, mic and camera off; after leaving, the lobby again", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "pj.reload.host" });
  const roomId = await createRoomOnPage(page, { name: uniqueRoomName("prejoin reload") });
  const hostPeople = await peopleTab(page);

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "pj.reload.guest" });
    const guest = await newPage(guestContext);
    await guest.goto(`/room/${roomId}`);
    await cameraSwitch(guest).click();
    await expect(cameraSwitch(guest)).toHaveAttribute("aria-checked", "true");
    await enter(guest).click();
    await expect(guest.getByRole("button", { name: "Turn camera off" })).toBeEnabled();
    await expect(hostPeople).toContainText("pj.reload.guest");

    await guest.reload();
    await expect(enter(guest)).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Turn camera on" })).toBeEnabled();
    await expect(guest.getByRole("button", { name: "Unmute mic" })).toBeEnabled();
    // Nobody saw them leave and come back (ADR 12).
    await page.getByRole("tab", { name: /chat/ }).click();
    await expect(page.getByText("pj.reload.guest left")).toHaveCount(0);

    await leaveRoom(guest);
    await guest.goto(`/room/${roomId}`);
    await expect(enter(guest)).toBeVisible();
  } finally {
    await guestContext.close();
  }
});
