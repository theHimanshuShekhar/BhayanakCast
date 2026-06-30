import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import { Server } from 'socket.io'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from '#/db'
import { middleware } from '../.output/server/index.mjs'
import { registerRealtime } from '../src/lib/realtime.ts'

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const host = process.env.HOST ?? '0.0.0.0'
const publicRoot = fileURLToPath(new URL('../.output/public', import.meta.url))
const migrationsFolder = fileURLToPath(
  new URL('../src/db/migrations', import.meta.url),
)

await migrate(db, { migrationsFolder })

const server = createServer(async (request, response) => {
  if (await serveStatic(request, response)) return
  middleware(request, response)
})

registerRealtime(new Server(server, { path: '/socket.io' }))

async function serveStatic(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false

  let pathname
  try {
    pathname = decodeURIComponent(
      new URL(request.url ?? '/', 'http://localhost').pathname,
    )
  } catch {
    response.writeHead(400).end('Bad Request')
    return true
  }

  const filePath = join(publicRoot, `.${pathname}`)
  if (
    filePath !== publicRoot.slice(0, -1) &&
    !filePath.startsWith(publicRoot + sep)
  )
    return false

  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    return false
  }

  if (!fileStat.isFile()) return false

  response.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Content-Length': fileStat.size,
    ...(pathname.startsWith('/assets/')
      ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
      : {}),
  })

  if (request.method === 'HEAD') {
    response.end()
    return true
  }

  createReadStream(filePath).pipe(response)
  return true
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.ico':
      return 'image/x-icon'
    case '.txt':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

server.listen(port, host, () => {
  console.log(`BhayanakCast listening on http://${host}:${port}`)
})
