import { connect } from 'node:net'

const input = process.argv[2]
if (!input) throw new Error('Usage: node scripts/check-public-exposure.mjs PUBLIC_ORIGIN')
const origin = new URL(input)
const forbiddenPorts = [5432, 6379, 8000, 8123, 9000]

for (const port of forbiddenPorts) {
  const exposed = await new Promise((resolve, reject) => {
    const socket = connect({ host: origin.hostname, port })
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 3_000)
    socket.once('connect', () => {
      clearTimeout(timeout)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', (error) => {
      clearTimeout(timeout)
      if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'].includes(error.code)) resolve(false)
      else reject(error)
    })
  })
  if (exposed) throw new Error(`public hostname accepts connections on backing-service port ${port}`)
}

console.log(JSON.stringify({
  checked_at: new Date().toISOString(),
  hostname: origin.hostname,
  closed_ports: forbiddenPorts,
}))
