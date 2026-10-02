/**
 * Home server functions: a thin `createServerFn` wrapper over src/server/home.ts that counts
 * the read against the client IP's limit (`limitPublicRead`) and derives the caller from the
 * session. Read through `homeSummaryQuery` (home.queries.ts) rather than calling it directly.
 */
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "~/db/client";
import { getHomeSummary } from "~/server/home";
import { getCaller, limitPublicRead } from "~/server/request-caller";

export const getHomeSummaryFn = createServerFn({ method: "GET" }).handler(async () => {
  limitPublicRead("home");
  return getHomeSummary(getDb(), await getCaller());
});
