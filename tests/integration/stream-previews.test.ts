import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterEach, describe, expect, test } from 'vitest'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { RoomService } from '../../src/server/rooms/room-service'
import { StreamService } from '../../src/server/streams/stream-service'
import {
  PreviewService,
  PREVIEW_BYTE_LIMIT,
  PREVIEW_UPLOAD_WINDOW_SECONDS,
} from '../../src/server/streams/preview-service'
import {
  bindPreviewRuntime,
  handleStreamPreviewRequest,
} from '../../src/server/streams/preview-http'
import { TestClock } from '../helpers/test-clock'
import { getIntegrationContext } from '../setup/integration'

const fixtures: Array<() => Promise<void>> = []

afterEach(async () => {
  bindPreviewRuntime({})
  await Promise.all(fixtures.splice(0).map((cleanup) => cleanup()))
})

/** A lossless WebP of the given canvas size. Only the header matters — the
    server reads dimensions and never decodes the image. */
function webp(width: number, height: number, padding = 0): Buffer {
  const payload = Buffer.alloc(20 + padding)
  payload[0] = 0x2f
  payload.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1)
  const size = Buffer.alloc(4)
  size.writeUInt32LE(payload.byteLength)
  const body = Buffer.concat([Buffer.from('WEBP'), Buffer.from('VP8L'), size, payload])
  const riffSize = Buffer.alloc(4)
  riffSize.writeUInt32LE(body.byteLength)
  return Buffer.concat([Buffer.from('RIFF'), riffSize, body])
}

async function createFixture() {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `stream-previews-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  await migrateAuthDatabase(pool, context.environment.schema)
  const valkey = new Redis(context.environment.valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  await valkey.connect()
  const clock = new TestClock(1_000_000)
  const now = () => new Date(clock.now())
  const valkeyPrefix = `${context.environment.valkeyPrefix}previews-${randomUUID()}:`
  const stored: Array<{ roomId: string; streamId: string; previewKey: string }> = []
  const rooms = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${valkeyPrefix}room:`,
    now,
    revokeConnections: () => undefined,
  })
  const account = async (name: string) => {
    const id = randomUUID()
    await pool.query(
      'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, false, $4, $4)',
      [id, name, `${id}@example.test`, now()],
    )
    return id
  }
  fixtures.push(async () => {
    const keys = await valkey.keys(`${valkeyPrefix}*`)
    if (keys.length > 0) await valkey.del(...keys)
    await Promise.all([pool.end(), valkey.quit()])
  })
  return {
    pool,
    valkey,
    valkeyPrefix,
    clock,
    rooms,
    account,
    stored,
    streams: new StreamService({ pool, now }),
    previews: new PreviewService({
      pool,
      valkey,
      valkeyPrefix,
      now,
      onStored: (event) => stored.push(event),
    }),
    /** Lets a test take a second capture without waiting out ADR 0034's
        window, which is real Valkey time rather than the test clock. */
    clearRateLimit: (streamId: string) =>
      valkey.del(`${valkeyPrefix}stream-preview:${streamId}`),
  }
}

function created(result: Awaited<ReturnType<RoomService['createRoom']>>) {
  expect(result.status).toBe('created')
  if (result.status !== 'created') throw new Error(`Expected created, got ${result.status}`)
  return result
}

async function streaming(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  visibility: 'public' | 'private' = 'public',
) {
  const host = await fixture.account('Hana')
  const room = created(
    await fixture.rooms.createRoom(host, {
      name: `Preview room ${randomUUID().slice(0, 8)}`,
      visibility,
      ...(visibility === 'private' ? { password: 'correct horse battery' } : {}),
    }),
  )
  const started = await fixture.streams.start(host, room.room.id)
  if (started.status !== 'started') throw new Error(`Expected started, got ${started.status}`)
  return {
    host,
    roomId: room.room.id,
    streamId: started.streamId,
    expiresAt: room.room.expiresAt,
  }
}

async function leaveConfirmed(rooms: RoomService, accountId: string) {
  const result = await rooms.leave(accountId)
  return result.status === 'confirmation-required'
    ? rooms.leave(accountId, { confirmation: result.confirmation })
    : result
}

