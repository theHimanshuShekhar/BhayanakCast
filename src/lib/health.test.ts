import { describe, expect, test } from 'vitest'
import { createHealthPayload } from './health'

describe('createHealthPayload', () => {
  test('reports healthy dependencies', async () => {
    const payload = await createHealthPayload({
      now: new Date('2026-06-19T00:00:00.000Z'),
      checkDatabase: async () => undefined,
      checkValkey: async () => undefined,
    })

    expect(payload).toEqual({
      ok: true,
      service: 'bhayanakcast',
      time: '2026-06-19T00:00:00.000Z',
      dependencies: {
        database: 'ok',
        valkey: 'ok',
      },
    })
  })

  test('marks health unhealthy when a dependency check fails', async () => {
    const payload = await createHealthPayload({
      now: new Date('2026-06-19T00:00:00.000Z'),
      checkDatabase: async () => {
        throw new Error('connection refused')
      },
      checkValkey: async () => undefined,
    })

    expect(payload.ok).toBe(false)
    expect(payload.dependencies.database).toBe('error')
    expect(JSON.stringify(payload)).not.toContain('connection refused')
  })
})
