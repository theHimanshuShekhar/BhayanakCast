export const MODERATION_ANALYTICS_INVENTORY = {
  version: 1,
  sharedProperties: ['inventory_version', 'identity_kind'] as const,
  identity: 'raw Discord ID',
  events: {
    admin_report_queue_viewed: [],
    admin_report_opened: ['target_type', 'evidence_available'],
    admin_report_review_submitted: ['target_type', 'disposition', 'evidence_available'],
    admin_room_termination_list_viewed: [],
    admin_room_end_submitted: ['outcome'],
    admin_sanctions_viewed: [],
    admin_sanction_apply_submitted: ['sanction_type', 'duration', 'outcome'],
    admin_sanction_lift_submitted: ['sanction_type', 'outcome'],
  },
} as const

export type ModerationAnalyticsEvent =
  | { readonly name: 'admin_report_queue_viewed'; readonly properties: Record<string, never> }
  | {
      readonly name: 'admin_report_opened'
      readonly properties: { readonly target_type: TargetType; readonly evidence_available: boolean }
    }
  | {
      readonly name: 'admin_report_review_submitted'
      readonly properties: {
        readonly target_type: TargetType
        readonly disposition: 'resolved' | 'dismissed'
        readonly evidence_available: boolean
      }
    }
  | {
      readonly name: 'admin_room_termination_list_viewed'
      readonly properties: Record<string, never>
    }
  | {
      readonly name: 'admin_room_end_submitted'
      readonly properties: { readonly outcome: RoomEndOutcome }
    }
  | { readonly name: 'admin_sanctions_viewed'; readonly properties: Record<string, never> }
  | {
      readonly name: 'admin_sanction_apply_submitted'
      readonly properties: {
        readonly sanction_type: SanctionType
        readonly duration: SanctionDuration
        readonly outcome: 'applied'
      }
    }
  | {
      readonly name: 'admin_sanction_lift_submitted'
      readonly properties: {
        readonly sanction_type: SanctionType
        readonly outcome: SanctionLiftOutcome
      }
    }

type TargetType = 'account' | 'room' | 'stream' | 'message'
type RoomEndOutcome = 'ended' | 'already-ended' | 'forbidden' | 'not-found'
type SanctionType = 'streaming' | 'chat' | 'room_creation' | 'all_access'
type SanctionDuration = 'default-seven-days' | 'custom' | 'indefinite'
type SanctionLiftOutcome = 'lifted' | 'already-inactive' | 'not-found'

export interface ModerationAnalyticsDelivery {
  readonly event: ModerationAnalyticsEvent['name']
  readonly distinctId: string
  readonly properties: Readonly<Record<string, boolean | number | string>>
}

export interface ModerationAnalyticsSink {
  capture(delivery: ModerationAnalyticsDelivery): void | Promise<void>
}

export interface ModerationAnalytics {
  record(event: ModerationAnalyticsEvent, discordId: string | null): void
}

export function createModerationAnalytics(options: {
  readonly sink: ModerationAnalyticsSink | null
  readonly operationalLog?: (entry: Readonly<Record<string, unknown>>) => void
}): ModerationAnalytics {
  const operationalLog = options.operationalLog ?? writeOperationalLog
  return {
    record(event, discordId) {
      if (!options.sink || !discordId || !DISCORD_ID.test(discordId)) return
      let safeEvent: ModerationAnalyticsEvent
      try {
        safeEvent = validateModerationAnalyticsEvent(event)
      } catch {
        return
      }
      const delivery: ModerationAnalyticsDelivery = {
        event: safeEvent.name,
        distinctId: discordId,
        properties: {
          inventory_version: MODERATION_ANALYTICS_INVENTORY.version,
          identity_kind: 'signed_in',
          ...safeEvent.properties,
        },
      }
      try {
        Promise.resolve(options.sink.capture(delivery)).catch(() => {
          operationalLog(deliveryFailure())
        })
      } catch {
        operationalLog(deliveryFailure())
      }
    },
  }
}

export function createModerationPostHogAdapter(options: {
  readonly host: string
  readonly projectApiKey: string
  readonly request?: typeof fetch
}): ModerationAnalyticsSink {
  const endpoint = `${options.host.replace(/\/+$/, '')}/capture/`
  const request = options.request ?? fetch
  return {
    async capture(delivery) {
      const safe = validateDelivery(delivery)
      const response = await request(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: options.projectApiKey,
          event: safe.event,
          properties: { distinct_id: safe.distinctId, ...safe.properties },
        }),
        signal: AbortSignal.timeout(2_000),
      })
      if (!response.ok) throw new Error(`PostHog capture failed (${response.status})`)
    },
  }
}

