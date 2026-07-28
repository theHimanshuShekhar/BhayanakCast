import { getProductionAuth, readSessionProjection } from '../auth/auth'
import {
  PREVIEW_BYTE_LIMIT,
  PREVIEW_TTL_SECONDS,
  type PreviewService,
} from './preview-service'

/** ADR 0029 keeps the documented thumbnail path stable, and an `<img>` cannot
    call a server function, so previews travel over plain HTTP on this path. */
const PREVIEW_PATH = '/api/stream-previews'

let service: PreviewService | undefined

export function bindPreviewRuntime(configuration: { readonly previews?: PreviewService }) {
  service = configuration.previews
}

export function getPreviewService() {
  if (!service) throw new Error('Preview runtime is not configured')
  return service
}

/** Returns `null` for anything that is not a preview request, so the caller
    falls through to the application router unchanged. */
export async function handleStreamPreviewRequest(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== PREVIEW_PATH && !url.pathname.startsWith(`${PREVIEW_PATH}/`)) {
    return null
  }
  if (!service) return new Response(null, { status: 503 })
  if (request.method === 'POST' && url.pathname === PREVIEW_PATH) {
    return upload(service, request)
  }
  if (request.method === 'GET' && url.pathname.length > PREVIEW_PATH.length + 1) {
    return serve(service, url.pathname.slice(PREVIEW_PATH.length + 1))
  }
  return new Response(null, { status: 405 })
}

async function upload(previews: PreviewService, request: Request): Promise<Response> {
  // `image/webp` is not a CORS-simple content type, so a cross-site form post
  // cannot reach this handler without a preflight nobody answers.
  if (request.headers.get('content-type') !== 'image/webp') {
    return new Response(null, { status: 415 })
  }
  const session = await readSessionProjection(getProductionAuth(), request.headers)
  if (!session) return new Response(null, { status: 401 })

  const bytes = await readCappedBody(request, PREVIEW_BYTE_LIMIT)
  if (!bytes) return new Response(null, { status: 413 })

  const result = await previews.store(session.id, bytes)
  if (result.status === 'stored') {
    return Response.json(
      { previewKey: result.previewKey, updatedAt: result.updatedAt.toISOString() },
      { status: 201 },
    )
  }
  if (result.status === 'rate-limited') {
    return new Response(null, {
      status: 429,
      headers: { 'retry-after': String(result.retryAfterSeconds) },
    })
  }
  if (result.status === 'not-streaming') return new Response(null, { status: 409 })
  return new Response(null, { status: result.reason === 'too-large' ? 413 : 422 })
}

async function serve(previews: PreviewService, segment: string): Promise<Response> {
  const stored = await previews.read(decodeURIComponent(segment))
  if (!stored) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(stored.bytes), {
    headers: {
      'content-type': 'image/webp',
      // Each upload gets its own key, so the bytes behind one never change.
      // `private` keeps a shared cache out of a private room's previews.
      'cache-control': `private, max-age=${PREVIEW_TTL_SECONDS}, immutable`,
    },
  })
}

/** Reads at most `limit` bytes and gives up rather than buffering whatever a
    client decided to send. */
async function readCappedBody(request: Request, limit: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) return null
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}
