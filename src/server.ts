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
import { bindRoomService } from './features/home/create-room'
import { bindPreferenceRuntime } from './server/profile/preference-service'
import { bindChatMuteRuntime } from './server/profile/chat-mute-service'
import { bindReportRuntime } from './server/moderation/report-service'
import { homePresence } from './server/home/home-presence'
import {
  createHomeEventHub,
  HOME_ACCOUNT_REVOKED_EVENT,
  HOME_SOCKET_EVENT,
  type HomeEventPublisher,
  type HomeEventHub,
  type HomeRealtimeEvent,
} from './server/realtime/home-events'
import { RoomService } from './server/rooms/room-service'
import { StreamService } from './server/streams/stream-service'
import { SubscriptionService } from './server/streams/subscription-service'
import { ChatService } from './server/rooms/chat-service'
import { bindRoomRealtimeRuntime, roomRealtime } from './server/rooms/room-runtime'
import {
  createRoomEventHub,
  ROOM_JOIN_COMMAND,
  ROOM_LEAVE_COMMAND,
  ROOM_SIGNAL_COMMAND,
  ROOM_SOCKET_EVENT,
  ROOM_TYPING_COMMAND,
  normalizeSignalPayload,
  type RoomEventHub,
  type RoomRealtimeEvent,
} from './server/realtime/room-events'
import { ConnectionRegistry, type RegisteredConnection } from './server/realtime/connection-registry'
import { bindDeletionRuntime } from './server/profile/deletion-service'
import type { ServerRuntime } from './server/runtime'
export { createServerRuntime } from './server/runtime'
export {
  parseTrustedProxyIps,
  resolveTrustedClientIp,
} from './server/auth/session'
const roomServicesByServer = new WeakMap<HttpServer, RoomService>()
const homeEventHubs = new WeakMap<HttpServer, HomeEventHub>()
const roomEventHubs = new WeakMap<HttpServer, RoomEventHub>()

export function bindServerRuntime(runtime: ServerRuntime, server: HttpServer) {
  const pool = runtime.getDatabasePool()
  if (pool) configuredAuthOrigin(process.env)
  bindAuthRuntime({ pool })
  bindHomeRuntime({ pool })
  bindPreferenceRuntime({ pool })
  const valkey = runtime.getValkey()
  const roomService =
    pool && valkey
      ? new RoomService({
          pool,
          valkey,
          valkeyPrefix: `${runtime.bindings.valkeyPrefix}room:`,
          publishHomeEvent: (event) => publishHomeEvent(server, event),
          publishRoomEvent: (event) => publishRoomEvent(server, event),
          now: () => new Date(runtime.clock.now()),
          revokeConnections: () => undefined,
          clock: runtime.clock,
        })
      : undefined
  if (roomService) bindRoomService(roomService)
  if (roomService) roomServicesByServer.set(server, roomService)
  bindDeletionRuntime({
    pool,
    roomService,
  })
  bindChatMuteRuntime({ pool })
  bindReportRuntime({ pool })
  if (pool) {
    const now = () => new Date(runtime.clock.now())
    bindRoomRealtimeRuntime({
      streams: new StreamService({
        pool,
        now,
        onRoomChanged: (roomId) => roomService?.publishRoomMembership(roomId),
      }),
      subscriptions: new SubscriptionService(pool, now, (event) =>
        publishHomeEvent(server, event),
      ),
      chat: new ChatService({ pool, now }),
      publish: (event) => publishRoomEvent(server, event),
    })
  }
}

