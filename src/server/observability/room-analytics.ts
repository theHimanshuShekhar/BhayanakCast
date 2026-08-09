export const ROOM_ANALYTICS_INVENTORY = {
  version: 2,
  sharedProperties: ['inventory_version', 'identity_kind'] as const,
  identity: {
    anonymous: 'anonymous:<random UUID>',
    signedIn: 'raw Discord ID',
  },
  events: {
    room_route_action: ['state', 'action', 'outcome'],
    room_companion_opened: ['surface', 'tab'],
    room_companion_closed: ['surface', 'reason'],
    room_companion_tab_selected: ['surface', 'tab'],
    room_companion_resized: ['height'],
    room_header_action: ['action', 'surface'],
    room_details_closed: ['reason'],
    room_details_resized: ['height'],
    room_media_compatibility_checked: ['trigger', 'outcome'],
    room_watch_action: ['action', 'outcome', 'attempt', 'watch_sequence_id'],
    room_reconnect_recovery: ['outcome', 'seconds_remaining'],
    room_stream_action: ['action', 'outcome'],
    room_mosaic_filter_changed: ['hidden'],
    room_watch_audio_changed: ['muted'],
    room_watch_fullscreen_requested: [],
    room_member_menu_opened: ['surface'],
    room_member_action_selected: ['surface', 'action'],
    room_chat_send: ['trigger', 'outcome'],
    room_chat_failed_discarded: [],
    room_chat_new_messages_opened: [],
    room_chat_typing_changed: ['typing'],
    room_message_menu_opened: [],
    room_message_action_selected: ['action'],
    room_chat_mute_changed: ['outcome'],
    room_ban_confirmation_cancelled: [],
    room_ban_confirmation_confirmed: [],
    room_ban_clear_requested: [],
    room_kick_confirmation_cancelled: [],
    room_kick_confirmation_confirmed: [],
    room_host_transfer_confirmation_cancelled: [],
    room_host_transfer_confirmation_confirmed: [],
    room_host_stream_stop_confirmation_cancelled: [],
    room_host_stream_stop_confirmation_confirmed: [],
  },
} as const

export type RoomCompanionSurface = 'dock' | 'drawer' | 'sheet'
export type RoomCompanionTab = 'chat' | 'people' | 'activity'

export type RoomRouteState = 'pre_admission' | 'past_stream'

