import type { Pool, PoolClient } from 'pg'

export type DeletionStatus = 'pending' | 'cancelled' | 'rejected' | 'approved'
export type SanctionType = 'streaming' | 'chat' | 'room_creation' | 'all_access'
export type AccountMutation =
  | 'theme'
  | 'chat-mute'
  | 'room-create'
  | 'room-admit'
  | 'stream-subscribe'
  | 'report'
  | 'moderate'
  | 'membership'

export type AccountAccessState = 'active' | 'pending' | 'sanctioned' | 'approved' | 'deleted'

export interface AccountAccessPolicy {
  readonly state: AccountAccessState
  readonly deletionStatus: DeletionStatus | null
  readonly sanctionTypes: readonly SanctionType[]
  readonly canBrowsePublicProfiles: boolean
  readonly canViewOwnProfile: boolean
  readonly canCancelDeletion: boolean
  canMutate(mutation: AccountMutation): boolean
}

export interface AccountAccessInput {
  readonly deletionStatus?: DeletionStatus | null
  readonly sanctionTypes?: readonly SanctionType[]
}

export class AccountAccessDeniedError extends Error {
  readonly code = 'ACCOUNT_ACCESS_DENIED' as const

  constructor(readonly mutation: AccountMutation, readonly state: AccountAccessState) {
    super(`Account cannot perform ${mutation} while ${state}`)
    this.name = 'AccountAccessDeniedError'
  }
}

export function accountAccessPolicy(input: AccountAccessInput = {}): AccountAccessPolicy {
  const deletionStatus = input.deletionStatus ?? null
  const sanctionTypes = [...new Set(input.sanctionTypes ?? [])]
  const state: AccountAccessState =
    deletionStatus === 'approved'
      ? 'approved'
      : deletionStatus === 'pending'
        ? 'pending'
        : sanctionTypes.includes('all_access')
          ? 'sanctioned'
          : 'active'

  return {
    state,
    deletionStatus,
    sanctionTypes,
    canBrowsePublicProfiles: state !== 'approved',
    canViewOwnProfile: state !== 'approved',
    canCancelDeletion: deletionStatus === 'pending',
    canMutate: (mutation) => {
      if (state === 'pending' || state === 'approved') return false
      if (sanctionTypes.includes('all_access')) return false
      if (mutation === 'room-create' && sanctionTypes.includes('room_creation')) return false
      if (mutation === 'stream-subscribe' && sanctionTypes.includes('streaming')) return false
      if (mutation === 'chat-mute' && sanctionTypes.includes('chat')) return false
      return true
    },
  }
}

export function assertAccountMutationAllowed(
  policy: AccountAccessPolicy,
  mutation: AccountMutation,
) {
  if (!policy.canMutate(mutation)) {
    throw new AccountAccessDeniedError(mutation, policy.state)
  }
}

export async function readAccountAccessPolicy(
  executor: Pool | PoolClient,
  accountId: string,
  instant = new Date(),
): Promise<AccountAccessPolicy | null> {
  const account = await executor.query<{ id: string }>(
    'SELECT id FROM "user" WHERE id = $1',
    [accountId],
  )
  if (!account.rows[0]) return null

  const deletion = await executor.query<{ status: DeletionStatus }>(
    `SELECT status
       FROM deletion_request
      WHERE account_id = $1
      ORDER BY requested_at DESC,
               (status = 'pending') DESC,
               resolved_at DESC NULLS LAST,
               id DESC
      LIMIT 1`,
    [accountId],
  )
  const accountState = await executor.query<{ deletionRequestedAt: Date | null }>(
    `SELECT deletion_requested_at AS "deletionRequestedAt"
       FROM account_state
      WHERE account_id = $1`,
    [accountId],
  )
  const deletionStatus =
    deletion.rows[0]?.status ??
    (accountState.rows[0]?.deletionRequestedAt ? ('pending' as const) : null)
  const sanctions = await executor.query<{ type: SanctionType }>(
    `SELECT type
       FROM platform_sanction
      WHERE account_id = $1
        AND starts_at <= $2
        AND lifted_at IS NULL
        AND (expires_at IS NULL OR expires_at > $2)`,
    [accountId, instant],
  )
  return accountAccessPolicy({
    deletionStatus,
    sanctionTypes: sanctions.rows.map(({ type }) => type),
  })
}

export async function requireAccountMutation(
  executor: Pool | PoolClient,
  accountId: string,
  mutation: AccountMutation,
  instant = new Date(),
): Promise<AccountAccessPolicy> {
  const policy = await readAccountAccessPolicy(executor, accountId, instant)
  if (!policy) throw new AccountAccessDeniedError(mutation, 'deleted')
  assertAccountMutationAllowed(policy, mutation)
  return policy
}

export async function withAccountMutation<T>(
  pool: Pool,
  accountId: string,
  mutation: AccountMutation,
  work: (client: PoolClient, policy: AccountAccessPolicy) => Promise<T>,
  instant = new Date(),
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const account = await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [accountId])
    if (!account.rows[0]) throw new AccountAccessDeniedError(mutation, 'deleted')
    const policy = await requireAccountMutation(client, accountId, mutation, instant)
    const result = await work(client, policy)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
