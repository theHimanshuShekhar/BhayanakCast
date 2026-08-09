import { describe, expect, it, vi } from 'vitest'
import {
  createRoomAnalytics,
  validateRoomAnalyticsEnvelope,
  type RoomAnalyticsDelivery,
} from '../../src/server/observability/room-analytics'

const anonymousId = 'd0b172a2-e031-4b77-b15a-a327f4f0b97e'

describe('Room analytics companion allowlist', () => {
  it.each([
    {
      name: 'room_companion_opened',
      properties: { surface: 'dock', tab: 'chat' },
    },
    {
      name: 'room_companion_closed',
      properties: { surface: 'drawer', reason: 'escape' },
    },
    {
      name: 'room_companion_tab_selected',
      properties: { surface: 'sheet', tab: 'activity' },
    },
    {
      name: 'room_companion_resized',
      properties: { height: '90' },
    },
  ])('accepts the exact $name payload', (event) => {
    expect(validateRoomAnalyticsEnvelope({ anonymousId, event })).toEqual({
      anonymousId,
      event,
    })
  })

  it.each([
    {
      name: 'room_companion_opened',
      properties: { surface: 'dock', tab: 'chat', draft: 'secret' },
    },
    {
      name: 'room_companion_closed',
      properties: { surface: 'drawer', reason: 'escape', roomId: 'private' },
    },
    { name: 'room_companion_resized', properties: { height: '75' } },
    {
      name: 'room_companion_tab_selected',
      properties: { surface: 'modal', tab: 'people' },
    },
  ])('rejects content, unknown properties, and values', (event) => {
    expect(() => validateRoomAnalyticsEnvelope({ anonymousId, event })).toThrow()
  })

  it('delivers only inventory identity and companion properties', () => {
    const deliveries: RoomAnalyticsDelivery[] = []
    const analytics = createRoomAnalytics({
      sink: { capture: (delivery) => { deliveries.push(delivery) } },
    })

    analytics.record(
      {
        anonymousId,
        event: {
          name: 'room_companion_opened',
          properties: { surface: 'sheet', tab: 'people' },
        },
      },
      '271828182845904523',
    )

    expect(deliveries).toEqual([
      {
        event: 'room_companion_opened',
        distinctId: '271828182845904523',
        properties: {
          inventory_version: 2,
          identity_kind: 'signed_in',
          surface: 'sheet',
          tab: 'people',
        },
      },
    ])
  })

  it('isolates synchronous and asynchronous sink failures', async () => {
    const operationalLog = vi.fn()
    const sync = createRoomAnalytics({
      sink: {
        capture: () => {
          throw new Error('offline')
        },
      },
      operationalLog,
    })
    const async = createRoomAnalytics({
      sink: { capture: () => Promise.reject(new Error('offline')) },
      operationalLog,
    })
    const envelope = {
      anonymousId,
      event: {
        name: 'room_companion_closed' as const,
        properties: { surface: 'dock' as const, reason: 'control' as const },
      },
    }

    expect(() => sync.record(envelope, null)).not.toThrow()
    expect(() => async.record(envelope, null)).not.toThrow()
    await vi.waitFor(() => expect(operationalLog).toHaveBeenCalledTimes(2))
  })
})

describe('Room analytics route-state allowlist', () => {
  it.each([
    {
      name: 'room_route_action',
      properties: {
        state: 'pre_admission',
        action: 'join',
        outcome: 'oauth_started',
      },
    },
    {
      name: 'room_route_action',
      properties: {
        state: 'past_stream',
        action: 'back_home',
        outcome: 'navigated',
      },
    },
  ])('accepts the exact content-free route action', (event) => {
    expect(validateRoomAnalyticsEnvelope({ anonymousId, event })).toEqual({
      anonymousId,
      event,
    })
  })

  it.each([
    {
      name: 'room_route_action',
      properties: {
        state: 'pre_admission',
        action: 'join',
        outcome: 'joined',
        password: 'forbidden',
      },
    },
    {
      name: 'room_route_action',
      properties: {
        state: 'past_stream',
        action: 'back_home',
        outcome: 'navigated',
        roomName: 'forbidden content',
      },
    },
    {
      name: 'room_route_action',
      properties: {
        state: 'admitted',
        action: 'join',
        outcome: 'joined',
      },
    },
  ])('rejects content, secrets, and states outside the route inventory', (event) => {
    expect(() => validateRoomAnalyticsEnvelope({ anonymousId, event })).toThrow()
  })
})

