/**
 * Appearance settings stored on the user row (ADR 13 addendum). Defaults match
 * the design prototype's DEFAULT_TWEAKS. Safe to import from client code.
 */
import { z } from "zod";

export const userSettingsSchema = z.strictObject({
  theme: z.enum(["dark", "light"]),
  /** oklch hue of the accent colour. */
  accentHue: z.int().min(0).max(360),
  /** Corner radius in px. */
  radius: z.int().min(0).max(32),
  density: z.enum(["compact", "comfortable", "spacious"]),
  layout: z.enum(["mosaic", "grid", "spotlight"]),
  showChat: z.boolean(),
});

export type UserSettings = z.infer<typeof userSettingsSchema>;
export type Theme = UserSettings["theme"];
export type Density = UserSettings["density"];
export type MosaicLayout = UserSettings["layout"];

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: "dark",
  accentHue: 265,
  radius: 12,
  density: "comfortable",
  layout: "mosaic",
  showChat: true,
};

/**
 * Settings from untrusted or older stored data: missing or invalid fields fall
 * back to their defaults, unknown fields are dropped.
 */
export function settingsOrDefaults(value: unknown): UserSettings {
  const stored = typeof value === "object" && value !== null ? value : {};
  const result = { ...DEFAULT_USER_SETTINGS };
  for (const key of Object.keys(DEFAULT_USER_SETTINGS) as (keyof UserSettings)[]) {
    const field = userSettingsSchema.shape[key].safeParse((stored as Record<string, unknown>)[key]);
    if (field.success) Object.assign(result, { [key]: field.data });
  }
  return result;
}

/**
 * The theme/accent cookie mirror, read during SSR so a visitor's first paint has
 * the right `dark` class and `--accent-h` (ADR 13 addendum). Value: `<theme>-<hue>`.
 */
export const THEME_COOKIE = "bc_theme";

export type ThemeMirror = Pick<UserSettings, "theme" | "accentHue">;

export function formatThemeCookie({ theme, accentHue }: ThemeMirror): string {
  return `${theme}-${accentHue}`;
}

export function parseThemeCookie(value: string | undefined): ThemeMirror | null {
  const match = value?.match(/^(dark|light)-(\d{1,3})$/);
  if (!match) return null;
  const parsed = userSettingsSchema
    .pick({ theme: true, accentHue: true })
    .safeParse({ theme: match[1], accentHue: Number(match[2]) });
  return parsed.success ? parsed.data : null;
}
