import { describe, expect, test } from 'vitest'
import { validateCreateRoomInput } from '../../src/features/home/create-room'

describe('create and admission boundary', () => {
  test('normalizes the complete public room input contract', () => {
    expect(
      validateCreateRoomInput({
        name: '  Film Night  ',
        category: '  Movies ',
        tags: [' Classic ', 'classic', '  friends '],
      }),
    ).toEqual({
      name: 'Film Night',
      category: 'Movies',
      tags: ['Classic', 'classic', 'friends'],
      visibility: 'public',
    })
  })

  test('rejects invalid room input at the boundary', () => {
    expect(() => validateCreateRoomInput({ name: 'no' })).toThrow('ROOM_NAME_LENGTH')
    expect(() =>
      validateCreateRoomInput({ name: 'valid', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    ).toThrow('ROOM_TAG_COUNT')
  })

})
