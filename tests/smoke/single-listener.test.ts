import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { request } from 'node:http'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import { ROOM_JOIN_COMMAND } from '../../src/server/realtime/room-events'

const LISTENING = /BhayanakCast listening on http:\/\/127\.0\.0\.1:(\d+)/

let server: ChildProcessWithoutNullStreams
let origin: string
let socket: Socket | undefined
let rawSocket: WebSocket | undefined

beforeAll(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  origin = await new Promise<string>((resolve, reject) => {
    let output = ''
    const inspect = (chunk: Buffer) => {
      output += chunk.toString()
      const match = LISTENING.exec(output)
      if (match) {
        resolve(`http://127.0.0.1:${match[1]}`)
      }
    }
    server.stdout.on('data', inspect)
    server.stderr.on('data', inspect)
    server.once('exit', (code) => {
      reject(new Error(`server exited with ${code}:\n${output}`))
    })
  })
})

afterAll(async () => {
  if (!server || server.exitCode !== null) return
  server.kill('SIGTERM')
  await once(server, 'exit')
  socket?.close()
})

describe('production single listener', () => {
  test('serves Start HTML and a built client asset', async () => {
    const response = await fetch(origin)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('BhayanakCast')

    const assetPath = html.match(/(?:src|href)="(\/static\/[^\"]+|\/assets\/[^\"]+)"/)?.[1]
    expect(assetPath).toBeDefined()
    const asset = await fetch(new URL(assetPath!, origin))
    expect(asset.status).toBe(200)
    expect(await asset.text()).not.toHaveLength(0)
  })

  test('accepts a Socket.IO polling handshake', async () => {
    const response = await fetch(`${origin}/socket.io/?EIO=4&transport=polling&t=smoke`)
    const payload = await response.text()
    expect(response.status).toBe(200)
    expect(payload).toMatch(/^0\{.*"sid"/)
  })

  test('admits an anonymous upgraded Socket.IO connection without a room listener', async () => {
    socket = io(origin, { transports: ['websocket'] })
    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', resolve)
      socket!.once('connect_error', reject)
    })
    expect(socket.connected).toBe(true)

    // ADR 0108: the anonymous socket registers no room handler at all, so a
    // room command is never heard rather than being rejected. No ack comes
    // back — that silence is the guarantee.
    const acked = await new Promise<boolean>((resolve) => {
      socket!
        .timeout(1_000)
        .emit(ROOM_JOIN_COMMAND, 'smoke', (error: Error | null) => resolve(!error))
    })
    expect(acked).toBe(false)
  })

  test('lets Start own unknown routes', async () => {
    const response = await fetch(`${origin}/not-a-real-route`)
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('Page not found')
  })

  test('never serves files outside the client build', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(origin, { path: '/static/..%2f..%2f..%2fpackage.json' }, (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
      req.once('error', reject)
      req.end()
    })
    expect(status).toBe(404)
  })

  test('closes an upgraded Socket.IO transport during shutdown', async () => {
    rawSocket = new WebSocket(
      `${origin.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`,
    )
    await new Promise<void>((resolve, reject) => {
      rawSocket!.addEventListener('message', () => resolve(), { once: true })
      rawSocket!.addEventListener('error', () => reject(new Error('websocket upgrade failed')), {
        once: true,
      })
    })
    const closed = new Promise<void>((resolve) => {
      rawSocket!.addEventListener('close', () => resolve(), { once: true })
    })
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    await Promise.all([closed, exited])
    expect(rawSocket.readyState).toBe(WebSocket.CLOSED)
  })
})
