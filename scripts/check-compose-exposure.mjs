import { execFileSync } from 'node:child_process'

const environment = {
  ...process.env,
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'exposure-check-only',
  CLOUDFLARED_TUNNEL_TOKEN: process.env.CLOUDFLARED_TUNNEL_TOKEN || 'exposure-check-only',
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'https://exposure-check.invalid',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'exposure-check-only-exposure-check-only',
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || 'exposure-check-only',
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || 'exposure-check-only',
  CLOUDFLARED_PUBLIC_URL: process.env.CLOUDFLARED_PUBLIC_URL || 'https://exposure-check.invalid',
}
const configured = JSON.parse(execFileSync('docker', ['compose', 'config', '--format', 'json'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  env: environment,
}))
const services = configured.services
const joins = (service, network) => Object.hasOwn(service.networks ?? {}, network)
for (const name of ['app', 'postgres', 'valkey', 'cloudflared']) {
  if (!services[name]) throw new Error(`missing production service: ${name}`)
}
for (const name of ['app', 'postgres', 'valkey', 'cloudflared']) {
  if ((services[name].ports ?? []).length !== 0) throw new Error(`${name} publishes a host port`)
}
for (const name of ['postgres', 'valkey']) {
  if (joins(services[name], 'edge')) throw new Error(`${name} is attached to the tunnel edge network`)
  if (!joins(services[name], 'data')) throw new Error(`${name} is missing the private data network`)
}
if (!['edge', 'data', 'analytics'].every((network) => joins(services.app, network))) {
  throw new Error('app does not bridge the three explicit private topology boundaries')
}
if (!joins(services.cloudflared, 'edge') || Object.keys(services.cloudflared.networks).length !== 1) {
  throw new Error('cloudflared can reach a network other than the application edge')
}
if (configured.networks?.data?.internal !== true) throw new Error('data network is not internal')
console.log(JSON.stringify({ checked_at: new Date().toISOString(), exposure: 'private' }))
