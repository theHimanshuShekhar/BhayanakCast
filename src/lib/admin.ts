import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import { account } from '#/db/schema'

export function isPlatformAdmin(
  discordUserId: string | null | undefined,
  allowlist: readonly string[],
) {
  return Boolean(discordUserId && allowlist.includes(discordUserId))
}

export async function isPlatformAdminUser(
  userId: string | null | undefined,
  allowlist: readonly string[],
) {
  if (!userId) return false

  const rows = await db
    .select({ discordUserId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'discord')))
    .limit(1)

  return isPlatformAdmin(rows.at(0)?.discordUserId, allowlist)
}
