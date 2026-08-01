import { Pool } from 'pg'
import { runRetention } from '../src/server/retention/retention-service'

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const pool = new Pool({ connectionString: databaseUrl, max: 1 })
try {
  const result = await runRetention(pool)
  console.info(
    JSON.stringify({
      timestamp: result.ranAt.toISOString(),
      level: 'info',
      event: 'retention_run_completed',
      transcriptRowsDeleted: result.transcriptRowsDeleted,
      reportRowsDeleted: result.reportRowsDeleted,
      enforcementKeysExpired: result.enforcementKeysExpired,
    }),
  )
} finally {
  await pool.end()
}
