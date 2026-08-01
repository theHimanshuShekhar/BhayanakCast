import { describe, expect, test, vi } from 'vitest'
import {
  HOME_ANALYTICS_INVENTORY,
  createHomeAnalytics,
  createPostHogAdapter,
  validateHomeAnalyticsEnvelope,
  type HomeAnalyticsDelivery,
} from '../../src/server/observability/home-analytics'

const ANONYMOUS_ID = '4d36e967-e325-4dea-9f91-5f9d23f05d2c'
const DISCORD_ID = '123456789012345678'

function viewed() {
  return {
    anonymousId: ANONYMOUS_ID,
    event: { name: 'home_viewed', properties: { mode: 'discovery' } },
  } as const
}

describe('Home analytics privacy boundary', () => {
  test('publishes only the versioned allowlisted event and properties', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const analytics = createHomeAnalytics({
      sink: createPostHogAdapter({
        host: 'https://posthog.internal/',
        projectApiKey: 'phc_project',
        request,
      }),
    })

    analytics.record(viewed(), null)
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())

    expect(HOME_ANALYTICS_INVENTORY).toMatchObject({ version: 1 })
    expect(request.mock.calls[0]![1]?.body).toBe(JSON.stringify({
      api_key: 'phc_project',
      event: 'home_viewed',
      properties: {
        distinct_id: `anonymous:${ANONYMOUS_ID}`,
        inventory_version: 1,
        identity_kind: 'anonymous',
        mode: 'discovery',
      },
    }))
  })

  test('enumerates the complete V1 Home event surface', () => {
    expect(HOME_ANALYTICS_INVENTORY).toEqual({
      version: 1,
      sharedProperties: ['inventory_version', 'identity_kind'],
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
    })
    expect(validateHomeAnalyticsEnvelope({
      anonymousId: ANONYMOUS_ID,
      event: {
        name: 'home_create_submitted',
        properties: {
          visibility: 'private',
          category_selected: true,
          tag_count: 2,
        },
      },
    })).toMatchObject({
      event: { name: 'home_create_submitted' },
    })
  })

  test('uses an anonymous pseudonym without Account identity and only raw Discord ID when signed in', () => {
    const deliveries: HomeAnalyticsDelivery[] = []
    const analytics = createHomeAnalytics({
      sink: { capture: (delivery) => void deliveries.push(delivery) },
    })

    analytics.record(viewed(), null)
    analytics.record(viewed(), DISCORD_ID)

    expect(deliveries).toEqual([
      {
        event: 'home_viewed',
        distinctId: `anonymous:${ANONYMOUS_ID}`,
        properties: { inventory_version: 1, identity_kind: 'anonymous', mode: 'discovery' },
      },
      {
        event: 'home_viewed',
        distinctId: DISCORD_ID,
        properties: { inventory_version: 1, identity_kind: 'signed_in', mode: 'discovery' },
      },
    ])
  })

  test.each([
    ['room name', { ...viewed(), event: { name: 'home_viewed', properties: { mode: 'discovery', roomName: 'Secret room' } } }],
    ['password', { ...viewed(), event: { name: 'home_create_submitted', properties: { visibility: 'private', category_selected: false, tag_count: 0, password: 'hunter22' } } }],
    ['chat', { ...viewed(), event: { name: 'home_viewed', properties: { mode: 'discovery', chat: 'private message' } } }],
    ['report', { ...viewed(), event: { name: 'report_submitted', properties: {} } }],
    ['media', { ...viewed(), event: { name: 'home_room_opened', properties: { collection: 'live_rooms', thumbnail: 'bytes' } } }],
    ['profile identity', { ...viewed(), event: { name: 'home_profile_opened', properties: { displayName: 'Person' } } }],
  ])('rejects forbidden %s properties or event families at the server boundary', (_label, value) => {
    expect(() => validateHomeAnalyticsEnvelope(value)).toThrow(TypeError)
  })

  test('drops a forbidden payload even when a caller bypasses static typing', () => {
    const capture = vi.fn()
    const analytics = createHomeAnalytics({ sink: { capture } })
    analytics.record({
      ...viewed(),
      event: {
        name: 'home_viewed',
        properties: { mode: 'discovery', roomName: 'Must not leave the process' },
      },
    } as never, null)
    expect(capture).not.toHaveBeenCalled()
  })

  test('does not throw or wait when PostHog is unavailable and emits only a structured delivery failure', async () => {
    const operationalLogs: unknown[] = []
    const analytics = createHomeAnalytics({
      sink: { capture: () => Promise.reject(new Error('PostHog unavailable')) },
      operationalLog: (entry) => operationalLogs.push(entry),
    })

    expect(() => analytics.record(viewed(), DISCORD_ID)).not.toThrow()
    expect(operationalLogs).toEqual([])
    await vi.waitFor(() => expect(operationalLogs).toEqual([
      {
        level: 'warn',
        event: 'analytics.delivery_failed',
        provider: 'posthog',
        inventory_version: 1,
      },
    ]))
  })

  test('treats missing analytics configuration as a no-op', () => {
    const analytics = createHomeAnalytics({ sink: null })
    expect(() => analytics.record(viewed(), null)).not.toThrow()
  })
})
