import { randomUUID } from 'node:crypto'
import { makeSignature } from 'better-auth/crypto'
import { Pool } from 'pg'

/** Seeds the two study-owned Accounts the usability protocol needs
    (docs/operations/usability-qualification.md §5) and prints their signed session cookies.

    Both are study scenery, never participants, so neither contributes a result row:
    - `Study Host` is the confederate that keeps a public room and Stream running, so a
      watch-branch participant has something real to find.
    - `Study Rehearsal` is the account the facilitator uses to confirm the room, Stream,
      and Chat still work before the participant arrives.

    Seeding them directly beats driving two more real Discord logins before every session.

    Usage: node --env-file-if-exists=.env scripts/usability-study-setup.mjs [--reset] */

const reset = process.argv.includes('--reset')
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const secret = process.env.BETTER_AUTH_SECRET
if (!secret) throw new Error('BETTER_AUTH_SECRET is required')
const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

const ACCOUNTS = [
  { role: 'confederate_host', discordId: '900000000000000001', name: 'Study Host' },
  { role: 'rehearsal_watcher', discordId: '900000000000000002', name: 'Study Rehearsal' },
]
const SESSION_DAYS = 7

const pool = new Pool({ connectionString: databaseUrl })
try {
  const seeded = []
  for (const { role, discordId, name } of ACCOUNTS) {
    if (reset) {
      await pool.query(
        `DELETE FROM "user"
          WHERE id IN (SELECT user_id FROM account WHERE provider_id = 'discord' AND account_id = $1)`,
        [discordId],
      )
    }

    const existing = await pool.query(
      `SELECT user_id AS "userId" FROM account WHERE provider_id = 'discord' AND account_id = $1`,
      [discordId],
    )

    let userId = existing.rows[0]?.userId
    if (!userId) {
      userId = randomUUID()
      await pool.query(
        `INSERT INTO "user" (id, name, email, email_verified, image) VALUES ($1, $2, $3, true, null)`,
        [userId, name, `${discordId}@bhayanakcast.invalid`],
      )
      await pool.query(
        `INSERT INTO account (id, account_id, provider_id, user_id) VALUES ($1, $2, 'discord', $3)`,
        [randomUUID(), discordId, userId],
      )
    }

    // ADR 0040 allows one connection per Account, so each role gets its own Account and
    // a single fresh session; reusing one cookie in two browsers displaces the first.
    await pool.query(`DELETE FROM session WHERE user_id = $1`, [userId])
    const token = randomUUID().replaceAll('-', '')
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
    await pool.query(`INSERT INTO session (id, token, user_id, expires_at) VALUES ($1, $2, $3, $4)`, [
      randomUUID(),
      token,
      userId,
      expiresAt,
    ])

    seeded.push({
      role,
      name,
      user_id: userId,
      discord_id: discordId,
      cookie: {
        name: 'better-auth.session_token',
        value: `${token}.${await makeSignature(token, secret)}`,
        domain: new URL(origin).hostname,
        path: '/',
        expires_at: expiresAt.toISOString(),
      },
    })
  }

  console.log(JSON.stringify({ seeded_at: new Date().toISOString(), origin, accounts: seeded }, null, 2))
} finally {
  await pool.end()
}
