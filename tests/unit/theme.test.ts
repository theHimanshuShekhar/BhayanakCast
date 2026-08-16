import { describe, expect, test } from 'vitest'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getThemeStorage,
  readThemeOverride,
  resolveTheme,
  writeThemeOverride,
} from '../../src/features/theme/theme'

describe('theme preference', () => {
  test('follows the system preference without an override', () => {
    expect(resolveTheme(null, false)).toBe('light')
    expect(resolveTheme(null, true)).toBe('dark')
  })

  test('uses a valid persisted override instead of the system preference', () => {
    const lightStorage = new MemoryStorage([[THEME_STORAGE_KEY, 'light']])
    const darkStorage = new MemoryStorage([[THEME_STORAGE_KEY, 'dark']])

    expect(resolveTheme(readThemeOverride(lightStorage), true)).toBe('light')
    expect(resolveTheme(readThemeOverride(darkStorage), false)).toBe('dark')
  })

  test('ignores invalid persisted values', () => {
    const storage = new MemoryStorage([[THEME_STORAGE_KEY, 'sepia']])

    expect(readThemeOverride(storage)).toBeNull()
    expect(resolveTheme(readThemeOverride(storage), true)).toBe('dark')
  })

  test('persists a local light or dark override', () => {
    const storage = new MemoryStorage()

    writeThemeOverride('dark', storage)
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    writeThemeOverride('light', storage)
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  test('falls back to the system when persisted storage cannot be read', () => {
    const storage = {
      getItem() {
        throw new Error('storage unavailable')
      },
    }

    expect(readThemeOverride(storage)).toBeNull()
    expect(resolveTheme(readThemeOverride(storage), true)).toBe('dark')
  })

  test('keeps theme changes usable when an override cannot be persisted', () => {
    const storage = {
      setItem() {
        throw new Error('storage unavailable')
      },
    }

    expect(() => writeThemeOverride('dark', storage)).not.toThrow()
  })

  test('handles browsers that deny access to the storage property', () => {
    const owner = {
      get localStorage(): Storage {
        throw new Error('storage access denied')
      },
    }

    expect(getThemeStorage(owner)).toBeNull()
  })

  test('keeps browser chrome color aligned with the applied override', () => {
    const root = {
      dataset: {} as DOMStringMap,
      style: { colorScheme: '' } as CSSStyleDeclaration,
    }
    const themeColor = {
      content: '#F2F4F8',
      dataset: { light: '#F2F4F8', dark: '#0B0E14' },
    }

    applyTheme('dark', root, themeColor)

    expect(themeColor.content).toBe('#0B0E14')
  })
})

class MemoryStorage {
  readonly #values: Map<string, string>

  constructor(entries: [string, string][] = []) {
    this.#values = new Map(entries)
  }

  getItem(key: string) {
    return this.#values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.#values.set(key, value)
  }
}
