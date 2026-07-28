import { AsyncRetryer } from '@tanstack/pacer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { startStream, stopStream, stopWatching, watchStream } from './room-queries'
import type { RoomRealtime } from './useRoomRealtime'

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

export type PublishState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'live'; readonly streamId: string }

export type WatchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'connecting'; readonly streamId: string; readonly attempt: number }
  | { readonly kind: 'watching'; readonly streamId: string }
  | { readonly kind: 'failed'; readonly streamId: string }

export interface RoomMedia {
  readonly supported: boolean
  readonly publish: PublishState
  readonly localStream: MediaStream | null
  readonly watch: WatchState
  readonly remoteStream: MediaStream | null
  readonly error: string | null
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
}: {
  roomId: string
  realtime: RoomRealtime
  connection: 'live' | 'reconnecting' | 'lost'
}): RoomMedia {
  const [supported] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.RTCPeerConnection === 'function' &&
      typeof navigator?.mediaDevices?.getDisplayMedia === 'function',
  )
  const [publish, setPublish] = useState<PublishState>({ kind: 'idle' })
  const [watch, setWatch] = useState<WatchState>({ kind: 'idle' })
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)
  const localStreamRef = useRef<MediaStream | null>(null)
  const publishedStreamId = useRef<string | null>(null)
  /** Outbound connections, one per watcher (≤9). */
  const outbound = useRef(new Map<string, RTCPeerConnection>())
  /** The single inbound connection. */
  const inbound = useRef<{ id: string; peer: RTCPeerConnection } | null>(null)
  /** The retryer for the current selection, if one is in flight (ADR 0077). */
  const watchAttempt = useRef<AsyncRetryer<(streamId: string) => Promise<void>> | null>(null)

  const closeInbound = useCallback(() => {
    const current = inbound.current
    inbound.current = null
    if (current) {
      realtime.sendSignal(current.id, { kind: 'close' })
      current.peer.close()
    }
    setRemoteStream(null)
  }, [realtime])

  /** ADR 0077: a retryer is single-use. Anything that ends the current watch —
      the stream stopping, another selection, leaving, a reconnect, cancelling —
      aborts the in-flight attempt and throws the retryer away rather than
      resetting it, so nothing can resume without a fresh explicit action. */
  const discardWatchAttempt = useCallback(() => {
    watchAttempt.current?.abort()
    watchAttempt.current = null
    closeInbound()
  }, [closeInbound])

  const releaseLocal = useCallback(() => {
    for (const [id, peer] of outbound.current) {
      realtime.sendSignal(id, { kind: 'close' })
      peer.close()
    }
    outbound.current.clear()
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    setLocalStream(null)
    publishedStreamId.current = null
  }, [realtime])

  // Publisher side of negotiation. The viewer offers, so a subscription this
  // client has never heard of is exactly how it learns a watcher arrived.
  useEffect(() => {
    return realtime.onSignal(async ({ subscriptionId, streamId, signal }) => {
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
      realtime.sendSignal(subscriptionId, { kind: 'answer', sdp: answer.sdp ?? '' })
    })

    function createPeer(subscriptionId: string) {
      const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        realtime.sendSignal(subscriptionId, {
          kind: 'candidate',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        })
      }
      return peer
    }
  }, [realtime])

  // A publisher stopping is authoritative: close the peer immediately rather
  // than waiting for the media to go silent (ADR 0104).
  useEffect(
    () =>
      realtime.onStreamStopped((streamId) => {
        setWatch((current) => {
          if (current.kind === 'idle' || current.streamId !== streamId) return current
          discardWatchAttempt()
          return { kind: 'idle' }
        })
      }),
    [realtime, discardWatchAttempt],
  )

  // Reconnect closes peer media at once; the grace only governs presentation.
  useEffect(() => {
    if (connection === 'live') return
    discardWatchAttempt()
    setWatch({ kind: 'idle' })
    if (connection === 'lost') {
      releaseLocal()
      setPublish({ kind: 'idle' })
    }
  }, [connection, discardWatchAttempt, releaseLocal])

  useEffect(() => () => {
    discardWatchAttempt()
    releaseLocal()
  }, [discardWatchAttempt, releaseLocal])

  return {
    supported,
    publish,
    localStream,
    watch,
    remoteStream,
    error,
    async startPublishing() {
      if (!supported || publish.kind !== 'idle') return
      cancelled.current = false
      setError(null)
      setPublish({ kind: 'starting' })
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      } catch {
        setPublish({ kind: 'idle' })
        setError('Screen sharing was not started.')
        return
      }
      if (cancelled.current) {
        stream.getTracks().forEach((track) => track.stop())
        setPublish({ kind: 'idle' })
        return
      }
      const result = await startStream({ data: roomId }).catch(() => null)
      if (!result || (result.status !== 'started' && result.status !== 'already-streaming')) {
        stream.getTracks().forEach((track) => track.stop())
        setPublish({ kind: 'idle' })
        setError(startFailure(result?.status))
        return
      }
      // Ending the share from the browser's own bar must stop the Stream too.
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
    },
    cancelPublishing() {
      cancelled.current = true
      if (publish.kind === 'starting') setPublish({ kind: 'idle' })
    },
    async stopPublishing() {
      const streamId = publishedStreamId.current
      releaseLocal()
      setPublish({ kind: 'idle' })
      if (streamId) await stopStream({ data: { streamId } }).catch(() => null)
    },
    async startWatching(streamId) {
      if (!supported) return
      setError(null)
      // Stop and clear the prior subscription first; a failed switch leaves the
      // viewer watching nothing rather than silently resuming (ADR 0101).
      discardWatchAttempt()
      setWatch({ kind: 'connecting', streamId, attempt: 1 })
      // One retryer per explicit selection or manual Retry — never reused, so
      // no attempt can outlive the action that asked for it (ADR 0077).
      const retryer: AsyncRetryer<(id: string) => Promise<void>> = new AsyncRetryer(
        (id: string) => negotiate(id, retryer.getAbortSignal()),
        {
          ...WATCH_RETRY_OPTIONS,
          onRetry: (attempt) => {
            closeInbound()
            setWatch({ kind: 'connecting', streamId, attempt: attempt + 1 })
          },
          onLastError: () => {
            // Exhausted: clear the attempt and hand the tile back to the viewer
            // with a manual Retry rather than looping on its own (ADR 0077).
            watchAttempt.current = null
            closeInbound()
            setWatch({ kind: 'failed', streamId })
          },
        },
      )
      watchAttempt.current = retryer
      await retryer.execute(streamId)
    },
    async stopWatchingStream() {
      discardWatchAttempt()
      setWatch({ kind: 'idle' })
      await stopWatching({ data: roomId }).catch(() => null)
    },
  }

  /** One direct-watch attempt: a fresh subscription and peer connection that
      settles only when the publisher's media arrives (ADR 0104). */
  async function negotiate(streamId: string, signal: AbortSignal | null) {
    const result = await watchStream({ data: { roomId, streamId } })
    if (result.status !== 'subscribed') throw new Error(result.status)
    if (signal?.aborted) throw new Error('aborted')
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    inbound.current = { id: result.id, peer }
    await new Promise<void>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        realtime.sendSignal(result.id, {
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
        resolve()
      }
      peer.addTransceiver('video', { direction: 'recvonly' })
      peer.addTransceiver('audio', { direction: 'recvonly' })
      peer
        .createOffer()
        .then(async (offer) => {
          await peer.setLocalDescription(offer)
          realtime.sendSignal(result.id, { kind: 'offer', sdp: offer.sdp ?? '' })
        })
        .catch(reject)
    })
  }
}

function startFailure(status: string | undefined) {
  if (status === 'account-read-only') return 'Your account is read-only right now.'
  if (status === 'all-access-sanctioned') return 'Streaming is unavailable on your account.'
  if (status === 'room-ended') return 'This room has ended.'
  return 'Your stream could not be started.'
}
