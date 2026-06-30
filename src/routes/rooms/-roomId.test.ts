import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('room route source', () => {
  test('loads private room password outside query params', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('sessionStorage.getItem')
    expect(source).not.toContain('validateSearch')
    expect(source).not.toContain('search.password')
  })

  test('requires an authenticated loader state before rendering room stream UI', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('!room.authenticated')
    expect(source).toContain('AuthRequiredState')
    expect(source).toContain('loadRoomSummary')
  })

  test('renders chat people feed side tabs', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain("'chat' | 'people' | 'feed'")
    expect(source).toContain('say something...')
    expect(source).toContain('room activity appears here')
  })

  test('renders product room summary header fields', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('loadRoomSummary')
    expect(source).toContain('/10 members')
    expect(source).toContain('live')
  })

  test('does not duplicate stream controls in a second bottom dock', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('room-bottom-dock')
    expect(source).not.toContain('# room info')
  })

  test('does not render chat status below the input', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('{status}</div>')
  })


  test('leaves the room through socket protocol', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain("socket.emit('room:leave'")
    expect(source).toContain('Leave room')
  })

  test('runs media cleanup before leaving an admitted room', () => {
    const routeSource = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )
    const panelSource = readFileSync(
      new URL('../../components/room-stream-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(routeSource).toContain('mediaCleanupRef')
    expect(routeSource).toContain('await mediaCleanupRef.current?.()')
    expect(routeSource).toContain("socket.emit('room:leave'")
    expect(panelSource).toContain('onMediaCleanupReady')
    expect(panelSource).toContain('stopRoomMedia')
    expect(panelSource).toContain('void stopSharing().catch')
    expect(panelSource).toContain('void stopWatching().catch')
  })

  test('maps room protocol codes to actionable user copy', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('roomStatusCopy')
    expect(source).toContain('That password did not open the room')
    expect(source).toContain('This room is already active in another tab or device')
    expect(source).not.toContain('setStatus(ack.code')
    expect(source).not.toContain("setStatus(nextState.status === 'joined' ? 'Ready' : 'Room admission failed')")
  })

  test('owns live room socket state for members chat and feed', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain("socket.on('member:joined'")
    expect(source).toContain("socket.on('member:left'")
    expect(source).toContain("socket.on('chat:message'")
    expect(source).toContain("socket.on('stream:started'")
    expect(source).toContain("socket.on('stream:stopped'")
    expect(source).toContain("socket.emit('chat:send'")
    expect(source).toContain('setFeedItems')
  })

  test('normalizes raw join snapshots before reading user names', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('normalizeMember')
    expect(source).toContain('normalizeStream')
    expect(source).toContain('userId')
  })


  test('gates live room UI behind authoritative join state', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('RoomJoinState')
    expect(source).toContain("status: 'joined'")
    expect(source).toContain('AdmissionGate')
    expect(source).toContain("joinState.status !== 'joined'")
    expect(source).toContain('<LiveRoomShell')
  })

  test('renders distinct admission blockers for server join outcomes', () => {
    const source = readFileSync(
      new URL('./$roomId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('PrivatePasswordGate')
    expect(source).toContain('DuplicateClientGate')
    expect(source).toContain('RoomFullGate')
    expect(source).toContain('RoomBannedGate')
    expect(source).toContain('RoomEndedGate')
    expect(source).toContain('ConnectionFailedGate')
    expect(source).toContain('ProtocolErrorGate')
  })

})
