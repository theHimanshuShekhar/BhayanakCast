// Appearance settings (ADR 13 addendum). A signed-in user's settings live on their user row
// and are saved there (debounced) as they change; a visitor's stay in this browser. Either way
// they are cached in localStorage, and theme + accent are mirrored into the bc_theme cookie so
// SSR paints a visitor's theme without a flash. The root route loads the initial settings on
// the server (getSettings) and hands them to SettingsProvider.
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  formatThemeCookie,
  settingsOrDefaults,
  THEME_COOKIE,
  type UserSettings,
} from "~/db/settings";
import { type InitialSettings, saveSettings } from "./settings-fns";

const STORAGE_KEY = "bc_settings";
const SAVE_DEBOUNCE_MS = 400;

type Ctx = { settings: UserSettings; update: (patch: Partial<UserSettings>) => void };
const SettingsContext = createContext<Ctx | null>(null);

const loadLocal = (): Partial<UserSettings> | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return settingsOrDefaults(JSON.parse(raw));
  } catch {}
  return null;
};

export function SettingsProvider({
  initial,
  children,
}: {
  initial: InitialSettings;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<UserSettings>(initial.settings);
  const [owner, setOwner] = useState(initial.userId);
  // Set by user edits, so settings adopted from the server aren't echoed back to it.
  const edited = useRef(false);

  // A different user after a client-side session change: adopt their saved settings. On
  // sign-out the visitor keeps what's on screen (it's already in localStorage).
  if (owner !== initial.userId) {
    setOwner(initial.userId);
    if (initial.userId) setSettings(initial.settings);
  }

  // A visitor's settings beyond the cookie mirror come from localStorage, after mount so
  // SSR and the first client render agree.
  useEffect(() => {
    if (initial.userId) return;
    const local = loadLocal();
    if (local) setSettings((s) => ({ ...s, ...local }));
  }, [initial.userId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      // biome-ignore lint/suspicious/noDocumentCookie: tiny theme cookie read by SSR; no Cookie Store API needed
      document.cookie = `${THEME_COOKIE}=${formatThemeCookie(settings)}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
  }, [settings]);

  useEffect(() => {
    if (!owner || !edited.current) return;
    const timer = setTimeout(() => {
      saveSettings({ data: settings }).catch((error: unknown) => {
        console.error("Saving settings failed", error);
      });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [settings, owner]);

  const update = (patch: Partial<UserSettings>) => {
    edited.current = true;
    setSettings((s) => ({ ...s, ...patch }));
  };
  return <SettingsContext value={{ settings, update }}>{children}</SettingsContext>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

/** `<html>` attributes for the current settings; rendered during SSR, so the first paint is right. */
export function useDocumentAppearance(): { className?: string; style: CSSProperties } {
  const { settings } = useSettings();
  return {
    className: settings.theme === "dark" ? "dark" : undefined,
    style: {
      "--accent-h": String(settings.accentHue),
      "--radius": `${settings.radius}px`,
      "--radius-sm": `${Math.max(4, settings.radius - 6)}px`,
      "--radius-lg": `${settings.radius + 6}px`,
    } as CSSProperties,
  };
}
