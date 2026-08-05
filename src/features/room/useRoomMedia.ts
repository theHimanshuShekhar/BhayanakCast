import { AsyncRetryer } from '@tanstack/pacer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { startStream, stopStream, stopWatching, watchStream } from './room-queries'
import type { RoomRealtime } from './useRoomRealtime'
import { observeRoom } from './room-observability'

/** ADR 0104: browser-native WebRTC, public STUN only, no TURN. */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

/** ADR 0077: the first attempt plus three retries at 1s, 2s and 4s. */
export const WATCH_MAX_ATTEMPTS = 4

/** ADR 0077 bounds the retries but not a single attempt, and a negotiation
    that never settles would strand the tile on `Connecting` forever — so an
    attempt that produces no track in this long is treated as a failure. */
const WATCH_ATTEMPT_TIMEOUT = 15_000

/** ADR 0077's retry policy, exactly: one direct-watch attempt then three more
    at 1s, 2s and 4s, with no jitter so the wait a viewer sees is the wait the
    decision names. */
export const WATCH_RETRY_OPTIONS = {
  maxAttempts: WATCH_MAX_ATTEMPTS,
  backoff: 'exponential',
  baseWait: 1_000,
  maxWait: 4_000,
  jitter: 0,
  maxExecutionTime: WATCH_ATTEMPT_TIMEOUT,
  throwOnError: false,
} as const

const WATCH_CLEANUP_RETRY_OPTIONS = {
  ...WATCH_RETRY_OPTIONS,
  maxExecutionTime: 5_000,
} as const

export type PublishState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'live'; readonly streamId: string }

export type WatchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'connecting'; readonly streamId: string; readonly attempt: number }
  | { readonly kind: 'watching'; readonly streamId: string }
  | { readonly kind: 'failed'; readonly streamId: string }

export type CompatibilityState = 'probing' | 'compatible' | 'incompatible'

export function beginWatchSelection(current: WatchState, streamId: string) {
  return {
    previousStreamId: current.kind === 'idle' ? null : current.streamId,
    next: { kind: 'connecting', streamId, attempt: 1 } as const,
  }
}

export function roomWatchEvent(
  action: 'watch' | 'retry' | 'cancel',
  outcome: 'started' | 'retrying' | 'connected' | 'exhausted' | 'cancelled',
  attempt: number,
  watchSequenceId: string,
) {
  return {
    name: 'room_watch_action',
    properties: {
      action,
      outcome,
      attempt,
      watch_sequence_id: watchSequenceId,
    },
  } as const
}

export interface WatchSequence {
  readonly id: string
  readonly attempt: number
}

export function beginWatchSequence(id = crypto.randomUUID()): WatchSequence {
  return { id, attempt: 1 }
}

export function retryWatchSequence(sequence: WatchSequence): WatchSequence {
  return { ...sequence, attempt: sequence.attempt + 1 }
}

export interface RoomMedia {
  /** Compatibility-passed alias retained for tile/control call sites. */
  readonly supported: boolean
  readonly compatibility: CompatibilityState
  readonly captureSupported: boolean | null
  readonly canWatch: boolean
  readonly publish: PublishState
  readonly localStream: MediaStream | null
  readonly watch: WatchState
  readonly remoteStream: MediaStream | null
  readonly error: string | null
  retryCompatibility(): Promise<void>
  startPublishing(): Promise<void>
  cancelPublishing(): void
  stopPublishing(): Promise<void>
  startWatching(streamId: string): Promise<void>
  stopWatchingStream(): Promise<void>
}

/** Screen sharing and the one watched stream. Every peer connection here is
    per directed subscription (ADR 0104) and is torn down explicitly — nothing
    resumes on its own after a failure or a reconnect (ADR 0103). */
