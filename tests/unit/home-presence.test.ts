import { describe, expect, test } from 'vitest'
import { HomePresence } from '../../src/server/home/home-presence'

describe('anonymous Home connection presence', () => {
  test('counts one visitor once across tabs and blends them with Accounts', () => {
    const presence = new HomePresence()
    presence.add('account-a', 'socket-1')
    presence.addVisitor('visitor-a', 'socket-2')
    presence.addVisitor('visitor-a', 'socket-3')
    presence.addVisitor('visitor-b', 'socket-4')
    expect(presence.count()).toBe(3)

    presence.removeVisitor('visitor-a', 'socket-2')
    expect(presence.count()).toBe(3)
    presence.removeVisitor('visitor-a', 'socket-3')
    expect(presence.count()).toBe(2)
  })

  test('keeps Account and visitor identifiers in separate namespaces', () => {
    const presence = new HomePresence()
    presence.add('shared-id', 'socket-1')
    presence.addVisitor('shared-id', 'socket-2')
    expect(presence.count()).toBe(2)

    presence.removeVisitor('shared-id', 'socket-2')
    expect(presence.count()).toBe(1)
  })

  test('carries anonymous visitors into the operator-day peak', () => {
    const presence = new HomePresence()
    const instant = new Date('2026-07-14T10:00:00.000Z')
    presence.add('account-a', 'socket-1', instant)
    presence.addVisitor('visitor-a', 'socket-2', instant)
    presence.removeVisitor('visitor-a', 'socket-2', instant)

    expect(presence.count()).toBe(1)
    expect(presence.peak('2026-07-14', instant)).toBe(2)
  })
})

describe('authenticated Home connection presence', () => {
  test('counts duplicate sockets for one Account once and removes only final disconnect', () => {
    const presence = new HomePresence()
    presence.add('account-a', 'socket-1')
    presence.add('account-a', 'socket-2')
    presence.add('account-b', 'socket-3')
    expect(presence.count()).toBe(2)

    presence.remove('account-a', 'socket-1')
    expect(presence.count()).toBe(2)
    presence.remove('account-a', 'socket-2')
    expect(presence.count()).toBe(1)
  })

  test('retains the operator-day peak after connections close', () => {
    const presence = new HomePresence()
    const instant = new Date('2026-07-14T10:00:00.000Z')
    presence.add('account-a', 'socket-1', instant)
    presence.add('account-b', 'socket-2', instant)
    presence.remove('account-b', 'socket-2')

    expect(presence.count()).toBe(1)
    expect(presence.peak('2026-07-14', instant)).toBe(2)
    const nextDay = new Date('2026-07-15T10:00:00.000Z')
    presence.add('account-c', 'socket-3', nextDay)
    presence.add('account-d', 'socket-4', nextDay)
    expect(presence.peak('2026-07-15', nextDay)).toBe(3)
    expect(presence.peak('2026-07-14', nextDay)).toBe(2)
  })

  test('records the new operator-day peak before the first disconnect', () => {
    const presence = new HomePresence()
    const firstDay = new Date('2026-07-14T10:00:00.000Z')
    const nextDay = new Date('2026-07-15T10:00:00.000Z')
    presence.add('account-a', 'socket-1', firstDay)
    presence.add('account-b', 'socket-2', firstDay)

    presence.remove('account-b', 'socket-2', nextDay)

    expect(presence.peak('2026-07-15', nextDay)).toBe(2)
  })
})
