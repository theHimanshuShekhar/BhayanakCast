import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, test } from 'vitest'
import { db } from '#/db'
import { account, user } from '#/db/schema'
import { isPlatformAdmin, isPlatformAdminUser } from './admin'

afterEach(async () => {
  await db.delete(account).where(eq(account.userId, 'internal-admin-id'))
  await db.delete(user).where(eq(user.id, 'internal-admin-id'))
})

describe('isPlatformAdmin', () => {
  test('matches exact Discord IDs from allowlist', () => {
    expect(isPlatformAdmin('111', ['111', '222'])).toBe(true)
    expect(isPlatformAdmin('11', ['111', '222'])).toBe(false)
  })

  test('resolves Discord account ID before checking allowlist', async () => {
    await db.insert(user).values({
      id: 'internal-admin-id',
      name: 'Admin',
      email: 'admin@example.test',
      emailVerified: true,
    })
    await db.insert(account).values({
      id: 'discord-admin-account',
      accountId: 'discord-admin-id',
      providerId: 'discord',
      userId: 'internal-admin-id',
    })

    await expect(
      isPlatformAdminUser('internal-admin-id', ['discord-admin-id']),
    ).resolves.toBe(true)
    await expect(
      isPlatformAdminUser('internal-admin-id', ['internal-admin-id']),
    ).resolves.toBe(false)
  })
})
