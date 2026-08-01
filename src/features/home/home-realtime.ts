import { createElement, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { acquireRealtimeSocket } from '../realtime-socket'
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
  /** Signed-out visitors get a minted visitor id so the server can collapse
      their tabs into one person; a signed-in visitor is deduped by account and
      is never given a stored identifier they did not ask for. */
  readonly anonymous: boolean
  readonly onCanonicalRefresh: () => void
}

const VISITOR_ID_STORAGE_KEY = 'bhayanakcast.visitor-id'

/** An opaque per-browser id, used for nothing but collapsing one person's tabs
    into one entry in the Home count. Storage is unavailable in some privacy
    modes; the server then falls back to counting the socket, which overcounts a
    multi-tab visitor rather than dropping them. */
function visitorId(): string | undefined {
  try {
    const stored = localStorage.getItem(VISITOR_ID_STORAGE_KEY)
    if (stored) return stored
    const minted = crypto.randomUUID()
    localStorage.setItem(VISITOR_ID_STORAGE_KEY, minted)
    return minted
  } catch {
    return undefined
  }
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
  anonymous,
  onCanonicalRefresh,
}: HomeRealtimeBridgeProps) {
  const queryClient = useQueryClient()
  const [snapshot, setSnapshot] = useState<HomeConnectionSnapshot>(() => ({
    state: 'idle',
    lastEventAt: Date.now(),
    attempt: 0,
  }))
  const onCanonicalRefreshRef = useRef(onCanonicalRefresh)
  const retryRef = useRef<() => void>(() => {})
  onCanonicalRefreshRef.current = onCanonicalRefresh

  useEffect(() => {
    const visitor = anonymous ? visitorId() : undefined
    const lease = acquireRealtimeSocket(
      anonymous ? `anonymous:${visitor ?? 'unstored'}` : 'authenticated',
      visitor,
    )
    const socket = lease.socket
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
      lease.release()
      retryRef.current = () => {}
    }
  }, [anonymous, queryClient])

  return createElement(HomeConnectionStatus, {
    ...snapshot,
    onRetry: snapshot.state === 'error' ? () => retryRef.current() : undefined,
  })
}
