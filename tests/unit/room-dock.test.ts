import { describe, expect, it } from 'vitest'
import { atBottom } from '../../src/features/room/RoomCompanionDock'

/** ADR 0102: a viewer reading older Activity is never scrolled away from it —
    new entries raise a `New activity` cue instead. */
describe('activity scroll position', () => {
  const panel = (scrollTop: number) => ({ scrollTop, clientHeight: 300, scrollHeight: 1_000 })

  it('treats the end of the list as reading the latest', () => {
    expect(atBottom(panel(700))).toBe(true)
  })

  it('tolerates the last line without raising a cue', () => {
    expect(atBottom(panel(680))).toBe(true)
  })

  it('treats a scrolled-up reader as needing the cue', () => {
    expect(atBottom(panel(0))).toBe(false)
    expect(atBottom(panel(500))).toBe(false)
  })

  it('reads an unmounted panel as caught up', () => {
    expect(atBottom(null)).toBe(true)
  })
})
