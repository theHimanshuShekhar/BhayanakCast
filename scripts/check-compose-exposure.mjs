import { execFileSync } from 'node:child_process'

const environment = {
  ...process.env,
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'exposure-check-only',
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'https://exposure-check.invalid',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'exposure-check-only-exposure-check-only',
  ENFORCEMENT_KEY_SECRET:
    process.env.ENFORCEMENT_KEY_SECRET || 'exposure-check-only-exposure-check-only',
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || 'exposure-check-only',
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || 'exposure-check-only',
}
const configured = JSON.parse(execFileSync('docker', ['compose', 'config', '--format', 'json'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  env: environment,
}))
const services = configured.services
const joins = (service, network) => Object.hasOwn(service.networks ?? {}, network)
for (const name of ['app', 'postgres', 'valkey']) {
  if (!services[name]) throw new Error(`missing production service: ${name}`)
}
if ((services.app.ports ?? []).length !== 1) {
  throw new Error('app does not publish exactly one host port')
}
for (const name of ['postgres', 'valkey']) {
  if ((services[name].ports ?? []).length !== 0) throw new Error(`${name} publishes a host port`)
}
for (const name of ['app', 'postgres', 'valkey']) {
  if (!joins(services[name], 'data')) throw new Error(`${name} is missing the private data network`)
  if (Object.keys(services[name].networks).length !== 1) {
    throw new Error(`${name} can reach a network other than data`)
  }
}
if (Object.values(configured.networks ?? {}).some((network) => network.external === true)) {
  throw new Error('production topology depends on an external Docker network')
}
if (configured.networks?.data?.internal !== true) throw new Error('data network is not internal')
console.log(JSON.stringify({ checked_at: new Date().toISOString(), exposure: 'private' }))