describe('Room analytics mosaic allowlist', () => {
  it.each([
    {
      name: 'room_mosaic_filter_changed',
      properties: { hidden: true },
    },
    {
      name: 'room_watch_audio_changed',
      properties: { muted: false },
    },
    {
      name: 'room_watch_fullscreen_requested',
      properties: {},
    },
  ])('accepts only the exact $name interaction', (event) => {
    expect(validateRoomAnalyticsEnvelope({ anonymousId, event })).toEqual({
      anonymousId,
      event,
    })
  })

  it.each([
    {
      name: 'room_mosaic_filter_changed',
      properties: { hidden: true, memberName: 'forbidden content' },
    },
    {
      name: 'room_watch_audio_changed',
      properties: { muted: 'yes' },
    },
    {
      name: 'room_watch_fullscreen_requested',
      properties: { streamId: 'forbidden identity' },
    },
  ])('rejects content, identities, and non-allowlisted values for $name', (event) => {
    expect(() => validateRoomAnalyticsEnvelope({ anonymousId, event })).toThrow()
  })
})


describe('Room analytics media-recovery allowlist', () => {
  it.each([
    {
      name: 'room_media_compatibility_checked',
      properties: { trigger: 'retry', outcome: 'compatible' },
    },
    {
      name: 'room_watch_action',
      properties: {
        action: 'retry',
        outcome: 'retrying',
        attempt: 3,
        watch_sequence_id: 'c6db6c55-dfa5-4edc-8758-3ca062646c7c',
      },
    },
    {
      name: 'room_reconnect_recovery',
      properties: { outcome: 'started', seconds_remaining: 45 },
    },
    {
      name: 'room_stream_action',
      properties: { action: 'cancel', outcome: 'succeeded' },
    },
  ])('accepts the exact content-free $name interaction', (event) => {
    expect(validateRoomAnalyticsEnvelope({ anonymousId, event })).toEqual({
      anonymousId,
      event,
    })
  })

  it.each([
    {
      name: 'room_media_compatibility_checked',
      properties: { trigger: 'retry', outcome: 'compatible', roomName: 'private' },
    },
    {
      name: 'room_watch_action',
      properties: {
        action: 'retry',
        outcome: 'retrying',
        attempt: 5,
        watch_sequence_id: 'c6db6c55-dfa5-4edc-8758-3ca062646c7c',
      },
    },
    {
      name: 'room_watch_action',
      properties: {
        action: 'watch',
        outcome: 'connected',
        attempt: 0,
        watch_sequence_id: 'c6db6c55-dfa5-4edc-8758-3ca062646c7c',
      },
    },
    {
      name: 'room_reconnect_recovery',
      properties: { outcome: 'started', seconds_remaining: 46 },
    },
    {
      name: 'room_stream_action',
      properties: { action: 'start', outcome: 'failed', streamId: 'forbidden' },
    },
  ])('rejects content, identifiers, and values outside the recovery inventory', (event) => {
    expect(() => validateRoomAnalyticsEnvelope({ anonymousId, event })).toThrow()
  })
})
describe('Room analytics member-action allowlist', () => {
  it.each([
    {
      name: 'room_member_menu_opened',
      properties: { surface: 'tile' },
    },
    {
      name: 'room_member_action_selected',
      properties: { surface: 'people', action: 'report' },
    },
    {
      name: 'room_member_action_selected',
      properties: { surface: 'tile', action: 'room_ban' },
    },
    {
      name: 'room_ban_confirmation_cancelled',
      properties: {},
    },
    {
      name: 'room_ban_confirmation_confirmed',
      properties: {},
    },
    {
      name: 'room_ban_clear_requested',
      properties: {},
    },
  ])('accepts the exact content-free $name interaction', (event) => {
    expect(validateRoomAnalyticsEnvelope({ anonymousId, event })).toEqual({
      anonymousId,
      event,
    })
  })

  it.each([
    {
      name: 'room_member_menu_opened',
      properties: { surface: 'tile', targetName: 'forbidden content' },
    },
    {
      name: 'room_member_action_selected',
      properties: { surface: 'people', action: 'remove' },
    },
    {
      name: 'room_member_action_selected',
      properties: { surface: 'settings', action: 'room_ban' },
    },
    {
      name: 'room_ban_confirmation_confirmed',
      properties: { roomId: 'forbidden identity' },
    },
    {
      name: 'room_ban_clear_requested',
      properties: { accountId: 'forbidden identity' },
    },
  ])('rejects content, identity, and non-allowlisted values for $name', (event) => {
    expect(() => validateRoomAnalyticsEnvelope({ anonymousId, event })).toThrow()
  })
})

