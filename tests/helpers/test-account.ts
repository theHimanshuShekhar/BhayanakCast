import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { testUtils } from 'better-auth/plugins'
import {
  createAuthServer,
  readSessionProjection,
} from '../../src/server/auth/auth'
import { mapDiscordProfile } from '../../src/server/auth/discord-profile'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import type { SessionProjection } from '../../src/server/auth/session'
import type { IntegrationContext } from '../setup/integration'

export interface DiscordTestProfile {
  id: string
  username: string
  global_name?: string | null
  avatar?: string | null
  email?: string | null
  verified?: boolean
  discriminator?: string
}

export interface SignedInTestAccount {
  readonly sessionCookie: string
  readonly setCookieHeaders: readonly string[]
}

export interface InspectedTestSession {
  readonly expiresAt: Date
}

export interface StoredDiscordOAuthTokens {
  readonly accessToken: string | null
  readonly refreshToken: string | null
}

export interface TestAccountHarness {
  signInDiscord(profile: DiscordTestProfile): Promise<SignedInTestAccount>
  readProjectedSession(
    sessionCookie: string,
  ): Promise<SessionProjection | null>
  inspectSession(sessionCookie: string): Promise<InspectedTestSession>
  signOut(sessionCookie: string): Promise<void>
  revokeSession(sessionCookie: string): Promise<void>
  inspectDiscordTokens(discordId: string): Promise<StoredDiscordOAuthTokens>
  now(): number
  advanceTimeBy(duration: number): Promise<void>
  cleanup(): Promise<void>
}

interface TestAuthContext {
  readonly internalAdapter: {
    deleteSession(token: string): Promise<void>
  }
  readonly test: {
    deleteUser(userId: string): Promise<void>
  }
}

interface SessionValue {
  readonly session: {
    readonly token: string
    readonly expiresAt: Date
  }
  readonly user: {
    readonly id: string
  }
}

interface SocialSignInResponse {
  readonly url: string
}

interface DiscordOAuthStub {
  readonly profile: DiscordTestProfile
  readonly accessToken: string
}

const DISCORD_TOKEN_ENDPOINT = 'https://discord.com/api/oauth2/token'
const discordOAuthStubs = new Map<string, DiscordOAuthStub>()
let originalFetch: typeof fetch | undefined
let activeFetchStubs = 0

