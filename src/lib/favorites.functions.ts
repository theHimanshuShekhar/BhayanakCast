/**
 * Favorite server functions: thin `createServerFn` wrappers over
 * src/server/favorites.ts. Each validates its input with zod and derives the
 * caller from the session. Read through the query options in favorites.queries.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "~/db/client";
import { isFavorite, toggleFavorite } from "~/server/favorites";
import { getCaller } from "~/server/request-caller";
import { toggleFavoriteInput } from "./favorites";
import { userIdInput } from "./profiles";

export const isFavoriteFn = createServerFn({ method: "GET" })
  .validator(userIdInput)
  .handler(async ({ data }) => isFavorite(getDb(), await getCaller(), data.userId));

export const toggleFavoriteFn = createServerFn({ method: "POST" })
  .validator(toggleFavoriteInput)
  .handler(async ({ data }) => toggleFavorite(getDb(), await getCaller(), data));