describe('stream previews', () => {
  test('stores the latest preview of a live stream and serves it back', async () => {
    const fixture = await createFixture()
    const { host, roomId, streamId } = await streaming(fixture)

    const result = await fixture.previews.store(host, webp(640, 360))
    expect(result).toMatchObject({ status: 'stored', roomId, streamId })
    if (result.status !== 'stored') throw new Error('Expected a stored preview')

    const row = await fixture.pool.query<{ key: string; at: Date }>(
      'SELECT preview_key AS key, preview_updated_at AS at FROM stream WHERE id = $1',
      [streamId],
    )
    expect(row.rows[0]?.key).toBe(result.previewKey)
    expect(row.rows[0]?.at).toEqual(new Date(fixture.clock.now()))
    expect(fixture.stored).toMatchObject([{ streamId, previewKey: result.previewKey }])

    const served = await fixture.previews.read(result.previewKey)
    expect(served?.visibility).toBe('public')
    expect(served?.bytes.equals(webp(640, 360))).toBe(true)

    // The bytes are live-only: Valkey expires them without anyone sweeping.
    const ttl = await fixture.valkey.ttl(`${fixture.valkeyPrefix}preview:${result.previewKey}`)
    expect(ttl).toBeGreaterThan(0)
  })

  test('archives the latest public capture through Stream stop and empty-room end', async () => {
    const fixture = await createFixture()
    const { host, roomId, streamId } = await streaming(fixture)
    const firstBytes = webp(640, 360)
    const secondBytes = webp(320, 180)

    const first = await fixture.previews.store(host, firstBytes)
    if (first.status !== 'stored') throw new Error('Expected a stored preview')
    await fixture.clearRateLimit(streamId)
    fixture.clock.advanceTo(fixture.clock.now() + 120_000)
    const second = await fixture.previews.store(host, secondBytes)
    if (second.status !== 'stored') throw new Error('Expected a replacement preview')

    await fixture.streams.stop(host)
    await expect(leaveConfirmed(fixture.rooms, host)).resolves.toMatchObject({ status: 'left' })
    fixture.clock.advanceTo(fixture.clock.now() + 5 * 60_000)
    expect(await fixture.rooms.endDueRooms()).toBeGreaterThanOrEqual(1)

    await expect(fixture.previews.readArchived(roomId)).resolves.toEqual({
      bytes: secondBytes,
      capturedAt: second.updatedAt,
    })
  })

  test('keeps a public archive through lifetime and Platform Admin end paths', async () => {
    const lifetime = await createFixture()
    const due = await streaming(lifetime)
    const lifetimeBytes = webp(640, 360)
    await lifetime.previews.store(due.host, lifetimeBytes)
    lifetime.clock.advanceTo(due.expiresAt.getTime())
    expect(await lifetime.rooms.endDueRooms()).toBeGreaterThanOrEqual(1)
    await expect(lifetime.previews.readArchived(due.roomId)).resolves.toMatchObject({
      bytes: lifetimeBytes,
    })

    const enforced = await createFixture()
    const live = await streaming(enforced)
    const admin = await enforced.account('Admin')
    const adminBytes = webp(320, 180)
    await enforced.previews.store(live.host, adminBytes)
    await expect(
      enforced.rooms.adminEndRoom(
        { accountId: admin, isPlatformAdmin: true },
        live.roomId,
      ),
    ).resolves.toMatchObject({ status: 'ended' })
    await expect(enforced.previews.readArchived(live.roomId)).resolves.toMatchObject({
      bytes: adminBytes,
    })
  })

  test('never reads a live or private Room archive', async () => {
    const fixture = await createFixture()
    const publicRoom = await streaming(fixture)
    await fixture.previews.store(publicRoom.host, webp(640, 360))
    await expect(fixture.previews.readArchived(publicRoom.roomId)).resolves.toBeNull()

    const privateFixture = await createFixture()
    const privateRoom = await streaming(privateFixture, 'private')
    await privateFixture.previews.store(privateRoom.host, webp(64, 36))
    await expect(
      privateFixture.pool.query(
        'SELECT room_id FROM past_stream_thumbnail WHERE room_id = $1',
        [privateRoom.roomId],
      ),
    ).resolves.toMatchObject({ rows: [] })
    const admin = await privateFixture.account('Admin')
    await privateFixture.rooms.adminEndRoom(
      { accountId: admin, isPlatformAdmin: true },
      privateRoom.roomId,
    )
    await expect(privateFixture.previews.readArchived(privateRoom.roomId)).resolves.toBeNull()
  })

  test('deletes a public archive on privacy change and archives a later public capture', async () => {
    const fixture = await createFixture()
    const { host, roomId, streamId } = await streaming(fixture)
    await fixture.previews.store(host, webp(640, 360))

    await fixture.rooms.updateRoom(host, roomId, {
      name: 'Now private',
      visibility: 'private',
      password: 'correct horse battery',
    })
    await expect(
      fixture.pool.query(
        'SELECT room_id FROM past_stream_thumbnail WHERE room_id = $1',
        [roomId],
      ),
    ).resolves.toMatchObject({ rows: [] })
    await fixture.rooms.updateRoom(host, roomId, {
      name: 'Public again',
      visibility: 'public',
    })
    await fixture.clearRateLimit(streamId)
    fixture.clock.advanceTo(fixture.clock.now() + 120_000)
    const replacementBytes = webp(320, 180)
    await fixture.previews.store(host, replacementBytes)
    const admin = await fixture.account('Admin')
    await fixture.rooms.adminEndRoom(
      { accountId: admin, isPlatformAdmin: true },
      roomId,
    )

    await expect(fixture.previews.readArchived(roomId)).resolves.toMatchObject({
      bytes: replacementBytes,
    })
  })

  test('serves only ended public archives over the immutable HTTP path', async () => {
    const fixture = await createFixture()
    const { host, roomId } = await streaming(fixture)
    const bytes = webp(640, 360)
    await fixture.previews.store(host, bytes)
    bindPreviewRuntime({ previews: fixture.previews })

    const live = await handleStreamPreviewRequest(
      new Request(`http://example.test/api/past-stream-previews/${roomId}`),
    )
    expect(live?.status).toBe(404)
    expect(live?.headers.get('cache-control')).toBe('no-store')

    const admin = await fixture.account('Admin')
    await fixture.rooms.adminEndRoom(
      { accountId: admin, isPlatformAdmin: true },
      roomId,
    )
    const ended = await handleStreamPreviewRequest(
      new Request(`http://example.test/api/past-stream-previews/${roomId}`),
    )
    expect(ended?.status).toBe(200)
    expect(ended?.headers.get('content-type')).toBe('image/webp')
    expect(ended?.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(Buffer.from(await ended!.arrayBuffer())).toEqual(bytes)

    const noCapture = await streaming(fixture)
    const privateCapture = await streaming(fixture, 'private')
    await fixture.previews.store(privateCapture.host, webp(64, 36))
    for (const absent of [noCapture.roomId, privateCapture.roomId]) {
      await fixture.rooms.adminEndRoom(
        { accountId: admin, isPlatformAdmin: true },
        absent,
      )
      const missing = await handleStreamPreviewRequest(
        new Request(`http://example.test/api/past-stream-previews/${absent}`),
      )
      expect(missing?.status).toBe(404)
      expect(missing?.headers.get('cache-control')).toBe('no-store')
    }

    for (const segment of [randomUUID(), 'not-a-room-id']) {
      const missing = await handleStreamPreviewRequest(
        new Request(`http://example.test/api/past-stream-previews/${segment}`),
      )
      expect(missing?.status).toBe(404)
      expect(missing?.headers.get('cache-control')).toBe('no-store')
    }
  })

  test('keeps only the newest preview and drops the bytes behind the old key', async () => {
    const fixture = await createFixture()
    const { host, streamId } = await streaming(fixture)

    const first = await fixture.previews.store(host, webp(640, 360))
    if (first.status !== 'stored') throw new Error('Expected a stored preview')
    await fixture.clearRateLimit(streamId)
    fixture.clock.advanceTo(fixture.clock.now() + 120_000)
    const second = await fixture.previews.store(host, webp(320, 180))
    if (second.status !== 'stored') throw new Error('Expected a second stored preview')

    expect(second.previewKey).not.toBe(first.previewKey)
    expect(await fixture.previews.read(first.previewKey)).toBeNull()
    expect((await fixture.previews.read(second.previewKey))?.bytes.byteLength).toBe(
      webp(320, 180).byteLength,
    )
  })

  test('serializes concurrent replacements and removes the displaced bytes', async () => {
    const fixture = await createFixture()
    const { host, streamId } = await streaming(fixture)
    const originalSet = fixture.valkey.set.bind(fixture.valkey)
    const firstWrite = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    let delay = true
    fixture.valkey.set = (async (...args: Parameters<typeof originalSet>) => {
      if (delay && String(args[0]).includes('preview:')) {
        delay = false
        firstWrite.resolve()
        await releaseFirst.promise
      }
      return originalSet(...args)
    }) as typeof fixture.valkey.set

    const first = fixture.previews.store(host, webp(640, 360))
    await firstWrite.promise
    await fixture.clearRateLimit(streamId)
    const second = await fixture.previews.store(host, webp(320, 180))
    releaseFirst.resolve()
    const completed = await first
    expect(second.status).toBe('stored')
    expect(completed.status).toBe('stored')

    const keys = await fixture.valkey.keys(`${fixture.valkeyPrefix}preview:*`)
    expect(keys).toHaveLength(1)
    const row = await fixture.pool.query<{ key: string }>(
      'SELECT preview_key AS key FROM stream WHERE id = $1',
      [streamId],
    )
    expect(keys[0]).toBe(`${fixture.valkeyPrefix}preview:${row.rows[0]?.key}`)
  })

  test('holds a publisher to one upload per window', async () => {
    const fixture = await createFixture()
    const { host } = await streaming(fixture)

    expect((await fixture.previews.store(host, webp(640, 360))).status).toBe('stored')
    await expect(fixture.previews.store(host, webp(640, 360))).resolves.toMatchObject({
      status: 'rate-limited',
      retryAfterSeconds: expect.any(Number),
    })
    const limited = await fixture.previews.store(host, webp(640, 360))
    if (limited.status !== 'rate-limited') throw new Error('Expected a rate limit')
    expect(limited.retryAfterSeconds).toBeLessThanOrEqual(PREVIEW_UPLOAD_WINDOW_SECONDS)
  })

  test('refuses a private room preview detailed enough to read', async () => {
    const fixture = await createFixture()
    const { host, streamId } = await streaming(fixture, 'private')

    await expect(fixture.previews.store(host, webp(640, 360))).resolves.toEqual({
      status: 'rejected',
      reason: 'too-detailed',
    })
    const untouched = await fixture.pool.query(
      'SELECT preview_key FROM stream WHERE id = $1',
      [streamId],
    )
    expect(untouched.rows[0]?.preview_key).toBeNull()

    const small = await fixture.previews.store(host, webp(64, 36))
    expect(small.status).toBe('stored')
    if (small.status !== 'stored') throw new Error('Expected a stored preview')
    expect((await fixture.previews.read(small.previewKey))?.visibility).toBe('private')
  })

  test('refuses bytes that are not a WebP, and bytes past the cap', async () => {
    const fixture = await createFixture()
    const { host } = await streaming(fixture)

    await expect(fixture.previews.store(host, Buffer.alloc(0))).resolves.toEqual({
      status: 'rejected',
      reason: 'empty',
    })
    await expect(
      fixture.previews.store(host, Buffer.alloc(PREVIEW_BYTE_LIMIT + 1, 1)),
    ).resolves.toEqual({ status: 'rejected', reason: 'too-large' })
    await expect(
      fixture.previews.store(host, Buffer.from('PNG, or anything else at all')),
    ).resolves.toEqual({ status: 'rejected', reason: 'not-webp' })
  })

  test('archives a capture at the exact byte limit', async () => {
    const fixture = await createFixture()
    const { host, roomId } = await streaming(fixture)
    const base = webp(640, 360)
    const bytes = webp(640, 360, PREVIEW_BYTE_LIMIT - base.byteLength)
    expect(bytes.byteLength).toBe(PREVIEW_BYTE_LIMIT)
    await expect(fixture.previews.store(host, bytes)).resolves.toMatchObject({
      status: 'stored',
    })
    const admin = await fixture.account('Admin')
    await fixture.rooms.adminEndRoom(
      { accountId: admin, isPlatformAdmin: true },
      roomId,
    )
    await expect(fixture.previews.readArchived(roomId)).resolves.toMatchObject({
      bytes,
    })
  })

  test('has nothing to store without a live stream, and stops serving when one ends', async () => {
    const fixture = await createFixture()
    const idle = await fixture.account('Ida')
    await expect(fixture.previews.store(idle, webp(640, 360))).resolves.toEqual({
      status: 'not-streaming',
    })

    const { host } = await streaming(fixture)
    const stored = await fixture.previews.store(host, webp(640, 360))
    if (stored.status !== 'stored') throw new Error('Expected a stored preview')

    await fixture.streams.stop(host)
    expect(await fixture.previews.read(stored.previewKey)).toBeNull()
  })

  test('retires a public preview when the room turns private', async () => {
    const fixture = await createFixture()
    const { host, roomId } = await streaming(fixture)
    const stored = await fixture.previews.store(host, webp(640, 360))
    if (stored.status !== 'stored') throw new Error('Expected a stored preview')

    expect(
      await fixture.rooms.updateRoom(host, roomId, {
        name: 'Now private',
        visibility: 'private',
        password: 'correct horse battery',
      }),
    ).toEqual({ status: 'updated' })

    expect(await fixture.previews.read(stored.previewKey)).toBeNull()
    const row = await fixture.pool.query(
      'SELECT preview_key, preview_updated_at FROM stream WHERE room_id = $1',
      [roomId],
    )
    expect(row.rows[0]).toEqual({ preview_key: null, preview_updated_at: null })
  })

  test('serves nothing for a key nobody holds', async () => {
    const fixture = await createFixture()
    expect(await fixture.previews.read(randomUUID())).toBeNull()
    expect(await fixture.previews.read('../../etc/passwd')).toBeNull()
  })
})
