import type { APIRequestContext, APIResponse } from "@playwright/test";
import { signIn } from "./auth";
import { expect, newPage, test } from "./fixtures";
import {
  createRoomOnPage,
  createUsers,
  fakeClipboard,
  minutesAgo,
  seedRoom,
  uniqueRoomName,
} from "./rooms";

// Link embeds (#87, ADR 22): what a link-unfurling crawler gets. Every request here is a bare
// HTTP one, no cookies and no JS, with the crawler's own user agent, against the production
// build: the tags must be in the server-rendered HTML, and the room card image must be a real
// 1200x630 PNG. Private rooms and invite links must reveal nothing.

const CRAWLERS = {
  Discordbot: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  Twitterbot: "Twitterbot/1.0",
  Slackbot: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  facebookexternalhit: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  WhatsApp: "WhatsApp/2.23.20.0",
  TelegramBot: "TelegramBot (like TwitterBot)",
} as const;
const DISCORDBOT = CRAWLERS.Discordbot;

/** `html` entity-decoded for the few entities React writes into attributes. */
const decode = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The page's `<head>` and its `<meta>` tags by `name` or `property` (and `<title>`). */
function readHead(html: string) {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
  const tags = new Map<string, string>();
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/g)) {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
    const key = attr("name") ?? attr("property");
    const content = attr("content");
    if (key && content !== undefined) tags.set(key, decode(content));
  }
  const title = decode(/<title>([\s\S]*?)<\/title>/.exec(head)?.[1] ?? "");
  const icons = [...head.matchAll(/<link\b[^>]*\brel="(icon|apple-touch-icon)"[^>]*>/g)].map(
    ([tag]) => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? "",
  );
  return { head, tags, title, icons };
}

/** Fetch `path` as `userAgent` (no cookies); follows redirects as a crawler does. */
async function crawl(request: APIRequestContext, path: string, userAgent: string = DISCORDBOT) {
  const response = await request.get(path, { headers: { "user-agent": userAgent } });
  expect(response.status(), `${path} as ${userAgent}`).toBe(200);
  return { response, ...readHead(await response.text()) };
}

/** `response` is a PNG of exactly 1200x630. */
async function expectCardPng(response: APIResponse) {
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  const bytes = await response.body();
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);
}

/** The tags every page has, with `image` the absolute URL of its card. */
function expectFullTags(tags: Map<string, string>, origin: string, url: string, image: string) {
  expect(tags.get("description")).toBeTruthy();
  expect(tags.get("theme-color")).toBe("#5d90ff");
  expect(tags.get("og:type")).toBe("website");
  expect(tags.get("og:site_name")).toBe("BhayanakCast");
  expect(tags.get("og:url")).toBe(url);
  expect(tags.get("og:image")).toBe(image);
  expect(tags.get("og:image")).toMatch(new RegExp(`^${origin}/`));
  expect(tags.get("og:image:width")).toBe("1200");
  expect(tags.get("og:image:height")).toBe("630");
  expect(tags.get("og:image:alt")).toBeTruthy();
  expect(tags.get("og:description")).toBe(tags.get("description"));
  expect(tags.get("twitter:card")).toBe("summary_large_image");
  expect(tags.get("twitter:title")).toBe(tags.get("og:title"));
  expect(tags.get("twitter:description")).toBe(tags.get("og:description"));
  expect(tags.get("twitter:image")).toBe(image);
}

const originOf = (baseURL: string | undefined) => new URL(baseURL ?? "").origin;

test("the home page carries the site's tags, and its share image and icons are real files", async ({
  request,
  baseURL,
}) => {
  const origin = originOf(baseURL);
  const { tags, title, icons } = await crawl(request, "/");
  expectFullTags(tags, origin, `${origin}/`, `${origin}/og-image.png`);
  expect(tags.get("og:title")).toBe("Your crew. Your screens. One room.");
  expect(title).toBe("BhayanakCast · your crew, your screens, one room");
  expect(icons).toEqual(
    expect.arrayContaining(["/favicon.svg", "/favicon.png", "/apple-touch-icon.png"]),
  );

  await expectCardPng(await request.get("/og-image.png"));
  for (const icon of ["/favicon.png", "/apple-touch-icon.png"]) {
    const served = await request.get(icon);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/png");
  }
});

