import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('home route source', () => {
  test('renders design discovery sections', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('Active Rooms')
    expect(source).toContain('Live Now')
    expect(source).toContain('Past Streams')
  })

  test('hides past streams when none exist', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('filteredPastRooms.length ?')
  })

  test('renders dense discovery card metadata', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('AvatarStack')
    expect(source).toContain('Streamer')
    expect(source).toContain('Streaming')
  })

  test('renders discovery sidebar data panels', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('Global Stats')
    expect(source).toContain('Trending Now')
    expect(source).toContain('Community')
  })

  test('renders a playful empty-room state', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('No rooms are haunting the hallway yet')
  })

  test('renders create room as design modal flow', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('DialogContent')
    expect(source).toContain('start a hang')
    expect(source).toContain('What kind of room')
  })

  test('uses one create-room close control', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('showCloseButton={false}')
  })

  test('opens create modal from sidebar request event', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('bhayanakcast:create-room')
    expect(source).toContain('setCreateOpen(true)')
  })

  test('uses private-room password modal instead inline URL password join', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('private room')
    expect(source).toContain('privateJoinPassword')
    expect(source).toContain('sessionStorage.setItem')
    expect(source).not.toContain('search:')
  })

  test('shows sign-in actions including the kept dev user', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('signInDiscord')
    expect(source).toContain('signInDevUser')
    expect(source).toContain('Continue as Dev User')
    expect(source).toContain('Continue with Discord')
  })

  test('hides Discord sign-in action for signed-in users', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('authClient.useSession()')
    expect(source).toContain('!session.data?.user ?')
  })
})
