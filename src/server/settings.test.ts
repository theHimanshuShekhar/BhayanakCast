import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { user } from "../db/schema/index.ts";
import {
  DEFAULT_USER_SETTINGS,
  formatThemeCookie,
  parseThemeCookie,
  type UserSettings,
} from "../db/settings.ts";
import { createTestDb } from "../db/test-db.ts";
import { getUserSettings, saveUserSettings } from "./settings.ts";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db
    .insert(user)
    .values(["a", "b"].map((id) => ({ id, name: id, email: `${id}@discord.invalid` })));
});

afterEach(async () => {
  await close();
});

const CUSTOM: UserSettings = {
  theme: "light",
  accentHue: 145,
  radius: 24,
  density: "compact",
  layout: "spotlight",
  showChat: false,
};

async function storedSettings(id: string) {
  const [row] = await db.select({ settings: user.settings }).from(user).where(eq(user.id, id));
  return row?.settings;
}

describe("settings", () => {
  it("starts every user on the defaults", async () => {
    expect(await getUserSettings(db, "a")).toEqual(DEFAULT_USER_SETTINGS);
  });

  it("round-trips saved settings for that user only", async () => {
    expect(await saveUserSettings(db, "a", CUSTOM)).toEqual(CUSTOM);
    expect(await getUserSettings(db, "a")).toEqual(CUSTOM);
    expect(await getUserSettings(db, "b")).toEqual(DEFAULT_USER_SETTINGS);
  });

  it.each([
    ["an unknown theme", { ...CUSTOM, theme: "sepia" }],
    ["a hue above 360", { ...CUSTOM, accentHue: 400 }],
    ["a fractional radius", { ...CUSTOM, radius: 12.5 }],
    ["a negative radius", { ...CUSTOM, radius: -1 }],
    ["an unknown density", { ...CUSTOM, density: "cozy" }],
    ["an unknown layout", { ...CUSTOM, layout: "carousel" }],
    ["a non-boolean chat flag", { ...CUSTOM, showChat: "yes" }],
    ["a missing field", { ...CUSTOM, showChat: undefined }],
    ["an unknown field", { ...CUSTOM, role: "admin" }],
    ["a non-object", "light"],
  ])("rejects %s and keeps what was stored", async (_, input) => {
    await saveUserSettings(db, "a", CUSTOM);
    await expect(saveUserSettings(db, "a", input)).rejects.toThrow();
    expect(await storedSettings("a")).toEqual(CUSTOM);
  });

  it("refuses to save for an unknown user", async () => {
    await expect(saveUserSettings(db, "nobody", CUSTOM)).rejects.toThrow();
    expect(await getUserSettings(db, "nobody")).toBeNull();
  });

  it("fills in defaults for missing or invalid stored fields", async () => {
    await db
      .update(user)
      .set({ settings: { theme: "light", accentHue: "pink" } as unknown as UserSettings })
      .where(eq(user.id, "a"));
    expect(await getUserSettings(db, "a")).toEqual({ ...DEFAULT_USER_SETTINGS, theme: "light" });
  });
});

describe("theme cookie mirror", () => {
  it("round-trips theme and accent", () => {
    const value = formatThemeCookie({ theme: "light", accentHue: 30 });
    expect(parseThemeCookie(value)).toEqual({ theme: "light", accentHue: 30 });
  });

  it.each([undefined, "", "sepia-30", "light-999", "light-", "dark-30; x"])(
    "ignores %j",
    (value) => {
      expect(parseThemeCookie(value)).toBeNull();
    },
  );
});
