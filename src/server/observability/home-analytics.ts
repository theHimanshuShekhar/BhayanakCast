export const HOME_ANALYTICS_INVENTORY = {
  version: 1,
  sharedProperties: ['inventory_version', 'identity_kind'] as const,
  identity: {
    anonymous: 'anonymous:<random UUID>',
    signedIn: 'raw Discord ID',
  },
  events: {
    home_viewed: ['mode'],
    home_search_applied: ['has_text_query', 'category_selected', 'tag_count'],
    home_filters_opened: [],
    home_room_opened: ['collection'],
    home_profile_opened: [],
    home_past_stream_opened: [],
    home_create_started: [],
    home_create_submitted: ['visibility', 'category_selected', 'tag_count'],
    home_create_succeeded: ['visibility', 'category_selected', 'tag_count'],
    home_discord_sign_in_started: ['intent'],
    home_section_retried: ['section'],
  },
} as const

export type HomeAnalyticsEvent =
  | { readonly name: 'home_viewed'; readonly properties: { readonly mode: 'discovery' | 'search' } }
  | { readonly name: 'home_search_applied'; readonly properties: SearchStateProperties }
  | { readonly name: 'home_filters_opened'; readonly properties: EmptyProperties }
  | { readonly name: 'home_room_opened'; readonly properties: { readonly collection: 'live_rooms' | 'search_results' } }
  | { readonly name: 'home_profile_opened'; readonly properties: EmptyProperties }
  | { readonly name: 'home_past_stream_opened'; readonly properties: EmptyProperties }
  | { readonly name: 'home_create_started'; readonly properties: EmptyProperties }
  | { readonly name: 'home_create_submitted'; readonly properties: CreateProperties }
  | { readonly name: 'home_create_succeeded'; readonly properties: CreateProperties }
  | { readonly name: 'home_discord_sign_in_started'; readonly properties: { readonly intent: 'home' | 'create' } }
  | { readonly name: 'home_section_retried'; readonly properties: { readonly section: HomeAnalyticsSection } }

type EmptyProperties = Record<string, never>
interface SearchStateProperties {
  readonly has_text_query: boolean
  readonly category_selected: boolean
  readonly tag_count: number
}
interface CreateProperties {
  readonly visibility: 'public' | 'private'
  readonly category_selected: boolean
  readonly tag_count: number
}
export type HomeAnalyticsSection = 'filters' | 'presence' | 'statistics' | 'live_rooms' | 'profiles' | 'past_streams'

export interface HomeAnalyticsEnvelope {
  readonly anonymousId: string
  readonly event: HomeAnalyticsEvent
}

export interface HomeAnalyticsDelivery {
  readonly event: HomeAnalyticsEvent['name']
  readonly distinctId: string
  readonly properties: Readonly<Record<string, boolean | number | string>>
}

export interface HomeAnalyticsSink {
  capture(delivery: HomeAnalyticsDelivery): void | Promise<void>
}

export interface HomeAnalytics {
  record(envelope: HomeAnalyticsEnvelope, discordId: string | null): void
}

interface OperationalLogEntry {
  readonly level: 'warn'
  readonly event: 'analytics.delivery_failed'
  readonly provider: 'posthog'
  readonly inventory_version: 1
}

interface HomeAnalyticsOptions {
  readonly sink: HomeAnalyticsSink | null
  readonly operationalLog?: (entry: OperationalLogEntry) => void
}

export function createHomeAnalytics(options: HomeAnalyticsOptions): HomeAnalytics {
  const operationalLog = options.operationalLog ?? writeOperationalLog
  return {
    record(envelope: HomeAnalyticsEnvelope, discordId: string | null): void {
      if (!options.sink) return
      let safeEnvelope: HomeAnalyticsEnvelope
      try {
        safeEnvelope = validateHomeAnalyticsEnvelope(envelope)
      } catch {
        return
      }
      if (discordId !== null && !DISCORD_ID.test(discordId)) return
      try {
        const signedIn = discordId !== null
        const delivery: HomeAnalyticsDelivery = {
          event: safeEnvelope.event.name,
          distinctId: signedIn ? discordId : `anonymous:${safeEnvelope.anonymousId}`,
          properties: {
            inventory_version: HOME_ANALYTICS_INVENTORY.version,
            identity_kind: signedIn ? 'signed_in' : 'anonymous',
            ...safeEnvelope.event.properties,
          },
        }
        Promise.resolve(options.sink.capture(delivery)).catch(() => {
          operationalLog(deliveryFailure())
        })
      } catch {
        operationalLog(deliveryFailure())
      }
    },
  }
}

interface PostHogAdapterOptions {
  readonly host: string
  readonly projectApiKey: string
  readonly request?: typeof fetch
}

export function createPostHogAdapter(options: PostHogAdapterOptions): HomeAnalyticsSink {
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
          properties: {
            distinct_id: safe.distinctId,
            ...safe.properties,
          },
        }),
        signal: AbortSignal.timeout(2_000),
      })
      if (!response.ok) throw new Error(`PostHog capture failed (${response.status})`)
    },
  }
}

