import { isIP } from 'node:net'

const DISCORD_ID = /^\d{17,20}$/

export interface SessionProjection {
  id: string
  displayName: string
  avatar: string | null
  isPlatformAdmin: boolean
  expiresAt: Date
}

interface ProjectableSession {
  user: {
    id: string
    name: string
    image?: string | null
    [key: string]: unknown
  }
  session: {
    expiresAt: Date
    [key: string]: unknown
  }
  isPlatformAdmin: boolean
}

export function projectSession(value: ProjectableSession): SessionProjection {
  return {
    id: value.user.id,
    displayName: value.user.name,
    avatar: value.user.image ?? null,
    isPlatformAdmin: value.isPlatformAdmin,
    expiresAt: value.session.expiresAt,
  }
}

export function parseAdminDiscordIds(value: string | undefined) {
  const ids = new Set<string>()
  for (const part of value?.split(',') ?? []) {
    const id = part.trim()
    if (!id) continue
    if (!DISCORD_ID.test(id)) {
      throw new TypeError(`Invalid Discord id in ADMIN_DISCORD_IDS: ${id}`)
    }
    ids.add(id)
  }
  return (discordId: string) => ids.has(discordId)
}

export function parseTrustedProxyIps(value: string | undefined): string[] {
  return (value?.split(',') ?? [])
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizeRequiredIp)
}

interface ClientIpRequest {
  directIp: string | undefined
  headers: Headers
}

interface ClientIpPolicy {
  trustedProxyIps: readonly string[]
}

export function resolveTrustedClientIp(
  request: ClientIpRequest,
  policy: ClientIpPolicy,
): string | null {
  const directIp = normalizeIp(request.directIp)
  if (!directIp) return null

  const trustedProxyIps = new Set(policy.trustedProxyIps.map(normalizeRequiredIp))
  if (!trustedProxyIps.has(directIp)) return directIp

  const cloudflareIp = request.headers.get('cf-connecting-ip')
  return normalizeIp(cloudflareIp ?? undefined) ?? directIp
}

function normalizeRequiredIp(value: string) {
  const ip = normalizeIp(value)
  if (!ip) throw new TypeError(`Invalid trusted proxy IP: ${value}`)
  return ip
}

function normalizeIp(value: string | undefined) {
  if (!value) return null
  const normalized = value.startsWith('::ffff:') ? value.slice(7) : value
  return isIP(normalized) ? normalized : null
}
