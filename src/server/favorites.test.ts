import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { favorites, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { type Caller, SignInRequiredError } from "./caller.ts";
import { isFavorite, SelfFavoriteError, toggleFavorite } from "./favorites.ts";

let db: Db;
let close: () => Promise<void>;

const visitor: Caller = { user: null, role: "visitor" };
const asUser = (id: string): Caller => ({ user: { id, username: id }, role: "user" });
const fan = asUser("fan");
const other = asUser("other");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values(
    ["fan", "star", "other"].map((id) => ({
      id,
      name: id,
      email: `${id}@discord.invalid`,
      discordUsername: `${id}.discord`,
    })),
  );
});

afterEach(async () => {
  await close();
});

describe("toggleFavorite", () => {
  it("favorites and unfavorites a user", async () => {
    expect(await isFavorite(db, fan, "star")).toBe(false);

    expect(await toggleFavorite(db, fan, { userId: "star", favorite: true })).toEqual({
      favorite: true,
    });
    expect(await isFavorite(db, fan, "star")).toBe(true);

    expect(await toggleFavorite(db, fan, { userId: "star", favorite: false })).toEqual({
      favorite: false,
    });
    expect(await isFavorite(db, fan, "star")).toBe(false);
  });

  it("is idempotent per target", async () => {
    await toggleFavorite(db, fan, { userId: "star", favorite: true });
    await toggleFavorite(db, fan, { userId: "star", favorite: true });
    expect(await db.select().from(favorites)).toHaveLength(1);
    expect(await isFavorite(db, fan, "star")).toBe(true);

    await toggleFavorite(db, fan, { userId: "star", favorite: false });
    await toggleFavorite(db, fan, { userId: "star", favorite: false });
    expect(await isFavorite(db, fan, "star")).toBe(false);
  });

  it("is per caller: another user's favorite is theirs alone", async () => {
    await toggleFavorite(db, fan, { userId: "star", favorite: true });
    expect(await isFavorite(db, other, "star")).toBe(false);

    await toggleFavorite(db, other, { userId: "star", favorite: false });
    expect(await isFavorite(db, fan, "star")).toBe(true);
  });

  it("rejects favoriting yourself", async () => {
    await expect(toggleFavorite(db, fan, { userId: "fan", favorite: true })).rejects.toThrow(
      SelfFavoriteError,
    );
    expect(await db.select().from(favorites)).toEqual([]);
    expect(await isFavorite(db, fan, "fan")).toBe(false);
  });

  it("rejects visitors", async () => {
    await expect(toggleFavorite(db, visitor, { userId: "star", favorite: true })).rejects.toThrow(
      SignInRequiredError,
    );
    expect(await db.select().from(favorites)).toEqual([]);
  });

  it("rejects an unknown user", async () => {
    await expect(toggleFavorite(db, fan, { userId: "nobody", favorite: true })).rejects.toThrow(
      "No user nobody",
    );
  });
});

describe("isFavorite", () => {
  it("is false for visitors", async () => {
    await toggleFavorite(db, fan, { userId: "star", favorite: true });
    expect(await isFavorite(db, visitor, "star")).toBe(false);
  });
});
