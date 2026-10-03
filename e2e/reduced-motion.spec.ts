import type { Page } from "@playwright/test";
import { signIn } from "./auth";
import { expect, test } from "./fixtures";
import { createRoomAs, createRoomOnPage, uniqueRoomName } from "./rooms";

// `prefers-reduced-motion: reduce` (#78): no pulse or wave keeps looping, and a reaction fades in
// place instead of floating up. Without the preference the same elements do animate, so a pass
// here means the media query did it and not that the selectors found nothing.

const pulses = (page: Page) => page.locator(".animate-bc-pulse");

/** Every animation still running on the page that never ends. */
const infiniteAnimations = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY)
      .map((a) => (a instanceof CSSAnimation ? a.animationName : a.id)),
  );

test("home: the live pulse loops by default", async ({ page, browser }) => {
  await createRoomAs(browser, "motion.default", { name: uniqueRoomName("motion default") });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(pulses(page).first()).toBeVisible();
  await expect
    .poll(() =>
      pulses(page)
        .first()
        .evaluate((el) => el.getAnimations().length),
    )
    .toBeGreaterThan(0);
  expect(await infiniteAnimations(page)).toContain("bc-pulse");
});

test("home: under reduced motion the live pulse does not animate and nothing loops", async ({
  page,
  browser,
}) => {
  await createRoomAs(browser, "motion.reduced", { name: uniqueRoomName("motion reduced") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(pulses(page).first()).toBeVisible();
  const count = await pulses(page).count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const pulse = pulses(page).nth(i);
    expect(await pulse.evaluate((el) => el.getAnimations().length)).toBe(0);
    await expect(pulse).toHaveCSS("animation-name", "none");
  }
  expect(await infiniteAnimations(page)).toEqual([]);
});

test("room: a reaction fades in place under reduced motion and floats otherwise", async ({
  page,
  context,
}) => {
  await signIn(context, { username: "motion.room" });
  await createRoomOnPage(page, { name: uniqueRoomName("motion room") });

  const react = async (emoji: string) => {
    await page.getByRole("button", { name: "Reactions" }).click();
    await page.getByRole("menuitem", { name: `React ${emoji}` }).click();
    await page.keyboard.press("Escape");
    return page.getByRole("img", { name: `reaction ${emoji}` }).last();
  };

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(await react("🔥")).toHaveCSS("animation-name", "bc-float");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(await react("💯")).toHaveCSS("animation-name", "bc-float-still");
  expect(await infiniteAnimations(page)).toEqual([]);
});
