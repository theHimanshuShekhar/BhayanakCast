import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, test } from 'vitest'
import * as schema from './schema'

function names(values: readonly unknown[]) {
  return values.map((value) => {
    const item = value as { name?: string; config?: { name?: string } }
    return item.name ?? item.config?.name
  })
}

describe('database schema invariants', () => {
  test('matches documented room lifecycle indexes and checks', () => {
    const config = getTableConfig(schema.rooms)

    expect(names(config.indexes)).toEqual(
      expect.arrayContaining(['rooms_current_host_idx']),
    )
    expect(names(config.checks)).toEqual(
      expect.arrayContaining([
        'rooms_category_len_chk',
        'rooms_empty_since_chk',
        'rooms_ended_at_chk',
      ]),
    )
  })

  test('matches documented room ban and stream consistency checks', () => {
    expect(names(getTableConfig(schema.roomBans).indexes)).toEqual(
      expect.arrayContaining(['room_bans_banned_user_idx']),
    )
    expect(names(getTableConfig(schema.roomBans).checks)).toEqual(
      expect.arrayContaining(['room_bans_clear_consistency_chk']),
    )

    expect(names(getTableConfig(schema.streamSessions).checks)).toEqual(
      expect.arrayContaining([
        'stream_sessions_interval_chk',
        'stream_sessions_stop_reason_chk',
      ]),
    )
  })

  test('matches documented report resolution and snapshot fields', () => {
    expect(schema).toHaveProperty('reportResolution')

    const config = getTableConfig(schema.reports)
    expect(names(config.columns)).toEqual(
      expect.arrayContaining([
        'thumbnail_content_type',
        'resolved_by_user_id',
        'resolution',
        'resolution_note',
      ]),
    )
    expect(names(config.indexes)).toEqual(
      expect.arrayContaining(['reports_resolved_idx', 'reports_room_idx']),
    )
    expect(names(config.checks)).toEqual(
      expect.arrayContaining([
        'reports_details_len_chk',
        'reports_resolution_consistency_chk',
        'reports_thumbnail_content_type_chk',
      ]),
    )
  })

  test('matches documented platform sanction lift fields and checks', () => {
    const config = getTableConfig(schema.platformSanctions)

    expect(names(config.columns)).toEqual(
      expect.arrayContaining(['lifted_by_user_id']),
    )
    expect(names(config.checks)).toEqual(
      expect.arrayContaining([
        'platform_sanctions_expiry_chk',
        'platform_sanctions_lift_consistency_chk',
      ]),
    )
  })
})
