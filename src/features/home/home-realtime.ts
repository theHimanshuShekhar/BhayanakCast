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
  type HomeConnectionState,
} from './HomeConnectionStatus'

interface HomeRealtimeBridgeProps {
  readonly enabled: boolean
  readonly onCanonicalRefresh: () => void
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
  const [state, setState] = useState<HomeConnectionState>('idle')
  const onCanonicalRefreshRef = useRef(onCanonicalRefresh)
  const socketRef = useRef<ReturnType<typeof io> | null>(null)
  const retryRef = useRef<() => void>(() => {})
  onCanonicalRefreshRef.current = onCanonicalRefresh

  useEffect(() => {
    if (!enabled) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setState('idle')
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

    const handleDisconnect = () => {
      if (replaced) return
      recovering = true
      generation += 1
      void queryClient.invalidateQueries({
        queryKey: ['home'],
        refetchType: 'none',
      })
      setState('reconnecting')
    }
    const refreshCanonical = async (refreshGeneration: number) => {
      try {
        await refreshHomeQueries(queryClient)
        if (refreshGeneration !== generation || !socket.connected || replaced) return
        recovering = false
        onCanonicalRefreshRef.current()
        setState('idle')
      } catch {
        if (refreshGeneration === generation && socket.connected && !replaced) {
          setState('error')
        }
      }
    }
    const handleConnect = () => {
      const connectGeneration = ++generation
      if (!recovering) {
        setState('idle')
        return
      }
      setState('reconnecting')
      void refreshCanonical(connectGeneration)
    }
    const handleConnectError = () => {
      if (replaced) return
      recovering = true
      generation += 1
      setState('error')
    }
    const handleAccountReplaced = () => {
      replaced = true
      recovering = false
      generation += 1
      socket.io.opts.reconnection = false
      setState('replaced')
      socket.disconnect()
    }
    const handleRetry = () => {
      if (replaced || !recovering) return
      const retryGeneration = ++generation
      setState('reconnecting')
      if (!socket.connected) {
        socket.connect()
        return
      }
      void refreshCanonical(retryGeneration)
    }
    retryRef.current = handleRetry
    const handleHomeEvent = (value: unknown) => {
      const event = normalizeHomeRealtimeEvent(value)
      if (event) applyHomeRealtimeEvent(queryClient, event)
    }
    const handleAccountRevoked = () => {
      replaced = true
      recovering = false
      generation += 1
      socket.io.opts.reconnection = false
      setState('revoked')
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
    state,
    onRetry: state === 'error' ? () => retryRef.current() : undefined,
  })
}
