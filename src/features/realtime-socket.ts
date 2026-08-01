import { io, type Socket } from 'socket.io-client'

interface RealtimeSocketLease {
  readonly socket: Socket
  release(): void
}

let current:
  | {
      readonly identity: string
      readonly socket: Socket
      leases: number
    }
  | undefined

export function acquireRealtimeSocket(
  identity: 'authenticated' | `anonymous:${string}`,
  visitorId?: string,
): RealtimeSocketLease {
  if (current && current.identity !== identity) {
    current.socket.disconnect()
    current = undefined
  }
  current ??= {
    identity,
    socket: io({
      path: '/socket.io/',
      withCredentials: true,
      ...(visitorId ? { auth: { visitorId } } : {}),
    }),
    leases: 0,
  }
  const leased = current
  leased.leases += 1
  let released = false
  return {
    socket: leased.socket,
    release() {
      if (released) return
      released = true
      leased.leases -= 1
      queueMicrotask(() => {
        if (current !== leased || leased.leases !== 0) return
        leased.socket.disconnect()
        current = undefined
      })
    },
  }
}
