// Appearance settings (ADR 13 addendum). Persisted to localStorage + a cookie for SSR for now;
// the DB-backed copy on the user row replaces the localStorage source once auth lands.
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  accentHue: 265,
  radius: 12,
  density: "comfortable",
  layout: "mosaic",
  showChat: true,
};

const STORAGE_KEY = "bc_settings";

type Ctx = { settings: Settings; update: (patch: Partial<Settings>) => void };
const SettingsContext = createContext<Ctx | null>(null);

const load = (): Settings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {}
  return DEFAULT_SETTINGS;
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  // Hydrate from storage after mount so SSR and first client render agree.
  useEffect(() => setSettings(load()), []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent-h", String(settings.accentHue));
    root.style.setProperty("--radius", `${settings.radius}px`);
    root.style.setProperty("--radius-sm", `${Math.max(4, settings.radius - 6)}px`);
    root.style.setProperty("--radius-lg", `${settings.radius + 6}px`);
    root.classList.toggle("dark", settings.theme === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      // biome-ignore lint/suspicious/noDocumentCookie: tiny theme cookie read by SSR; no Cookie Store API needed
      document.cookie = `bc_theme=${settings.theme}-${settings.accentHue}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
  }, [settings]);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  return <SettingsContext value={{ settings, update }}>{children}</SettingsContext>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
