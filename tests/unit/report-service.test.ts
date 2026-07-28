import { describe, expect, test } from 'vitest'
import {
  REPORT_REASONS,
  submitReport,
  type ReportInput,
} from '../../src/server/moderation/report-service'

const ROOM_ID = '00000000-0000-4000-8000-000000000001'

function report(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    targetType: 'stream',
    targetId: 'stream-1',
    roomId: ROOM_ID,
    reason: 'other',
    details: null,
    ...overrides,
  }
}

describe('submitReport', () => {
  // The rejections below are decided before any database work, so no pool is
  // bound here — reaching the insert would throw and fail the test.
  test('requires details only for `other`', async () => {
    await expect(submitReport('account-1', report())).resolves.toEqual({
      status: 'details-required',
    })
    await expect(
      submitReport('account-1', report({ reason: 'other', details: '   ' })),
    ).resolves.toEqual({ status: 'details-required' })
  })

  test('rejects details past the stored limit', async () => {
    await expect(
      submitReport('account-1', report({ reason: 'spam', details: 'x'.repeat(2_001) })),
    ).resolves.toEqual({ status: 'details-required' })
  })

  test('exposes ADR 0008 fixed reasons with no free-text reason', () => {
    expect([...REPORT_REASONS]).toEqual([
      'harassment',
      'sexual',
      'violence',
      'privacy',
      'spam',
      'copyright',
      'other',
    ])
  })
})
