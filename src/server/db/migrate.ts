import { join } from 'node:path'
import type { Pool } from 'pg'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from './client'

// The bundler rewrites import.meta.url to the source path used during the
// image build. Resolve from the process root instead so production reads the
// copied runtime assets rather than the absent build-stage sources.
export function resolveMigrationsFolder(
  nodeEnv = process.env.NODE_ENV,
  cwd = process.cwd(),
) {
  return join(
    cwd,
    nodeEnv === 'production'
      ? 'dist/server/migrations'
      : 'src/server/db/migrations',
  )
}
const MIGRATIONS_FOLDER = resolveMigrationsFolder()
const POSTGRES_IDENTIFIER = /^[a-z_][a-z0-9_]*$/

export async function migrateAuthDatabase(pool: Pool, schema: string) {
  if (!POSTGRES_IDENTIFIER.test(schema)) {
    throw new TypeError('Database schema must be a lowercase PostgreSQL identifier')
  }

  const current = await pool.query<{ schema: string }>(
    'SELECT current_schema() AS schema',
  )
  if (current.rows[0]?.schema !== schema) {
    throw new Error(`Database pool search_path must select schema ${schema}`)
  }

  await migrate(createDatabase(pool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: schema,
  })
}
