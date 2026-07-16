import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { canonicalHomeSearch, parseHomeSearch } from '../../src/features/home/home-search'
import { operatorDay } from '../../src/features/home/operator-day'
import { getRouter, retryableHomeError } from '../../src/router'

describe('Home search URL values', () => {
  test('normalizes Unicode, omits empty values, and sorts unique tags', () => {
    expect(
      parseHomeSearch({
        q: '  cafe\u0301  ',
        category: '   ',
        tags: ['  sci-fi ', 'ＳＦ', 'sci-fi', '', 7],
      }),
    ).toEqual({ q: 'café', tags: ['SF', 'sci-fi'] })
  })

  test('discards malformed values', () => {
    expect(parseHomeSearch({ q: 7, category: ['film'], tags: { nope: true } })).toEqual({})
  })

  test('bounds canonical public search values before cache keys and ranking', () => {
    expect(
      parseHomeSearch({
        q: 'q'.repeat(81),
        category: 'c'.repeat(33),
        tags: [
          'z'.repeat(25),
          'six',
          'five',
          'four',
          'three',
          'two',
          'one',
        ],
      }),
    ).toEqual({ tags: ['five', 'four', 'one', 'six', 'three'] })
  })

  test('is idempotent for every canonicalized value', () => {
    const canonical = parseHomeSearch({
      q: '  Films ',
      category: ' Drama ',
      tags: [' Mystery ', 'Drama', 'Mystery'],
    })

    expect(canonicalHomeSearch(canonical)).toEqual(canonical)
  })

  test('canonicalizes arbitrary URL-shaped values idempotently', () => {
    fc.assert(
      fc.property(
        fc.record({
          q: fc.oneof(fc.string(), fc.integer(), fc.array(fc.string())),
          category: fc.oneof(fc.string(), fc.integer(), fc.array(fc.string())),
          tags: fc.oneof(fc.string(), fc.integer(), fc.array(fc.oneof(fc.string(), fc.integer()))),
        }),
        (input) => {
          const canonical = parseHomeSearch(input)
          expect(parseHomeSearch(canonical)).toEqual(canonical)
          expect(canonical.tags).toEqual(
            canonical.tags && [...canonical.tags].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
          )
        },
      ),
    )
  })
  test('creates an isolated QueryClient for each router request', () => {
    const first = getRouter()
    const second = getRouter()
    const firstClient = first.options.context.queryClient
    const secondClient = second.options.context.queryClient

    firstClient.setQueryData(['home', 'isolation'], 'first')
    expect(secondClient.getQueryData(['home', 'isolation'])).toBeUndefined()
  })

  test('retries server-function failures but not deterministic client errors', () => {
    expect(retryableHomeError(new Error('server function failed'))).toBe(true)
    expect(retryableHomeError({ status: 503 })).toBe(true)
    expect(retryableHomeError({ status: 400 })).toBe(false)
    expect(retryableHomeError({ message: 'not an Error' })).toBe(false)
  })

  test('derives the cache day in the configured operator timezone', () => {
    const instant = new Date('2026-07-14T20:30:00.000Z')
    expect(operatorDay(instant, 'UTC')).toBe('2026-07-14')
    expect(operatorDay(instant, 'Asia/Kolkata')).toBe('2026-07-15')
  })
})