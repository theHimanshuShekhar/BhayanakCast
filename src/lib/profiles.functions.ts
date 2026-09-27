/**
 * Profile server functions: thin `createServerFn` wrappers over
 * src/server/profiles.ts. Each validates its input with zod and derives the
 * caller from the session. Read through the query options in profiles.queries.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "~/db/client";
import { getProfile, searchUsers } from "~/server/profiles";
import { getCaller } from "~/server/request-caller";
import { searchUsersInput, userIdInput } from "./profiles";

export const getProfileFn = createServerFn({ method: "GET" })
  .validator(userIdInput)
  .handler(async ({ data }) => getProfile(getDb(), await getCaller(), data.userId));

export const searchUsersFn = createServerFn({ method: "GET" })
  .validator(searchUsersInput)
  .handler(async ({ data }) => searchUsers(getDb(), await getCaller(), data));