export function useRoomMedia({
  roomId,
  realtime,
  connection,
  roomEnded,
  activeStreamIds,
}: {
  roomId: string
  realtime: RoomRealtime
  connection: 'live' | 'reconnecting' | 'lost'
  roomEnded: boolean
  activeStreamIds: readonly string[]
}): RoomMedia {
  const { onSignal, onStreamStopped, sendSignal } = realtime
  const [compatibility, setCompatibility] = useState<CompatibilityState>('probing')
  /** `null` until the client has mounted.

      `isDesktopCaptureClient` reads `navigator`, so a server render always answers
      `false` while a Chromium desktop answers `true`. Resolving it during the first
      client render therefore made the shelf hydrate a different branch than the server
      sent, and React discarded and regenerated the subtree on every admitted-room load.
      Staying `null` through hydration keeps both renders identical; the shelf shows its
      ordinary probing state until the real answer arrives one effect later, so no
      "Desktop only" copy flashes at a client that does support capture. */
  const [captureSupported, setCaptureSupported] = useState<boolean | null>(null)
  useEffect(() => setCaptureSupported(isDesktopCaptureClient()), [])
  const [publish, setPublish] = useState<PublishState>({ kind: 'idle' })
  const [watch, setWatch] = useState<WatchState>({ kind: 'idle' })
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const compatibilityProbe = useRef(0)
  const lastConnection = useRef(connection)
  const publishAttempt = useRef(0)
  const localStreamRef = useRef<MediaStream | null>(null)
  const publishedStreamId = useRef<string | null>(null)
  /** Outbound connections, one per watcher (≤9). */
  const outbound = useRef(new Map<string, RTCPeerConnection>())
  /** The single inbound connection. */
  const inbound = useRef<{ id: string; peer: RTCPeerConnection } | null>(null)
  /** The retryer for the current selection, if one is in flight (ADR 0077). */
  const watchSequence = useRef<WatchSequence | null>(null)
  const watchAttempt = useRef<AsyncRetryer<(streamId: string) => Promise<void>> | null>(null)

  const runCompatibilityProbe = useCallback(async (trigger: 'admission' | 'retry') => {
    const generation = ++compatibilityProbe.current
    setCompatibility('probing')
    const compatible = await probeDirectMediaCompatibility()
    if (compatibilityProbe.current !== generation) return
    setCompatibility(compatible ? 'compatible' : 'incompatible')
    observeRoom({
      name: 'room_media_compatibility_checked',
      properties: { trigger, outcome: compatible ? 'compatible' : 'incompatible' },
    })
  }, [])

  useEffect(() => {
    void runCompatibilityProbe('admission')
    return () => {
      compatibilityProbe.current += 1
    }
  }, [runCompatibilityProbe])

  const closeInbound = useCallback(() => {
    const current = inbound.current
    inbound.current = null
    if (current) {
      sendSignal(current.id, { kind: 'close' })
      current.peer.close()
    }
    setRemoteStream(null)
  }, [sendSignal])

  /** ADR 0077: a retryer is single-use. Anything that ends the current watch —
      the stream stopping, another selection, leaving, a reconnect, cancelling —
      aborts the in-flight attempt and throws the retryer away rather than
      resetting it, so nothing can resume without a fresh explicit action. */
  const discardWatchAttempt = useCallback(() => {
    watchAttempt.current?.abort()
    watchAttempt.current = null
    watchSequence.current = null
    closeInbound()
  }, [closeInbound])

  const releaseLocal = useCallback(() => {
    for (const [id, peer] of outbound.current) {
      sendSignal(id, { kind: 'close' })
      peer.close()
    }
    outbound.current.clear()
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    setLocalStream(null)
    publishedStreamId.current = null
  }, [sendSignal])

  // Publisher side of negotiation. The viewer offers, so a subscription this
  // client has never heard of is exactly how it learns a watcher arrived.
  useEffect(() => {
    return onSignal(async ({ subscriptionId, streamId, signal }) => {
      const existing = outbound.current.get(subscriptionId)
      if (signal.kind === 'close') {
        existing?.close()
        outbound.current.delete(subscriptionId)
        if (inbound.current?.id === subscriptionId) {
          watchAttempt.current?.abort()
          watchAttempt.current = null
          inbound.current.peer.close()
          inbound.current = null
          setRemoteStream(null)
          setWatch({ kind: 'idle' })
        }
        return
      }
      if (inbound.current?.id === subscriptionId) {
        const peer = inbound.current.peer
        if (signal.kind === 'answer') {
          await peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
        } else if (signal.kind === 'candidate') {
          await peer.addIceCandidate(signal).catch(() => {})
        }
        return
      }
      if (signal.kind === 'candidate') {
        await existing?.addIceCandidate(signal).catch(() => {})
        return
      }
      if (signal.kind !== 'offer') return
      const stream = localStreamRef.current
      if (!stream || publishedStreamId.current !== streamId) return
      const peer = existing ?? createPeer(subscriptionId)
      outbound.current.set(subscriptionId, peer)
      for (const track of stream.getTracks()) {
        if (!peer.getSenders().some((sender) => sender.track === track)) {
          peer.addTrack(track, stream)
        }
      }
      await peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      sendSignal(subscriptionId, { kind: 'answer', sdp: answer.sdp ?? '' })
    })

    function createPeer(subscriptionId: string) {
      const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        sendSignal(subscriptionId, {
          kind: 'candidate',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        })
      }
      return peer
    }
  }, [onSignal, sendSignal])

  // A publisher stopping is authoritative: close the peer immediately rather
  // than waiting for the media to go silent (ADR 0104).
  useEffect(
    () =>
      onStreamStopped((streamId) => {
        setWatch((current) => {
          if (current.kind === 'idle' || current.streamId !== streamId) return current
          discardWatchAttempt()
          return { kind: 'idle' }
        })
        if (publishedStreamId.current === streamId) {
          releaseLocal()
          setPublish({ kind: 'idle' })
        }
      }),
    [onStreamStopped, discardWatchAttempt, releaseLocal],
  )

  const activeStreamKey = activeStreamIds.join('\u0000')
  useEffect(() => {
    if (
      watch.kind === 'idle' ||
      activeStreamKey.split('\u0000').includes(watch.streamId)
    ) return
    discardWatchAttempt()
    setWatch({ kind: 'idle' })
  }, [activeStreamKey, watch, discardWatchAttempt])

  // Reconnect grace preserves membership, never peer media. Both local capture
  // and the watched peer close at the first disconnect and remain idle after
  // reclaim until the member explicitly starts or watches again.
  useEffect(() => {
    const previous = lastConnection.current
    lastConnection.current = connection
    if (connection === 'reconnecting' && previous !== 'reconnecting') {
      observeRoom({
        name: 'room_reconnect_recovery',
        properties: { outcome: 'started', seconds_remaining: 45 },
      })
    } else if (connection === 'live' && previous === 'reconnecting') {
      observeRoom({
        name: 'room_reconnect_recovery',
        properties: { outcome: 'reclaimed', seconds_remaining: 0 },
      })
    } else if (connection === 'lost' && previous === 'reconnecting') {
      observeRoom({
        name: 'room_reconnect_recovery',
        properties: { outcome: 'expired', seconds_remaining: 0 },
      })
    }
    if (connection === 'live') return
    publishAttempt.current += 1
    discardWatchAttempt()
    releaseLocal()
    setWatch({ kind: 'idle' })
    setPublish({ kind: 'idle' })
  }, [connection, discardWatchAttempt, releaseLocal])

  useEffect(() => {
    if (!roomEnded) return
    publishAttempt.current += 1
    discardWatchAttempt()
    releaseLocal()
    setWatch({ kind: 'idle' })
    setPublish({ kind: 'idle' })
  }, [roomEnded, discardWatchAttempt, releaseLocal])

  useEffect(() => () => {
    discardWatchAttempt()
    releaseLocal()
  }, [discardWatchAttempt, releaseLocal])

  return {
    supported: compatibility === 'compatible',
    compatibility,
    captureSupported,
    canWatch: compatibility === 'compatible' && connection === 'live' && !roomEnded,
    publish,
    localStream,
    watch,
    remoteStream,
    error,
    async retryCompatibility() {
      await runCompatibilityProbe('retry')
    },
    async startPublishing() {
      if (
        compatibility !== 'compatible' ||
        captureSupported !== true ||
        connection !== 'live' ||
        roomEnded ||
        publish.kind !== 'idle'
      ) return
      observeRoom({
        name: 'room_stream_action',
        properties: { action: 'start', outcome: 'requested' },
      })
      const generation = ++publishAttempt.current
      setError(null)
      setPublish({ kind: 'starting' })
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      } catch {
        if (generation !== publishAttempt.current) return
        setPublish({ kind: 'idle' })
        setError('Screen sharing was not started.')
        observeRoom({
          name: 'room_stream_action',
          properties: { action: 'start', outcome: 'failed' },
        })
        return
      }
      if (generation !== publishAttempt.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const result = await startStream({ data: roomId }).catch(() => null)
      if (generation !== publishAttempt.current) {
        stream.getTracks().forEach((track) => track.stop())
        if (result && (result.status === 'started' || result.status === 'already-streaming')) {
          await stopStream({ data: { streamId: result.streamId } }).catch(() => null)
        }
        return
      }
      if (!result || (result.status !== 'started' && result.status !== 'already-streaming')) {
        stream.getTracks().forEach((track) => track.stop())
        setPublish({ kind: 'idle' })
        setError(startFailure(result?.status))
        observeRoom({
          name: 'room_stream_action',
          properties: { action: 'start', outcome: 'failed' },
        })
        return
      }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        const live = publishedStreamId.current
        releaseLocal()
        setPublish({ kind: 'idle' })
        if (live) void stopStream({ data: { streamId: live } }).catch(() => null)
      })
      localStreamRef.current = stream
      publishedStreamId.current = result.streamId
      setLocalStream(stream)
      setPublish({ kind: 'live', streamId: result.streamId })
      observeRoom({
        name: 'room_stream_action',
        properties: { action: 'start', outcome: 'succeeded' },
      })
    },
    cancelPublishing() {
      publishAttempt.current += 1
      if (publish.kind === 'starting') {
        setPublish({ kind: 'idle' })
        observeRoom({
          name: 'room_stream_action',
          properties: { action: 'cancel', outcome: 'succeeded' },
        })
      }
    },
    async stopPublishing() {
      const streamId = publishedStreamId.current
      releaseLocal()
      setPublish({ kind: 'idle' })
      if (streamId) await stopStream({ data: { streamId } }).catch(() => null)
      observeRoom({
        name: 'room_stream_action',
        properties: { action: 'stop', outcome: 'succeeded' },
      })
    },
    async startWatching(streamId) {
      if (compatibility !== 'compatible' || connection !== 'live' || roomEnded) return
      setError(null)
      const action = watch.kind === 'failed' && watch.streamId === streamId ? 'retry' : 'watch'
      const previousSequence = watchSequence.current
      if (watch.kind !== 'idle' && watch.kind !== 'failed' && previousSequence) {
        observeRoom(
          roomWatchEvent(
            'cancel',
            'cancelled',
            previousSequence.attempt,
            previousSequence.id,
          ),
        )
      }
      discardWatchAttempt()
      let sequence = beginWatchSequence()
      watchSequence.current = sequence
      setWatch(beginWatchSelection(watch, streamId).next)
      observeRoom(roomWatchEvent(action, 'started', sequence.attempt, sequence.id))
      let exhausted = false
      const retryer: AsyncRetryer<(id: string) => Promise<void>> = new AsyncRetryer(
        (id: string) =>
          negotiate(
            id,
            retryer.getAbortSignal(),
            action,
            sequence.attempt,
            sequence.id,
          ),
        {
          ...WATCH_RETRY_OPTIONS,
          onRetry: () => {
            if (watchSequence.current?.id !== sequence.id) return
            closeInbound()
            sequence = retryWatchSequence(sequence)
            watchSequence.current = sequence
            setWatch({ kind: 'connecting', streamId, attempt: sequence.attempt })
            observeRoom(
              roomWatchEvent(action, 'retrying', sequence.attempt, sequence.id),
            )
          },
          onLastError: () => {
            if (watchSequence.current?.id !== sequence.id) return
            exhausted = true
            watchAttempt.current = null
            closeInbound()
          },
        },
      )
      watchAttempt.current = retryer
      await retryer.execute(streamId)
      if (exhausted && watchSequence.current?.id === sequence.id) {
        const cleaned = await cleanupWatchSubscription()
        if (watchSequence.current?.id !== sequence.id) return
        setWatch({ kind: 'failed', streamId })
        observeRoom(
          roomWatchEvent(
            action,
            'exhausted',
            sequence.attempt,
            sequence.id,
          ),
        )
        watchSequence.current = null
        if (!cleaned) {
          setError('The failed watch could not be released. Retry when the connection recovers.')
        }
      }
    },
    async stopWatchingStream() {
      const sequence = watchSequence.current
      if (watch.kind !== 'idle' && sequence) {
        observeRoom(
          roomWatchEvent('cancel', 'cancelled', sequence.attempt, sequence.id),
        )
      }
      discardWatchAttempt()
      watchSequence.current = null
      const cleaned = await cleanupWatchSubscription()
      setWatch({ kind: 'idle' })
      if (!cleaned) setError('The watch could not be released. Try again when connected.')
    },
  }

  async function cleanupWatchSubscription() {
    let failed = false
    const cleanup = new AsyncRetryer(
      async () => {
        await stopWatching({ data: roomId })
      },
      {
        ...WATCH_CLEANUP_RETRY_OPTIONS,
        onLastError: () => {
          failed = true
        },
      },
    )
    await cleanup.execute()
    return !failed
  }

  /** One direct-watch attempt: a fresh subscription and peer connection that
      settles only when the publisher's media arrives (ADR 0104). */
  async function negotiate(
    streamId: string,
    signal: AbortSignal | null,
    action: 'watch' | 'retry',
    attempt: number,
    sequenceId: string,
  ) {
    const result = await watchStream({ data: { roomId, streamId } })
    if (result.status !== 'subscribed') throw new Error(result.status)
    if (signal?.aborted) throw new Error('aborted')
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    inbound.current = { id: result.id, peer }
    await new Promise<void>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        sendSignal(result.id, {
          kind: 'candidate',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        })
      }
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed') reject(new Error('peer-failed'))
      }
      peer.ontrack = (event) => {
        setRemoteStream(event.streams[0] ?? new MediaStream([event.track]))
        setWatch({ kind: 'watching', streamId })
        observeRoom(roomWatchEvent(action, 'connected', attempt, sequenceId))
        resolve()
      }
      peer.addTransceiver('video', { direction: 'recvonly' })
      peer.addTransceiver('audio', { direction: 'recvonly' })
      peer
        .createOffer()
        .then(async (offer) => {
          await peer.setLocalDescription(offer)
          sendSignal(result.id, { kind: 'offer', sdp: offer.sdp ?? '' })
        })
        .catch(reject)
    })
  }
}

