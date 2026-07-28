import { createElement, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import {
  applyHomeRealtimeEvent,
  HOME_ACCOUNT_REPLACED_EVENT,
  HOME_ACCOUNT_REVOKED_EVENT,
  HOME_SOCKET_EVENT,
  normalizeHomeRealtimeEvent,
} from '../../server/realtime/home-events'
import {
  HomeConnectionStatus,
  RECOVERED_RETIRE_MS,
  type HomeConnectionState,
} from './HomeConnectionStatus'

interface HomeRealtimeBridgeProps {
  readonly enabled: boolean
  readonly onCanonicalRefresh: () => void
}

/** Everything the strip needs, published as one value: the state alone cannot
    say how stale the page is or how many times the socket has tried. */
interface HomeConnectionSnapshot {
  readonly state: HomeConnectionState
  readonly lastEventAt: number
  readonly attempt: number
}

export function refreshHomeQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries(
    { queryKey: ['home'], refetchType: 'active' },
    { throwOnError: true },
  )
}

export function HomeRealtimeBridge({
  enabled,
  onCanonicalRefresh,
}: HomeRealtimeBridgeProps) {
  const queryClient = useQueryClient()
  const [snapshot, setSnapshot] = useState<HomeConnectionSnapshot>(() => ({
    state: 'idle',
    lastEventAt: Date.now(),
    attempt: 0,
  }))
  const onCanonicalRefreshRef = useRef(onCanonicalRefresh)
  const socketRef = useRef<ReturnType<typeof io> | null>(null)
  const retryRef = useRef<() => void>(() => {})
  onCanonicalRefreshRef.current = onCanonicalRefresh

  useEffect(() => {
    if (!enabled) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setSnapshot({ state: 'idle', lastEventAt: Date.now(), attempt: 0 })
      return
    }

    const socket = io({
      path: '/socket.io/',
      withCredentials: true,
    })
    socketRef.current = socket
    let recovering = false
    let replaced = false
    let generation = 0
    // Tracked outside React: every delivered event refreshes the freshness
    // clock, but only a state change is worth a render.
    let lastEventAt = Date.now()
    let attempt = 0
    let retireTimer: ReturnType<typeof setTimeout> | undefined

    const publish = (state: HomeConnectionState) => {
      clearTimeout(retireTimer)
      retireTimer = undefined
      setSnapshot({ state, lastEventAt, attempt })
    }
    const publishRecovered = () => {
      publish('recovered')
      retireTimer = setTimeout(() => publish('idle'), RECOVERED_RETIRE_MS)
    }

    const handleDisconnect = () => {
      if (replaced) return
      recovering = true
      generation += 1
      attempt += 1
      void queryClient.invalidateQueries({
        queryKey: ['home'],
        refetchType: 'none',
      })
      publish('reconnecting')
    }
    const refreshCanonical = async (refreshGeneration: number) => {
      try {
        await refreshHomeQueries(queryClient)
        if (refreshGeneration !== generation || !socket.connected || replaced) return
        recovering = false
        lastEventAt = Date.now()
        attempt = 0
        onCanonicalRefreshRef.current()
        publishRecovered()
      } catch {
        if (refreshGeneration === generation && !replaced) {
          publish('error')
        }
      }
    }
    const handleConnect = () => {
      const connectGeneration = ++generation
      if (!recovering) {
        lastEventAt = Date.now()
        attempt = 0
        publish('idle')
        return
      }
      publish('reconnecting')
      void refreshCanonical(connectGeneration)
    }
    const handleConnectError = () => {
      if (replaced) return
      recovering = true
      generation += 1
      attempt += 1
      publish('error')
    }
    const handleAccountReplaced = () => {
      replaced = true
      recovering = false
      generation += 1
      socket.io.opts.reconnection = false
      publish('replaced')
      socket.disconnect()
    }
    const handleRetry = () => {
      if (replaced || !recovering) return
      const retryGeneration = ++generation
      attempt += 1
      publish('reconnecting')
      if (!socket.connected) {
        socket.connect()
        return
      }
      void refreshCanonical(retryGeneration)
    }
    retryRef.current = handleRetry
    const handleHomeEvent = (value: unknown) => {
      const event = normalizeHomeRealtimeEvent(value)
      if (!event) return
      lastEventAt = Date.now()
      applyHomeRealtimeEvent(queryClient, event)
    }
    const handleAccountRevoked = () => {
      replaced = true
      recovering = false
      generation += 1
      socket.io.opts.reconnection = false
      publish('revoked')
      socket.disconnect()
    }

    socket.on('disconnect', handleDisconnect)
    socket.on('connect', handleConnect)
    socket.on('connect_error', handleConnectError)
    socket.on(HOME_SOCKET_EVENT, handleHomeEvent)
    socket.on(HOME_ACCOUNT_REPLACED_EVENT, handleAccountReplaced)
    socket.on(HOME_ACCOUNT_REVOKED_EVENT, handleAccountRevoked)
    return () => {
      generation += 1
      replaced = true
      clearTimeout(retireTimer)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect', handleConnect)
      socket.off('connect_error', handleConnectError)
      socket.off(HOME_SOCKET_EVENT, handleHomeEvent)
      socket.off(HOME_ACCOUNT_REPLACED_EVENT, handleAccountReplaced)
      socket.off(HOME_ACCOUNT_REVOKED_EVENT, handleAccountRevoked)
      socket.disconnect()
      if (socketRef.current === socket) socketRef.current = null
      retryRef.current = () => {}
    }
  }, [enabled, queryClient])

  return createElement(HomeConnectionStatus, {
    ...snapshot,
    onRetry: snapshot.state === 'error' ? () => retryRef.current() : undefined,
  })
}
