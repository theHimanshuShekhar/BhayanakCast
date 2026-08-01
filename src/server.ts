import type { Pool } from 'pg'
import type { Server as HttpServer } from 'node:http'
import { createHash } from 'node:crypto'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { Server as SocketServer, type Socket as SocketConnection } from 'socket.io'
import { debounce } from '@tanstack/pacer'
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
import { bindHomeAnalytics } from './server/home/home-observability'
import { bindRoomAnalytics } from './server/rooms/room-observability'
import { bindRoomService } from './features/home/create-room'
import { bindPreferenceRuntime } from './server/profile/preference-service'
import { bindChatMuteRuntime } from './server/profile/chat-mute-service'
import { bindReportRuntime } from './server/moderation/report-service'
import { bindModerationAnalytics } from './server/moderation/moderation-observability'
import { bindSanctionRuntime } from './server/moderation/sanction-service'
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
import { PreviewService } from './server/streams/preview-service'
import {
  bindPreviewRuntime,
  handleStreamPreviewRequest,
} from './server/streams/preview-http'
import { ChatService } from './server/rooms/chat-service'
import { bindRoomRealtimeRuntime, roomRealtime } from './server/rooms/room-runtime'
import {
  createRoomEventHub,
  ROOM_CHAT_COMMAND,
  ROOM_JOIN_COMMAND,
  ROOM_LEAVE_COMMAND,
  ROOM_SIGNAL_COMMAND,
  ROOM_SOCKET_EVENT,
  ROOM_TYPING_COMMAND,
  ROOM_TYPING_TTL_MS,
  normalizeRoomChatCommand,
  normalizeSignalPayload,
  type RoomEventHub,
  type RoomRealtimeEvent,
} from './server/realtime/room-events'
import { ConnectionRegistry, type RegisteredConnection } from './server/realtime/connection-registry'
import { bindDeletionRuntime } from './server/profile/deletion-service'
import { createAccountLifecycleAnalytics } from './server/observability/account-lifecycle-analytics'
import type { ServerRuntime } from './server/runtime'
export { createServerRuntime } from './server/runtime'
export {
  parseTrustedProxyIps,
  resolveTrustedClientIp,
} from './server/auth/session'
const roomServicesByServer = new WeakMap<HttpServer, RoomService>()
const homeEventHubs = new WeakMap<HttpServer, HomeEventHub>()
const roomEventHubs = new WeakMap<HttpServer, RoomEventHub>()
const connectionRevokers = new WeakMap<
  HttpServer,
  {
    readonly account: (accountId: string) => void
    readonly room: (accountId: string, roomId: string) => void
  }
>()

