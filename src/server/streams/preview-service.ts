import { randomUUID } from 'node:crypto'
import type Redis from 'ioredis'
import type { Pool } from 'pg'
import { consumeFixedWindow } from '../rate-limits/fixed-window'
import { readWebpDimensions } from './preview-image'

/** ADR 0034's thumbnail budget: one upload every 110 seconds per stream
    session, capped at 100 KB. The client paces itself at 120 seconds (ADR
    0035); this is the server's own limit and does not trust that pacing. */
export const PREVIEW_BYTE_LIMIT = 100 * 1024
export const PREVIEW_UPLOAD_WINDOW_SECONDS = 110

/** Previews are live-only state — ADR 0023 keeps them out of the database
    recovery guarantee, so the bytes live in Valkey and expire on their own if
    a publisher disappears without stopping. Two missed refreshes' worth. */
export const PREVIEW_TTL_SECONDS = 300

/** A public-room preview is a readable thumbnail. A private-room preview must
    not be: ADR 0035 shows it blurred, and a blur applied only in CSS would
    still ship the readable bytes to anyone holding the key. Capping the stored
    width is what makes the private treatment true of the file itself. */
export const PUBLIC_PREVIEW_MAX_WIDTH = 640
export const PRIVATE_PREVIEW_MAX_WIDTH = 64

export type PreviewRejection = 'empty' | 'too-large' | 'not-webp' | 'too-detailed'

export type StorePreviewResult =
  | {
      readonly status: 'stored'
      readonly roomId: string
      readonly streamId: string
      readonly previewKey: string
      readonly updatedAt: Date
    }
  | { readonly status: 'not-streaming' }
  | { readonly status: 'rejected'; readonly reason: PreviewRejection }
  | { readonly status: 'rate-limited'; readonly retryAfterSeconds: number }

export interface StoredPreview {
  readonly bytes: Buffer
  readonly visibility: 'public' | 'private'
}

const PREVIEW_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface PreviewServiceConfiguration {
  readonly pool: Pool
  readonly valkey: Redis
  readonly valkeyPrefix: string
  readonly now?: () => Date
  /** Called after a committed upload so Home cards and room tiles can show the
      new preview without polling. Failures never fail the upload. */
  readonly onStored?: (stored: {
    readonly roomId: string
    readonly streamId: string
    readonly previewKey: string
    readonly updatedAt: Date
  }) => void
}

/** ADR 0035's capture target: the latest preview of each live Stream, held
    live-only, replaced rather than accumulated. */
export class PreviewService {
  private readonly pool: Pool
  private readonly valkey: Redis
  private readonly valkeyPrefix: string
  private readonly now: () => Date
  private readonly onStored: NonNullable<PreviewServiceConfiguration['onStored']>

  constructor(configuration: PreviewServiceConfiguration) {
    this.pool = configuration.pool
    this.valkey = configuration.valkey
    this.valkeyPrefix = configuration.valkeyPrefix
    this.now = configuration.now ?? (() => new Date())
    this.onStored = configuration.onStored ?? (() => {})
  }

  async store(accountId: string, bytes: Buffer): Promise<StorePreviewResult> {
    if (bytes.byteLength === 0) return { status: 'rejected', reason: 'empty' }
    if (bytes.byteLength > PREVIEW_BYTE_LIMIT) {
      return { status: 'rejected', reason: 'too-large' }
    }
    const dimensions = readWebpDimensions(bytes)
    if (!dimensions) return { status: 'rejected', reason: 'not-webp' }

    // The publisher is resolved from the session's own live membership; a
    // client never names the stream it is uploading for (ADR 0104).
    const target = await this.pool.query<{
      streamId: string
      roomId: string
      visibility: 'public' | 'private'
    }>(
      `SELECT stream.id AS "streamId",
              stream.room_id AS "roomId",
              room.visibility
         FROM stream
         JOIN room_membership membership
           ON membership.id = stream.membership_id
          AND membership.left_at IS NULL
         JOIN room ON room.id = stream.room_id
        WHERE membership.account_id = $1
          AND stream.ended_at IS NULL
          AND room.ended_at IS NULL`,
      [accountId],
    )
    const stream = target.rows[0]
    if (!stream) return { status: 'not-streaming' }

    const maxWidth =
      stream.visibility === 'private' ? PRIVATE_PREVIEW_MAX_WIDTH : PUBLIC_PREVIEW_MAX_WIDTH
    if (dimensions.width > maxWidth) return { status: 'rejected', reason: 'too-detailed' }

    const decision = await consumeFixedWindow(
      this.valkey,
      this.valkeyPrefix,
      `stream-preview:${stream.streamId}`,
      1,
      PREVIEW_UPLOAD_WINDOW_SECONDS,
    )
    if (decision.kind === 'limited') {
      return { status: 'rate-limited', retryAfterSeconds: decision.retryAfterSeconds }
    }

    const previewKey = randomUUID()
    const updatedAt = this.now()
    await this.valkey.set(this.bytesKey(previewKey), bytes, 'EX', PREVIEW_TTL_SECONDS)
    const client = await this.pool.connect()
    let previousKey: string | null
    try {
      await client.query('BEGIN')
      const current = await client.query<{ previousKey: string | null }>(
        `SELECT preview_key AS "previousKey"
           FROM stream
          WHERE id = $1 AND ended_at IS NULL
          FOR UPDATE`,
        [stream.streamId],
      )
      if (!current.rows[0]) {
        await client.query('ROLLBACK')
        await this.valkey.del(this.bytesKey(previewKey))
        return { status: 'not-streaming' }
      }
      previousKey = current.rows[0].previousKey
      await client.query(
        `UPDATE stream
            SET preview_key = $2, preview_updated_at = $3
          WHERE id = $1`,
        [stream.streamId, previewKey, updatedAt],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      await this.valkey.del(this.bytesKey(previewKey))
      throw error
    } finally {
      client.release()
    }
    // The row lock makes this the key actually displaced by this upload, even
    // when two accepted uploads reach the claim concurrently.
    if (previousKey) await this.valkey.del(this.bytesKey(previousKey))

    const stored = {
      roomId: stream.roomId,
      streamId: stream.streamId,
      previewKey,
      updatedAt,
    }
    try {
      this.onStored(stored)
    } catch {
      // Fan-out is best effort once the preview is stored.
    }
    return { status: 'stored', ...stored }
  }

  /** Serving is deliberately not membership-gated: Home shows previews of
      public and private rooms alike to visitors who have not joined anything
      (ADR 0084). What keeps a private room private is the stored image itself
      — see `PRIVATE_PREVIEW_MAX_WIDTH`. A key still only serves while its
      Stream is live, so stopping a Stream retires its preview at once. */
  async read(previewKey: string): Promise<StoredPreview | null> {
    if (!PREVIEW_KEY.test(previewKey)) return null
    const owner = await this.pool.query<{ visibility: 'public' | 'private' }>(
      `SELECT room.visibility
         FROM stream
         JOIN room ON room.id = stream.room_id
        WHERE stream.preview_key = $1
          AND stream.ended_at IS NULL
          AND room.ended_at IS NULL`,
      [previewKey],
    )
    const visibility = owner.rows[0]?.visibility
    if (!visibility) return null
    const bytes = await this.valkey.getBuffer(this.bytesKey(previewKey))
    return bytes ? { bytes, visibility } : null
  }

  private bytesKey(previewKey: string) {
    return `${this.valkeyPrefix}preview:${previewKey}`
  }
}