export async function probeDirectMediaCompatibility(
  createPeer: (() => RTCPeerConnection) | null =
    typeof RTCPeerConnection === 'function'
      ? () => new RTCPeerConnection({ iceServers: ICE_SERVERS })
      : null,
): Promise<boolean> {
  if (!createPeer) return false
  let peer: RTCPeerConnection | null = null
  try {
    peer = createPeer()
    peer.addTransceiver('video', { direction: 'recvonly' })
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    return true
  } catch {
    return false
  } finally {
    peer?.close()
  }
}

interface CaptureClientEnvironment {
  readonly userAgent: string
  readonly userAgentData?: {
    readonly mobile?: boolean
    readonly brands?: readonly { readonly brand: string }[]
  }
  readonly mediaDevices?: { readonly getDisplayMedia?: unknown }
}

/** Publishing is deliberately narrower than watching: Chromium-family desktop
    only, while compatible mobile Safari/Chrome can still subscribe. */
export function isDesktopCaptureClient(
  environment: CaptureClientEnvironment | null =
    typeof navigator === 'undefined'
      ? null
      : (navigator as Navigator & CaptureClientEnvironment),
): boolean {
  if (!environment || typeof environment.mediaDevices?.getDisplayMedia !== 'function') return false
  if (environment.userAgentData?.mobile === true) return false
  if (/(Android|iPhone|iPad|iPod|Mobile)/i.test(environment.userAgent)) return false
  const brands = environment.userAgentData?.brands?.map(({ brand }) => brand).join(' ') ?? ''
  return /(Chromium|Google Chrome|Microsoft Edge)/i.test(brands) ||
    /(Chrome|Chromium|Edg)\//i.test(environment.userAgent)
}

function startFailure(status: string | undefined) {
  if (status === 'account-read-only') return 'Your account is read-only right now.'
  if (status === 'all-access-sanctioned') return 'Streaming is unavailable on your account.'
  if (status === 'room-ended') return 'This room has ended.'
  return 'Your stream could not be started.'
}
