import { spawn } from 'node:child_process'
import { io } from 'socket.io-client'

const port = 3300
const origin = `http://127.0.0.1:${port}`
const server = spawn('pnpm', ['start'], {
  detached: true,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
server.stdout.on('data', (chunk) => {
  output += chunk.toString()
})
server.stderr.on('data', (chunk) => {
  output += chunk.toString()
})

try {
  await waitForHttp(`${origin}/api/health`)
  const home = await fetch(`${origin}/?smoke=${Date.now()}`)
  if (!home.ok) throw new Error(`home returned ${home.status}`)
  const text = await home.text()
  if (!text.includes('Active Rooms'))
    throw new Error('home did not render Active Rooms')
  await assertAssetsLoad(origin, text)
  await connectSocket(origin)
  console.log('production smoke passed')
} finally {
  process.kill(-server.pid, 'SIGTERM')
}

async function waitForHttp(url) {
  const started = Date.now()
  while (Date.now() - started < 20_000) {
    try {
      const response = await fetch(`${url}?smoke=${Date.now()}`)
      if (response.ok) return
    } catch {
      await delay(250)
    }
  }
  throw new Error(`server did not become ready:\n${output}`)
}

async function assertAssetsLoad(origin, html) {
  const assetPaths = [
    ...html.matchAll(/["'](\/assets\/[^"']+\.(?:css|js))["']/g),
  ].map((match) => match[1])
  if (assetPaths.length === 0)
    throw new Error('home did not include css/js assets')

  for (const path of assetPaths) {
    const response = await fetch(`${origin}${path}`)
    if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  }
}

function connectSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], timeout: 2_000 })
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('socket connection timed out'))
    }, 3_000)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.close()
      resolve()
    })
    socket.once('connect_error', (error) => {
      clearTimeout(timer)
      socket.close()
      reject(error)
    })
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
