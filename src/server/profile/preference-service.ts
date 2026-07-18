import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { Pool } from 'pg'
import {
  getProductionAuth,
  readSessionProjection,
} from '../auth/auth'

export type ThemeOverride = 'light' | 'dark' | null

export interface ThemePreference {
  readonly authenticated: boolean
  readonly theme: ThemeOverride
}

interface PreferenceRuntimeState {
  pool?: Pool
}

const globalPreference = globalThis as typeof globalThis & {
  __bhayanakCastPreference?: PreferenceRuntimeState
}
const preferenceState = (globalPreference.__bhayanakCastPreference ??= {})

export function parseThemeOverride(value: unknown): ThemeOverride {
  if (value === null || value === 'light' || value === 'dark') return value
  throw new TypeError('Theme preference must be light, dark, or null')
}

export function resolveAnonymousTheme(
  localOverride: ThemeOverride,
  prefersDark: boolean,
): 'light' | 'dark' {
  return localOverride ?? (prefersDark ? 'dark' : 'light')
}

export function resolveAuthenticatedTheme(
  accountOverride: ThemeOverride,
  prefersDark: boolean,
): 'light' | 'dark' {
  return accountOverride ?? (prefersDark ? 'dark' : 'light')
}

export function bindPreferenceRuntime(runtime: { pool: Pool | undefined }) {
  preferenceState.pool = runtime.pool
}

export function createPreferenceService(pool: Pool) {
  return {
    async readTheme(accountId: string): Promise<ThemeOverride> {
      const result = await pool.query<{ theme: string | null }>(
        'SELECT theme FROM account_preference WHERE account_id = $1',
        [accountId],
      )
      return parseStoredTheme(result.rows[0]?.theme ?? null)
    },

    async setTheme(accountId: string, value: unknown): Promise<ThemeOverride> {
      const theme = parseThemeOverride(value)
      await pool.query(
        `INSERT INTO account_preference (account_id, theme)
         VALUES ($1, $2)
         ON CONFLICT (account_id) DO UPDATE SET theme = EXCLUDED.theme`,
        [accountId, theme],
      )
      return theme
    },
  }
}

export function getProductionPreferenceService() {
  const pool = preferenceState.pool
  if (!pool) throw new Error('DATABASE_URL is required for preferences')
  return createPreferenceService(pool)
}

export function validateThemePreferenceInput(value: unknown): { theme: ThemeOverride } {
  if (!value || typeof value !== 'object' || !('theme' in value)) {
    throw new TypeError('Theme preference input must include theme')
  }
  return { theme: parseThemeOverride(value.theme) }
}

export const getThemePreference = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ThemePreference> => {
    const session = await readSessionProjection(getProductionAuth(), getRequest().headers)
    if (!session) return { authenticated: false, theme: null }
    return {
      authenticated: true,
      theme: await getProductionPreferenceService().readTheme(session.id),
    }
  },
)

export const setThemePreference = createServerFn({ method: 'POST' })
  .validator(validateThemePreferenceInput)
  .handler(async ({ data }): Promise<ThemePreference> => {
    const session = await readSessionProjection(getProductionAuth(), getRequest().headers)
    if (!session) throw new Error('Authentication required')
    return {
      authenticated: true,
      theme: await getProductionPreferenceService().setTheme(session.id, data.theme),
    }
  })

function parseStoredTheme(value: string | null): ThemeOverride {
  return value === null || value === 'light' || value === 'dark' ? value : null
}
