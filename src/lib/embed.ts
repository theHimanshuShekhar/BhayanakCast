/**
 * Link embeds (ADR 22): the `<meta>` tags that make a pasted link unfurl as a rich card in
 * Discord, X, Slack, WhatsApp and the like. Client-safe and pure: each route's `head()` calls a
 * builder with the site's `origin` (from `BETTER_AUTH_URL`, see ./embed.functions.ts) and the
 * data its loader already has. Crawlers run no JS, so these tags are read from the server-
 * rendered HTML.
 *
 * Privacy rule: a builder is only ever handed what a visitor may see. The room builder also
 * refuses a private room itself, and the invite and unavailable builders take no room data at
 * all, so a private room's name, host and invite token can't reach a tag.
 */
import { fmtMins } from "./format.ts";
import type { Profile } from "./profiles";
import type { Recap } from "./recaps";
import type { LiveRoomCard } from "./rooms";

const SITE_NAME = "BhayanakCast";
/** The browser tab's title on the home page and wherever a page sets none. */
const SITE_TITLE = "BhayanakCast · your crew, your screens, one room";
/** The card's title: Discord shows the site name above it, so it doesn't repeat the name. */
const SITE_CARD_TITLE = "Your crew. Your screens. One room.";
const SITE_DESCRIPTION =
  "Live screen sharing for small groups. Up to 3 people share their screens at once to up to 10 in a room: no downloads, just sign in with Discord.";

/** The brand accent (`--color-primary`, oklch(0.68 0.19 265)); Discord colours its embed bar with it. */
export const THEME_COLOR = "#5d90ff";

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
/** The designed share image, committed in public/ (`pnpm og:image` regenerates it). */
export const SITE_IMAGE_PATH = "/og-image.png";
const SITE_IMAGE_ALT = "BhayanakCast: your crew, your screens, one room.";

/** One entry of a route's `head().meta`. */
export type MetaTag = Record<string, string>;

interface EmbedPage {
  /** The browser tab's title, when it differs from the card's. */
  documentTitle?: string;
  title: string;
  description: string;
  /** Absolute canonical URL; none leaves `og:url` out, so a crawler keeps the URL it was given. */
  url?: string;
  /** Absolute URL of a 1200x630 PNG. */
  image: string;
  imageAlt: string;
}

/** Every tag a page carries: description, theme colour, Open Graph and the Twitter card. */
function embedMeta(page: EmbedPage): MetaTag[] {
  return [
    { title: page.documentTitle ?? page.title },
    { name: "description", content: page.description },
    { name: "theme-color", content: THEME_COLOR },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: page.title },
    { property: "og:description", content: page.description },
    ...(page.url ? [{ property: "og:url", content: page.url }] : []),
    { property: "og:image", content: page.image },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: String(OG_IMAGE_WIDTH) },
    { property: "og:image:height", content: String(OG_IMAGE_HEIGHT) },
    { property: "og:image:alt", content: page.imageAlt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: page.title },
    { name: "twitter:description", content: page.description },
    { name: "twitter:image", content: page.image },
    { name: "twitter:image:alt", content: page.imageAlt },
  ];
}

/** The generic card: the site, and the stand-in for anything a visitor may not see. */
function siteCard(origin: string, overrides: Partial<EmbedPage> = {}): EmbedPage {
  return {
    title: SITE_CARD_TITLE,
    description: SITE_DESCRIPTION,
    image: `${origin}${SITE_IMAGE_PATH}`,
    imageAlt: SITE_IMAGE_ALT,
    ...overrides,
  };
}

/**
 * The site's tags without a canonical URL: the default under every page that sets none (the
 * root route's), since a canonical URL belongs to the page that is it.
 */
export const siteMeta = (origin: string): MetaTag[] =>
  embedMeta(siteCard(origin, { documentTitle: SITE_TITLE }));

/** The home page's tags: the site's, with the site root as its URL. */
export const homeMeta = (origin: string): MetaTag[] =>
  embedMeta(siteCard(origin, { documentTitle: SITE_TITLE, url: `${origin}/` }));

