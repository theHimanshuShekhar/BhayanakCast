import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  ROOM_CHAT_COMMAND,
  ROOM_JOIN_COMMAND,
  ROOM_LEAVE_COMMAND,
  ROOM_SIGNAL_COMMAND,
  ROOM_SOCKET_EVENT,
  ROOM_TYPING_COMMAND,
  ROOM_TYPING_TTL_MS,
  type RoomActivityEntry,
  type RoomChatMessage,
  type RoomRealtimeEvent,
  type RoomSignalPayload,
} from '../../server/realtime/room-events'
import { invalidateRoomProjection } from './room-queries'
import type { SendChatResult } from '../../server/rooms/chat-service'

/** ADR 0103's grace: presentation freezes for this long before the room admits
    it has lost the connection. */
export const RECONNECT_GRACE_MS = 45_000

export interface RoomSocket {
  on(event: string, handler: (value?: unknown) => void): unknown
  off(event: string, handler: (value?: unknown) => void): unknown
  emit(event: string, payload?: unknown, ack?: (result: unknown) => void): unknown
  readonly connected?: boolean
}

export interface TypingMember {
  readonly accountId: string
  readonly displayName: string
}
export type RoomChatSendResult =
  | SendChatResult
  | { readonly status: 'failed' | 'unavailable' }

export interface RoomRealtime {
  readonly messages: readonly RoomChatMessage[]
  readonly activity: readonly RoomActivityEntry[]
  readonly typing: readonly TypingMember[]
  readonly connection: 'live' | 'reconnecting' | 'lost'
  readonly reconnectSecondsRemaining: number | null
  readonly ended: boolean
  appendMessage(message: RoomChatMessage): void
  replaceMessage(mutationId: string, message: RoomChatMessage | null): void
  setTyping(typing: boolean): void
  sendMessage(body: string, mutationId: string): Promise<RoomChatSendResult>
  sendSignal(subscriptionId: string, signal: RoomSignalPayload): void
  onSignal(
    listener: (event: {
      subscriptionId: string
      streamId: string
      signal: RoomSignalPayload
    }) => void,
  ): () => void
  onStreamStopped(listener: (streamId: string) => void): () => void
}

/** The room's own realtime surface. It shares the single Socket.IO connection
    with Home — ADR 0104 puts signaling on that same connection, and a second
    connection would displace the first. */
