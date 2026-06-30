import { describe, expect, test } from 'vitest'
import { createRoomInputSchema } from './room-actions'

describe('create room action input', () => {
  test('rejects room names shorter than three characters', () => {
    const result = createRoomInputSchema.safeParse({
      name: 'ab',
      category: 'gaming',
      tags: [],
      visibility: 'public',
    })

    expect(result.success).toBe(false)
  })
})