export function validateModerationAnalyticsEvent(value: unknown): ModerationAnalyticsEvent {
  const event = exactObject(value, ['name', 'properties'])
  if (event.name === 'admin_report_queue_viewed') {
    exactObject(event.properties, [])
    return { name: event.name, properties: {} }
  }
  if (event.name === 'admin_report_opened') {
    const properties = validateReviewProperties(event.properties, false)
    return {
      name: event.name,
      properties: {
        target_type: properties.target_type,
        evidence_available: properties.evidence_available,
      },
    }
  }
  if (event.name === 'admin_report_review_submitted') {
    const properties = validateReviewProperties(event.properties, true)
    return {
      name: event.name,
      properties: {
        target_type: properties.target_type,
        disposition: properties.disposition!,
        evidence_available: properties.evidence_available,
      },
    }
  }
  if (event.name === 'admin_room_termination_list_viewed') {
    exactObject(event.properties, [])
    return { name: event.name, properties: {} }
  }
  if (event.name === 'admin_room_end_submitted') {
    const properties = exactObject(event.properties, ['outcome'])
    if (!ROOM_END_OUTCOMES.includes(properties.outcome as RoomEndOutcome)) {
      invalidProperties()
    }
    return {
      name: event.name,
      properties: { outcome: properties.outcome as RoomEndOutcome },
    }
  }
  if (event.name === 'admin_sanctions_viewed') {
    exactObject(event.properties, [])
    return { name: event.name, properties: {} }
  }
  if (event.name === 'admin_sanction_apply_submitted') {
    const properties = exactObject(event.properties, ['sanction_type', 'duration', 'outcome'])
    if (
      !SANCTION_TYPES.includes(properties.sanction_type as SanctionType) ||
      !SANCTION_DURATIONS.includes(properties.duration as SanctionDuration) ||
      properties.outcome !== 'applied'
    ) invalidProperties()
    return {
      name: event.name,
      properties: {
        sanction_type: properties.sanction_type as SanctionType,
        duration: properties.duration as SanctionDuration,
        outcome: 'applied',
      },
    }
  }
  if (event.name === 'admin_sanction_lift_submitted') {
    const properties = exactObject(event.properties, ['sanction_type', 'outcome'])
    if (
      !SANCTION_TYPES.includes(properties.sanction_type as SanctionType) ||
      !SANCTION_LIFT_OUTCOMES.includes(properties.outcome as SanctionLiftOutcome)
    ) invalidProperties()
    return {
      name: event.name,
      properties: {
        sanction_type: properties.sanction_type as SanctionType,
        outcome: properties.outcome as SanctionLiftOutcome,
      },
    }
  }
  throw new TypeError('Event is not in the moderation analytics inventory')
}

function validateReviewProperties(value: unknown, withDisposition: boolean) {
  const source = exactObject(
    value,
    withDisposition
      ? ['target_type', 'disposition', 'evidence_available']
      : ['target_type', 'evidence_available'],
  )
  if (!TARGET_TYPES.includes(source.target_type as TargetType)) invalidProperties()
  if (typeof source.evidence_available !== 'boolean') invalidProperties()
  if (
    withDisposition &&
    source.disposition !== 'resolved' &&
    source.disposition !== 'dismissed'
  ) invalidProperties()
  return {
    target_type: source.target_type as TargetType,
    evidence_available: source.evidence_available as boolean,
    disposition: source.disposition as 'resolved' | 'dismissed' | undefined,
  }
}

function validateDelivery(delivery: ModerationAnalyticsDelivery): ModerationAnalyticsDelivery {
  if (!DISCORD_ID.test(delivery.distinctId)) invalidProperties()
  const event = validateModerationAnalyticsEvent({
    name: delivery.event,
    properties: Object.fromEntries(
      Object.entries(delivery.properties).filter(
        ([key]) => key !== 'inventory_version' && key !== 'identity_kind',
      ),
    ),
  })
  const expected = MODERATION_ANALYTICS_INVENTORY.events[event.name]
  const properties = exactObject(delivery.properties, [
    ...MODERATION_ANALYTICS_INVENTORY.sharedProperties,
    ...expected,
  ])
  if (
    properties.inventory_version !== MODERATION_ANALYTICS_INVENTORY.version ||
    properties.identity_kind !== 'signed_in'
  ) invalidProperties()
  return {
    event: event.name,
    distinctId: delivery.distinctId,
    properties: {
      inventory_version: MODERATION_ANALYTICS_INVENTORY.version,
      identity_kind: 'signed_in',
      ...event.properties,
    },
  }
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidProperties()
  const source = value as Record<string, unknown>
  const actual = Object.keys(source)
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalidProperties()
  return source
}

function invalidProperties(): never {
  throw new TypeError('Properties do not match the moderation analytics inventory')
}

function deliveryFailure() {
  return {
    level: 'warn',
    event: 'analytics.delivery_failed',
    provider: 'posthog',
    inventory: 'moderation',
    inventory_version: 1,
  } as const
}

function writeOperationalLog(entry: Readonly<Record<string, unknown>>) {
  console.warn(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }))
}

const TARGET_TYPES = ['account', 'room', 'stream', 'message'] as const
const ROOM_END_OUTCOMES = ['ended', 'already-ended', 'forbidden', 'not-found'] as const
const SANCTION_TYPES = ['streaming', 'chat', 'room_creation', 'all_access'] as const
const SANCTION_DURATIONS = ['default-seven-days', 'custom', 'indefinite'] as const
const SANCTION_LIFT_OUTCOMES = ['lifted', 'already-inactive', 'not-found'] as const
const DISCORD_ID = /^\d{17,20}$/
