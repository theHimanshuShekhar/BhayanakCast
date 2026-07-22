import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { Pool } from 'pg'
import {
  getProductionAuth,
  readSessionProjection,
} from '../auth/auth'
import { withAccountMutation } from '../auth/account-access-policy'

const MUTE_LIST_LIMIT = 100

export interface MutedAccount {
  readonly accountId: string
  readonly displayName: string
  readonly avatarUrl: string | null
}

interface ChatMuteRuntimeState {
  pool?: Pool
}

const globalChatMute = globalThis as typeof globalThis & {
  __bhayanakCastChatMute?: ChatMuteRuntimeState
}
const chatMuteState = (globalChatMute.__bhayanakCastChatMute ??= {})

export function isChatPresentationAllowed(
  viewerAccountId: string,
  authorAccountId: string,
  mutedAccountIds: ReadonlySet<string>,
) {
  return viewerAccountId === authorAccountId || !mutedAccountIds.has(authorAccountId)
}

export function bindChatMuteRuntime(runtime: { pool: Pool | undefined }) {
  chatMuteState.pool = runtime.pool
}

export function createChatMuteService(pool: Pool) {
  return {
    async mute(mutingAccountId: string, mutedAccountId: string): Promise<void> {
      assertAccountIds(mutingAccountId, mutedAccountId)
      await withAccountMutation(pool, mutingAccountId, 'chat-mute', async (client) => {
        await client.query(
          `INSERT INTO chat_mute (muting_account_id, muted_account_id)
           VALUES ($1, $2)
           ON CONFLICT (muting_account_id, muted_account_id) DO NOTHING`,
          [mutingAccountId, mutedAccountId],
        )
      })
    },

    async unmute(mutingAccountId: string, mutedAccountId: string): Promise<void> {
      assertAccountIds(mutingAccountId, mutedAccountId)
      await withAccountMutation(pool, mutingAccountId, 'chat-mute', async (client) => {
        await client.query(
          'DELETE FROM chat_mute WHERE muting_account_id = $1 AND muted_account_id = $2',
          [mutingAccountId, mutedAccountId],
        )
      })
    },

    async list(mutingAccountId: string): Promise<MutedAccount[]> {
      assertAccountId(mutingAccountId)
      const result = await pool.query<MutedAccountRow>(
        `SELECT mute.muted_account_id AS "accountId",
                account.name AS "displayName",
                account.image AS "avatarUrl"
           FROM chat_mute mute
           JOIN "user" account ON account.id = mute.muted_account_id
           LEFT JOIN account_state state ON state.account_id = account.id
          WHERE mute.muting_account_id = $1
            AND state.deletion_requested_at IS NULL
          ORDER BY mute.created_at DESC, mute.muted_account_id ASC
          LIMIT ${MUTE_LIST_LIMIT}`,
        [mutingAccountId],
      )
      return result.rows
    },

    async getMuteIds(mutingAccountId: string): Promise<Set<string>> {
      assertAccountId(mutingAccountId)
      const result = await pool.query<{ mutedAccountId: string }>(
        `SELECT muted_account_id AS "mutedAccountId"
           FROM chat_mute
          WHERE muting_account_id = $1`,
        [mutingAccountId],
      )
      return new Set(result.rows.map(({ mutedAccountId }) => mutedAccountId))
    },
  }
}

export function getProductionChatMuteService() {
  const pool = chatMuteState.pool
  if (!pool) throw new Error('DATABASE_URL is required for chat mutes')
  return createChatMuteService(pool)
}

export function validateChatMuteInput(value: unknown): { accountId: string } {
  if (!value || typeof value !== 'object' || !('accountId' in value)) {
    throw new TypeError('Chat mute input must include accountId')
  }
  return { accountId: assertAccountId(value.accountId) }
}

export const getChatMutes = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ authenticated: boolean; mutes: MutedAccount[] }> => {
    const session = await currentSession()
    if (!session) return { authenticated: false, mutes: [] }
    return {
      authenticated: true,
      mutes: await getProductionChatMuteService().list(session.id),
    }
  },
)

export const getCurrentViewerMuteIds = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string[]> => {
    const session = await requireSession()
    return [...(await getProductionChatMuteService().getMuteIds(session.id))]
  },
)

export const muteAccount = createServerFn({ method: 'POST' })
  .validator(validateChatMuteInput)
  .handler(async ({ data }): Promise<{ mutedAccountId: string }> => {
    const session = await requireSession()
    await getProductionChatMuteService().mute(session.id, data.accountId)
    return { mutedAccountId: data.accountId }
  })

export const unmuteAccount = createServerFn({ method: 'POST' })
  .validator(validateChatMuteInput)
  .handler(async ({ data }): Promise<{ unmutedAccountId: string }> => {
    const session = await requireSession()
    await getProductionChatMuteService().unmute(session.id, data.accountId)
    return { unmutedAccountId: data.accountId }
  })

async function currentSession() {
  return readSessionProjection(getProductionAuth(), getRequest().headers)
}

async function requireSession() {
  const session = await currentSession()
  if (!session) throw new Error('Authentication required')
  return session
}

function assertAccountIds(mutingAccountId: string, mutedAccountId: string) {
  assertAccountId(mutingAccountId)
  assertAccountId(mutedAccountId)
  if (mutingAccountId === mutedAccountId) {
    throw new TypeError('You cannot mute yourself')
  }
}

function assertAccountId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Account id is required')
  }
  return value
}

interface MutedAccountRow {
  accountId: string
  displayName: string
  avatarUrl: string | null
}
