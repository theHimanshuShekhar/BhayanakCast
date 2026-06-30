import { useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { Radio, Square } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  canShareScreen,
  streamTrackSummary,
  thumbnailIntervalMs,
} from '#/lib/streaming-client'

const WATCH_RETRY_ATTEMPTS = 3
const WATCH_RETRY_WINDOW_MS = 15_000
const WATCH_RETRY_DELAY_MS = WATCH_RETRY_WINDOW_MS / WATCH_RETRY_ATTEMPTS

export type LiveRoomMember = {
  membershipId?: string
  joinedAt?: string
  isHost?: boolean
  isStreaming?: boolean
  user: { id: string; name?: string | null }
}

export type LiveRoomStream = {
  id?: string
  streamSessionId?: string
  startedAt?: string
  user: { id: string; name?: string | null }
}

type WatchStartAck = {
  ok: boolean
  code?: string
  data?: { stream: LiveRoomStream; streamerSocketId: string }
}

type SignalDescription = {
  streamSessionId: string
  targetSocketId: string
  fromSocketId: string
  description: RTCSessionDescriptionInit
}

type SignalIce = {
  streamSessionId: string
  targetSocketId: string
  fromSocketId: string
  candidate: RTCIceCandidateInit
}

export function RoomStreamPanel({
  members,
  roomId,
  socket,
  status,
  streams,
}: {
  members: LiveRoomMember[]
  roomId: string
  socket: Socket | null
  status: string
  streams: LiveRoomStream[]
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const subscribedTileRef = useRef<HTMLElement>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef(new Map<string, RTCPeerConnection>())
  const thumbnailTimerRef = useRef<number | undefined>(undefined)
  const [shareSupported, setShareSupported] = useState(false)
  const [streamSessionId, setStreamSessionId] = useState<string | null>(null)
  const [watchedStreamSessionId, setWatchedStreamSessionId] = useState<string | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [remoteMuted, setRemoteMuted] = useState(false)
  const [watchError, setWatchError] = useState('')
  const [localStatus, setLocalStatus] = useState('Ready')

  useEffect(() => {
    setShareSupported(canShareScreen(navigator.mediaDevices))
  }, [])

  useEffect(() => {
    if (!socket) return

    const onOffer = (event: SignalDescription) => {
      void answerOffer(socket, event)
    }
    const onAnswer = (event: SignalDescription) => {
      void peersRef.current.get(event.fromSocketId)?.setRemoteDescription(event.description)
    }
    const onIce = (event: SignalIce) => {
      void peersRef.current.get(event.fromSocketId)?.addIceCandidate(event.candidate)
    }

    socket.on('signal:offer', onOffer)
    socket.on('signal:answer', onAnswer)
    socket.on('signal:iceCandidate', onIce)

    return () => {
      socket.off('signal:offer', onOffer)
      socket.off('signal:answer', onAnswer)
      socket.off('signal:iceCandidate', onIce)
    }
  }, [socket])

  useEffect(() => {
    return () => {
      stopLocalStream()
      closePeers()
    }
  }, [])

  async function startSharing() {
    if (!socket) return
    if (!canShareScreen(navigator.mediaDevices)) {
      setLocalStatus('Screen sharing requires Chromium desktop capture')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
    } catch {
      setLocalStatus('Ready')
      return
    }

    localStreamRef.current = stream
    if (localVideoRef.current) localVideoRef.current.srcObject = stream

    const ack = await socket.timeout(5_000).emitWithAck('stream:start', {
      roomId,
      ...streamTrackSummary(stream),
    })
    if (!ack.ok) {
      stopLocalStream()
      setLocalStatus(ack.code ?? 'STREAM_START_FAILED')
      return
    }

    const activeStreamId = getStreamId(ack.data.stream)
    setStreamSessionId(activeStreamId)
    setLocalStatus('Streaming')
    stream.getVideoTracks()[0]?.addEventListener('ended', () => void stopSharing())
    thumbnailTimerRef.current = window.setInterval(
      () => void uploadThumbnail(activeStreamId),
      thumbnailIntervalMs,
    )
  }

  async function stopSharing() {
    const activeStreamId = streamSessionId
    stopLocalStream()
    setStreamSessionId(null)
    setLocalStatus('Ready')
    if (socket && activeStreamId) {
      await socket.timeout(5_000).emitWithAck('stream:stop', {
        roomId,
        streamSessionId: activeStreamId,
      })
    }
  }

  async function watchStream(stream: LiveRoomStream, attempt = 1) {
    if (!socket) return
    const activeStreamId = getStreamId(stream)

    try {
      setWatchError('')
      const watchAck = (await socket.timeout(5_000).emitWithAck('watch:start', {
        roomId,
        streamSessionId: activeStreamId,
      })) as WatchStartAck
      if (!watchAck.ok || !watchAck.data) {
        setWatchError(watchAck.code ?? 'CONNECTION_FAILED')
        return
      }

      const streamerSocketId = watchAck.data.streamerSocketId
      const peer = createPeer(socket, activeStreamId, streamerSocketId)
      peer.addTransceiver('video', { direction: 'recvonly' })
      peer.addTransceiver('audio', { direction: 'recvonly' })
      peer.ontrack = (event) => {
        const nextStream = event.streams[0]
        setRemoteStream(nextStream)
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = nextStream
      }
      peersRef.current.set(streamerSocketId, peer)

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      const offerAck = (await socket.timeout(5_000).emitWithAck('signal:offer', {
        roomId,
        streamSessionId: activeStreamId,
        targetSocketId: streamerSocketId,
        description: offer,
      })) as { ok: boolean }
      if (!offerAck.ok) throw new Error('signal offer failed')

      setWatchedStreamSessionId(activeStreamId)
      setLocalStatus('Watching')
    } catch {
      closePeers()
      if (attempt < WATCH_RETRY_ATTEMPTS) {
        setLocalStatus(`Retrying watch ${attempt + 1}/${WATCH_RETRY_ATTEMPTS}`)
        window.setTimeout(
          () => void watchStream(stream, attempt + 1),
          WATCH_RETRY_DELAY_MS,
        )
        return
      }
      setWatchError('CONNECTION_FAILED')
      setLocalStatus('CONNECTION_FAILED')
    }
  }

  async function stopWatching() {
    const activeStreamId = watchedStreamSessionId
    closePeers()
    setRemoteStream(null)
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    setWatchedStreamSessionId(null)
    setLocalStatus('Ready')
    if (socket && activeStreamId) {
      await socket.timeout(5_000).emitWithAck('watch:stop', {
        roomId,
        streamSessionId: activeStreamId,
      })
    }
  }

  async function answerOffer(activeSocket: Socket, event: SignalDescription) {
    const stream = localStreamRef.current
    if (!stream) return

    const peer = createPeer(activeSocket, event.streamSessionId, event.fromSocketId)
    for (const track of stream.getTracks()) peer.addTrack(track, stream)
    peersRef.current.set(event.fromSocketId, peer)
    await peer.setRemoteDescription(event.description)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    await activeSocket.timeout(5_000).emitWithAck('signal:answer', {
      roomId,
      streamSessionId: event.streamSessionId,
      targetSocketId: event.fromSocketId,
      description: answer,
    })
  }

  function createPeer(
    activeSocket: Socket,
    activeStreamId: string,
    targetSocketId: string,
  ) {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    peer.onicecandidate = (event) => {
      if (!event.candidate) return
      activeSocket.emit('signal:iceCandidate', {
        roomId,
        streamSessionId: activeStreamId,
        targetSocketId,
        candidate: event.candidate.toJSON(),
      })
    }
    return peer
  }

  function stopLocalStream() {
    if (thumbnailTimerRef.current) window.clearInterval(thumbnailTimerRef.current)
    thumbnailTimerRef.current = undefined
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
  }

  async function uploadThumbnail(activeStreamId: string) {
    const video = localVideoRef.current
    if (!video || !socket || video.videoWidth === 0) return

    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * 320))
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.72),
    )
    if (!blob) return

    const data = await blob.arrayBuffer()
    await socket.timeout(5_000).emitWithAck('stream:thumbnail', {
      roomId,
      streamSessionId: activeStreamId,
      contentType: 'image/webp',
      byteLength: data.byteLength,
      data,
    })
  }

  function closePeers() {
    for (const peer of peersRef.current.values()) peer.close()
    peersRef.current.clear()
  }

  function toggleRemoteMute() {
    setRemoteMuted((muted) => !muted)
  }

  function fullscreenSubscribedTile() {
    void subscribedTileRef.current?.requestFullscreen()
  }

  const orderedMembers = orderMembers(members, streams)
  const fallbackMembers = orderedMembers.length
    ? orderedMembers
    : [{ user: { id: 'you', name: 'You' }, isStreaming: false }]
  const watchedStream = streams.find((stream) => getStreamId(stream) === watchedStreamSessionId)
  const previewTargets = watchTargets(streams, streamSessionId, watchedStreamSessionId)

  return (
    <div className="room-view room-mosaic-view relative flex min-h-0 flex-1 flex-col">
      <div className="mosaic room-mosaic grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(260px,1fr))] content-start gap-4 overflow-y-auto p-5 pb-24" style={{ gridAutoRows: 'minmax(220px, 320px)' }} aria-label="Room member mosaic">
        {streamSessionId ? (
          <article className="tile viewer-tile member-tile tile-subscribed motion-tile-state overflow-hidden rounded-3xl border border-cyan-300/20 bg-[#101b33] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
            <video autoPlay muted playsInline ref={localVideoRef} />
            <span className="stream-live-pill">● Live</span>
            <div className="stream-tile-caption member-name-chip">
              <span>Local preview</span>
              <strong>You</strong>
            </div>
          </article>
        ) : null}

        {watchedStream ? (
          <article className="tile viewer-tile member-tile tile-subscribed motion-tile-state overflow-hidden rounded-3xl border border-cyan-300/20 bg-[#101b33] shadow-[0_18px_50px_rgba(0,0,0,0.28)]" ref={subscribedTileRef}>
            <video autoPlay muted={remoteMuted} playsInline ref={remoteVideoRef} />
            <span className="stream-live-pill">● Live</span>
            <div className="stream-tile-caption member-name-chip">
              <span>{remoteStream ? 'Watching' : 'Connecting'}</span>
              <strong>{friendlyName(watchedStream.user)}</strong>
            </div>
            <div className="tile-controls member-tile-actions bottom-right-controls">
              <Button onClick={toggleRemoteMute} size="sm" variant="outline">
                {remoteMuted ? 'Unmute' : 'Mute'}
              </Button>
              <Button onClick={fullscreenSubscribedTile} size="sm" variant="outline">
                Fullscreen
              </Button>
              <Button onClick={() => void stopWatching()} size="sm" variant="destructive">
                Stop Watching
              </Button>
            </div>
          </article>
        ) : null}

        {previewTargets.map((stream) => (
          <article className="tile member-tile tile-preview motion-tile-state overflow-hidden rounded-3xl border border-violet-300/20 bg-[#101b33] shadow-[0_18px_50px_rgba(0,0,0,0.28)]" key={getStreamId(stream)}>
            <div className="tile-preview-blur" />
            <span className="stream-live-pill">● Live</span>
            <div className="stream-tile-caption member-name-chip">
              <span>Stream preview</span>
              <strong>{friendlyName(stream.user)}</strong>
            </div>
            <div className="tile-controls member-tile-actions bottom-right-controls">
              <Button onClick={() => void watchStream(stream)} size="sm" variant="outline">
                {watchError ? 'Retry' : 'View Stream'}
              </Button>
            </div>
            {watchError ? <p className="stream-error">{watchError || 'CONNECTION_FAILED'}</p> : null}
          </article>
        ))}

        {fallbackMembers.map((member) => (
          <article className="tile viewer-tile member-tile motion-tile-state overflow-hidden rounded-3xl border border-white/10 bg-[#10182d] shadow-[0_18px_50px_rgba(0,0,0,0.24)]" key={member.user.id}>
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-violet-300 to-cyan-300 text-sm font-black text-slate-950 shadow-[0_0_28px_rgba(34,211,238,0.22)]">
                  {friendlyName(member.user).slice(0, 2).toUpperCase()}
                </div>
                <strong className="mt-4 block max-w-full truncate text-sm font-black text-white">{friendlyName(member.user)}</strong>
                <span className="mt-1 block text-xs text-slate-500">{member.isStreaming ? 'Live' : 'Not streaming'}</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="streamer-bottom-controls pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#0b1220]/90 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.38)] backdrop-blur-xl">
        {!streamSessionId ? (
          <Button className="streamer-control-button border border-violet-300/30 bg-violet-500/20 text-violet-50 hover:bg-violet-500/30" disabled={!shareSupported || !socket} onClick={() => void startSharing()} size="sm">
            <Radio className="mr-2 h-4 w-4" /> Start stream
          </Button>
        ) : (
          <Button className="streamer-control-button" onClick={() => void stopSharing()} size="sm" variant="destructive">
            <Square className="mr-2 h-4 w-4" /> Stop stream
          </Button>
        )}
        <span className="px-2 text-xs text-slate-400">{localStatus || status}</span>
      </div>
    </div>
  )
}

function getStreamId(stream: LiveRoomStream) {
  return stream.streamSessionId ?? stream.id ?? ''
}

function watchTargets(
  streams: LiveRoomStream[],
  localStreamSessionId: string | null,
  watchedStreamSessionId: string | null,
) {
  return streams.filter((stream) => {
    const id = getStreamId(stream)
    return id !== localStreamSessionId && id !== watchedStreamSessionId
  })
}

function friendlyName(user: { name?: string | null; id?: string }) {
  if (user.name && user.name !== user.id) return user.name
  return user.id ? `Member ${user.id.slice(0, 4)}` : 'Room member'
}

function orderMembers(members: LiveRoomMember[], streams: LiveRoomStream[]) {
  const streamByUser = new Map(streams.map((stream) => [stream.user.id, stream]))
  return [...members].sort((left, right) => {
    const leftStream = streamByUser.get(left.user.id)
    const rightStream = streamByUser.get(right.user.id)
    if (leftStream && rightStream) {
      return (leftStream.startedAt ?? '').localeCompare(rightStream.startedAt ?? '')
    }
    if (leftStream) return -1
    if (rightStream) return 1
    return (left.joinedAt ?? '').localeCompare(right.joinedAt ?? '')
  })
}
