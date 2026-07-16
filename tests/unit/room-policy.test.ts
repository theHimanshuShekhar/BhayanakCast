import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
  normalizeRoomInput,
  RoomInputError,
} from '../../src/server/rooms/room-policy'

const room = (overrides: Record<string, unknown> = {}) => ({
  name: 'Movie night',
  ...overrides,
})

const expectInputError = (
  input: Parameters<typeof normalizeRoomInput>[0],
  code: RoomInputError['code'],
) => {
  expect(() => normalizeRoomInput(input)).toThrow(RoomInputError)

  try {
    normalizeRoomInput(input)
  } catch (error) {
    expect(error).toMatchObject({ code })
  }
}

describe('room input policy', () => {
  test('normalizes name and optional metadata with NFKC trimming', () => {
    expect(
      normalizeRoomInput(
        room({
          name: '  Ｍｏｖｉｅ　ｎｉｇｈｔ  ',
          category: '  Ｆｉｌｍ  ',
          tags: ['  Café  ', 'Cafe\u0301', '   ', 'Ｈｏｒｒｏｒ'],
        }),
      ),
    ).toEqual({
      name: 'Movie night',
      category: 'Film',
      tags: ['Café', 'Horror'],
      visibility: 'public',
    })
  })

  test('defaults visibility to public and removes public passwords', () => {
    expect(
      normalizeRoomInput(room({ password: 'private-but-public' })),
    ).toEqual({
      name: 'Movie night',
      tags: [],
      visibility: 'public',
    })
  })

  test('accepts the three and eighty visible-character name boundaries', () => {
    expect(normalizeRoomInput(room({ name: '👁️👁️👁️' })).name).toBe('👁️👁️👁️')
    expect(normalizeRoomInput(room({ name: 'a'.repeat(80) })).name).toHaveLength(
      80,
    )
  })

  test('rejects names outside the visible-character bounds', () => {
    expectInputError(room({ name: '👁️👁️' }), 'ROOM_NAME_LENGTH')
    expectInputError(room({ name: 'a'.repeat(81) }), 'ROOM_NAME_LENGTH')
  })

  test('accepts a category at its boundary and rejects a longer one', () => {
    expect(normalizeRoomInput(room({ category: 'c'.repeat(32) })).category).toHaveLength(
      32,
    )
    expectInputError(room({ category: 'c'.repeat(33) }), 'ROOM_CATEGORY_LENGTH')
  })

  test('omits blank tags and deduplicates normalized tags', () => {
    expect(
      normalizeRoomInput(room({ tags: ['  ', 'Ｆｉｌｍ', 'Film', 'Film'] })).tags,
    ).toEqual(['Film'])
  })

  test('accepts five tags and rejects six distinct tags', () => {
    expect(
      normalizeRoomInput(room({ tags: ['1', '2', '3', '4', '5'] })).tags,
    ).toHaveLength(5)
    expectInputError(
      room({ tags: ['1', '2', '3', '4', '5', '6'] }),
      'ROOM_TAG_COUNT',
    )
  })

  test('accepts a tag at its boundary and rejects a longer one', () => {
    expect(normalizeRoomInput(room({ tags: ['t'.repeat(24)] })).tags[0]).toHaveLength(
      24,
    )
    expectInputError(room({ tags: ['t'.repeat(25)] }), 'ROOM_TAG_LENGTH')
  })

  test('requires an eight visible-character password for private rooms', () => {
    expectInputError(
      room({ visibility: 'private', password: '👁️'.repeat(7) }),
      'ROOM_PASSWORD_LENGTH',
    )
    expect(
      normalizeRoomInput(
        room({ visibility: 'private', password: '👁️'.repeat(8) }),
      ),
    ).toMatchObject({
      visibility: 'private',
      password: '👁️'.repeat(8),
    })
  })

  test('allows duplicate room names by parsing the same name twice', () => {
    expect(normalizeRoomInput(room({ name: 'Same name' })).name).toBe('Same name')
    expect(normalizeRoomInput(room({ name: 'Same name' })).name).toBe('Same name')
  })

  test('normalizes arbitrary valid metadata with native NFKC trimming', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('a', 'Ｂ', 'ℌ', '💀', 'e\u0301'), {
          minLength: 3,
          maxLength: 80,
        }),
        (characters) => {
          const name = `  ${characters.join('')}  `
          expect(normalizeRoomInput(room({ name })).name).toBe(
            name.normalize('NFKC').trim(),
          )
        },
      ),
    )
  })

  test('enforces arbitrary visible-character name lengths', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (length) => {
        const name = '💀'.repeat(length)
        if (length >= 3 && length <= 80) {
          expect(normalizeRoomInput(room({ name })).name).toBe(name)
        } else {
          expectInputError(room({ name }), 'ROOM_NAME_LENGTH')
        }
      }),
    )
  })

  test('enforces arbitrary distinct tag counts after normalization', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (count) => {
        const tags = Array.from({ length: count }, (_, index) => `tag-${index}`)
        if (count <= 5) {
          expect(normalizeRoomInput(room({ tags })).tags).toHaveLength(count)
        } else {
          expectInputError(room({ tags }), 'ROOM_TAG_COUNT')
        }
      }),
    )
  })
})