export function useRoomRealtime({
  socket,
  roomId,
  admitted,
  history,
  queryClient,
}: {
  socket: RoomSocket | null
  roomId: string
  admitted: boolean
  history: readonly RoomChatMessage[]
  queryClient: QueryClient
}): RoomRealtime {
  const [messages, setMessages] = useState<readonly RoomChatMessage[]>(() =>
    mergeCanonicalMessages([], history),
  )
  const [activity, setActivity] = useState<readonly RoomActivityEntry[]>([])
  const [typingBy, setTypingBy] = useState<
    Readonly<Record<string, { displayName: string; at: number }>>
  >({})
  const [connection, setConnection] = useState<'live' | 'reconnecting' | 'lost'>(
    socket ? (socket.connected === false ? 'reconnecting' : 'live') : 'lost',
  )
  const [ended, setEnded] = useState(false)
  const [reconnectSecondsRemaining, setReconnectSecondsRemaining] = useState<number | null>(null)
  const reconnectDeadline = useRef<number | null>(null)
  const signalListeners = useRef(new Set<Parameters<RoomRealtime['onSignal']>[0]>())
  const stoppedListeners = useRef(new Set<(streamId: string) => void>())

  // The backfill is fetched once per admission (ADR 0071); a later refetch of
  // the same window must not drop messages that arrived live in between.
  useEffect(() => {
    setMessages((current) => mergeCanonicalMessages(current, history))
  }, [history])

  useEffect(() => {
    if (!admitted) return
    if (!socket) {
      setConnection('lost')
      setReconnectSecondsRemaining(null)
      setTypingBy({})
      return
    }
    let joined = false
    const onEvent = (value?: unknown) => {
      const event = value as RoomRealtimeEvent | undefined
      if (!event || typeof event !== 'object' || event.roomId !== roomId) return
      switch (event.type) {
        case 'chat-message':
          setMessages((current) => mergeCanonicalMessages(current, [event.message]))
          break
        case 'activity':
          setActivity((current) => [...current, event.entry])
          break
        case 'typing':
          setTypingBy((current) => {
            if (!event.typing) {
              const { [event.accountId]: _removed, ...rest } = current
              return rest
            }
            return {
              ...current,
              [event.accountId]: { displayName: event.displayName, at: Date.now() },
            }
          })
          break
        case 'stream-stopped':
          for (const listener of [...stoppedListeners.current]) listener(event.streamId)
          void invalidateRoomProjection(queryClient, roomId)
          break
        // A fresher preview is a roster change: the tile reads both the key
        // and its freshness off the projection (ADR 0035).
        case 'stream-preview':
        case 'stream-started':
        case 'membership-changed':
          void invalidateRoomProjection(queryClient, roomId)
          break
        case 'room-ended':
          setEnded(true)
          void invalidateRoomProjection(queryClient, roomId)
          break
        case 'signal':
          for (const listener of [...signalListeners.current]) {
            listener({
              subscriptionId: event.subscriptionId,
              streamId: event.streamId,
              signal: event.signal,
            })
          }
          break
      }
    }
    const join = (recovering = false) => {
      socket.emit(ROOM_JOIN_COMMAND, roomId, (result: unknown) => {
        joined = (result as { status?: string } | null)?.status === 'joined'
        reconnectDeadline.current = null
        setReconnectSecondsRemaining(null)
        if (joined) {
          setConnection('live')
          if (recovering) void invalidateRoomProjection(queryClient, roomId)
        } else {
          setConnection('lost')
        }
      })
    }
    const onConnect = () => join(true)
    const onDisconnect = () => {
      reconnectDeadline.current = Date.now() + RECONNECT_GRACE_MS
      setReconnectSecondsRemaining(RECONNECT_GRACE_MS / 1_000)
      setConnection('reconnecting')
      setTypingBy({})
    }
    socket.on(ROOM_SOCKET_EVENT, onEvent)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    if (socket.connected !== false) join()
    else onDisconnect()
    return () => {
      socket.off(ROOM_SOCKET_EVENT, onEvent)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      if (joined) socket.emit(ROOM_LEAVE_COMMAND)
    }
  }, [socket, roomId, admitted, queryClient])

  // The countdown derives from one fixed deadline rather than decrementing
  // state, so delayed/backgrounded timers still show the actual server grace.
  useEffect(() => {
    if (connection !== 'reconnecting' || reconnectDeadline.current === null) return
    const update = () => {
      const remaining = reconnectGraceSeconds(reconnectDeadline.current as number)
      setReconnectSecondsRemaining(remaining)
      if (remaining === 0) {
        reconnectDeadline.current = null
        setConnection('lost')
      }
    }
    update()
    const timer = setInterval(update, 250)
    return () => clearInterval(timer)
  }, [connection])

  useEffect(() => {
    const expiries = Object.values(typingBy).map(
      (member) => member.at + ROOM_TYPING_TTL_MS,
    )
    if (expiries.length === 0) return
    const timer = setTimeout(() => {
      const cutoff = Date.now() - ROOM_TYPING_TTL_MS
      setTypingBy((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, member]) => member.at > cutoff),
        ),
      )
    }, Math.max(0, Math.min(...expiries) - Date.now()))
    return () => clearTimeout(timer)
  }, [typingBy])

  const typing = useMemo(
    () =>
      Object.entries(typingBy).map(([accountId, member]) => ({
        accountId,
        displayName: member.displayName,
      })),
    [typingBy],
  )

  const appendMessage = useCallback((message: RoomChatMessage) => {
    setMessages((current) => mergeCanonicalMessages(current, [message]))
  }, [])
  const replaceMessage = useCallback((mutationId: string, message: RoomChatMessage | null) => {
    setMessages((current) =>
      mergeCanonicalMessages(
        current.filter((entry) => entry.mutationId !== mutationId),
        message ? [message] : [],
      ),
    )
  }, [])
  const setTyping = useCallback(
    (value: boolean) => socket?.emit(ROOM_TYPING_COMMAND, value),
    [socket],
  )
  const sendMessage = useCallback(
    (body: string, mutationId: string): Promise<RoomChatSendResult> => {
      if (!socket || socket.connected === false || connection !== 'live') {
        return Promise.resolve({ status: 'unavailable' })
      }
      return new Promise<RoomChatSendResult>((resolve) => {
        const timeout = setTimeout(() => resolve({ status: 'failed' }), 10_000)
        socket.emit(ROOM_CHAT_COMMAND, { body, mutationId }, (result: unknown) => {
          clearTimeout(timeout)
          if (!result || typeof result !== 'object' || !('status' in result)) {
            resolve({ status: 'failed' })
            return
          }
          resolve(result as RoomChatSendResult)
        })
      })
    },
    [connection, socket],
  )
  const sendSignal = useCallback(
    (subscriptionId: string, signal: RoomSignalPayload) => {
      socket?.emit(ROOM_SIGNAL_COMMAND, { subscriptionId, signal })
    },
    [socket],
  )
  const onSignal = useCallback((listener: Parameters<RoomRealtime['onSignal']>[0]) => {
    signalListeners.current.add(listener)
    return () => signalListeners.current.delete(listener) as unknown as void
  }, [])
  const onStreamStopped = useCallback(
    (listener: Parameters<RoomRealtime['onStreamStopped']>[0]) => {
      stoppedListeners.current.add(listener)
      return () => stoppedListeners.current.delete(listener) as unknown as void
    },
    [],
  )
  return useMemo(
    () => ({
      messages,
      activity,
      typing,
      connection,
      reconnectSecondsRemaining,
      ended,
      appendMessage,
      replaceMessage,
      setTyping,
      sendMessage,
      sendSignal,
      onSignal,
      onStreamStopped,
    }),
    [
      activity,
      appendMessage,
      connection,
      ended,
      messages,
      onSignal,
      onStreamStopped,
      reconnectSecondsRemaining,
      replaceMessage,
      sendMessage,
      sendSignal,
      setTyping,
      typing,
    ],
  )
}

function mergeCanonicalMessages(
  current: readonly RoomChatMessage[],
  incoming: readonly RoomChatMessage[],
): readonly RoomChatMessage[] {
  const messages = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) messages.set(message.id, message)
  return [...messages.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )
}

/** Visible grace uses ceiling so the first frame says 45 and zero is exposed
    only once the complete server reservation has elapsed. */
export function reconnectGraceSeconds(deadline: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deadline - now) / 1_000))
}
