import { expect, test } from 'vitest'
import { avatarFallbackLabel } from '../../src/features/avatar-fallback'

test('keeps an uppercased avatar fallback to at most two characters', () => {
  expect(avatarFallbackLabel('ßara')).toBe('SS')
})
