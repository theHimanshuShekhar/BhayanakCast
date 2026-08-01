import * as server from '../dist/server/index.js'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const runtime = server.createServerRuntime(process.env)

try {
  await runtime.migrate()
  const result = await server.runRetention(runtime.getDatabasePool())
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
  await runtime.close()
}
