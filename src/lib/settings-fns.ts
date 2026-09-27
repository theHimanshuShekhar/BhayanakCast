/**
 * Settings server functions (ADR 13 addendum). The caller is always the session
 * user; the client never names whose settings to read or write.
 */
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { getDb } from "~/db/client";
import {
  DEFAULT_USER_SETTINGS,
  parseThemeCookie,
  THEME_COOKIE,
  type UserSettings,
  userSettingsSchema,
} from "~/db/settings";
import { getSessionFromRequest } from "~/server/session";
import { getUserSettings, saveUserSettings } from "~/server/settings";

export interface InitialSettings {
  /** The signed-in user the settings belong to; null for a visitor. */
  userId: string | null;
  settings: UserSettings;
}

/**
 * The caller's settings as the server knows them: a user's saved settings, or for
 * a visitor the defaults with the theme/accent from the cookie mirror.
 */
export const getSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<InitialSettings> => {
    const session = await getSessionFromRequest(getRequestHeaders());
    if (session) {
      const saved = await getUserSettings(getDb(), session.user.id);
      if (saved) return { userId: session.user.id, settings: saved };
    }
    const mirror = parseThemeCookie(getCookie(THEME_COOKIE));
    return { userId: null, settings: { ...DEFAULT_USER_SETTINGS, ...mirror } };
  },
);

/** Save the signed-in caller's settings. Visitors keep theirs in localStorage only. */
export const saveSettings = createServerFn({ method: "POST" })
  .validator(userSettingsSchema)
  .handler(async ({ data }): Promise<UserSettings> => {
    const session = await getSessionFromRequest(getRequestHeaders());
    if (!session) throw new Error("Sign in to save settings");
    return saveUserSettings(getDb(), session.user.id, data);
  });
