import type { BrowserContext, Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, fakeClipboard, uniqueRoomName } from "./rooms";

// Private rooms (#41, #42, #43, ADR 16): copy the invite link, knock, and the host admits or
// denies; the host regenerates the link, and a visitor signs in from it.

/** Copy the room's invite link from the room-info menu (with `fakeClipboard`) and return it. */
async function copyInviteLink(page: Page): Promise<string> {
  await page.getByRole("button", { name: "room info" }).click();
  await page.getByRole("menuitem", { name: "copy invite link" }).click();
  await expect(page.getByText("invite link copied")).toBeVisible();
  const link = await page.evaluate(() => (window as unknown as { copied?: string }).copied);
  expect(link).toMatch(/\/join\/[\w-]+$/);
  return link ?? "";
}

/** A signed-in `username` in a new context, on the knock screen of `link`. */
async function openInvite(context: BrowserContext, username: string, link: string) {
  await signIn(context, { username });
  const guest = await newPage(context);
  await guest.goto(link);
  return guest;
}

/** The room's people tab, opened. */
async function peopleTab(page: Page) {
  await page.getByRole("tab", { name: /people/ }).click();
  return page.getByRole("tabpanel", { name: /people/ });
}

const knockToast = (page: Page, username: string) =>
  page.getByRole("heading", { name: `${username} wants to join` });

test("the host copies the invite link, a guest knocks and is admitted", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "priv.host" });
  await fakeClipboard(context);
  const name = uniqueRoomName("private hang");
  const roomId = await createRoomOnPage(page, { name, isPrivate: true });
  const link = await copyInviteLink(page);

  const guestContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "priv.guest" });
    const guest = await newPage(guestContext);

    // Not approved: the room itself isn't there for them.
    await guest.goto(`/room/${roomId}`);
    await expect(guest.getByRole("heading", { name: "room not found" })).toBeVisible();

    await guest.goto(link);
    await expect(guest.getByRole("heading", { name })).toBeVisible();
    // The waiting screen has the lobby's device check: set up the mic while waiting.
    const mic = guest.getByRole("switch", { name: "Microphone" });
    await mic.click();
    await expect(mic).toHaveAttribute("aria-checked", "true");
    await guest.getByRole("button", { name: "knock" }).click();
    await expect(guest.getByText("waiting for the host to let you in")).toBeVisible();

    // The toast (its title; the text is also announced in a live region).
    await expect(knockToast(page, "priv.guest")).toBeVisible();
    await page.getByRole("button", { name: "admit priv.guest" }).first().click();
    await expect(knockToast(page, "priv.guest")).toHaveCount(0);

    // Straight into the room with the mic as set up, and everyone sees them there.
    await expect(guest).toHaveURL(new RegExp(`/room/${roomId}$`));
    await expect(guest.getByRole("button", { name: "Turn camera on" })).toBeEnabled();
    await expect(guest.getByRole("button", { name: "Mute mic" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("group", { name: "priv.guest", exact: true })).toBeVisible();

    // The approval lasts: a reload goes back in without knocking.
    await guest.reload();
    await expect(guest.getByRole("button", { name: "Turn camera on" })).toBeEnabled();
  } finally {
    await guestContext.close();
  }
});

