/**
 * The site's public origin for link embeds (ADR 22): a thin `createServerFn`, safe to import
 * anywhere. `BETTER_AUTH_URL` is server-only, and every absolute URL in a tag (`og:url`,
 * `og:image`) has to be built on it, not on whatever host the request arrived at.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "~/server/env";

const getSiteOriginFn = createServerFn({ method: "GET" }).handler(
  (): string => new URL(env.BETTER_AUTH_URL).origin,
);

let origin: Promise<string> | undefined;

/**
 * The origin, fetched once per process or page: it never changes, and the root route asks on
 * every navigation.
 */
export function siteOrigin(): Promise<string> {
  origin ??= getSiteOriginFn().catch((error) => {
    origin = undefined;
    throw error;
  });
  return origin;
}
