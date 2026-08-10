import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createRsbuild } from '@rsbuild/core'
import rsbuildConfig from '../rsbuild.config'
import {
  attachSocketServer,
  bindServerRuntime,
  createServerRuntime,
  parseTrustedProxyIps,
  resolveTrustedClientIp,
} from '../src/server'
import { handleStreamPreviewRequest } from '../src/server/streams/preview-http'

const rsbuild = await createRsbuild({ config: rsbuildConfig })
const dev = await rsbuild.createDevServer()
const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? dev.port)
const runtime = createServerRuntime(process.env)
await runtime.migrate()
const trustedProxyIps = parseTrustedProxyIps(process.env.TRUSTED_PROXY_IPS)

const server = createServer(async (request, response) => {
  const headers = new Headers()
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headers.append(request.rawHeaders[index]!, request.rawHeaders[index + 1]!)
  }
  const clientIp = resolveTrustedClientIp(
    { directIp: request.socket.remoteAddress, headers },
    { trustedProxyIps },
  )
  delete request.headers['x-bhayanakcast-client-ip']
  if (clientIp) request.headers['x-bhayanakcast-client-ip'] = clientIp

  const requestUrl = new URL(
    request.url ?? '/',
    `http://${request.headers.host ?? `${host}:${port}`}`,
  )
  // The dev bundle can load its own copy of the route module. Handle preview
  // traffic on this serving instance so it uses the runtime bound below.
  if (
    requestUrl.pathname === '/api/stream-previews' ||
    requestUrl.pathname.startsWith('/api/stream-previews/') ||
    requestUrl.pathname === '/api/past-stream-previews' ||
    requestUrl.pathname.startsWith('/api/past-stream-previews/')
  ) {
    const previewRequestInit: RequestInit & { duplex?: 'half' } = {
      method: request.method ?? 'GET',
      headers,
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      previewRequestInit.body = Readable.toWeb(request) as ReadableStream<Uint8Array>
      previewRequestInit.duplex = 'half'
    }
    const previewResponse = await handleStreamPreviewRequest(
      new Request(requestUrl, previewRequestInit),
    )
    if (previewResponse) {
      const responseHeaders = Object.fromEntries(previewResponse.headers.entries())
      response.writeHead(previewResponse.status, responseHeaders)
      response.end(Buffer.from(await previewResponse.arrayBuffer()))
      return
    }
  }

  dev.middlewares(request, response, (error?: unknown) => {
    if (error) {
      console.error(error)
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Internal Server Error')
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Page not found')
  })
})
bindServerRuntime(runtime, server)
const sockets = attachSocketServer(server, runtime.getDatabasePool())
dev.connectWebSocket({ server })
server.listen(port, host, async () => {
  await dev.afterListen()
  console.log(`BhayanakCast development server on http://${host}:${port}`)
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