test("a knock waits in the people tab; denying it tells the knocker and clears it everywhere", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "priv.deny.host" });
  await fakeClipboard(context);
  const roomId = await createRoomOnPage(page, {
    name: uniqueRoomName("private deny"),
    isPrivate: true,
  });
  const link = await copyInviteLink(page);
  const people = await peopleTab(page);

  const guestContext = await browser.newContext();
  try {
    const guest = await openInvite(guestContext, "priv.denied", link);
    await guest.getByRole("button", { name: "knock" }).click();
    await expect(guest.getByText("waiting for the host to let you in")).toBeVisible();

    // Dismissing the toast doesn't lose the knock: it's listed under "waiting", with a link to
    // their profile.
    await expect(knockToast(page, "priv.denied")).toBeVisible();
    await page.getByRole("button", { name: "dismiss priv.denied's knock" }).click();
    await expect(knockToast(page, "priv.denied")).toHaveCount(0);
    await expect(people).toContainText("waiting");
    await expect(people.getByRole("link", { name: "priv.denied" })).toHaveAttribute(
      "href",
      /\/profile\//,
    );
    await people.getByRole("button", { name: "deny priv.denied" }).click();

    await expect(guest.getByText("the host declined your request.")).toBeVisible();
    await expect(people.getByRole("link", { name: "priv.denied" })).toHaveCount(0);

    // Still not in.
    await guest.goto(`/room/${roomId}`);
    await expect(guest.getByRole("heading", { name: "room not found" })).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

test("with nobody to answer the knocker waits for the host; leaving withdraws the knock", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "priv.away.host" });
  await fakeClipboard(context);
  const roomId = await createRoomOnPage(page, {
    name: uniqueRoomName("private away"),
    isPrivate: true,
  });
  const link = await copyInviteLink(page);
  await page.getByRole("button", { name: /^leave$/ }).click();
  await expect(page).toHaveURL(/\/$/);

  const guestContext = await browser.newContext();
  try {
    const guest = await openInvite(guestContext, "priv.waiting", link);
    await guest.getByRole("button", { name: "knock" }).click();
    await expect(guest.getByText("waiting for the host. nobody who can let you in")).toBeVisible();

    // The host comes back: the knocker hears someone can answer, and the host sees the knock.
    await enterRoom(page, roomId);
    await expect(guest.getByText("waiting for the host to let you in")).toBeVisible();
    await expect(knockToast(page, "priv.waiting")).toBeVisible();

    // The knocker gives up: the knock goes away for the host, toast and people tab alike.
    await guest.getByRole("button", { name: "back", exact: true }).click();
    await expect(guest).toHaveURL(/\/$/);
    await expect(knockToast(page, "priv.waiting")).toHaveCount(0);
    const people = await peopleTab(page);
    await expect(people).toContainText("priv.away.host");
    await expect(people).not.toContainText("waiting");
  } finally {
    await guestContext.close();
  }
});

test("the host regenerates the invite link: the old link is no longer valid", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "priv.regen.host" });
  await fakeClipboard(context);
  const name = uniqueRoomName("private regen");
  await createRoomOnPage(page, { name, isPrivate: true });
  const old = await copyInviteLink(page);

  await page.getByRole("button", { name: "room info" }).click();
  await page.getByRole("menuitem", { name: "regenerate invite link" }).click();
  await expect(page.getByText("new invite link made: old links no longer work")).toBeVisible();
  const fresh = await copyInviteLink(page);
  expect(fresh).not.toBe(old);

  const guestContext = await browser.newContext();
  try {
    const guest = await openInvite(guestContext, "priv.regen.guest", old);
    await expect(
      guest.getByRole("heading", { name: "this invite link is no longer valid" }),
    ).toBeVisible();
    await guest.goto(fresh);
    await expect(guest.getByRole("heading", { name })).toBeVisible();
    await expect(guest.getByRole("button", { name: "knock" })).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

test("a visitor signs in from the invite link and comes back to its knock screen", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, { username: "priv.visit.host" });
  await fakeClipboard(context);
  const name = uniqueRoomName("private visit");
  await createRoomOnPage(page, { name, isPrivate: true });
  const link = await copyInviteLink(page);
  const invitePath = new URL(link).pathname;

  const visitorContext = await browser.newContext();
  try {
    const visitor = await newPage(visitorContext);
    await visitor.route("https://discord.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>discord consent</h1>" }),
    );
    // Better Auth's answer, stood in for: the real endpoint's per-IP sign-in rate limit is
    // shared by every test here (src/lib/auth.test.ts covers its redirect to the invite link).
    let signInBody: unknown;
    await visitor.route("**/api/auth/sign-in/social", (route) => {
      signInBody = route.request().postDataJSON();
      return route.fulfill({
        json: { url: "https://discord.com/oauth2/authorize", redirect: true },
      });
    });
    await visitor.goto(link);
    await expect(visitor.getByRole("heading", { name })).toBeVisible();
    await expect(visitor.getByRole("button", { name: "knock" })).toHaveCount(0);

    // Discord is to send them back to this invite link, not home.
    await visitor
      .getByRole("region", { name })
      .getByRole("button", { name: /sign in with discord/i })
      .click();
    await visitor.waitForURL("https://discord.com/**");
    expect(signInBody).toMatchObject({ provider: "discord", callbackURL: invitePath });

    // Discord's round trip, stood in for by the test sign-in, then its redirect.
    await signIn(visitorContext, { username: "priv.visitor" });
    await visitor.goto(invitePath);
    await expect(visitor.getByRole("heading", { name })).toBeVisible();
    await visitor.getByRole("button", { name: "knock" }).click();
    await expect(visitor.getByText("waiting for the host to let you in")).toBeVisible();
    await expect(knockToast(page, "priv.visitor")).toBeVisible();
  } finally {
    await visitorContext.close();
  }
});
