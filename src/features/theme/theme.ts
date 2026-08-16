export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'bhayanakcast.theme'

export interface ThemeBootstrapPreference {
  readonly authenticated: boolean
  readonly theme: Theme | null
}

export function createThemeBootstrapScript(
  preference: ThemeBootstrapPreference = { authenticated: false, theme: null },
) {
  const serialized = JSON.stringify(preference)
  return `(()=>{const a=${serialized};let o=a.authenticated?a.theme:null;if(!a.authenticated){try{o=localStorage.getItem('${THEME_STORAGE_KEY}')}catch{}}if(o!=='light'&&o!=='dark')o=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';const r=document.documentElement;r.dataset.theme=o;r.style.colorScheme=o;let m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.name='theme-color';m.dataset.light='#F2F4F8';m.dataset.dark='#0B0E14';document.head.append(m)}m.content=m.dataset[o]})()`
}

export const THEME_BOOTSTRAP_SCRIPT = createThemeBootstrapScript()

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
