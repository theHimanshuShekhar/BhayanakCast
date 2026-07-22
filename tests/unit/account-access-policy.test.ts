import { describe, expect, test } from 'vitest'
import {
  accountAccessPolicy,
  type AccountMutation,
} from '../../src/server/auth/account-access-policy'

describe('account access policy', () => {
  test.each([
    'theme',
    'chat-mute',
    'room-create',
    'room-admit',
    'stream-subscribe',
    'report',
    'moderate',
    'membership',
  ] satisfies AccountMutation[])('denies pending account mutation %s', (mutation) => {
    const policy = accountAccessPolicy({ deletionStatus: 'pending' })
    expect(policy.state).toBe('pending')
    expect(policy.canMutate(mutation)).toBe(false)
  })

  test('keeps pending account able to inspect and cancel its request', () => {
    const policy = accountAccessPolicy({ deletionStatus: 'pending' })
    expect(policy.canBrowsePublicProfiles).toBe(true)
    expect(policy.canViewOwnProfile).toBe(true)
    expect(policy.canCancelDeletion).toBe(true)
  })

  test.each(['cancelled', 'rejected', null] as const)(
    'restores ordinary access after %s deletion state',
    (deletionStatus) => {
      const policy = accountAccessPolicy({ deletionStatus })
      expect(policy.state).toBe('active')
      expect(policy.canMutate('theme')).toBe(true)
      expect(policy.canCancelDeletion).toBe(false)
    },
  )

  test('approved account is not cancellable and cannot mutate', () => {
    const policy = accountAccessPolicy({ deletionStatus: 'approved' })
    expect(policy.state).toBe('approved')
    expect(policy.canCancelDeletion).toBe(false)
    expect(policy.canMutate('membership')).toBe(false)
  })
})