describe('Room analytics Chat allowlist', () => {
  it.each([
    {
      name: 'room_chat_send',
      properties: { trigger: 'composer', outcome: 'sent' },
    },
    {
      name: 'room_chat_send',
      properties: { trigger: 'retry', outcome: 'failed' },
    },
    { name: 'room_chat_failed_discarded', properties: {} },
    { name: 'room_chat_new_messages_opened', properties: {} },
    {
      name: 'room_chat_typing_changed',
      properties: { typing: true },
    },
    { name: 'room_message_menu_opened', properties: {} },
    {
      name: 'room_message_action_selected',
      properties: { action: 'report' },
    },
    {
      name: 'room_chat_mute_changed',
      properties: { outcome: 'muted' },
    },
  ])('accepts the exact content-free $name interaction', (event) => {
    expect(validateRoomAnalyticsEnvelope({ anonymousId, event }).event).toEqual(event)
  })

  it.each([
    {
      name: 'room_chat_send',
      properties: { trigger: 'composer', outcome: 'sent', body: 'forbidden chat' },
    },
    {
      name: 'room_chat_typing_changed',
      properties: { typing: true, displayName: 'forbidden identity' },
    },
    {
      name: 'room_message_action_selected',
      properties: { action: 'report', details: 'forbidden report' },
    },
    {
      name: 'room_chat_mute_changed',
      properties: { outcome: 'muted', accountId: 'forbidden identity' },
    },
  ])('rejects content and identity properties for $name', (event) => {
    expect(() => validateRoomAnalyticsEnvelope({ anonymousId, event })).toThrow()
  })
})

describe('Room stream quality analytics delivery', () => {
  it('round-trips the exact encoder quality sample', () => {
    const deliveries: RoomAnalyticsDelivery[] = []
    const analytics = createRoomAnalytics({
      sink: { capture: (delivery) => { deliveries.push(delivery) } },
    })
    const event = {
      name: 'room_stream_quality' as const,
      properties: {
        encoder_implementation: 'ExternalEncoderFactory',
        quality_limitation_reason: 'none' as const,
        frames_per_second: 60,
        frame_height: 1080,
      },
    }

    analytics.record({ anonymousId, event }, '271828182845904523')

    expect(deliveries).toEqual([
      {
        event: 'room_stream_quality',
        distinctId: '271828182845904523',
        properties: {
          inventory_version: 2,
          identity_kind: 'signed_in',
          ...event.properties,
        },
      },
    ])
  })
})