test("a public live room's link gives every crawler the room's own title, description and card", async ({
  request,
  browser,
  context,
  baseURL,
}) => {
  const origin = originOf(baseURL);
  const [hostId = ""] = await createUsers(browser, ["embed.host"]);
  const name = uniqueRoomName("embed live");
  const roomId = await seedRoom(context, {
    name,
    hostUserId: hostId,
    createdAt: minutesAgo(10),
    presence: [{ userId: hostId, startedAt: minutesAgo(5) }],
  });

  for (const [crawler, userAgent] of Object.entries(CRAWLERS)) {
    const { response, tags, title } = await crawl(request, `/room/${roomId}`, userAgent);
    // The room's own tags, though the visitor was sent on to /?join=<id>.
    expect(response.url(), crawler).toContain(`/?join=${roomId}`);
    expectFullTags(
      tags,
      origin,
      `${origin}/room/${roomId}`,
      `${origin}/api/og/room/${roomId}.png?v=0`,
    );
    expect(tags.get("og:title"), crawler).toBe(name);
    expect(tags.get("og:description"), crawler).toBe(
      "Live now · hosted by embed.host · 1 watching · join on BhayanakCast",
    );
    expect(title, crawler).toBe(`${name} — BhayanakCast`);
  }

  // The card the tags name is a valid PNG, public and cacheable for a minute.
  const card = await request.get(`/api/og/room/${roomId}.png?v=0`);
  await expectCardPng(card);
  expect(card.headers()["cache-control"]).toBe("public, max-age=60");
  expect(card.headers()["x-content-type-options"]).toBe("nosniff");
  expect(
    Buffer.compare(
      await card.body(),
      await (await request.get(`/api/og/room/${roomId}.png`)).body(),
    ),
  ).toBe(0);

  // The HTML itself stays private to its caller (it embeds the session's loader data).
  const page = await request.get(`/room/${roomId}`);
  expect(page.headers()["cache-control"]).toBe("private, no-store");
});

test("a private room's link and card reveal nothing about the room", async ({
  request,
  browser,
  context,
  baseURL,
}) => {
  const origin = originOf(baseURL);
  const [hostId = ""] = await createUsers(browser, ["hush.embedhost"]);
  const name = uniqueRoomName("hush embed secret");
  const roomId = await seedRoom(context, {
    name,
    hostUserId: hostId,
    isPrivate: true,
    createdAt: minutesAgo(10),
    presence: [{ userId: hostId, startedAt: minutesAgo(5) }],
  });

  for (const userAgent of Object.values(CRAWLERS)) {
    const { response, head, tags, title } = await crawl(request, `/room/${roomId}`, userAgent);
    const html = await (
      await request.get(`/room/${roomId}`, { headers: { "user-agent": userAgent } })
    ).text();
    expectFullTags(tags, origin, `${origin}/`, `${origin}/og-image.png`);
    expect(tags.get("og:title")).toBe("This room isn't available");
    expect(title).toBe("This room isn't available");
    // Not the name or the host anywhere in the page, and not them or the room's id in the head
    // or the image URL. (The page's router state does echo the id: it is the URL asked for.)
    for (const secret of [name, "hush.embedhost"]) {
      expect(html, `${secret} in the page`).not.toContain(secret);
    }
    for (const secret of [name, "hush.embedhost", roomId]) {
      expect(head, `${secret} in the head`).not.toContain(secret);
      expect(tags.get("og:image")).not.toContain(secret);
    }
    expect(response.url()).toContain("join=");
  }

  // The card endpoint answers like it does for a room that never existed: the site image.
  const same = await request.get(`/api/og/room/${roomId}.png`, { maxRedirects: 0 });
  const unknown = await request.get("/api/og/room/no-such-room.png", { maxRedirects: 0 });
  for (const response of [same, unknown]) {
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe("/og-image.png");
    expect(response.headers()["cache-control"]).toBe("public, max-age=60");
  }
  await expectCardPng(await request.get(`/api/og/room/${roomId}.png`));
});

