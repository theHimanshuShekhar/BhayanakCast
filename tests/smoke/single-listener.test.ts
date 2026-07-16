import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { request } from 'node:http'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { io, type Socket } from 'socket.io-client'

const LISTENING = /BhayanakCast listening on http:\/\/127\.0\.0\.1:(\d+)/

let server: ChildProcessWithoutNullStreams
let origin: string
let socket: Socket | undefined

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

  test('closes an upgraded Socket.IO connection during shutdown', async () => {
    socket = io(origin, { transports: ['websocket'] })
    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', resolve)
      socket!.once('connect_error', reject)
    })
    expect(socket.connected).toBe(true)
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
})