function validateDelivery(delivery: HomeAnalyticsDelivery): HomeAnalyticsDelivery {
  if (typeof delivery.event !== 'string' || typeof delivery.distinctId !== 'string') {
    throw new TypeError('Invalid Home analytics delivery')
  }
  const inventoryProperties =
    HOME_ANALYTICS_INVENTORY.events[
      delivery.event as keyof typeof HOME_ANALYTICS_INVENTORY.events
    ]
  if (!inventoryProperties) throw new TypeError('Invalid Home analytics delivery')
  const properties = exactObject(delivery.properties, [
    ...HOME_ANALYTICS_INVENTORY.sharedProperties,
    ...inventoryProperties,
  ])
  if (properties.inventory_version !== HOME_ANALYTICS_INVENTORY.version) {
    throw new TypeError('Invalid Home analytics inventory version')
  }
  const identityKind = properties.identity_kind
  if (
    (identityKind === 'anonymous' &&
      (!delivery.distinctId.startsWith('anonymous:') ||
        !UUID.test(delivery.distinctId.slice('anonymous:'.length)))) ||
    (identityKind === 'signed_in' && !DISCORD_ID.test(delivery.distinctId)) ||
    (identityKind !== 'anonymous' && identityKind !== 'signed_in')
  ) {
    throw new TypeError('Invalid Home analytics identity')
  }
  const eventProperties = Object.fromEntries(
    inventoryProperties.map((property) => [property, properties[property]]),
  )
  const safeEvent = validateEvent(delivery.event, eventProperties)
  return {
    event: safeEvent.name,
    distinctId: delivery.distinctId,
    properties: {
      inventory_version: HOME_ANALYTICS_INVENTORY.version,
      identity_kind: identityKind,
      ...safeEvent.properties,
    },
  }
}

export function validateHomeAnalyticsEnvelope(value: unknown): HomeAnalyticsEnvelope {
  const source = exactObject(value, ['anonymousId', 'event'])
  if (typeof source.anonymousId !== 'string' || !UUID.test(source.anonymousId)) {
    throw new TypeError('anonymousId must be a UUID')
  }
  const event = exactObject(source.event, ['name', 'properties'])
  if (typeof event.name !== 'string') throw new TypeError('Invalid Home analytics event')
  return {
    anonymousId: source.anonymousId,
    event: validateEvent(event.name, event.properties),
  }
}

function validateEvent(name: string, properties: unknown): HomeAnalyticsEvent {
  switch (name) {
    case 'home_viewed': {
      const value = exactObject(properties, ['mode'])
      if (value.mode !== 'discovery' && value.mode !== 'search') invalidProperties()
      return { name, properties: { mode: value.mode } }
    }
    case 'home_search_applied':
      return { name, properties: validateSearchState(properties) }
    case 'home_filters_opened':
    case 'home_profile_opened':
    case 'home_past_stream_opened':
    case 'home_create_started':
      exactObject(properties, [])
      return { name, properties: {} }
    case 'home_room_opened': {
      const value = exactObject(properties, ['collection'])
      if (value.collection !== 'live_rooms' && value.collection !== 'search_results') invalidProperties()
      return { name, properties: { collection: value.collection } }
    }
    case 'home_create_submitted':
    case 'home_create_succeeded':
      return { name, properties: validateCreate(properties) }
    case 'home_discord_sign_in_started': {
      const value = exactObject(properties, ['intent'])
      if (value.intent !== 'home' && value.intent !== 'create') invalidProperties()
      return { name, properties: { intent: value.intent } }
    }
    case 'home_section_retried': {
      const value = exactObject(properties, ['section'])
      if (typeof value.section !== 'string' || !(value.section in HOME_SECTIONS)) invalidProperties()
      return { name, properties: { section: value.section as HomeAnalyticsSection } }
    }
    default:
      throw new TypeError('Event is not in the Home analytics inventory')
  }
}

function validateSearchState(value: unknown): SearchStateProperties {
  const source = exactObject(value, ['has_text_query', 'category_selected', 'tag_count'])
  if (typeof source.has_text_query !== 'boolean' || typeof source.category_selected !== 'boolean') invalidProperties()
  return {
    has_text_query: source.has_text_query,
    category_selected: source.category_selected,
    tag_count: boundedCount(source.tag_count),
  }
}

function validateCreate(value: unknown): CreateProperties {
  const source = exactObject(value, ['visibility', 'category_selected', 'tag_count'])
  if (source.visibility !== 'public' && source.visibility !== 'private') invalidProperties()
  if (typeof source.category_selected !== 'boolean') invalidProperties()
  return {
    visibility: source.visibility,
    category_selected: source.category_selected,
    tag_count: boundedCount(source.tag_count),
  }
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidProperties()
  const source = value as Record<string, unknown>
  const actual = Object.keys(source)
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalidProperties()
  return source
}

function boundedCount(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 5) invalidProperties()
  return value as number
}

function invalidProperties(): never {
  throw new TypeError('Properties do not match the Home analytics inventory')
}

function deliveryFailure(): OperationalLogEntry {
  return {
    level: 'warn',
    event: 'analytics.delivery_failed',
    provider: 'posthog',
    inventory_version: 1,
  }
}

function writeOperationalLog(entry: OperationalLogEntry) {
  console.warn(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DISCORD_ID = /^\d{17,20}$/
const HOME_SECTIONS: Record<HomeAnalyticsSection, true> = {
  filters: true,
  presence: true,
  statistics: true,
  live_rooms: true,
  profiles: true,
  past_streams: true,
}
