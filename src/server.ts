import type { Server as HttpServer } from 'node:http'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { Server as SocketServer } from 'socket.io'
export { createServerRuntime } from './server/runtime'

const attachedSockets = new WeakMap<HttpServer, SocketServer>()

export function attachSocketServer(server: HttpServer) {
  const existing = attachedSockets.get(server)
  if (existing) return existing

  const sockets = new SocketServer(server, {
    path: '/socket.io/',
    serveClient: false,
  })
  attachedSockets.set(server, sockets)
  return sockets
}

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
