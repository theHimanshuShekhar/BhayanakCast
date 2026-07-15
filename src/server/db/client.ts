import type { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { databaseSchema } from './schema'

export type Database = NodePgDatabase<typeof databaseSchema>

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema: databaseSchema })
}

