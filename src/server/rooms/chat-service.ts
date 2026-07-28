import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  AccountAccessDeniedError,
  requireAccountMutation,
} from '../auth/account-access-policy'
import { CHAT_BODY_LIMIT, type RoomChatMessage } from '../realtime/room-events'

/** ADR 0071. Also the realtime window: nothing older is ever sent live. */
export const CHAT_HISTORY_LIMIT = 50
export { CHAT_BODY_LIMIT }

export type SendChatResult =
  | { readonly status: 'sent'; readonly message: RoomChatMessage }
  | { readonly status: 'not-admitted' }
  | { readonly status: 'room-ended' }
  | { readonly status: 'empty' | 'too-long' }
  | { readonly status: 'account-read-only' | 'chat-sanctioned' }

export interface ChatServiceConfiguration {
  readonly pool: Pool
  readonly now?: () => Date
}

/** Collapses runs of blank lines but keeps deliberate line breaks — ADR 0102
    makes the composer multiline, so a newline is content here, unlike the
    single-line room description. */
export function normalizeChatBody(body: string): string {
  return body.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export class ChatService {
  private readonly pool: Pool
  private readonly now: () => Date

  constructor(configuration: ChatServiceConfiguration) {
    this.pool = configuration.pool
    this.now = configuration.now ?? (() => new Date())
  }

  async send(
    accountId: string,
    input: { readonly roomId: string; readonly body: string; readonly mutationId?: string },
  ): Promise<SendChatResult> {
    const body = normalizeChatBody(input.body)
    if (body.length === 0) return { status: 'empty' }
    if ([...body].length > CHAT_BODY_LIMIT) return { status: 'too-long' }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [accountId])
      const denial = await chatDenial(client, accountId, this.now())
      if (denial) {
        await client.query('ROLLBACK')
        return denial
      }

      const membership = await client.query<{
        id: string
        roomId: string
        displayName: string
        avatarUrl: string | null
      }>(
        `SELECT membership.id,
                membership.room_id AS "roomId",
                account.name AS "displayName",
                account.image AS "avatarUrl"
           FROM room_membership membership
           JOIN "user" account ON account.id = membership.account_id
          WHERE membership.account_id = $1 AND membership.left_at IS NULL`,
        [accountId],
      )
      const current = membership.rows[0]
      if (!current || current.roomId !== input.roomId) {
        await client.query('ROLLBACK')
        return { status: 'not-admitted' }
      }

      const room = await client.query<{ endedAt: Date | null }>(
        'SELECT ended_at AS "endedAt" FROM room WHERE id = $1',
        [input.roomId],
      )
      if (!room.rows[0] || room.rows[0].endedAt) {
        await client.query('ROLLBACK')
        return { status: 'room-ended' }
      }

      const id = randomUUID()
      const createdAt = this.now()
      await client.query(
        `INSERT INTO message (id, room_id, membership_id, body, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, input.roomId, current.id, body, createdAt],
      )
      await client.query('COMMIT')
      return {
        status: 'sent',
        message: {
          id,
          roomId: input.roomId,
          membershipId: current.id,
          accountId,
          displayName: current.displayName,
          avatarUrl: current.avatarUrl,
          body,
          createdAt: createdAt.toISOString(),
          mutationId: input.mutationId ?? null,
        },
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  /** The admission backfill. Mute filtering happens in SQL so a muted author's
      text never reaches the viewer's client at all (ADR 0102). */
  async history(
    roomId: string,
    viewerAccountId: string,
  ): Promise<readonly RoomChatMessage[]> {
    const result = await this.pool.query<{
      id: string
      roomId: string
      membershipId: string
      accountId: string
      displayName: string
      avatarUrl: string | null
      body: string
      createdAt: Date
    }>(
      `SELECT * FROM (
         SELECT message.id,
                message.room_id AS "roomId",
                message.membership_id AS "membershipId",
                membership.account_id AS "accountId",
                account.name AS "displayName",
                account.image AS "avatarUrl",
                message.body,
                message.created_at AS "createdAt"
           FROM message
           JOIN room_membership membership ON membership.id = message.membership_id
           JOIN "user" account ON account.id = membership.account_id
          WHERE message.room_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM chat_mute
               WHERE chat_mute.muting_account_id = $2
                 AND chat_mute.muted_account_id = membership.account_id
            )
          ORDER BY message.created_at DESC, message.id DESC
          LIMIT ${CHAT_HISTORY_LIMIT}
       ) recent
       ORDER BY recent."createdAt" ASC, recent.id ASC`,
      [roomId, viewerAccountId],
    )
    return result.rows.map((row) => ({
      id: row.id,
      roomId: row.roomId,
      membershipId: row.membershipId,
      accountId: row.accountId,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      mutationId: null,
    }))
  }

  /** Accounts this viewer has muted, so realtime delivery can drop their
      messages and typing indicators before they render. */
  async mutedAccountIds(viewerAccountId: string): Promise<readonly string[]> {
    const result = await this.pool.query<{ mutedAccountId: string }>(
      'SELECT muted_account_id AS "mutedAccountId" FROM chat_mute WHERE muting_account_id = $1',
      [viewerAccountId],
    )
    return result.rows.map((row) => row.mutedAccountId)
  }
}

async function chatDenial(
  client: PoolClient,
  accountId: string,
  instant: Date,
): Promise<{ readonly status: 'account-read-only' | 'chat-sanctioned' } | null> {
  try {
    const access = await requireAccountMutation(client, accountId, 'chat-mute', instant)
    if (access.sanctionTypes.includes('chat')) return { status: 'chat-sanctioned' }
    if (!access.canMutate('chat-mute')) return { status: 'account-read-only' }
    return null
  } catch (error) {
    if (!(error instanceof AccountAccessDeniedError)) throw error
    return {
      status: error.state === 'sanctioned' ? 'chat-sanctioned' : 'account-read-only',
    }
  }
}
