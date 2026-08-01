import type { Pool } from 'pg'
import type { SanctionType } from '../auth/account-access-policy'

export async function createEnforcementKey(secret: string, discordId: string) {
  if (secret.length < 32) throw new TypeError('Enforcement secret must be at least 32 characters')
  if (!/^\d{17,20}$/.test(discordId)) throw new TypeError('Invalid Discord identity')
  const encoder = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`bhayanakcast:discord-enforcement:v1\0${discordId}`),
    ),
  )
  let encoded = ''
  for (const byte of signature) encoded += byte.toString(16).padStart(2, '0')
  return encoded
}

export async function applyEnforcementSanctions(
  pool: Pool,
  accountId: string,
  discordId: string,
  secret: string,
  instant = new Date(),
): Promise<readonly SanctionType[]> {
  const key = await createEnforcementKey(secret, discordId)
  const result = await pool.query<{ type: SanctionType }>(
    `WITH active AS (
       SELECT sanction.id, sanction.type, sanction.starts_at, sanction.expires_at
         FROM anonymized_subject subject
         JOIN platform_sanction sanction ON sanction.subject_id = subject.id
        WHERE subject.enforcement_key = $1
          AND sanction.starts_at <= $3
          AND sanction.lifted_at IS NULL
          AND (sanction.expires_at IS NULL OR sanction.expires_at > $3)
     ), copied AS (
       INSERT INTO platform_sanction
         (id, account_id, type, starts_at, expires_at, origin_sanction_id)
       SELECT gen_random_uuid(), $2, active.type, active.starts_at, active.expires_at, active.id
         FROM active
       ON CONFLICT (account_id, origin_sanction_id)
         WHERE origin_sanction_id IS NOT NULL
       DO NOTHING
       RETURNING type
     )
     SELECT type FROM active`,
    [key, accountId, instant],
  )
  return result.rows.map(({ type }) => type)
}

