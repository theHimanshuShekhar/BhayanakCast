import { describe, expect, test, vi } from 'vitest'
import {
  ACCOUNT_LIFECYCLE_ANALYTICS_INVENTORY,
  createAccountLifecycleAnalytics,
} from '../../src/server/observability/account-lifecycle-analytics'

describe('Account lifecycle analytics allowlist', () => {
  test('enumerates only content-free deletion interactions', () => {
    expect(ACCOUNT_LIFECYCLE_ANALYTICS_INVENTORY).toEqual({
      version: 1,
      events: {
        account_deletion_requested: [],
        account_deletion_cancelled: [],
        admin_deletion_approved: [],
        admin_deletion_rejected: [],
      },
    })
  })

  test('sends only inventory version and approved raw Discord identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    createAccountLifecycleAnalytics({
      POSTHOG_HOST: 'https://posthog.example',
      POSTHOG_PROJECT_API_KEY: 'project-key',
    }).record('account_deletion_requested', '102938475610293847')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      api_key: 'project-key',
      event: 'account_deletion_requested',
      properties: {
        distinct_id: '102938475610293847',
        inventory_version: 1,
      },
    })
    vi.unstubAllGlobals()
  })

  test('removes the PostHog person association without deleting aggregate events', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          results: [{ uuid: '0c193a8b-8451-4564-957b-6b81871f4728' }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await createAccountLifecycleAnalytics({
      POSTHOG_HOST: 'https://posthog.example/',
      POSTHOG_PROJECT_ID: '7',
      POSTHOG_PERSONAL_API_KEY: 'personal-key',
    }).forget('102938475610293847')
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://posthog.example/api/projects/7/persons/?distinct_id=102938475610293847',
      { headers: { authorization: 'Bearer personal-key' } },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://posthog.example/api/projects/7/persons/0c193a8b-8451-4564-957b-6b81871f4728/?delete_events=false',
      {
        method: 'DELETE',
        headers: { authorization: 'Bearer personal-key' },
      },
    )
    vi.unstubAllGlobals()
  })

  test('allows production startup when PostHog is disabled', async () => {
    const analytics = createAccountLifecycleAnalytics({
      NODE_ENV: 'production',
      POSTHOG_HOST: 'http://posthog:8000',
    })
    expect(() =>
      analytics.record('account_deletion_requested', '102938475610293847'),
    ).not.toThrow()
    await expect(analytics.forget('102938475610293847')).resolves.toBeUndefined()
  })

  test('refuses partial production PostHog configuration', () => {
    expect(() =>
      createAccountLifecycleAnalytics({
        NODE_ENV: 'production',
        POSTHOG_HOST: 'http://posthog:8000',
        POSTHOG_PROJECT_API_KEY: 'project-key',
      }),
    ).toThrow('PostHog Account lifecycle analytics is not configured')
  })

  test('rejects unknown events and non-Discord identities before delivery', () => {
    const analytics = createAccountLifecycleAnalytics({})
    expect(() => analytics.record('report_content_viewed' as never, '102938475610293847')).toThrow()
    expect(() => analytics.record('account_deletion_cancelled', 'internal-account-id')).toThrow()
  })
})