export async function createTestAccountHarness(
  context: IntegrationContext,
): Promise<TestAccountHarness> {
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `bhayanakcast-test-account-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  const initialTime = Math.max(Date.now(), context.environment.clock.now())
  context.environment.clock.advanceTo(initialTime)
  await context.server.advanceClock(initialTime)
  const clock = installControlledDate(initialTime)
  const removeFetchStub = installDiscordOAuthFetchStub()
  const clientIp = createTestClientIp()
  const users = new Set<string>()
  let cleanupPromise: Promise<void> | undefined

  try {
    await migrateAuthDatabase(pool, context.environment.schema)
    const authServer = createAuthServer({
      pool,
      baseURL: context.server.origin,
      secret: context.server.auth.secret,
      discordClientId: context.server.auth.discordClientId,
      discordClientSecret: context.server.auth.discordClientSecret,
      plugins: [testUtils()],
      async discordGetUserInfo(tokens) {
        if (!tokens.accessToken) return null
        const stub = discordOAuthStubs.get(tokens.accessToken)
        if (!stub) return null
        return {
          user: mapDiscordProfile(stub.profile),
          data: stub.profile,
        }
      },
    })
    const auth = authServer.auth
    const testContext = (await auth.$context) as unknown as TestAuthContext

    const sessionValue = async (sessionCookie: string): Promise<SessionValue> => {
      const value = await authServer.auth.api.getSession({
        headers: new Headers({
          cookie: sessionCookie,
          'x-bhayanakcast-client-ip': clientIp,
        }),
      })
      if (!value) throw new Error('Expected a signed-in test session')
      return value as SessionValue
    }

    const cleanup = () => {
      cleanupPromise ??= (async () => {
        const failures: unknown[] = []
        for (const userId of users) {
          try {
            await testContext.test.deleteUser(userId)
          } catch (error) {
            failures.push(error)
          }
        }
        try {
          await pool.end()
        } catch (error) {
          failures.push(error)
        }
        removeFetchStub()
        clock.restore()
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Failed to clean test account harness')
        }
      })()
      return cleanupPromise
    }
    return {
      async signInDiscord(profile) {
        const accessToken = `test-discord-access-token-${profile.id}`
        discordOAuthStubs.set(accessToken, { profile, accessToken })
        try {
          const signInResponse = await authServer.auth.handler(
            new Request(`${context.server.origin}/api/auth/sign-in/social`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-bhayanakcast-client-ip': clientIp,
              },
              body: JSON.stringify({
                provider: 'discord',
                callbackURL: context.server.origin,
                disableRedirect: true,
              }),
            }),
          )
          if (!signInResponse.ok) {
            throw new Error(`Discord sign-in initialization failed (${signInResponse.status})`)
          }
          const response = (await signInResponse.json()) as SocialSignInResponse
          const state = new URL(response.url).searchParams.get('state')
          if (!state) throw new Error('Discord sign-in did not issue OAuth state')

          const callbackResponse = await authServer.auth.handler(
            new Request(
              `${context.server.origin}/api/auth/callback/discord?code=${encodeURIComponent(accessToken)}&state=${encodeURIComponent(state)}`,
              {
                headers: {
                  cookie: cookieHeader(signInResponse.headers.getSetCookie()),
                  'x-bhayanakcast-client-ip': clientIp,
                },
              },
            ),
          )
          if (callbackResponse.status < 300 || callbackResponse.status >= 400) {
            throw new Error(`Discord callback failed (${callbackResponse.status})`)
          }
          const setCookieHeaders = callbackResponse.headers.getSetCookie()
          const sessionCookie = findSessionCookie(setCookieHeaders)
          const signedInSession = await sessionValue(sessionCookie)
          users.add(signedInSession.user.id)
          await assertEncryptedOAuthToken(pool, profile.id, accessToken)

          return { sessionCookie, setCookieHeaders }
        } finally {
          discordOAuthStubs.delete(accessToken)
        }
      },
      async readProjectedSession(sessionCookie) {
        return readSessionProjection(
          authServer,
          new Headers({
            cookie: sessionCookie,
            'x-bhayanakcast-client-ip': clientIp,
          }),
        )
      },
      async inspectSession(sessionCookie) {
        const value = await sessionValue(sessionCookie)
        return { expiresAt: value.session.expiresAt }
      },
      async signOut(sessionCookie) {
        const response = await authServer.auth.handler(
          new Request(`${context.server.origin}/api/auth/sign-out`, {
            method: 'POST',
            headers: {
              cookie: sessionCookie,
              origin: context.server.origin,
              'x-bhayanakcast-client-ip': clientIp,
            },
          }),
        )
        if (!response.ok) {
          throw new Error(
            `Sign-out failed (${response.status}): ${await response.text()}`,
          )
        }
      },
      async revokeSession(sessionCookie) {
        const value = await sessionValue(sessionCookie)
        await testContext.internalAdapter.deleteSession(value.session.token)
      },
      async inspectDiscordTokens(discordId) {
        const result = await pool.query<StoredDiscordOAuthTokens>(
          'SELECT access_token AS "accessToken", refresh_token AS "refreshToken" FROM account WHERE provider_id = $1 AND account_id = $2',
          ['discord', discordId],
        )
        return (
          result.rows[0] ?? {
            accessToken: null,
            refreshToken: null,
          }
        )
      },
      now: clock.now,
      async advanceTimeBy(duration) {
        if (!Number.isFinite(duration) || duration < 0) {
          throw new RangeError('Time advances must be finite and non-negative')
        }
        const instant = clock.advanceBy(duration)
        context.environment.clock.advanceTo(instant)
        await context.server.advanceClock(instant)
      },
      cleanup,
    }
  } catch (error) {
    removeFetchStub()
    clock.restore()
    await pool.end()
    throw error
  }
}


function createTestClientIp() {
  const hex = randomUUID().replaceAll('-', '')
  return `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}:${hex.slice(8, 12)}:${hex.slice(12, 16)}:${hex.slice(16, 20)}:${hex.slice(20, 24)}`
}

function cookieHeader(setCookieHeaders: readonly string[]) {
  return setCookieHeaders
    .map((header) => header.slice(0, header.indexOf(';')))
    .join('; ')
}

function findSessionCookie(setCookieHeaders: readonly string[]) {
  const header = setCookieHeaders.find(
    (candidate) =>
      /session_token(?:\.\d+)?=/.test(candidate) &&
      !/max-age=0/i.test(candidate),
  )
  if (!header) throw new Error('Discord callback did not issue a session cookie')
  return header.slice(0, header.indexOf(';'))
}

async function assertEncryptedOAuthToken(
  pool: Pool,
  discordId: string,
  rawAccessToken: string,
) {
  const result = await pool.query<StoredDiscordOAuthTokens>(
    'SELECT access_token AS "accessToken", refresh_token AS "refreshToken" FROM account WHERE provider_id = $1 AND account_id = $2',
    ['discord', discordId],
  )
  const tokens = result.rows[0]
  if (
    !tokens?.accessToken ||
    !tokens.refreshToken ||
    tokens.accessToken === rawAccessToken ||
    tokens.refreshToken === `test-refresh-token-${rawAccessToken}`
  ) {
    throw new Error('Discord OAuth tokens were not encrypted at rest')
  }
}

function installDiscordOAuthFetchStub() {
  if (activeFetchStubs === 0) {
    originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = requestUrl(input)
      if (url === DISCORD_TOKEN_ENDPOINT) {
        const accessToken = await requestFormValue(input, init)
        const stub = accessToken ? discordOAuthStubs.get(accessToken) : undefined
        if (!stub) return new Response('Unknown test OAuth code', { status: 400 })
        return Response.json({
          access_token: stub.accessToken,
          refresh_token: `test-refresh-token-${stub.accessToken}`,
          expires_in: 3_600,
          scope: 'identify email',
          token_type: 'Bearer',
        })
      }
      return originalFetch!(input, init)
    }
  }
  activeFetchStubs += 1
  let removed = false
  return () => {
    if (removed) return
    removed = true
    activeFetchStubs -= 1
    if (activeFetchStubs !== 0) return
    globalThis.fetch = originalFetch!
    originalFetch = undefined
  }
}

function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : String(input)
}

async function requestFormValue(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
) {
  const body = init?.body
  if (body instanceof URLSearchParams) return body.get('code')
  if (typeof body === 'string') return new URLSearchParams(body).get('code')
  if (input instanceof Request) {
    return new URLSearchParams(await input.clone().text()).get('code')
  }
  return null
}

interface ControlledDate {
  now(): number
  advanceBy(duration: number): number
  restore(): void
}

function installControlledDate(initialTime: number): ControlledDate {
  const NativeDate = Date
  let instant = initialTime
  const replacement = function (
    this: unknown,
    ...arguments_: unknown[]
  ) {
    if (!new.target) return new NativeDate(instant).toString()
    return Reflect.construct(
      NativeDate,
      arguments_.length === 0 ? [instant] : arguments_,
      new.target,
    )
  }
  Object.setPrototypeOf(replacement, NativeDate)
  replacement.prototype = NativeDate.prototype
  Object.defineProperty(replacement, 'now', { value: () => instant })
  globalThis.Date = replacement as unknown as DateConstructor

  return {
    now: () => instant,
    advanceBy(duration) {
      instant += duration
      return instant
    },
    restore() {
      if (globalThis.Date === replacement) globalThis.Date = NativeDate
    },
  }
}
