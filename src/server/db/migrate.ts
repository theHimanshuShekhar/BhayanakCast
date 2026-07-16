import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from './client'

const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url))
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
