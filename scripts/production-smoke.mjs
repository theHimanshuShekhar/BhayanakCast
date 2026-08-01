import { setTimeout as delay } from 'node:timers/promises'

const input = process.argv[2]
if (!input) throw new Error('Usage: node scripts/production-smoke.mjs ORIGIN')
const origin = new URL(input)
if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('ORIGIN must use HTTP or HTTPS')

const health = await fetch(new URL('/health/ready', origin), { redirect: 'error' })
if (!health.ok) throw new Error(`readiness failed with HTTP ${health.status}`)
const healthBody = await health.json()
if (healthBody.status !== 'ready') throw new Error(`unexpected readiness state: ${healthBody.status}`)

const home = await fetch(origin, { redirect: 'follow' })
if (!home.ok) throw new Error(`application HTTP failed with ${home.status}`)
if (new URL(home.url).origin !== origin.origin) {
  throw new Error(`public request escaped the configured origin to ${home.url}`)
}
if (!(await home.text()).includes('BhayanakCast')) throw new Error('application HTML marker missing')

const polling = await fetch(new URL('/socket.io/?EIO=4&transport=polling&t=production-smoke', origin))
if (!polling.ok || !/^0\{.*"sid"/.test(await polling.text())) {
  throw new Error('Socket.IO polling handshake failed')
}

const websocketUrl = new URL('/socket.io/?EIO=4&transport=websocket', origin)
websocketUrl.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:'
const socket = new WebSocket(websocketUrl)
const websocketResult = new Promise((resolve, reject) => {
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string' && event.data.startsWith('0{')) resolve()
    else reject(new Error('Socket.IO WebSocket returned an unexpected handshake'))
  }, { once: true })
  socket.addEventListener('error', () => reject(new Error('Socket.IO WebSocket upgrade failed')), { once: true })
})
await Promise.race([
  websocketResult,
  delay(5_000).then(() => { throw new Error('Socket.IO WebSocket upgrade timed out') }),
])
socket.close()

if (process.env.TUNNEL_READY_URL) {
  const tunnel = await fetch(process.env.TUNNEL_READY_URL)
  if (!tunnel.ok) throw new Error(`cloudflared readiness failed with HTTP ${tunnel.status}`)
}

console.log(JSON.stringify({
  checked_at: new Date().toISOString(),
  origin: origin.origin,
  http: 'ok',
  websocket: 'ok',
  tunnel: process.env.TUNNEL_READY_URL ? 'ok' : 'not-requested',
}))