export type RoomAnalyticsEvent =
  | {
      readonly name: 'room_route_action'
      readonly properties: {
        readonly state: RoomRouteState
        readonly action: 'join' | 'back_home'
        readonly outcome:
          | 'joined'
          | 'confirmation_required'
          | 'oauth_started'
          | 'rejected'
          | 'failed'
          | 'navigated'
      }
    }
  | {
      readonly name: 'room_companion_opened'
      readonly properties: {
        readonly surface: RoomCompanionSurface
        readonly tab: RoomCompanionTab
      }
    }
  | {
      readonly name: 'room_companion_closed'
      readonly properties: {
        readonly surface: RoomCompanionSurface
        readonly reason: 'control' | 'escape'
      }
    }
  | {
      readonly name: 'room_companion_tab_selected'
      readonly properties: {
        readonly surface: RoomCompanionSurface
        readonly tab: RoomCompanionTab
      }
    }
  | {
      readonly name: 'room_companion_resized'
      readonly properties: { readonly height: '55' | '90' }
    }
  | {
      readonly name: 'room_header_action'
      readonly properties: {
        readonly action: 'back_home' | 'details' | 'settings'
        readonly surface: 'desktop' | 'mobile' | 'details'
      }
    }
  | {
      readonly name: 'room_details_closed'
      readonly properties: { readonly reason: 'control' | 'escape' | 'backdrop' }
    }
  | {
      readonly name: 'room_details_resized'
      readonly properties: { readonly height: '55' | '90' }
    }
  | {
      readonly name: 'room_media_compatibility_checked'
      readonly properties: {
        readonly trigger: 'admission' | 'retry'
        readonly outcome: 'compatible' | 'incompatible'
      }
    }
  | {
      readonly name: 'room_watch_action'
      readonly properties: {
        readonly action: 'watch' | 'retry' | 'cancel'
        readonly outcome: 'started' | 'retrying' | 'connected' | 'exhausted' | 'cancelled'
        readonly attempt: number
        readonly watch_sequence_id: string
      }
    }
  | {
      readonly name: 'room_reconnect_recovery'
      readonly properties: {
        readonly outcome: 'started' | 'reclaimed' | 'expired'
        readonly seconds_remaining: number
      }
    }
  | {
      readonly name: 'room_stream_action'
      readonly properties: {
        readonly action: 'start' | 'cancel' | 'stop'
        readonly outcome: 'requested' | 'succeeded' | 'failed'
      }
    }
  | {
      readonly name: 'room_mosaic_filter_changed'
      readonly properties: { readonly hidden: boolean }
    }
  | {
      readonly name: 'room_watch_audio_changed'
      readonly properties: { readonly muted: boolean }
    }
  | {
      readonly name: 'room_watch_fullscreen_requested'
      readonly properties: Record<string, never>
    }
  | {
      readonly name: 'room_member_menu_opened'
      readonly properties: { readonly surface: 'tile' | 'people' }
    }
  | {
      readonly name: 'room_member_action_selected'
      readonly properties: {
        readonly surface: 'tile' | 'people'
        readonly action:
          | 'report'
          | 'kick'
          | 'room_ban'
          | 'host_transfer'
          | 'host_stream_stop'
      }
    }
  | {
      readonly name: 'room_chat_send'
      readonly properties: {
        readonly trigger: 'composer' | 'retry'
        readonly outcome: 'sent' | 'failed' | 'unavailable'
      }
    }
  | {
      readonly name:
        | 'room_chat_failed_discarded'
        | 'room_chat_new_messages_opened'
        | 'room_message_menu_opened'
      readonly properties: Record<string, never>
    }
  | {
      readonly name: 'room_chat_typing_changed'
      readonly properties: { readonly typing: boolean }
    }
  | {
      readonly name: 'room_message_action_selected'
      readonly properties: { readonly action: 'report' | 'mute' }
    }
  | {
      readonly name: 'room_chat_mute_changed'
      readonly properties: { readonly outcome: 'muted' | 'failed' }
    }
  | {
      readonly name:
        | 'room_ban_confirmation_cancelled'
        | 'room_ban_confirmation_confirmed'
        | 'room_ban_clear_requested'
        | 'room_kick_confirmation_cancelled'
        | 'room_kick_confirmation_confirmed'
        | 'room_host_transfer_confirmation_cancelled'
        | 'room_host_transfer_confirmation_confirmed'
        | 'room_host_stream_stop_confirmation_cancelled'
        | 'room_host_stream_stop_confirmation_confirmed'
      readonly properties: Record<string, never>
    }

export interface RoomAnalyticsEnvelope {
  readonly anonymousId: string
  readonly event: RoomAnalyticsEvent
}

export interface RoomAnalyticsDelivery {
  readonly event: RoomAnalyticsEvent['name']
  readonly distinctId: string
  readonly properties: Readonly<Record<string, boolean | number | string>>
}

export interface RoomAnalyticsSink {
  capture(delivery: RoomAnalyticsDelivery): void | Promise<void>
}

export interface RoomAnalytics {
  record(envelope: RoomAnalyticsEnvelope, discordId: string | null): void
}

interface RoomAnalyticsOptions {
  readonly sink: RoomAnalyticsSink | null
  readonly operationalLog?: (entry: RoomAnalyticsFailureLog) => void
}

interface RoomAnalyticsFailureLog {
  readonly level: 'warn'
  readonly event: 'analytics.delivery_failed'
  readonly provider: 'posthog'
  readonly inventory_version: 2
  readonly product_surface: 'room'
}

