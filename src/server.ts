import type { Pool } from 'pg'
import type { Server as HttpServer } from 'node:http'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { Server as SocketServer, type Socket as SocketConnection } from 'socket.io'
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
import {
  createHomeEventHub,
  HOME_ACCOUNT_REPLACED_EVENT,
  HOME_ACCOUNT_REVOKED_EVENT,
  HOME_SOCKET_EVENT,
  type HomeEventPublisher,
  type HomeEventHub,
  type HomeRealtimeEvent,
} from './server/realtime/home-events'
import { RoomService } from './server/rooms/room-service'
import { bindDeletionRuntime } from './server/profile/deletion-service'
import type { ServerRuntime } from './server/runtime'
export { createServerRuntime } from './server/runtime'
export {
  parseTrustedProxyIps,
  resolveTrustedClientIp,
} from './server/auth/session'
const homeEventHubs = new WeakMap<HttpServer, HomeEventHub>()

export function bindServerRuntime(runtime: ServerRuntime, server: HttpServer) {
  const pool = runtime.getDatabasePool()
  if (pool) configuredAuthOrigin(process.env)
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
            publishHomeEvent: (event) => publishHomeEvent(server, event),
            now: () => new Date(runtime.clock.now()),
            revokeConnections: () => undefined,
          })
        : undefined,
  })
  bindChatMuteRuntime({ pool })
}

export function publishHomeEvent(server: HttpServer, event: HomeRealtimeEvent) {
  homeEventHubs.get(server)?.publish(event)
}

const attachedSockets = new WeakMap<HttpServer, SocketServer>()

export function attachSocketServer(server: HttpServer, databasePool?: Pool) {
  const existing = attachedSockets.get(server)
  if (existing) return existing

  const sockets = new SocketServer(server, {
    path: '/socket.io/',
    serveClient: false,
  })
  const eventHub = createHomeEventHub()
  const socketsByAccount = new Map<string, SocketConnection>()
  const claimsByAccount = new Map<string, { readonly socket: SocketConnection; readonly generation: number }>()
  const generationsByAccount = new Map<string, number>()
  homeEventHubs.set(server, eventHub)
  bindDeletionRuntime({
    revokeConnections: (accountId) => {
      for (const socket of sockets.sockets.sockets.values()) {
        if (socket.data.accountId === accountId) {
          socket.emit(HOME_ACCOUNT_REVOKED_EVENT)
          socket.disconnect(true)
        }
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
      if (databasePool) {
        const policy = await readAccountAccessPolicy(databasePool, session.id)
        if (policy?.state === 'pending' || policy?.state === 'approved') {
          return next(new Error('Account access restricted'))
        }
      }
      return next()
    } catch {
      return next(new Error('Authentication required'))
    }
  })
  sockets.on('connection', (socket) => {
    const accountId = socket.data.accountId
    if (typeof accountId !== 'string') return socket.disconnect(true)
    const generation = (generationsByAccount.get(accountId) ?? 0) + 1
    generationsByAccount.set(accountId, generation)
    claimsByAccount.set(accountId, { socket, generation })
    let activated = false
    let unsubscribe: () => void = () => {}
    const removePresence = () => {
      if (claimsByAccount.get(accountId)?.socket === socket) {
        claimsByAccount.delete(accountId)
      }
      if (socketsByAccount.get(accountId) === socket) socketsByAccount.delete(accountId)
      unsubscribe()
      if (!activated) return
      homePresence.remove(accountId, socket.id)
      eventHub.publish({
        type: 'presence',
        connectedAccountCount: homePresence.count(),
      })
    }
    socket.on('disconnect', removePresence)
    try {
      const claim = claimsByAccount.get(accountId)
      if (
        !socket.connected ||
        !claim ||
        claim.socket !== socket ||
        claim.generation !== generation
      ) {
        socket.disconnect(true)
        return
      }
      const previous = socketsByAccount.get(accountId)
      socketsByAccount.set(accountId, socket)
      homePresence.add(accountId, socket.id)
      activated = true
      unsubscribe = eventHub.subscribe((event) => socket.emit(HOME_SOCKET_EVENT, event))
      if (previous && previous !== socket) {
        previous.emit(HOME_ACCOUNT_REPLACED_EVENT)
        previous.disconnect(true)
      }
      eventHub.publish({
        type: 'presence',
        connectedAccountCount: homePresence.count(),
      })
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
