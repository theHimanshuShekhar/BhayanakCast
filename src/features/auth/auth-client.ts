import { createAuthClient } from 'better-auth/react'

export interface SessionProjection {
  id: string
  displayName: string
  avatar: string | null
  isPlatformAdmin: boolean
  expiresAt: Date
}

interface SessionProjectionResponse {
  id: string
  displayName: string
  avatar: string | null
  isPlatformAdmin: boolean
  expiresAt: string
}

export const authClient = createAuthClient({ basePath: '/api/auth' })

export async function fetchSessionProjection(): Promise<SessionProjection | null> {
  const response = await fetch('/api/session', {
    method: 'GET',
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error(`Unable to read session (${response.status})`)
  }

  const session = (await response.json()) as SessionProjectionResponse | null
  if (session === null) return null

  return {
    id: session.id,
    displayName: session.displayName,
    avatar: session.avatar,
    isPlatformAdmin: session.isPlatformAdmin,
    expiresAt: new Date(session.expiresAt),
  }
}