export function createRoomAnalytics(options: RoomAnalyticsOptions): RoomAnalytics {
  const operationalLog = options.operationalLog ?? writeOperationalLog
  return {
    record(envelope, discordId) {
      if (!options.sink) return
      let safeEnvelope: RoomAnalyticsEnvelope
      try {
        safeEnvelope = validateRoomAnalyticsEnvelope(envelope)
      } catch {
        return
      }
      if (discordId !== null && !DISCORD_ID.test(discordId)) return
      const signedIn = discordId !== null
      const delivery: RoomAnalyticsDelivery = {
        event: safeEnvelope.event.name,
        distinctId: signedIn ? discordId : `anonymous:${safeEnvelope.anonymousId}`,
        properties: {
          inventory_version: ROOM_ANALYTICS_INVENTORY.version,
          identity_kind: signedIn ? 'signed_in' : 'anonymous',
          ...safeEnvelope.event.properties,
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

export function createRoomPostHogAdapter(options: {
  readonly host: string
  readonly projectApiKey: string
  readonly request?: typeof fetch
}): RoomAnalyticsSink {
  const endpoint = `${options.host.replace(/\/+$/, '')}/capture/`
  const request = options.request ?? fetch
  return {
    async capture(delivery) {
      const safe = validateRoomAnalyticsDelivery(delivery)
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

export function validateRoomAnalyticsEnvelope(value: unknown): RoomAnalyticsEnvelope {
  const source = exactObject(value, ['anonymousId', 'event'])
  if (typeof source.anonymousId !== 'string' || !UUID.test(source.anonymousId)) {
    throw new TypeError('anonymousId must be a UUID')
  }
  const event = exactObject(source.event, ['name', 'properties'])
  if (typeof event.name !== 'string') throw new TypeError('Invalid Room analytics event')
  return { anonymousId: source.anonymousId, event: validateEvent(event.name, event.properties) }
}

function validateRoomAnalyticsDelivery(delivery: RoomAnalyticsDelivery): RoomAnalyticsDelivery {
  if (typeof delivery.event !== 'string' || typeof delivery.distinctId !== 'string') {
    throw new TypeError('Invalid Room analytics delivery')
  }
  const eventProperties = ROOM_ANALYTICS_INVENTORY.events[delivery.event]
  if (!eventProperties) throw new TypeError('Invalid Room analytics delivery')
  const properties = exactObject(delivery.properties, [
    ...ROOM_ANALYTICS_INVENTORY.sharedProperties,
    ...eventProperties,
  ])
  if (properties.inventory_version !== ROOM_ANALYTICS_INVENTORY.version) {
    throw new TypeError('Invalid Room analytics inventory version')
  }
  const identityKind = properties.identity_kind
  if (
    (identityKind === 'anonymous' &&
      (!delivery.distinctId.startsWith('anonymous:') ||
        !UUID.test(delivery.distinctId.slice('anonymous:'.length)))) ||
    (identityKind === 'signed_in' && !DISCORD_ID.test(delivery.distinctId)) ||
    (identityKind !== 'anonymous' && identityKind !== 'signed_in')
  ) {
    throw new TypeError('Invalid Room analytics identity')
  }
  const safeEvent = validateEvent(
    delivery.event,
    Object.fromEntries(eventProperties.map((property) => [property, properties[property]])),
  )
  return {
    event: safeEvent.name,
    distinctId: delivery.distinctId,
    properties: {
      inventory_version: ROOM_ANALYTICS_INVENTORY.version,
      identity_kind: identityKind,
      ...safeEvent.properties,
    },
  }
}

function validateEvent(name: string, properties: unknown): RoomAnalyticsEvent {
  switch (name) {
    case 'room_route_action': {
      const source = exactObject(properties, ['state', 'action', 'outcome'])
      if (
        (source.state !== 'pre_admission' && source.state !== 'past_stream') ||
        (source.action !== 'join' && source.action !== 'back_home') ||
        ![
          'joined',
          'confirmation_required',
          'oauth_started',
          'rejected',
          'failed',
          'navigated',
        ].includes(String(source.outcome))
      ) {
        invalidProperties()
      }
      return {
        name,
        properties: {
          state: source.state,
          action: source.action,
          outcome: source.outcome as
            | 'joined'
            | 'confirmation_required'
            | 'oauth_started'
            | 'rejected'
            | 'failed'
            | 'navigated',
        },
      }
    }
    case 'room_companion_opened':
    case 'room_companion_tab_selected': {
      const source = exactObject(properties, ['surface', 'tab'])
      if (!isSurface(source.surface) || !isTab(source.tab)) invalidProperties()
      return { name, properties: { surface: source.surface, tab: source.tab } }
    }
    case 'room_companion_closed': {
      const source = exactObject(properties, ['surface', 'reason'])
      if (
        !isSurface(source.surface) ||
        (source.reason !== 'control' && source.reason !== 'escape')
      ) {
        invalidProperties()
      }
      return { name, properties: { surface: source.surface, reason: source.reason } }
    }
    case 'room_companion_resized': {
      const source = exactObject(properties, ['height'])
      if (source.height !== '55' && source.height !== '90') invalidProperties()
      return { name, properties: { height: source.height } }
    }
    case 'room_header_action': {
      const source = exactObject(properties, ['action', 'surface'])
      if (
        (source.action !== 'back_home' &&
          source.action !== 'details' &&
          source.action !== 'settings') ||
        (source.surface !== 'desktop' &&
          source.surface !== 'mobile' &&
          source.surface !== 'details')
      ) {
        invalidProperties()
      }
      return {
        name,
        properties: { action: source.action, surface: source.surface },
      }
    }
    case 'room_details_closed': {
      const source = exactObject(properties, ['reason'])
      if (
        source.reason !== 'control' &&
        source.reason !== 'escape' &&
        source.reason !== 'backdrop'
      ) {
        invalidProperties()
      }
      return { name, properties: { reason: source.reason } }
    }
    case 'room_details_resized': {
      const source = exactObject(properties, ['height'])
      if (source.height !== '55' && source.height !== '90') invalidProperties()
      return { name, properties: { height: source.height } }
    }
    case 'room_media_compatibility_checked': {
      const source = exactObject(properties, ['trigger', 'outcome'])
      if (
        (source.trigger !== 'admission' && source.trigger !== 'retry') ||
        (source.outcome !== 'compatible' && source.outcome !== 'incompatible')
      ) {
        invalidProperties()
      }
      return {
        name,
        properties: { trigger: source.trigger, outcome: source.outcome },
      }
    }
    case 'room_watch_action': {
      const source = exactObject(properties, [
        'action',
        'outcome',
        'attempt',
        'watch_sequence_id',
      ])
      if (
        (source.action !== 'watch' && source.action !== 'retry' && source.action !== 'cancel') ||
        !['started', 'retrying', 'connected', 'exhausted', 'cancelled'].includes(
          String(source.outcome),
        ) ||
        !Number.isInteger(source.attempt) ||
        Number(source.attempt) < 1 ||
        Number(source.attempt) > 4 ||
        typeof source.watch_sequence_id !== 'string' ||
        !UUID.test(source.watch_sequence_id)
      ) {
        invalidProperties()
      }
      return {
        name,
        properties: {
          action: source.action,
          outcome: source.outcome as
            | 'started'
            | 'retrying'
            | 'connected'
            | 'exhausted'
            | 'cancelled',
          attempt: Number(source.attempt),
          watch_sequence_id: source.watch_sequence_id,
        },
      }
    }
    case 'room_reconnect_recovery': {
      const source = exactObject(properties, ['outcome', 'seconds_remaining'])
      if (
        (source.outcome !== 'started' &&
          source.outcome !== 'reclaimed' &&
          source.outcome !== 'expired') ||
        !Number.isInteger(source.seconds_remaining) ||
        Number(source.seconds_remaining) < 0 ||
        Number(source.seconds_remaining) > 45
      ) {
        invalidProperties()
      }
      return {
        name,
        properties: {
          outcome: source.outcome,
          seconds_remaining: Number(source.seconds_remaining),
        },
      }
    }
    case 'room_stream_action': {
      const source = exactObject(properties, ['action', 'outcome'])
      if (
        (source.action !== 'start' && source.action !== 'cancel' && source.action !== 'stop') ||
        (source.outcome !== 'requested' &&
          source.outcome !== 'succeeded' &&
          source.outcome !== 'failed')
      ) {
        invalidProperties()
      }
      return { name, properties: { action: source.action, outcome: source.outcome } }
    }
    case 'room_mosaic_filter_changed': {
      const source = exactObject(properties, ['hidden'])
      if (typeof source.hidden !== 'boolean') invalidProperties()
      return { name, properties: { hidden: source.hidden } }
    }
    case 'room_watch_audio_changed': {
      const source = exactObject(properties, ['muted'])
      if (typeof source.muted !== 'boolean') invalidProperties()
      return { name, properties: { muted: source.muted } }
    }
    case 'room_watch_fullscreen_requested':
      exactObject(properties, [])
      return { name, properties: {} }
    case 'room_member_menu_opened': {
      const source = exactObject(properties, ['surface'])
      if (source.surface !== 'tile' && source.surface !== 'people') invalidProperties()
      return { name, properties: { surface: source.surface } }
    }
    case 'room_member_action_selected': {
      const source = exactObject(properties, ['surface', 'action'])
      if (
        (source.surface !== 'tile' && source.surface !== 'people') ||
        (source.action !== 'report' &&
          source.action !== 'kick' &&
          source.action !== 'room_ban' &&
          source.action !== 'host_transfer' &&
          source.action !== 'host_stream_stop')
      ) {
        invalidProperties()
      }
      return { name, properties: { surface: source.surface, action: source.action } }
    }
    case 'room_chat_send': {
      const source = exactObject(properties, ['trigger', 'outcome'])
      if (
        (source.trigger !== 'composer' && source.trigger !== 'retry') ||
        (source.outcome !== 'sent' &&
          source.outcome !== 'failed' &&
          source.outcome !== 'unavailable')
      ) {
        invalidProperties()
      }
      return { name, properties: { trigger: source.trigger, outcome: source.outcome } }
    }
    case 'room_chat_failed_discarded':
    case 'room_chat_new_messages_opened':
    case 'room_message_menu_opened':
      exactObject(properties, [])
      return { name, properties: {} }
    case 'room_chat_typing_changed': {
      const source = exactObject(properties, ['typing'])
      if (typeof source.typing !== 'boolean') invalidProperties()
      return { name, properties: { typing: source.typing } }
    }
    case 'room_message_action_selected': {
      const source = exactObject(properties, ['action'])
      if (source.action !== 'report' && source.action !== 'mute') invalidProperties()
      return { name, properties: { action: source.action } }
    }
    case 'room_chat_mute_changed': {
      const source = exactObject(properties, ['outcome'])
      if (source.outcome !== 'muted' && source.outcome !== 'failed') invalidProperties()
      return { name, properties: { outcome: source.outcome } }
    }
    case 'room_ban_confirmation_cancelled':
    case 'room_ban_confirmation_confirmed':
    case 'room_ban_clear_requested':
    case 'room_kick_confirmation_cancelled':
    case 'room_kick_confirmation_confirmed':
    case 'room_host_transfer_confirmation_cancelled':
    case 'room_host_transfer_confirmation_confirmed':
    case 'room_host_stream_stop_confirmation_cancelled':
    case 'room_host_stream_stop_confirmation_confirmed':
      exactObject(properties, [])
      return { name, properties: {} }
    default:
      throw new TypeError('Event is not in the Room analytics inventory')
  }
}

function isSurface(value: unknown): value is RoomCompanionSurface {
  return value === 'dock' || value === 'drawer' || value === 'sheet'
}

function isTab(value: unknown): value is RoomCompanionTab {
  return value === 'chat' || value === 'people' || value === 'activity'
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidProperties()
  const source = value as Record<string, unknown>
  const actual = Object.keys(source).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalidProperties()
  }
  return source
}

function invalidProperties(): never {
  throw new TypeError('Room analytics properties do not match the inventory')
}

function deliveryFailure(): RoomAnalyticsFailureLog {
  return {
    level: 'warn',
    event: 'analytics.delivery_failed',
    provider: 'posthog',
    inventory_version: 2,
    product_surface: 'room',
  }
}

function writeOperationalLog(entry: RoomAnalyticsFailureLog) {
  console.warn(JSON.stringify(entry))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DISCORD_ID = /^\d{17,20}$/
