import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import { createRoomOnPage, enterRoom, uniqueRoomName } from "./rooms";

// The e2e server ends empty rooms after 60s instead of 5 minutes
// (REALTIME_EMPTY_ROOM_TIMEOUT_MS in playwright.config.ts), and keeps the 30s host grace.

test("home follows a room's host handover, then its end: gone from Live Now, in Past Streams", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(200_000);
  await signIn(context, { username: "lc.lead" });
  const name = uniqueRoomName("lifecycle hang");
  const roomId = await createRoomOnPage(page, { name });

  const guestContext = await browser.newContext();
  const visitorContext = await browser.newContext();
  try {
    await signIn(guestContext, { username: "lc.guest" });
    const guest = await newPage(guestContext);
    await enterRoom(guest, roomId);
    await expect(guest.getByText("lc.guest (you)").first()).toBeVisible();

    // A visitor watches home, which only the lobby socket keeps current.
    const visitor = await newPage(visitorContext);
    await visitor.goto("/");
    const card = visitor.getByRole("button", { name: `Join ${name}` });
    await expect(card).toContainText(/lc\.lead\s*Host/);

    // The host leaves (the leave button: a closed page would count as a blip first, ADR 12);
    // after the host grace the guest is host, and the card says so.
    await page.getByRole("button", { name: /^leave$/ }).click();
    await expect(card).toContainText(/lc\.guest\s*Host/, { timeout: 60_000 });

    // The last person leaves: the room ends once it has sat empty long enough.
    await guest.getByRole("button", { name: /^leave$/ }).click();
    await expect(card).toBeHidden({ timeout: 90_000 });
    await expect(visitor.getByRole("button", { name: `View recap of ${name}` })).toBeVisible();
  } finally {
    await guestContext.close();
    await visitorContext.close();
  }
});
