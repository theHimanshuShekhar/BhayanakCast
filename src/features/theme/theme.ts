export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'bhayanakcast.theme'

export const THEME_BOOTSTRAP_SCRIPT = `(()=>{let t;try{t=localStorage.getItem('${THEME_STORAGE_KEY}')}catch{}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';const r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;let m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.name='theme-color';m.dataset.light='#F6F8FC';m.dataset.dark='#0D1422';document.head.append(m)}m.content=m.dataset[t]})()`

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>
type StorageOwner = { readonly localStorage: Storage }
type ThemeRoot = Pick<HTMLElement, 'dataset' | 'style'>
type ThemeColorMeta = Pick<HTMLMetaElement, 'content' | 'dataset'>

export function getThemeStorage(owner: StorageOwner): Storage | null {
  try {
    return owner.localStorage
  } catch {
    return null
  }
}

export function readThemeOverride(
  storage: ReadableStorage | null,
): Theme | null {
  try {
    if (!storage) return null
    const value = storage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function resolveTheme(
  override: string | null,
  prefersDark: boolean,
): Theme {
  if (override === 'light' || override === 'dark') return override
  return prefersDark ? 'dark' : 'light'
}

export function writeThemeOverride(
  theme: Theme,
  storage: WritableStorage | null,
) {
  try {
    if (!storage) return
    storage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The in-document theme still changes when storage is unavailable.
  }
}

export function applyTheme(
  theme: Theme,
  root: ThemeRoot,
  themeColor?: ThemeColorMeta | null,
) {
  root.dataset.theme = theme
  root.style.colorScheme = theme
  const color = themeColor?.dataset[theme]
  if (color) themeColor.content = color
}