/**
 * A private room, or an invite link to one: nothing about the room, and no `og:url`, so the URL
 * a crawler was given (an invite link is a bearer token) is the one it keeps, and nothing here
 * can name it.
 */
export const privateRoomMeta = (origin: string): MetaTag[] =>
  embedMeta(
    siteCard(origin, {
      title: "A private room on BhayanakCast",
      description: "This room is private. Sign in with Discord and knock if you have an invite.",
    }),
  );

/**
 * A room link whose room a visitor can't see: ended, unknown or private. The three look alike,
 * so the card can't tell a stranger which rooms exist.
 */
export const unavailableRoomMeta = (origin: string): MetaTag[] =>
  embedMeta(
    siteCard(origin, {
      url: `${origin}/`,
      title: "This room isn't available",
      description: "It has ended or is private. See what's live on BhayanakCast.",
    }),
  );

/** The path of a room's card image; `version` (its newest thumbnail) busts caches when it changes. */
export const roomImagePath = (roomId: string, version = 0): string =>
  `/api/og/room/${encodeURIComponent(roomId)}.png?v=${version}`;

/** The newest thumbnail time among a room's streamers, in epoch ms (0 when none). */
export const newestThumbnailMs = (streamers: readonly { thumbnailAt: string | null }[]): number =>
  streamers.reduce(
    (newest, s) => Math.max(newest, s.thumbnailAt ? Date.parse(s.thumbnailAt) : 0),
    0,
  );

type RoomEmbedSource = Pick<
  LiveRoomCard,
  "id" | "name" | "isPrivate" | "host" | "participantCount" | "streamers"
>;

/** A live public room: its name, who hosts it, how many are in, and its generated card. */
export function roomMeta(origin: string, room: RoomEmbedSource): MetaTag[] {
  if (room.isPrivate) return privateRoomMeta(origin);
  const image = roomImagePath(room.id, newestThumbnailMs(room.streamers));
  return embedMeta({
    documentTitle: `${room.name} — ${SITE_NAME}`,
    title: room.name,
    description: [
      "Live now",
      ...(room.host ? [`hosted by ${room.host.username}`] : []),
      `${room.participantCount} watching`,
      "join on BhayanakCast",
    ].join(" · "),
    // The URL that answers with these tags: /room/<id> redirects a visitor here, so naming it
    // would make the two pages each other's canonical.
    url: `${origin}/?join=${encodeURIComponent(room.id)}`,
    image: `${origin}${image}`,
    imageAlt: `${room.name}, live on BhayanakCast`,
  });
}

/** An ended public room's recap. Its image is the site's: a past stream has no live card. */
export function recapMeta(
  origin: string,
  recap: Pick<Recap, "id" | "name" | "isPrivate" | "host" | "durationMinutes" | "people">,
): MetaTag[] {
  if (recap.isPrivate) return privateRoomMeta(origin);
  return embedMeta(
    siteCard(origin, {
      documentTitle: `${recap.name} (recap) — ${SITE_NAME}`,
      title: recap.name,
      description: [
        "Past stream",
        ...(recap.host ? [`hosted by ${recap.host.username}`] : []),
        `${recap.people.length} ${recap.people.length === 1 ? "person" : "people"}`,
        fmtMins(recap.durationMinutes),
      ].join(" · "),
      url: `${origin}/past/${encodeURIComponent(recap.id)}`,
    }),
  );
}

/** A profile. Its stats count public rooms only for a visitor (the profile read applies that). */
export function profileMeta(
  origin: string,
  profile: Pick<Profile, "id" | "username" | "stats">,
): MetaTag[] {
  const { hoursStreamed, hoursWatched, roomsHosted } = profile.stats;
  return embedMeta(
    siteCard(origin, {
      documentTitle: `${profile.username} — ${SITE_NAME}`,
      title: `${profile.username} on BhayanakCast`,
      description: [
        `${hoursStreamed.toFixed(1)}h streamed`,
        `${hoursWatched.toFixed(1)}h watched`,
        `${roomsHosted} ${roomsHosted === 1 ? "room" : "rooms"} hosted`,
      ].join(" · "),
      url: `${origin}/profile/${encodeURIComponent(profile.id)}`,
    }),
  );
}
