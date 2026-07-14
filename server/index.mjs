import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extname, resolve, sep } from 'node:path'

const CLIENT_ROOT = resolve('dist/client')
const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 3000)
const TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

const startModule = await import('../dist/server/index.js')
const startEntry = startModule.default
if (!startEntry || typeof startEntry.fetch !== 'function') {
  throw new TypeError('The Start server bundle must export a fetch handler')
}
if (typeof startModule.attachSocketServer !== 'function') {
  throw new TypeError('The Start server bundle must export attachSocketServer')
}
if (typeof startModule.createServerRuntime !== 'function') {
  throw new TypeError('The Start server bundle must export createServerRuntime')
}
const runtime = startModule.createServerRuntime(process.env)
if (process.send && runtime.bindings.workerId) {
  process.on('message', (message) => {
    void handleRuntimeCommand(message)
  })
  process.once('disconnect', shutdown)
}

const server = createServer(async (request, response) => {
  try {
    if (await serveClientAsset(request, response)) return
    await serveStart(request, response)
  } catch (error) {
    console.error(error)
    if (response.headersSent) {
      response.destroy()
      return
    }
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Internal Server Error')
  }
})

const sockets = startModule.attachSocketServer(server)
server.listen(PORT, HOST, () => {
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : PORT
  console.log(`BhayanakCast listening on http://${HOST}:${port}`)
  process.send?.({
    type: 'runtime-ready',
    bindings: runtime.bindings,
  })
})

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  const deadline = setTimeout(() => process.exit(1), 10_000)
  deadline.unref()
  sockets.disconnectSockets(true)
  try {
    await sockets.close()
    await runtime.close()
    clearTimeout(deadline)
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

async function handleRuntimeCommand(message) {
  if (
    !message ||
    typeof message !== 'object' ||
    message.type !== 'runtime-command' ||
    typeof message.id !== 'string'
  ) {
    return
  }
  try {
    let result
    switch (message.operation) {
      case 'sql':
        result = await runtime.sql(message.text, message.values)
        break
      case 'set':
        result = await runtime.set(message.key, message.value)
        break
      case 'get':
        result = await runtime.get(message.key)
        break
      case 'advance-clock':
        result = runtime.advanceClock(message.instant)
        break
      default:
        throw new Error(`unknown runtime operation: ${message.operation}`)
    }
    process.send?.({ type: 'runtime-result', id: message.id, result })
  } catch (error) {
    process.send?.({
      type: 'runtime-result',
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function serveClientAsset(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false

  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname)
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Bad Request')
    return true
  }

  if (pathname === '/' || pathname.includes('\0')) return false
  const candidate = resolve(CLIENT_ROOT, `.${pathname}`)
  if (!candidate.startsWith(`${CLIENT_ROOT}${sep}`)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not Found')
    return true
  }

  let file
  try {
    file = await stat(candidate)
  } catch {
    return false
  }
  if (!file.isFile()) return false

  response.writeHead(200, {
    'cache-control': pathname.startsWith('/static/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate',
    'content-length': file.size,
    'content-type': TYPES.get(extname(candidate)) ?? 'application/octet-stream',
  })
  if (request.method === 'HEAD') {
    response.end()
    return true
  }
  await pipeline(createReadStream(candidate), response)
  return true
}

async function serveStart(incoming, outgoing) {
  const controller = new AbortController()
  incoming.once('aborted', () => controller.abort())
  outgoing.once('close', () => {
    if (!outgoing.writableEnded) controller.abort()
  })

  const headers = new Headers()
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
    headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1])
  }
  const host = headers.get('host') ?? 'localhost'
  const bodyless = incoming.method === 'GET' || incoming.method === 'HEAD'
  const init = {
    method: incoming.method,
    headers,
    signal: controller.signal,
    ...(bodyless
      ? {}
      : { body: Readable.toWeb(incoming), duplex: 'half' }),
  }
  const request = new Request(
    new URL(incoming.url ?? '/', `http://${host}`),
    init,
  )
  const response = await startEntry.fetch(request)

  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') outgoing.setHeader(name, value)
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length) outgoing.setHeader('set-cookie', cookies)
  outgoing.writeHead(response.status, response.statusText)

  if (!response.body || incoming.method === 'HEAD') {
    outgoing.end()
    return
  }
  await pipeline(Readable.fromWeb(response.body), outgoing)
}
