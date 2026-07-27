import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { selectNextHost, type HostCandidate } from '../../src/server/rooms/host-policy'

const candidate = (id: string, joinedAt: number): HostCandidate => ({
  id,
  joinedAt: new Date(joinedAt),
})

describe('host succession policy', () => {
  test('selects the earliest continuously present remaining member', () => {
    expect(
      selectNextHost([
        candidate('later', 20),
        candidate('earlier', 10),
        candidate('middle', 15),
      ]),
    ).toEqual('earlier')
  })

  test('uses membership id as a deterministic tie-breaker', () => {
    expect(
      selectNextHost([candidate('z', 10), candidate('a', 10)]),
    ).toEqual('a')
  })

  test('returns no successor when the room has no remaining members', () => {
    expect(selectNextHost([])).toBeNull()
  })

  test('is permutation-invariant for arbitrary member orderings', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            joinedAt: fc.integer({ min: 0, max: 100_000 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (members) => {
          const unique = [...new Map(members.map((member) => [member.id, member])).values()]
          const expected = [...unique].sort(
            (left, right) =>
              left.joinedAt - right.joinedAt || left.id.localeCompare(right.id),
          )[0]?.id ?? null
          expect(
            selectNextHost(
              unique.map((member) => candidate(member.id, member.joinedAt)),
            ),
          ).toBe(expected)
        },
      ),
    )
  })
})
