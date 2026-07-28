import { useAsyncThrottler } from '@tanstack/react-pacer'
import { useEffect } from 'react'

/** ADR 0035: the browser paces its own uploads at two minutes, leading and
    trailing, so the first usable frame goes up at once and captures inside the
    window collapse to the latest one. The server keeps its own, tighter limit
    (ADR 0034) and does not trust this. */
export const PREVIEW_UPLOAD_INTERVAL_MS = 120_000

/** Captures are cheap and uploads are not, so frames are taken more often than
    they are sent and the throttler drops all but the newest. */
const CAPTURE_INTERVAL_MS = 30_000

/** A public preview is a readable thumbnail; a private one is captured small
    enough that the blur is not the only thing hiding the screen (ADR 0035).
    The server enforces the same two widths. */
export const PUBLIC_PREVIEW_WIDTH = 640
export const PRIVATE_PREVIEW_WIDTH = 64

const PREVIEW_PATH = '/api/stream-previews'

/** Uploads the latest frame of the viewer's own Stream. Stopping the stream,
    leaving, or unmounting cancels pending work and aborts an upload in flight
    — nothing about a preview outlives the Stream it came from. */
export function useStreamPreview({
  stream,
  visibility,
}: {
  readonly stream: MediaStream | null
  readonly visibility: 'public' | 'private'
}) {
  const uploader = useAsyncThrottler(
    async (frame: Blob) => {
      await fetch(PREVIEW_PATH, {
        method: 'POST',
        body: frame,
        headers: { 'content-type': 'image/webp' },
        signal: uploader.getAbortSignal() ?? undefined,
      })
    },
    {
      wait: PREVIEW_UPLOAD_INTERVAL_MS,
      leading: true,
      trailing: true,
      throwOnError: false,
    },
  )

  useEffect(() => {
    if (!stream || typeof document === 'undefined') return
    const width = visibility === 'private' ? PRIVATE_PREVIEW_WIDTH : PUBLIC_PREVIEW_WIDTH
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    const canvas = document.createElement('canvas')
    let stopped = false

    const capture = async () => {
      const frame = await captureFrame(video, canvas, width)
      if (frame && !stopped) await uploader.maybeExecute(frame)
    }
    void video.play().then(capture).catch(() => undefined)
    const timer = setInterval(() => void capture(), CAPTURE_INTERVAL_MS)

    return () => {
      stopped = true
      clearInterval(timer)
      uploader.cancel()
      uploader.abort()
      video.srcObject = null
    }
  }, [stream, visibility, uploader])
}

async function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxWidth: number,
): Promise<Blob | null> {
  if (!video.videoWidth || !video.videoHeight) return null
  const width = Math.min(maxWidth, video.videoWidth)
  canvas.width = width
  canvas.height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const frame = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.6),
  )
  // A browser that cannot encode WebP hands back a PNG instead; the server
  // would reject it, so the tile simply keeps showing no preview.
  return frame?.type === 'image/webp' ? frame : null
}