export function publishRoomEvent(server: HttpServer, event: RoomRealtimeEvent) {
  roomEventHubs.get(server)?.publish(event)
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
  const roomHub = createRoomEventHub()
  roomEventHubs.set(server, roomHub)
  const connectionRegistry = new ConnectionRegistry()
  const terminalConnections = new WeakSet<RegisteredConnection>()
  const claimsByAccount = new Map<string, { readonly socket: SocketConnection; readonly generation: number }>()
  const generationsByAccount = new Map<string, number>()
  const roomService = roomServicesByServer.get(server)
  const accountOperations = new Map<string, Promise<unknown>>()
  const runAccountOperation = <T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const prior = accountOperations.get(accountId) ?? Promise.resolve()
    const next = prior.catch(() => undefined).then(operation)
    let tracked!: Promise<unknown>
    tracked = next.then(
      () => {
        if (accountOperations.get(accountId) === tracked) accountOperations.delete(accountId)
      },
      () => {
        if (accountOperations.get(accountId) === tracked) accountOperations.delete(accountId)
      },
    )
    accountOperations.set(accountId, tracked)
    return next
  }
  homeEventHubs.set(server, eventHub)
  bindDeletionRuntime({
    revokeConnections: (accountId) => {
      for (const socket of sockets.sockets.sockets.values()) {
        if (socket.data.accountId === accountId) {
          const connection = socket as unknown as RegisteredConnection
          terminalConnections.add(connection)
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
        if (value !== undefined) {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
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
    if (typeof accountId !== 'string') {
      socket.disconnect(true)
      return
    }
    const connection = socket as unknown as RegisteredConnection
    let activated = false
    let handledDisconnect = false
    let unsubscribe: () => void = () => {}
    const removePresence = () => {
      if (handledDisconnect) return
      handledDisconnect = true
      void runAccountOperation(accountId, async () => {
        if (claimsByAccount.get(accountId)?.socket === socket) {
          claimsByAccount.delete(accountId)
        }
        connectionRegistry.remove(accountId, connection)
        if (!activated) return
        unsubscribe()
        homePresence.remove(accountId, socket.id)
        eventHub.publish({
          type: 'presence',
          connectedAccountCount: homePresence.count(),
        })
        if (!terminalConnections.has(connection)) {
          await roomService?.handleUnexpectedDisconnect(accountId)
        }
        terminalConnections.delete(connection)
      }).catch(() => undefined)
    }
    socket.on('disconnect', removePresence)

    // Room realtime. ADR 0104 authorizes every client-initiated command
    // against the account's own admitted membership, so nothing here trusts a
    // client-supplied membership or peer identifier.
    let leaveRoomChannel: () => void = () => {}
    let roomMembership: {
      readonly roomId: string
      readonly membershipId: string
      readonly displayName: string
    } | null = null
    const detachRoom = () => {
      leaveRoomChannel()
      leaveRoomChannel = () => {}
      roomMembership = null
    }
    socket.on('disconnect', detachRoom)

    socket.on(ROOM_JOIN_COMMAND, async (value: unknown, ack?: (result: unknown) => void) => {
      const roomId = typeof value === 'string' ? value : null
      if (!roomId || !roomService) return ack?.({ status: 'rejected' })
      const projection = await roomService.inspectRouteProjection(roomId, accountId)
      if (projection?.kind !== 'admitted') return ack?.({ status: 'rejected' })
      const self = projection.room.roster.find(
        (member) => member.membershipId === projection.self.id,
      )
      detachRoom()
      roomMembership = {
        roomId: projection.room.id,
        membershipId: projection.self.id,
        displayName: self?.displayName ?? '',
      }
      // Mutes are read once per join: a mute takes effect for messages that
      // arrive after it, and rejoining is what re-reads the list (ADR 0102).
      const muted = new Set((await roomRealtime().chat?.mutedAccountIds(accountId).catch(() => [])) ?? [])
      leaveRoomChannel = roomHub.subscribe(projection.room.id, (event) => {
        if ('accountId' in event && muted.has(event.accountId)) return
        if (event.type === 'chat-message' && muted.has(event.message.accountId)) return
        socket.emit(ROOM_SOCKET_EVENT, event)
      })
      ack?.({ status: 'joined', membershipId: projection.self.id })
    })

    socket.on(ROOM_LEAVE_COMMAND, (_value: unknown, ack?: (result: unknown) => void) => {
      detachRoom()
      ack?.({ status: 'left' })
    })

    socket.on(ROOM_TYPING_COMMAND, (value: unknown, ack?: (result: unknown) => void) => {
      const current = roomMembership
      if (!current) return ack?.({ status: 'rejected' })
      roomHub.publish({
        type: 'typing',
        roomId: current.roomId,
        membershipId: current.membershipId,
        accountId,
        displayName: current.displayName,
        typing: value === true,
      })
      ack?.({ status: 'accepted' })
    })

    socket.on(ROOM_SIGNAL_COMMAND, async (value: unknown, ack?: (result: unknown) => void) => {
      const current = roomMembership
      const command = value as { subscriptionId?: unknown; signal?: unknown } | null
      const subscriptionId =
        command && typeof command.subscriptionId === 'string' ? command.subscriptionId : null
      const signal = normalizeSignalPayload(command?.signal)
      if (!current || !subscriptionId || !signal) return ack?.({ status: 'rejected' })
      const parties = await roomRealtime().subscriptions?.parties(subscriptionId)
      if (!parties || parties.roomId !== current.roomId) return ack?.({ status: 'rejected' })
      const recipient =
        parties.viewerAccountId === accountId
          ? parties.publisherAccountId
          : parties.publisherAccountId === accountId
            ? parties.viewerAccountId
            : null
      if (!recipient) return ack?.({ status: 'rejected' })
      claimsByAccount.get(recipient)?.socket.emit(ROOM_SOCKET_EVENT, {
        type: 'signal',
        roomId: parties.roomId,
        streamId: parties.streamId,
        subscriptionId,
        signal,
      })
      ack?.({ status: 'relayed' })
    })
    void runAccountOperation(accountId, async () => {
      const generation = (generationsByAccount.get(accountId) ?? 0) + 1
      generationsByAccount.set(accountId, generation)
      claimsByAccount.set(accountId, { socket, generation })
      const claim = claimsByAccount.get(accountId)
      if (!socket.connected || !claim || claim.socket !== socket || claim.generation !== generation) {
        socket.disconnect(true)
        return
      }
      let displacedRoomId: string | undefined
      const previous = connectionRegistry.current(accountId)
      if (previous && previous !== connection) {
        terminalConnections.add(previous)
        try {
          const previousSocket = previous as unknown as SocketConnection
          const departure =
            previousSocket.connected === false
              ? await roomService?.handleUnexpectedDisconnect(accountId)
              : await roomService?.terminalDeparture(accountId, 'displacement')
          if (departure && 'roomId' in departure) displacedRoomId = departure.roomId
        } catch (error) {
          terminalConnections.delete(previous)
          throw error
        }
      }
      try {
        connectionRegistry.register(accountId, connection)
      } catch (error) {
        if (previous) terminalConnections.delete(previous)
        throw error
      }
      const currentClaim = claimsByAccount.get(accountId)
      if (!currentClaim || currentClaim.socket !== socket || currentClaim.generation !== generation) {
        socket.disconnect(true)
        return
      }
      activated = true
      homePresence.add(accountId, socket.id)
      unsubscribe = eventHub.subscribe((event) => socket.emit(HOME_SOCKET_EVENT, event))
      if (displacedRoomId) {
        socket.emit(HOME_SOCKET_EVENT, {
          type: 'room-discovery',
          roomId: displacedRoomId,
        })
      }
      await roomService?.reclaimMembership(accountId)
      eventHub.publish({
        type: 'presence',
        connectedAccountCount: homePresence.count(),
      })
    }).catch(() => socket.disconnect(true))
  })
  return sockets
}

export default createServerEntry({
  async fetch(request) {
    const authResponse = await handleAuthenticationRequest(request)
    return authResponse ?? handler.fetch(request)
  },
})
