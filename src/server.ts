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
import { bindHomeRuntime } from './server/home/home-functions'
import { homePresence } from './server/home/home-presence'
import type { ServerRuntime } from './server/runtime'
export { createServerRuntime } from './server/runtime'
export {
  parseTrustedProxyIps,
  resolveTrustedClientIp,
} from './server/auth/session'

export function bindServerRuntime(runtime: ServerRuntime) {
  const pool = runtime.getDatabasePool()
  if (pool) configuredAuthOrigin(process.env)
  parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS)
  bindAuthRuntime({ pool })
  bindHomeRuntime({ pool })
}

const attachedSockets = new WeakMap<HttpServer, SocketServer>()

export function attachSocketServer(server: HttpServer) {
  const existing = attachedSockets.get(server)
  if (existing) return existing

  const sockets = new SocketServer(server, {
    path: '/socket.io/',
    serveClient: false,
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
      return next()
    } catch {
      return next(new Error('Authentication required'))
    }
  })
  sockets.on('connection', (socket) => {
    const accountId = socket.data.accountId
    if (typeof accountId !== 'string') return socket.disconnect(true)
    homePresence.add(accountId, socket.id)
    socket.on('disconnect', () => homePresence.remove(accountId, socket.id))
  })
  return sockets
}

export default createServerEntry({
  async fetch(request) {
    const authResponse = await handleAuthenticationRequest(request)
    return authResponse ?? handler.fetch(request)
  },
})
