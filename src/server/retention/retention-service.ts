import type { Pool } from 'pg'

export interface RetentionRunResult {
  readonly ranAt: Date
  readonly transcriptRowsDeleted: number
  readonly reportRowsDeleted: number
  readonly enforcementKeysExpired: number
}

export async function runRetention(
  pool: Pool,
  ranAt = new Date(),
): Promise<RetentionRunResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const transcripts = await client.query(
      `DELETE FROM message persisted
        USING room ended
        WHERE persisted.room_id = ended.id
          AND ended.ended_at IS NOT NULL
          AND ended.ended_at <= $1::timestamp - interval '30 days'`,
      [ranAt],
    )
    const reports = await client.query(
      `DELETE FROM report
        WHERE status IN ('resolved', 'dismissed')
          AND retain_until <= $1::timestamp`,
      [ranAt],
    )
    const enforcementKeys = await client.query(
      `UPDATE anonymized_subject subject
          SET enforcement_key = NULL
        WHERE subject.enforcement_key IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
              FROM platform_sanction sanction
             WHERE sanction.subject_id = subject.id
               AND sanction.starts_at <= $1::timestamp
               AND sanction.lifted_at IS NULL
               AND (sanction.expires_at IS NULL OR sanction.expires_at > $1::timestamp)
          )`,
      [ranAt],
    )
    const result: RetentionRunResult = {
      ranAt,
      transcriptRowsDeleted: transcripts.rowCount ?? 0,
      reportRowsDeleted: reports.rowCount ?? 0,
      enforcementKeysExpired: enforcementKeys.rowCount ?? 0,
    }
    await client.query(
      `INSERT INTO retention_run_audit
         (id, ran_at, transcript_rows_deleted, report_rows_deleted, enforcement_keys_expired)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        globalThis.crypto.randomUUID(),
        result.ranAt,
        result.transcriptRowsDeleted,
        result.reportRowsDeleted,
        result.enforcementKeysExpired,
      ],
    )
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
