/**
 * Favorites, server half (ADR 19: a badge only, no sorting or notifications).
 * Each function takes the database and the caller explicitly, so
 * src/lib/favorites.functions.ts stays a thin wrapper and tests call these
 * directly against PGlite. The favoriting user is always the caller, never an
 * id the client sends.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { favorites, user } from "../db/schema/index.ts";
import { type ToggleFavoriteInput, toggleFavoriteInput } from "../lib/favorites.ts";
import { type Caller, requireSignedIn } from "./caller.ts";

/** Thrown when a user tries to favorite themselves. */
export class SelfFavoriteError extends Error {
  constructor() {
    super("You can't favorite yourself");
    this.name = "SelfFavoriteError";
  }
}

const pair = (userId: string, favoriteUserId: string) =>
  and(eq(favorites.userId, userId), eq(favorites.favoriteUserId, favoriteUserId));

/** Whether the caller has favorited `userId`. Always false for visitors and for yourself. */
export async function isFavorite(db: Db, caller: Caller, userId: string): Promise<boolean> {
  if (!caller.user || caller.user.id === userId) return false;
  const [row] = await db
    .select({ userId: favorites.userId })
    .from(favorites)
    .where(pair(caller.user.id, userId));
  return row !== undefined;
}

/**
 * Favorite or unfavorite `userId` as the caller and return the stored state.
 * Idempotent per target: the input carries the wanted state, so a repeated
 * call (a double click, a retry) changes nothing. Visitors, self-favorites and
 * unknown users are rejected.
 */
export async function toggleFavorite(
  db: Db,
  caller: Caller,
  input: ToggleFavoriteInput,
): Promise<{ favorite: boolean }> {
  requireSignedIn(caller);
  const { userId, favorite } = toggleFavoriteInput.parse(input);
  if (userId === caller.user.id) throw new SelfFavoriteError();
  if (!favorite) {
    await db.delete(favorites).where(pair(caller.user.id, userId));
    return { favorite: false };
  }
  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
  if (!target) throw new Error(`No user ${userId}`);
  await db
    .insert(favorites)
    .values({ userId: caller.user.id, favoriteUserId: userId })
    .onConflictDoNothing();
  return { favorite: true };
}
