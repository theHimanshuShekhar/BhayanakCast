import { describe, expect, test } from 'vitest'
import { CHAT_BODY_LIMIT, normalizeChatBody } from '../../src/server/rooms/chat-service'

describe('normalizeChatBody', () => {
  test('keeps deliberate line breaks but collapses blank runs', () => {
    expect(normalizeChatBody('one\n\n\n\ntwo')).toBe('one\n\ntwo')
    expect(normalizeChatBody('one\r\ntwo')).toBe('one\ntwo')
  })

  test('trims surrounding whitespace so a blank message stays empty', () => {
    expect(normalizeChatBody('   \n\t ')).toBe('')
  })

  test('does not shorten a message inside the composer limit', () => {
    const body = 'a'.repeat(CHAT_BODY_LIMIT)
    expect(normalizeChatBody(body)).toHaveLength(CHAT_BODY_LIMIT)
  })
})
