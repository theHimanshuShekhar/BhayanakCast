/**
 * The room-card route's answers (ADR 22), apart from ./og-room.ts so the route can answer with
 * the site image even when the image pipeline (satori, resvg, libwebp) fails to load.
 */
import { SITE_IMAGE_PATH } from "../lib/embed.ts";

/** `Cache-Control` of a card: Discord and friends cache an embed on their side too. */
export const CARD_CACHE_CONTROL = "public, max-age=60";

/** The answer for a card. */
export function cardResponse(png: Uint8Array): Response {
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": CARD_CACHE_CONTROL,
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * The answer when there is no room card: the committed site image, the same for a private,
 * ended or unknown room, a render that failed and a client over its budget. Cached like a card,
 * so a crawler that hits an ended room's old link doesn't come back at once.
 */
export function siteImageResponse(): Response {
  return new Response(null, {
    status: 302,
    headers: { location: SITE_IMAGE_PATH, "cache-control": CARD_CACHE_CONTROL },
  });
}
