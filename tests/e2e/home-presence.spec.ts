import { io } from 'socket.io-client'
import { expect, test } from './fixtures'

function connection(origin: string, cookie?: string, visitorId?: string) {
  const socket = io(origin, {
    path: '/socket.io/',
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
    extraHeaders: cookie ? { cookie } : undefined,
    ...(visitorId ? { auth: { visitorId } } : {}),
  })
  const connected = Promise.withResolvers<void>()
  const rejected = Promise.withResolvers<Error>()
  socket.once('connect', connected.resolve)
  socket.once('connect_error', rejected.resolve)
  socket.connect()
  return { socket, connected: connected.promise, rejected: rejected.promise }
}

// ADR 0108: an anonymous visitor is part of the Home count, so the socket that
// carries the count is open to them too.
test('admits anonymous sockets and accepts duplicate authenticated tabs', async ({ authSessions }) => {
  const anonymous = connection(authSessions.origin, undefined, 'e2e-presence-visitor')
  await expect(anonymous.connected).resolves.toBeUndefined()
  anonymous.socket.disconnect()

  const signedIn = await authSessions.createBrowserContext({
    id: '102938475610293847', username: 'presence', global_name: 'Presence member', avatar: 'presence-avatar', email: 'presence@example.test', verified: true,
  })
  const first = connection(authSessions.origin, signedIn.sessionCookie)
  const second = connection(authSessions.origin, signedIn.sessionCookie)
  await Promise.all([first.connected, second.connected])
  expect(first.socket.id).not.toBe(second.socket.id)
  first.socket.disconnect()
  second.socket.disconnect()
})
