import { useEffect, useMemo, useRef, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  ROOM_JOIN_COMMAND,
  ROOM_LEAVE_COMMAND,
  ROOM_SIGNAL_COMMAND,
  ROOM_SOCKET_EVENT,
  ROOM_TYPING_COMMAND,
  type RoomActivityEntry,
  type RoomChatMessage,
  type RoomRealtimeEvent,
  type RoomSignalPayload,
} from '../../server/realtime/room-events'
import { invalidateRoomProjection } from './room-queries'

/** ADR 0103's grace: presentation freezes for this long before the room admits
    it has lost the connection. */
export const RECONNECT_GRACE_MS = 45_000
/** A typing indicator that stops being refreshed retires on its own. */
const TYPING_TTL_MS = 5_000

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

export interface RoomRealtime {
  readonly messages: readonly RoomChatMessage[]
  readonly activity: readonly RoomActivityEntry[]
  readonly typing: readonly TypingMember[]
  readonly connection: 'live' | 'reconnecting' | 'lost'
  readonly ended: boolean
  appendMessage(message: RoomChatMessage): void
  replaceMessage(mutationId: string, message: RoomChatMessage | null): void
  setTyping(typing: boolean): void
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
  const [messages, setMessages] = useState<readonly RoomChatMessage[]>(history)
  const [activity, setActivity] = useState<readonly RoomActivityEntry[]>([])
  const [typingBy, setTypingBy] = useState<
    Readonly<Record<string, { displayName: string; at: number }>>
  >({})
  const [connection, setConnection] = useState<'live' | 'reconnecting' | 'lost'>('live')
  const [ended, setEnded] = useState(false)
  const signalListeners = useRef(new Set<Parameters<RoomRealtime['onSignal']>[0]>())
  const stoppedListeners = useRef(new Set<(streamId: string) => void>())

  // The backfill is fetched once per admission (ADR 0071); a later refetch of
  // the same window must not drop messages that arrived live in between.
  useEffect(() => {
    setMessages((current) => (current.length === 0 ? history : current))
  }, [history])

  useEffect(() => {
    if (!socket || !admitted) return
    let joined = false
    const onEvent = (value?: unknown) => {
      const event = value as RoomRealtimeEvent | undefined
      if (!event || typeof event !== 'object' || event.roomId !== roomId) return
      switch (event.type) {
        case 'chat-message':
          setMessages((current) =>
            current.some((message) => message.id === event.message.id)
              ? current
              : [...current, event.message],
          )
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
    const join = () => {
      socket.emit(ROOM_JOIN_COMMAND, roomId, (result: unknown) => {
        joined = (result as { status?: string } | null)?.status === 'joined'
      })
    }
    const onConnect = () => {
      setConnection('live')
      join()
    }
    const onDisconnect = () => setConnection('reconnecting')
    socket.on(ROOM_SOCKET_EVENT, onEvent)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    if (socket.connected !== false) join()
    return () => {
      socket.off(ROOM_SOCKET_EVENT, onEvent)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      if (joined) socket.emit(ROOM_LEAVE_COMMAND)
    }
  }, [socket, roomId, admitted, queryClient])

  // ADR 0103: after the grace elapses the room stops pretending and asks for an
  // explicit re-Watch / re-Start rather than resuming media silently.
  useEffect(() => {
    if (connection !== 'reconnecting') return
    const timer = setTimeout(() => setConnection('lost'), RECONNECT_GRACE_MS)
    return () => clearTimeout(timer)
  }, [connection])

  useEffect(() => {
    if (Object.keys(typingBy).length === 0) return
    const timer = setTimeout(() => {
      const cutoff = Date.now() - TYPING_TTL_MS
      setTypingBy((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, member]) => member.at > cutoff),
        ),
      )
    }, TYPING_TTL_MS)
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

  return {
    messages,
    activity,
    typing,
    connection,
    ended,
    appendMessage(message) {
      setMessages((current) => [...current, message])
    },
    replaceMessage(mutationId, message) {
      setMessages((current) => {
        const next = current.filter((entry) => entry.mutationId !== mutationId)
        return message ? [...next, message] : next
      })
    },
    setTyping(value) {
      socket?.emit(ROOM_TYPING_COMMAND, value)
    },
    sendSignal(subscriptionId, signal) {
      socket?.emit(ROOM_SIGNAL_COMMAND, { subscriptionId, signal })
    },
    onSignal(listener) {
      signalListeners.current.add(listener)
      return () => signalListeners.current.delete(listener) as unknown as void
    },
    onStreamStopped(listener) {
      stoppedListeners.current.add(listener)
      return () => stoppedListeners.current.delete(listener) as unknown as void
    },
  }
}
