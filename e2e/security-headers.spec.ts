import type { BrowserContext, Page, Response } from "@playwright/test";
import { signIn } from "./auth";
import { expect, test } from "./fixtures";
import { createRoomOnPage, uniqueRoomName } from "./rooms";

// The security headers (ADR 9 addendum): the production server sends a Content-Security-Policy
// with a nonce for the page's inline scripts. Every other spec already runs under it, since a
// blocked script or socket would fail them; these assert the headers and that nothing, in either
// browser, reports a violation on the paths the policy was written for.

const AVATAR = "https://cdn.discordapp.com/avatars/900000000000000002/cspavatar.png";
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Collect CSP violations from every page of `context`, whatever the browser: the DOM event
 * (survives navigations) and console messages about the policy. Read the list with `violations`.
 */
async function watchViolations(context: BrowserContext, page: Page) {
  const violations: string[] = [];
  await context.exposeFunction("__reportCspViolation", (violation: string) => {
    violations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __reportCspViolation(v: string): void })
        .__reportCspViolation;
      report(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });
  page.on("console", (message) => {
    if (/content.security.policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

const header = (response: Response, name: string) => response.headers()[name];

test("a page loads under the policy: nonced scripts, its headers, nothing blocked", async ({
  page,
  context,
}) => {
  const violations = await watchViolations(context, page);
  const response = await page.goto("/");
  if (!response) throw new Error("No response for /");

  const csp = header(response, "content-security-policy") ?? "";
  const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(header(response, "x-content-type-options")).toBe("nosniff");
  expect(header(response, "referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(header(response, "cache-control")).toBe("private, no-store");

  // Every inline script TanStack Start rendered carries the request's nonce (read from the
  // served HTML: scripts that remove themselves, and browsers hiding the attribute, would
  // leave nothing to check in the DOM), and the page hydrated, so they ran.
  const inlineScripts = [...(await response.text()).matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)];
  expect(inlineScripts.length).toBeGreaterThan(0);
  for (const [, attributes] of inlineScripts) expect(attributes).toContain(`nonce="${nonce}"`);
  await expect(page.getByRole("heading", { level: 1, name: "Active Rooms" })).toBeVisible();

  expect(violations).toEqual([]);
});

test("an invite page sends no referrer, and auth responses are private, no-store", async ({
  page,
  context,
}) => {
  const violations = await watchViolations(context, page);
  const response = await page.goto("/join/not-a-real-invite");
  if (!response) throw new Error("No response for the invite page");
  expect(header(response, "referrer-policy")).toBe("no-referrer");
  expect(header(response, "content-security-policy")).toContain("frame-ancestors 'none'");

  const session = await page.request.get("/api/auth/get-session");
  expect(session.headers()["cache-control"]).toBe("private, no-store");
  expect(session.headers()["x-content-type-options"]).toBe("nosniff");

  expect(violations).toEqual([]);
});

test("hashed assets keep a long cache and are not no-store", async ({ page }) => {
  const assets: Response[] = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/assets/")) assets.push(r);
  });
  await page.goto("/");
  expect(assets.length).toBeGreaterThan(0);
  for (const asset of assets) {
    expect(header(asset, "cache-control")).toBe("public, max-age=31536000, immutable");
    expect(header(asset, "x-content-type-options")).toBe("nosniff");
  }
});

test("a room (realtime socket, avatar, camera, share) runs without a violation", async ({
  page,
  context,
}) => {
  const violations = await watchViolations(context, page);
  const serverFns: Response[] = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/_serverFn/")) serverFns.push(r);
  });
  await context.route("https://cdn.discordapp.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL }),
  );
  await signIn(context, { username: "csp.host", image: AVATAR });
  await createRoomOnPage(page, { name: uniqueRoomName("csp room") });
  await expect(page.locator(`img[src^="${AVATAR}"]`).first()).toBeVisible();
  // Creating the room and loading its page were server-function calls: never cacheable.
  expect(serverFns.length).toBeGreaterThan(0);
  for (const fn of serverFns) expect(header(fn, "cache-control")).toBe("private, no-store");

  const camera = page.getByRole("button", { name: "Turn camera on" });
  await camera.click();
  await expect(page.getByRole("button", { name: "Turn camera off" })).toBeVisible();
  await expect(page.locator("video[data-camera]").first()).toBeVisible();

  const share = page.getByRole("button", { name: "Share screen" });
  await expect(share).toBeEnabled();
  await share.click();
  await expect(page.getByRole("button", { name: "Stop sharing" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  expect(violations).toEqual([]);
});
