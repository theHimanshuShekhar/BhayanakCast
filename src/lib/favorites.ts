/**
 * Favorites, client-safe half: the input schema for the favorite server
 * functions (src/server/favorites.ts). A favorite is a badge only (ADR 19): it
 * marks a user on their profile and nothing else.
 */
import { z } from "zod";

/**
 * Favorite (`favorite: true`) or unfavorite another user, by user id. The
 * client sends the state it wants, so repeating a toggle is a no-op.
 */
export const toggleFavoriteInput = z.object({
  userId: z.string().min(1).max(64),
  favorite: z.boolean(),
});
export type ToggleFavoriteInput = z.input<typeof toggleFavoriteInput>;