export function bindServerRuntime(runtime: ServerRuntime, server: HttpServer) {
  const pool = runtime.getDatabasePool()
  if (pool) configuredAuthOrigin(process.env)
  bindAuthRuntime({ pool })
  bindHomeRuntime({ pool })
  bindHomeAnalytics(process.env)
  bindRoomAnalytics(process.env)
  bindModerationAnalytics(process.env)
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
          revokeConnections: (accountId) =>
            connectionRevokers.get(server)?.account(accountId),
          revokeRoomConnections: (accountId, roomId) =>
            connectionRevokers.get(server)?.room(accountId, roomId),
          clock: runtime.clock,
        })
      : undefined
  if (roomService) bindRoomService(roomService)
  if (roomService) roomServicesByServer.set(server, roomService)
  bindSanctionRuntime({
    pool,
    roomService,
    now: () => new Date(runtime.clock.now()),
  })
  bindDeletionRuntime({
    pool,
    roomService,
    analytics: createAccountLifecycleAnalytics(process.env),
    enforcementSecret:
      process.env.ENFORCEMENT_KEY_SECRET ?? process.env.BETTER_AUTH_SECRET,
  })
  bindChatMuteRuntime({ pool })
  bindReportRuntime({
    pool,
    readPreview: valkey
      ? (previewKey) =>
          valkey.getBuffer(`${runtime.bindings.valkeyPrefix}stream:preview:${previewKey}`)
      : undefined,
  })
  bindPreviewRuntime({
    previews:
      pool && valkey
        ? new PreviewService({
            pool,
            valkey,
            valkeyPrefix: `${runtime.bindings.valkeyPrefix}stream:`,
            now: () => new Date(runtime.clock.now()),
            onStored: (stored) => {
              // Home cards patch the new preview in place; room tiles refetch
              // the projection, which carries the freshness the footer shows.
              publishHomeEvent(server, {
                type: 'room-value',
                roomId: stored.roomId,
                preview: {
                  previewKey: stored.previewKey,
                  updatedAt: stored.updatedAt.toISOString(),
                },
              })
              publishRoomEvent(server, {
                type: 'stream-preview',
                roomId: stored.roomId,
                streamId: stored.streamId,
                previewKey: stored.previewKey,
                updatedAt: stored.updatedAt.toISOString(),
              })
            },
          })
        : undefined,
  })
  if (pool) {
    const now = () => new Date(runtime.clock.now())
    bindRoomRealtimeRuntime({
      streams: new StreamService({
        pool,
        now,
        onRoomChanged: async (roomId) => {
          await roomService?.publishRoomMembership(roomId)
          publishRoomEvent(server, { type: 'membership-changed', roomId })
        },
        publishRoomEvent: (event) => publishRoomEvent(server, event),
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

/** Generous for one device, and a shared network now gets a budget per device
    rather than one between them. It bounds casual inflation of the Home count
    and the memory a single client can hold; it is not a defence against a
    distributed effort, and ADR 0108 accepts that. */
const MAX_ANONYMOUS_SOCKETS_PER_CLIENT = 8
const MAX_VISITOR_ID_LENGTH = 128
/** Long enough to swallow a refresh's disconnect/connect pair, short enough
    that a genuine arrival still reads as "right now". */
const PRESENCE_SETTLE_MS = 1_500

/** The visitor's own dedupe key, treated as opaque and never trusted: it only
    ever collapses that client's own tabs, so a forged value costs its owner an
    entry rather than earning them one. Without usable client storage there is
    no id, and the socket itself stands in — one tab, one person. */
function handshakeVisitorId(socket: SocketConnection): string {
  const claimed = socket.handshake.auth?.visitorId
  return typeof claimed === 'string' &&
    claimed.length > 0 &&
    claimed.length <= MAX_VISITOR_ID_LENGTH
    ? `id:${claimed}`
    : `socket:${socket.id}`
}

/** Passive fingerprint for the connection cap. Both parts fall out of the
    connection, so unlike anything computed in the browser the client cannot
    simply pick a new one per socket. */
function handshakeClientKey(socket: SocketConnection): string {
  const forwarded = socket.handshake.headers['x-forwarded-for']
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const address = forwardedValue?.split(',')[0]?.trim() || socket.handshake.address
  const userAgent = socket.handshake.headers['user-agent'] ?? ''
  return createHash('sha256').update(`${address}\n${userAgent}`).digest('hex')
}

export function attachSocketServer(server: HttpServer, databasePool?: Pool) {
  const existing = attachedSockets.get(server)
  if (existing) return existing

  const sockets = new SocketServer(server, {
    path: '/socket.io/',
    serveClient: false,
  })
  const eventHub = createHomeEventHub()
  // A page refresh is a disconnect immediately followed by a connect, so
  // publishing per socket event makes Home's "right now" count dip and recover
  // for every reader. Trailing-only debounce lets the pair settle, and the
  // count is read at flush time so the number sent is the current one.
  const publishPresence = debounce(
    () => eventHub.publish({ type: 'presence', connectedCount: homePresence.count() }),
    { wait: PRESENCE_SETTLE_MS, leading: false, trailing: true },
  )
  const roomHub = createRoomEventHub()
  roomEventHubs.set(server, roomHub)
  const connectionRegistry = new ConnectionRegistry()
  const terminalConnections = new WeakSet<RegisteredConnection>()
  const roomDetachers = new Map<string, () => void>()
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
  const revokeConnections = (accountId: string) => {
    for (const socket of sockets.sockets.sockets.values()) {
      if (socket.data.accountId === accountId) {
        const connection = socket as unknown as RegisteredConnection
        terminalConnections.add(connection)
        socket.emit(HOME_ACCOUNT_REVOKED_EVENT)
        socket.disconnect(true)
      }
    }
  }
  const revokeRoomConnections = (accountId: string, roomId: string) => {
    for (const socket of sockets.sockets.sockets.values()) {
      if (socket.data.accountId !== accountId || socket.data.roomId !== roomId) continue
      socket.emit(ROOM_SOCKET_EVENT, { type: 'membership-changed', roomId })
      roomDetachers.get(socket.id)?.()
    }
  }
  connectionRevokers.set(server, {
    account: revokeConnections,
    room: revokeRoomConnections,
  })
  bindDeletionRuntime({ revokeConnections })
  bindSanctionRuntime({ revokeConnections })
  attachedSockets.set(server, sockets)

  // Anonymous sockets, admitted per client key (ADR 0108). Keyed by
  // hash(IP + User-Agent) rather than IP alone so one shared NAT does not put
  // genuinely different devices on a single budget.
  const anonymousSocketsByClient = new Map<string, Set<string>>()

  sockets.use(async (socket, next) => {
    try {
      const headers = new Headers()
      for (const [name, value] of Object.entries(socket.handshake.headers)) {
        if (value !== undefined) {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
      }
      const session = await readSessionProjection(getProductionAuth(), headers)
      if (!session) {
        // No session is no longer a rejection: the visitor counts towards Home
        // presence. The connection handler gives them no room listeners, so
        // every command below still requires an account.
        socket.data.visitorId = handshakeVisitorId(socket)
        socket.data.clientKey = handshakeClientKey(socket)
        return next()
      }
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

  /** An anonymous visitor's whole lifecycle: take a slot, count, forward the
      public Home stream, give it all back on disconnect. No room listener is
      registered here, which is what keeps every room command account-only. */
  function admitAnonymousVisitor(socket: SocketConnection) {
    const visitorId = socket.data.visitorId
    const clientKey = socket.data.clientKey
    if (typeof visitorId !== 'string' || typeof clientKey !== 'string') {
      socket.disconnect(true)
      return
    }
    // Claim first and check after: two handshakes racing to the last slot both
    // see the pre-claim size, so only the post-claim size bounds them.
    const admitted = anonymousSocketsByClient.get(clientKey) ?? new Set<string>()
    admitted.add(socket.id)
    anonymousSocketsByClient.set(clientKey, admitted)
    if (admitted.size > MAX_ANONYMOUS_SOCKETS_PER_CLIENT) {
      releaseAnonymousSlot(clientKey, socket.id)
      socket.disconnect(true)
      return
    }

    homePresence.addVisitor(visitorId, socket.id)
    const unsubscribe = eventHub.subscribe((event) =>
      socket.emit(HOME_SOCKET_EVENT, event),
    )
    publishPresence()

    socket.on('disconnect', () => {
      unsubscribe()
      releaseAnonymousSlot(clientKey, socket.id)
      homePresence.removeVisitor(visitorId, socket.id)
      publishPresence()
    })
  }

  function releaseAnonymousSlot(clientKey: string, socketId: string) {
    const admitted = anonymousSocketsByClient.get(clientKey)
    if (!admitted) return
    admitted.delete(socketId)
    if (admitted.size === 0) anonymousSocketsByClient.delete(clientKey)
  }

  sockets.on('connection', (socket) => {
    const accountId = socket.data.accountId
    if (typeof accountId !== 'string') {
      admitAnonymousVisitor(socket)
      return
    }
    const connection = socket as unknown as RegisteredConnection
    let activated = false
    let handledDisconnect = false
    let unsubscribe: () => void = () => {}
    const removePresence = () => {
      const disconnectedFromRoom = typeof socket.data.roomId === 'string'
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
        publishPresence()
        if (!terminalConnections.has(connection) && disconnectedFromRoom) {
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
    let typingExpiry: NodeJS.Timeout | undefined
    let typingActive = false
    const detachRoom = () => {
      delete socket.data.roomId
      clearTimeout(typingExpiry)
      typingExpiry = undefined
      if (roomMembership && typingActive) {
        roomHub.publish({
          type: 'typing',
          roomId: roomMembership.roomId,
          membershipId: roomMembership.membershipId,
          accountId,
          displayName: roomMembership.displayName,
          typing: false,
        })
      }
      typingActive = false
      leaveRoomChannel()
      leaveRoomChannel = () => {}
      roomMembership = null
    }
    socket.on('disconnect', detachRoom)
    roomDetachers.set(socket.id, detachRoom)
    socket.on('disconnect', () => roomDetachers.delete(socket.id))

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
      socket.data.roomId = roomMembership.roomId
      // The server filter is refreshed on join; the client applies a newly
      // persisted mute immediately so content disappears without reconnecting.
      const muted = new Set((await roomRealtime().chat?.mutedAccountIds(accountId).catch(() => [])) ?? [])
      leaveRoomChannel = roomHub.subscribe(projection.room.id, (event) => {
        if (event.type === 'typing' && event.accountId === accountId) return
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

    socket.on(ROOM_CHAT_COMMAND, async (value: unknown, ack?: (result: unknown) => void) => {
      const current = roomMembership
      const command = normalizeRoomChatCommand(value)
      const chat = roomRealtime().chat
      if (!current || !command || !chat) return ack?.({ status: 'rejected' })
      try {
        const result = await chat.send(accountId, { roomId: current.roomId, ...command })
        if (result.status === 'sent') {
          roomHub.publish({
            type: 'chat-message',
            roomId: current.roomId,
            message: result.message,
          })
        }
        ack?.(result)
      } catch {
        ack?.({ status: 'failed' })
      }
    })

    socket.on(ROOM_TYPING_COMMAND, (value: unknown, ack?: (result: unknown) => void) => {
      const current = roomMembership
      if (!current || typeof value !== 'boolean') return ack?.({ status: 'rejected' })
      clearTimeout(typingExpiry)
      typingExpiry = undefined
      typingActive = value
      roomHub.publish({
        type: 'typing',
        roomId: current.roomId,
        membershipId: current.membershipId,
        accountId,
        displayName: current.displayName,
        typing: value,
      })
      if (value) {
        typingExpiry = setTimeout(() => {
          typingExpiry = undefined
          if (!typingActive || roomMembership !== current) return
          typingActive = false
          roomHub.publish({
            type: 'typing',
            roomId: current.roomId,
            membershipId: current.membershipId,
            accountId,
            displayName: current.displayName,
            typing: false,
          })
        }, ROOM_TYPING_TTL_MS)
      }
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
          const previousWasInRoom = typeof previousSocket.data.roomId === 'string'
          const departure = !previousWasInRoom
            ? undefined
            : previousSocket.connected === false
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
      publishPresence()
    }).catch(() => socket.disconnect(true))
  })
  return sockets
}

export default createServerEntry({
  async fetch(request) {
    const previewResponse = await handleStreamPreviewRequest(request)
    if (previewResponse) return previewResponse
    const authResponse = await handleAuthenticationRequest(request)
    return authResponse ?? handler.fetch(request)
  },
})
