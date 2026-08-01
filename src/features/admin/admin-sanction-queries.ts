import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getProductionAuth, readSessionProjection } from '../../server/auth/auth'
import type { SanctionType } from '../../server/auth/account-access-policy'
import {
  getSanctionService,
  PlatformAdminSanctionAuthorizationError,
  type SanctionAdminActor,
} from '../../server/moderation/sanction-service'
import { recordModerationInteraction } from '../../server/moderation/moderation-observability'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,255}$/
const SANCTION_TYPES: Record<SanctionType, true> = {
  streaming: true,
  chat: true,
  room_creation: true,
  all_access: true,
}

type Duration = 'default-seven-days' | 'custom' | 'indefinite'

export const getAdminSanctions = createServerFn({ method: 'GET' }).handler(async () => {
  const actor = await requireAdmin()
  const dashboard = await getSanctionService().dashboard(actor)
  await recordModerationInteraction({ name: 'admin_sanctions_viewed', properties: {} })
  return dashboard
})

export const applyAdminSanction = createServerFn({ method: 'POST' })
  .validator(validateApplySanctionCommand)
  .handler(async ({ data }) => {
    const actor = await requireAdmin()
    const result = await getSanctionService().apply(actor, {
      accountId: data.accountId,
      type: data.type,
      ...(data.duration === 'custom' ? { expiresAt: data.expiresAt } : {}),
      ...(data.duration === 'indefinite' ? { expiresAt: null } : {}),
    })
    await recordModerationInteraction({
      name: 'admin_sanction_apply_submitted',
      properties: {
        sanction_type: data.type,
        duration: data.duration,
        outcome: 'applied',
      },
    })
    return result
  })

export const liftAdminSanction = createServerFn({ method: 'POST' })
  .validator(validateSanctionId)
  .handler(async ({ data }) => {
    const actor = await requireAdmin()
    const result = await getSanctionService().lift(actor, data)
    if (result.status !== 'not-found') {
      await recordModerationInteraction({
        name: 'admin_sanction_lift_submitted',
        properties: {
          sanction_type: result.sanction.type,
          outcome: result.status,
        },
      })
    }
    return result
  })

async function requireAdmin(): Promise<SanctionAdminActor> {
  const session = await readSessionProjection(getProductionAuth(), getRequest().headers)
  if (!session?.isPlatformAdmin) throw new PlatformAdminSanctionAuthorizationError()
  return { accountId: session.id, isPlatformAdmin: true }
}

export function validateSanctionId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError('Invalid sanction id')
  return value.toLowerCase()
}

export function validateApplySanctionCommand(value: unknown): {
  readonly accountId: string
  readonly type: SanctionType
  readonly duration: Duration
  readonly expiresAt?: Date
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid sanction command')
  }
  const source = value as Record<string, unknown>
  const keys = Object.keys(source)
  if (
    !keys.every((key) => ['accountId', 'type', 'duration', 'expiresAt'].includes(key)) ||
    !ACCOUNT_ID.test(String(source.accountId ?? '')) ||
    SANCTION_TYPES[source.type as SanctionType] !== true ||
    !['default-seven-days', 'custom', 'indefinite'].includes(String(source.duration))
  ) {
    throw new TypeError('Invalid sanction command')
  }
  const duration = source.duration as Duration
  if (duration === 'custom') {
    if (typeof source.expiresAt !== 'string') throw new TypeError('Custom expiry is required')
    const expiresAt = new Date(source.expiresAt)
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new TypeError('Custom expiry must be in the future')
    }
    return {
      accountId: source.accountId as string,
      type: source.type as SanctionType,
      duration,
      expiresAt,
    }
  }
  if (source.expiresAt !== undefined) throw new TypeError('Expiry is only valid for custom duration')
  return {
    accountId: source.accountId as string,
    type: source.type as SanctionType,
    duration,
  }
}
