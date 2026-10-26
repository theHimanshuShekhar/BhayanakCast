/**
 * Home server functions: a thin `createServerFn` wrapper over src/server/home.ts that counts
 * the read against the client IP's limit (`limitPublicRead`) and derives the caller from the
 * session. Read through `homeSummaryQuery` and `youCardQuery` (home.queries.ts) rather than
 * calling them directly.
 */
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "~/db/client";
import { getHomeSummary, getYouCard } from "~/server/home";
import { getCaller, limitPublicRead } from "~/server/request-caller";

export const getHomeSummaryFn = createServerFn({ method: "GET" }).handler(async () => {
  limitPublicRead("home");
  return getHomeSummary(getDb(), await getCaller());
});

/** The signed-in caller's own "You" figures; null for a visitor. Takes no user id. */
export const getYouCardFn = createServerFn({ method: "GET" }).handler(async () => {
  limitPublicRead("home");
  return getYouCard(getDb(), await getCaller());
});
