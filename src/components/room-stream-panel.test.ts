import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('room stream panel source', () => {
  test('renders the central room mosaic surface', () => {
    const source = readFileSync(
      new URL('./room-stream-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('room-view')
    expect(source).toContain('mosaic')
    expect(source).toContain('tile')
  })

  test('names required mosaic tile states', () => {
    const source = readFileSync(
      new URL('./room-stream-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('tile-subscribed')
    expect(source).toContain('tile-preview')
    expect(source).toContain('viewer-tile')
  })

  test('keeps watch controls on the stream tile with retry', () => {
    const source = readFileSync(
      new URL('./room-stream-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('Stop Watching')
    expect(source).toContain('Retry')
    expect(source).toContain('watchError')
  })

  test('uses documented watch protocol and retry budget', () => {
    const source = readFileSync(
      new URL('./room-stream-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('watch:start')
    expect(source).toContain('watch:stop')
    expect(source).toContain('WATCH_RETRY_ATTEMPTS = 3')
    expect(source).toContain('WATCH_RETRY_WINDOW_MS = 15_000')
    expect(source).toContain('CONNECTION_FAILED')
  })

  test('uses socket thumbnail protocol instead of HTTP upload', () => {
    const source = readFileSync(
      new URL('./room-stream-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('stream:thumbnail')
    expect(source).toContain('byteLength')
    expect(source).not.toContain('/api/streams/')
  })

  test('tracks multiple available stream targets', () => {
    const source = readFileSync(
      new URL('./room-stream-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('watchTargets')
    expect(source).toContain('const previewTargets = watchTargets')
    expect(source).not.toContain('const watchTarget')
  })

  test('keeps only stream controls visible in the room panel', () => {
    const source = readFileSync(
      new URL('./room-stream-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('View Stream')
    expect(source).toContain('Mute')
    expect(source).not.toContain('Pin tile')
    expect(source).not.toContain('Report stream')
  })


  test('keeps idle member tiles compact and readable', () => {
    const source = readFileSync(
      new URL('./room-stream-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('friendlyName')
    expect(source).toContain("gridAutoRows: 'minmax(220px, 320px)'")
    expect(source).toContain('streamer-control-button')
  })


})
