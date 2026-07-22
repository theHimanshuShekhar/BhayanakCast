import type { Pool } from 'pg'
import type { Server as HttpServer } from 'node:http'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { Server as SocketServer } from 'socket.io'
import {
  bindAuthRuntime,
  configuredAuthOrigin,
  getProductionAuth,
  readSessionProjection,
} from './server/auth/auth'
import { handleAuthenticationRequest } from './server/auth/handler'
import { parseAdminDiscordIds } from './server/auth/session'
import { readAccountAccessPolicy } from './server/auth/account-access-policy'
import { bindHomeRuntime } from './server/home/home-functions'
import { bindPreferenceRuntime } from './server/profile/preference-service'
import { bindChatMuteRuntime } from './server/profile/chat-mute-service'
import { homePresence } from './server/home/home-presence'
import { RoomService } from './server/rooms/room-service'
import { bindDeletionRuntime } from './server/profile/deletion-service'
import type { ServerRuntime } from './server/runtime'
export { createServerRuntime } from './server/runtime'
export {
  parseTrustedProxyIps,
  resolveTrustedClientIp,
} from './server/auth/session'
let boundDatabasePool: Pool | undefined

export function bindServerRuntime(runtime: ServerRuntime) {
  const pool = runtime.getDatabasePool()
  if (pool) configuredAuthOrigin(process.env)
  boundDatabasePool = pool
  bindAuthRuntime({ pool })
  bindHomeRuntime({ pool })
  bindPreferenceRuntime({ pool })
  const valkey = runtime.getValkey()
  bindDeletionRuntime({
    pool,
    roomService:
      pool && valkey
        ? new RoomService({
            pool,
            valkey,
            valkeyPrefix: `${runtime.bindings.valkeyPrefix}room:`,
            now: () => new Date(runtime.clock.now()),
            revokeConnections: () => undefined,
          })
        : undefined,
  })
  bindChatMuteRuntime({ pool })
}

const attachedSockets = new WeakMap<HttpServer, SocketServer>()

export function attachSocketServer(server: HttpServer) {
  const existing = attachedSockets.get(server)
  if (existing) return existing

  const sockets = new SocketServer(server, {
    path: '/socket.io/',
    serveClient: false,
  })
  bindDeletionRuntime({
    revokeConnections: (accountId) => {
      for (const socket of sockets.sockets.sockets.values()) {
        if (socket.data.accountId === accountId) socket.disconnect(true)
      }
    },
  })
  attachedSockets.set(server, sockets)

  sockets.use(async (socket, next) => {
    try {
      const headers = new Headers()
      for (const [name, value] of Object.entries(socket.handshake.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      const session = await readSessionProjection(getProductionAuth(), headers)
      if (!session) return next(new Error('Authentication required'))
      socket.data.accountId = session.id
      if (boundDatabasePool) {
        const policy = await readAccountAccessPolicy(boundDatabasePool, session.id)
        if (policy?.state === 'pending' || policy?.state === 'approved') {
          return next(new Error('Account access restricted'))
        }
      }
      return next()
    } catch {
      return next(new Error('Authentication required'))
    }
  })
  sockets.on('connection', async (socket) => {
    const accountId = socket.data.accountId
    if (typeof accountId !== 'string') return socket.disconnect(true)
    const removePresence = () => homePresence.remove(accountId, socket.id)
    socket.on('disconnect', removePresence)
    try {
      if (boundDatabasePool) {
        const policy = await readAccountAccessPolicy(boundDatabasePool, accountId)
        if (!policy || policy.state !== 'active') {
          socket.disconnect(true)
          return
        }
      }
      if (!socket.connected) return
      homePresence.add(accountId, socket.id)
    } catch {
      socket.disconnect(true)
    }
  })
  return sockets
}

export default createServerEntry({
  async fetch(request) {
    const authResponse = await handleAuthenticationRequest(request)
    return authResponse ?? handler.fetch(request)
  },
})
