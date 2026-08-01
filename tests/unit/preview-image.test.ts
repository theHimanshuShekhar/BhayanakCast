import { describe, expect, test } from 'vitest'
import { readWebpDimensions } from '../../src/server/streams/preview-image'
import {
  previewFreshnessLabel,
  watcherAccessibleLabel,
} from '../../src/features/room/RoomMemberMosaic'

/** A WebP container with the given chunk payload, padded to a realistic
    length. The header is all the server ever reads. */
function container(chunk: string, payload: Buffer): Buffer {
  const body = Buffer.concat([
    Buffer.from('WEBP'),
    Buffer.from(chunk),
    uint32(payload.byteLength),
    payload,
  ])
  return Buffer.concat([Buffer.from('RIFF'), uint32(body.byteLength), body])
}

function uint32(value: number) {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value)
  return bytes
}

function lossy(width: number, height: number) {
  const payload = Buffer.alloc(20)
  payload.set([0x9d, 0x01, 0x2a], 3)
  payload.writeUInt16LE(width, 6)
  payload.writeUInt16LE(height, 8)
  return container('VP8 ', payload)
}

function lossless(width: number, height: number) {
  const payload = Buffer.alloc(20)
  payload[0] = 0x2f
  payload.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1)
  return container('VP8L', payload)
}

function extended(width: number, height: number) {
  const payload = Buffer.alloc(20)
  payload.writeUIntLE(width - 1, 4, 3)
  payload.writeUIntLE(height - 1, 7, 3)
  return container('VP8X', payload)
}

describe('readWebpDimensions', () => {
  test('reads the canvas size of each layout a browser produces', () => {
    expect(readWebpDimensions(lossy(640, 360))).toEqual({ width: 640, height: 360 })
    expect(readWebpDimensions(lossless(64, 36))).toEqual({ width: 64, height: 36 })
    expect(readWebpDimensions(extended(1920, 1080))).toEqual({ width: 1920, height: 1080 })
  })

  test('refuses anything that is not a WebP the browser would have made', () => {
    expect(readWebpDimensions(Buffer.alloc(64))).toBeNull()
    expect(readWebpDimensions(Buffer.from('not an image at all, truly not'))).toBeNull()
    // A PNG, which is what a browser without WebP encoding hands back.
    expect(
      readWebpDimensions(
        Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(40),
        ]),
      ),
    ).toBeNull()
    // The right container, a chunk nothing encodes.
    expect(readWebpDimensions(container('ANIM', Buffer.alloc(20)))).toBeNull()
    // Truncated before the header is complete.
    expect(readWebpDimensions(lossy(640, 360).subarray(0, 24))).toBeNull()
  })

  test('refuses a key frame without the sync code', () => {
    const broken = lossy(640, 360)
    broken[24] = 0x00
    expect(readWebpDimensions(broken)).toBeNull()
  })
})

describe('previewFreshnessLabel', () => {
  const now = new Date('2026-07-28T12:00:00.000Z')

  test('stays coarse, because previews only refresh every two minutes', () => {
    expect(previewFreshnessLabel(new Date('2026-07-28T11:59:31.000Z'), now)).toBe(
      'Preview just now',
    )
    expect(previewFreshnessLabel(new Date('2026-07-28T11:58:50.000Z'), now)).toBe(
      'Preview 1 minute ago',
    )
    expect(previewFreshnessLabel(new Date('2026-07-28T11:56:00.000Z'), now)).toBe(
      'Preview 4 minutes ago',
    )
  })

  test('says so when a stream has not uploaded one yet', () => {
    expect(previewFreshnessLabel(null, now)).toBe('No preview yet')
  })

  test('never reads as being in the future', () => {
    expect(previewFreshnessLabel(new Date('2026-07-28T12:00:30.000Z'), now)).toBe(
      'Preview just now',
    )
  })
})

describe('watcherAccessibleLabel', () => {
  const watcher = (accountId: string, displayName: string) => ({
    accountId,
    displayName,
    avatarUrl: null,
  })

  test('names every visible watcher and states the bounded total', () => {
    expect(
      watcherAccessibleLabel(
        [watcher('ada', 'Ada'), watcher('bea', 'Bea'), watcher('cy', 'Cy')],
        5,
      ),
    ).toBe('Watched by Ada, Bea, Cy and 2 more; 5 watchers total')
  })

  test('has truthful singular and empty names', () => {
    expect(watcherAccessibleLabel([watcher('ada', 'Ada')], 1)).toBe(
      'Watched by Ada; 1 watcher total',
    )
    expect(watcherAccessibleLabel([], 0)).toBe('No watchers')
  })
})
