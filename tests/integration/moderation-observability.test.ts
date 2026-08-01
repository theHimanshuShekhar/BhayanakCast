import { describe, expect, test, vi } from 'vitest'
import {
  MODERATION_ANALYTICS_INVENTORY,
  createModerationAnalytics,
  validateModerationAnalyticsEvent,
  type ModerationAnalyticsDelivery,
} from '../../src/server/observability/moderation-analytics'

describe('moderation observability allowlist', () => {
  test('sends only versioned, content-free Admin interaction properties', () => {
    const deliveries: ModerationAnalyticsDelivery[] = []
    const analytics = createModerationAnalytics({
      sink: { capture: (delivery) => { deliveries.push(delivery) } },
    })
    analytics.record({
      name: 'admin_report_review_submitted',
      properties: { target_type: 'message', disposition: 'resolved', evidence_available: false },
    }, '102938475610293900')
    expect(deliveries).toEqual([{
      event: 'admin_report_review_submitted',
      distinctId: '102938475610293900',
      properties: {
        inventory_version: MODERATION_ANALYTICS_INVENTORY.version,
        identity_kind: 'signed_in',
        target_type: 'message',
        disposition: 'resolved',
        evidence_available: false,
      },
    }])
    expect(JSON.stringify(deliveries)).not.toMatch(/details|reason|report_id|room_name|private body|thumbnail|media_bytes/)
  })

  test('allowlists only the room-end outcome and rejects Room content or identifiers', () => {
    expect(
      validateModerationAnalyticsEvent({
        name: 'admin_room_termination_list_viewed',
        properties: {},
      }),
    ).toEqual({
      name: 'admin_room_termination_list_viewed',
      properties: {},
    })
    expect(
      validateModerationAnalyticsEvent({
        name: 'admin_room_end_submitted',
        properties: { outcome: 'ended' },
      }),
    ).toEqual({
      name: 'admin_room_end_submitted',
      properties: { outcome: 'ended' },
    })
    expect(() =>
      validateModerationAnalyticsEvent({
        name: 'admin_room_end_submitted',
        properties: {
          outcome: 'ended',
          room_id: 'private',
          room_name: 'private',
          reason: 'private',
        },
      }),
    ).toThrow()
  })

  test.each([
    { name: 'admin_report_opened', properties: { target_type: 'stream', evidence_available: true, details: 'private' } },
    { name: 'admin_report_review_submitted', properties: { target_type: 'message', disposition: 'resolved', evidence_available: false, report_id: 'private' } },
    { name: 'admin_room_end_submitted', properties: { outcome: 'ended', room_id: 'private' } },
    { name: 'report_submitted', properties: {} },
  ])('rejects report content, identifiers, and unlisted event families', (event) => {
    expect(() => validateModerationAnalyticsEvent(event)).toThrow()
  })

  test('PostHog delivery failure cannot block the Admin action path', async () => {
    const logs = vi.fn()
    const analytics = createModerationAnalytics({
      sink: { capture: async () => { throw new Error('offline') } },
      operationalLog: logs,
    })
    expect(() => analytics.record({ name: 'admin_report_queue_viewed', properties: {} }, '102938475610293900')).not.toThrow()
    await vi.waitFor(() => expect(logs).toHaveBeenCalledWith(expect.objectContaining({
      event: 'analytics.delivery_failed', inventory: 'moderation',
    })))
  })
})
