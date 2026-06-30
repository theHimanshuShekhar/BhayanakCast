import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '#/db'
import * as schema from '#/db/schema'
import { buildAuthConfig } from './auth-config'
import { readServerEnv } from './env'

const env = readServerEnv()

export const auth = betterAuth({
  ...buildAuthConfig(env),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  plugins: [tanstackStartCookies()],
})
