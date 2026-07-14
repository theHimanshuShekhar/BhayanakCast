import { useEffect, useState } from 'react'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getThemeStorage,
  readThemeOverride,
  resolveTheme,
  writeThemeOverride,
  type Theme,
} from './theme'

const DARK_SCHEME = '(prefers-color-scheme: dark)'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    const media = window.matchMedia(DARK_SCHEME)
    const syncTheme = () => {
      const next = resolveTheme(
        readThemeOverride(getThemeStorage(window)),
        media.matches,
      )
      applyBrowserTheme(next)
      setTheme(next)
    }
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) syncTheme()
    }

    syncTheme()
    media.addEventListener('change', syncTheme)
    window.addEventListener('storage', syncStoredTheme)
    return () => {
      media.removeEventListener('change', syncTheme)
      window.removeEventListener('storage', syncStoredTheme)
    }
  }, [])

  const toggleTheme = () => {
    const current = theme ?? document.documentElement.dataset.theme
    const next: Theme = current === 'dark' ? 'light' : 'dark'
    writeThemeOverride(next, getThemeStorage(window))
    applyBrowserTheme(next)
    setTheme(next)
  }

  return (
    <button
      aria-label="Dark theme"
      aria-pressed={theme === null ? undefined : theme === 'dark'}
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
    >
      <span aria-hidden="true" className="theme-toggle__icons">
        <svg className="theme-toggle__sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
        </svg>
        <svg className="theme-toggle__moon" viewBox="0 0 24 24">
          <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8a8.5 8.5 0 1 0 11.6 11.6Z" />
        </svg>
      </span>
      <span>Theme</span>
    </button>
  )
}

function applyBrowserTheme(theme: Theme) {
  applyTheme(
    theme,
    document.documentElement,
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'),
  )
}
