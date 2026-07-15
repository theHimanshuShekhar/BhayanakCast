import type { Pool } from 'pg'
import {
  betterAuth,
  type Auth,
  type BetterAuthOptions,
  type BetterAuthPlugin,
} from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { DiscordOptions } from 'better-auth/social-providers'
import { createDatabase } from '../db/client'
import { authSchema } from '../db/schema/auth'
import { mapDiscordProfile } from './discord-profile'
import {
  parseAdminDiscordIds,
  projectSession,
  type SessionProjection,
} from './session'

export type AppAuth = Auth
export type DiscordUserInfoLoader = NonNullable<DiscordOptions['getUserInfo']>

export interface AuthConfiguration {
  pool: Pool
  baseURL: string
  secret: string
  discordClientId: string
  discordClientSecret: string
  adminDiscordIds?: string
  plugins?: BetterAuthPlugin[]
  discordGetUserInfo?: DiscordUserInfoLoader
}

export interface BoundAuthRuntime {
  pool: Pool | undefined
}

export interface AuthServer {
  auth: AppAuth
  isPlatformAdmin: (discordId: string) => boolean
}

interface AuthRuntimeState {
  boundRuntime?: BoundAuthRuntime
  productionAuth?: AuthServer
}

const globalAuth = globalThis as typeof globalThis & {
  __bhayanakCastAuth?: AuthRuntimeState
}
const authState = (globalAuth.__bhayanakCastAuth ??= {})

export function bindAuthRuntime(runtime: BoundAuthRuntime) {
  authState.boundRuntime = runtime
  authState.productionAuth = undefined
}

export function createAuthServer(configuration: AuthConfiguration): AuthServer {
  const baseURL = parseOrigin(configuration.baseURL, 'BETTER_AUTH_URL')
  if (configuration.secret.length < 32) {
    throw new TypeError('BETTER_AUTH_SECRET must contain at least 32 characters')
  }
  if (!configuration.discordClientId || !configuration.discordClientSecret) {
    throw new TypeError('Discord OAuth credentials are required')
  }

  const options: BetterAuthOptions = {
    appName: 'BhayanakCast',
    baseURL,
    basePath: '/api/auth',
    secret: configuration.secret,
    database: drizzleAdapter(createDatabase(configuration.pool), {
      provider: 'pg',
      schema: authSchema,
      transaction: true,
    }),
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const sanction = await configuration.pool.query(
              `SELECT 1
                 FROM platform_sanction
                WHERE account_id = $1
                  AND type = 'all_access'
                  AND starts_at <= CURRENT_TIMESTAMP
                  AND lifted_at IS NULL
                  AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
              [session.userId],
            )
            if (sanction.rows[0]) {
              throw new APIError('FORBIDDEN', {
                message: 'Account access is restricted.',
              })
            }
            return { data: session }
          },
        },
      },
    },
    socialProviders: {
      discord: {
        clientId: configuration.discordClientId,
        clientSecret: configuration.discordClientSecret,
        mapProfileToUser: mapDiscordProfile,
        getUserInfo: configuration.discordGetUserInfo,
        overrideUserInfoOnSignIn: true,
      },
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      updateAccountOnSignIn: true,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
    },
    trustedOrigins: [baseURL],
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['x-bhayanakcast-client-ip'],
      },
    },
    plugins: configuration.plugins,
  }

  return {
    auth: betterAuth(options),
    isPlatformAdmin: parseAdminDiscordIds(configuration.adminDiscordIds),
  }
}

export function getProductionAuth(): AuthServer {
  if (authState.productionAuth) return authState.productionAuth
  if (!authState.boundRuntime?.pool) {
    throw new Error('DATABASE_URL is required for authentication')
  }

  const environment = process.env
  authState.productionAuth = createAuthServer({
    pool: authState.boundRuntime.pool,
    baseURL: configuredAuthOrigin(environment),
    secret: requiredEnvironment(environment.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET'),
    discordClientId: requiredEnvironment(
      environment.DISCORD_CLIENT_ID,
      'DISCORD_CLIENT_ID',
    ),
    discordClientSecret: requiredEnvironment(
      environment.DISCORD_CLIENT_SECRET,
      'DISCORD_CLIENT_SECRET',
    ),
    adminDiscordIds: environment.ADMIN_DISCORD_IDS,
  })
  return authState.productionAuth
}

export async function readSessionProjection(
  server: AuthServer,
  headers: Headers,
): Promise<SessionProjection | null> {
  const value = await server.auth.api.getSession({ headers })
  if (!value) return null

  const context = await server.auth.$context
  const accounts = await context.internalAdapter.findAccounts(value.user.id)
  const discordAccount = accounts.find((account) => account.providerId === 'discord')

  return projectSession({
    user: value.user,
    session: value.session,
    isPlatformAdmin: Boolean(
      discordAccount && server.isPlatformAdmin(discordAccount.accountId),
    ),
  })
}

export function configuredAuthOrigin(environment: NodeJS.ProcessEnv) {
  const value =
    environment.CLOUDFLARED_PUBLIC_URL || environment.BETTER_AUTH_URL
  if (!value) {
    throw new Error(
      'CLOUDFLARED_PUBLIC_URL or BETTER_AUTH_URL is required for authentication',
    )
  }
  return parseOrigin(value, 'Authentication public URL')
}

function requiredEnvironment(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required for authentication`)
  return value
}

function parseOrigin(value: string, name: string) {
  const url = new URL(value)
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new TypeError(`${name} must be an HTTP origin without a path`)
  }
  return url.origin
}