test("an invite link's tags are generic and carry no token, name or host", async ({
  request,
  browser,
  baseURL,
}) => {
  const origin = originOf(baseURL);
  const hostContext = await browser.newContext();
  try {
    await signIn(hostContext, { username: "invite.embedhost" });
    await fakeClipboard(hostContext);
    const host = await newPage(hostContext);
    const name = uniqueRoomName("invite embed secret");
    await createRoomOnPage(host, { name, isPrivate: true });
    await host.getByRole("button", { name: "room info" }).click();
    await host.getByRole("menuitem", { name: "copy invite link" }).click();
    await expect(host.getByText("invite link copied")).toBeVisible();
    const link =
      (await host.evaluate(() => (window as unknown as { copied?: string }).copied)) ?? "";
    const token = /\/join\/([\w-]+)$/.exec(link)?.[1] ?? "";
    expect(token).not.toBe("");

    for (const userAgent of Object.values(CRAWLERS)) {
      const { head, tags, title } = await crawl(request, `/join/${token}`, userAgent);
      expectFullTags(tags, origin, `${origin}/`, `${origin}/og-image.png`);
      expect(tags.get("og:title")).toBe("A private room on BhayanakCast");
      expect(title).toBe("A private room on BhayanakCast");
      for (const secret of [token, name, "invite.embedhost", "/join/"]) {
        expect(head, `${secret} in the head`).not.toContain(secret);
      }
    }
    // An invalid token looks the same: nothing says whether a link is live.
    const { tags: invalid } = await crawl(request, "/join/not-a-real-token");
    expect(invalid.get("og:title")).toBe("A private room on BhayanakCast");
  } finally {
    await hostContext.close();
  }
});

test("an ended or unknown room's link is a generic card, not an empty embed", async ({
  request,
  browser,
  context,
  baseURL,
}) => {
  const origin = originOf(baseURL);
  const [hostId = ""] = await createUsers(browser, ["embed.endedhost"]);
  const name = uniqueRoomName("embed ended");
  const roomId = await seedRoom(context, {
    name,
    hostUserId: hostId,
    createdAt: minutesAgo(60),
    endedAt: minutesAgo(30),
  });

  for (const path of [`/room/${roomId}`, "/room/no-such-room"]) {
    const { head, tags } = await crawl(request, path);
    expectFullTags(tags, origin, `${origin}/`, `${origin}/og-image.png`);
    expect(tags.get("og:title")).toBe("This room isn't available");
    expect(head).not.toContain(name);
  }
});

test("a public recap and a profile have their own tags; a private recap stays generic", async ({
  request,
  browser,
  context,
  baseURL,
}) => {
  const origin = originOf(baseURL);
  const [hostId = ""] = await createUsers(browser, ["embed.recaphost"]);
  const span = { userId: hostId, startedAt: minutesAgo(90), endedAt: minutesAgo(30) };
  const seed = (name: string, isPrivate: boolean) =>
    seedRoom(context, {
      name,
      hostUserId: hostId,
      isPrivate,
      createdAt: minutesAgo(90),
      endedAt: minutesAgo(30),
      presence: [span],
    });
  const publicName = uniqueRoomName("embed recap");
  const privateName = uniqueRoomName("hush recap secret");
  const publicId = await seed(publicName, false);
  const privateId = await seed(privateName, true);

  const recap = await crawl(request, `/past/${publicId}`);
  expectFullTags(recap.tags, origin, `${origin}/past/${publicId}`, `${origin}/og-image.png`);
  expect(recap.tags.get("og:title")).toBe(publicName);
  expect(recap.tags.get("og:description")).toBe(
    "Past stream · hosted by embed.recaphost · 1 person · 1h",
  );

  const profile = await crawl(request, `/profile/${hostId}`);
  expectFullTags(profile.tags, origin, `${origin}/profile/${hostId}`, `${origin}/og-image.png`);
  expect(profile.tags.get("og:title")).toBe("embed.recaphost on BhayanakCast");

  // A visitor can't read a private recap: its page is "not found", and the tags are the site's.
  const hidden = await request.get(`/past/${privateId}`, { headers: { "user-agent": DISCORDBOT } });
  const { head, tags } = readHead(await hidden.text());
  expect(head).not.toContain(privateName);
  expect(tags.get("og:title")).not.toBe(privateName);
  expect(tags.get("og:image")).toBe(`${origin}/og-image.png`);
});
