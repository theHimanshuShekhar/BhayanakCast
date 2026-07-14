import { createServer } from 'node:http'
import { createRsbuild } from '@rsbuild/core'
import rsbuildConfig from '../rsbuild.config'
import { attachSocketServer } from '../src/server'

const rsbuild = await createRsbuild({ config: rsbuildConfig })
const dev = await rsbuild.createDevServer()
const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? dev.port)

const server = createServer((request, response) => {
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

const sockets = attachSocketServer(server)
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
    clearTimeout(deadline)
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
