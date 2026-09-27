/**
 * Appearance settings stored on the user row (ADR 13 addendum). Defaults match
 * the design prototype's DEFAULT_TWEAKS. Safe to import from client code.
 */
export type Theme = "dark" | "light";
export type Density = "compact" | "comfortable" | "spacious";
export type MosaicLayout = "mosaic" | "grid" | "spotlight";

export interface UserSettings {
  theme: Theme;
  accentHue: number;
  radius: number;
  density: Density;
  layout: MosaicLayout;
  showChat: boolean;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: "dark",
  accentHue: 265,
  radius: 12,
  density: "comfortable",
  layout: "mosaic",
  showChat: true,
};
