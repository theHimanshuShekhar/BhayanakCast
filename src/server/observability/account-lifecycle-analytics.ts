export const ACCOUNT_LIFECYCLE_ANALYTICS_INVENTORY = {
  version: 1,
  events: {
    account_deletion_requested: [],
    account_deletion_cancelled: [],
    admin_deletion_approved: [],
    admin_deletion_rejected: [],
  },
} as const

export type AccountLifecycleEventName =
  keyof typeof ACCOUNT_LIFECYCLE_ANALYTICS_INVENTORY.events

export interface AccountLifecycleAnalytics {
  record(event: AccountLifecycleEventName, discordId: string): void
  forget(discordId: string): Promise<void>
}

export function createAccountLifecycleAnalytics(
  environment: NodeJS.ProcessEnv,
): AccountLifecycleAnalytics {
  const host = environment.POSTHOG_HOST?.trim()
  const projectApiKey = environment.POSTHOG_PROJECT_API_KEY?.trim()
  const projectId = environment.POSTHOG_PROJECT_ID?.trim()
  const personalApiKey = environment.POSTHOG_PERSONAL_API_KEY?.trim()
  const hasAnyCredentials = Boolean(projectApiKey || projectId || personalApiKey)
  const hasAllCredentials = Boolean(projectApiKey && projectId && personalApiKey)
  if (
    environment.NODE_ENV === 'production' &&
    hasAnyCredentials &&
    (!host || !hasAllCredentials)
  ) {
    throw new Error('PostHog Account lifecycle analytics is not configured')
  }
  return {
    record(event, discordId) {
      if (!Object.hasOwn(ACCOUNT_LIFECYCLE_ANALYTICS_INVENTORY.events, event)) {
        throw new TypeError('Event is not in the Account lifecycle analytics inventory')
      }
      if (!/^\d{17,20}$/.test(discordId)) {
        throw new TypeError('Account lifecycle analytics requires a Discord identity')
      }
      if (!host || !projectApiKey) return
      void fetch(`${host.replace(/\/$/, '')}/capture/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: projectApiKey,
          event,
          properties: {
            distinct_id: discordId,
            inventory_version: ACCOUNT_LIFECYCLE_ANALYTICS_INVENTORY.version,
          },
        }),
      }).catch(() => {
        console.warn(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            event: 'account_lifecycle_analytics_delivery_failed',
          }),
        )
      })
    },
    async forget(discordId) {
      if (!/^\d{17,20}$/.test(discordId)) {
        throw new TypeError('Account lifecycle analytics requires a Discord identity')
      }
      if (!host || !projectId || !personalApiKey) return
      const baseUrl = host.replace(/\/$/, '')
      const personResponse = await fetch(
        `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/persons/?distinct_id=${encodeURIComponent(discordId)}`,
        { headers: { authorization: `Bearer ${personalApiKey}` } },
      )
      if (!personResponse.ok) throw new Error('PostHog person lookup failed')
      const body = (await personResponse.json()) as {
        readonly results?: readonly {
          readonly id?: unknown
          readonly uuid?: unknown
        }[]
      }
      const person = body.results?.[0]
      const personId =
        typeof person?.uuid === 'string'
          ? person.uuid
          : typeof person?.id === 'string'
            ? person.id
            : null
      if (!personId) return
      const deleteResponse = await fetch(
        `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/persons/${encodeURIComponent(personId)}/?delete_events=false`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${personalApiKey}` },
        },
      )
      if (!deleteResponse.ok) throw new Error('PostHog person deletion failed')
    },
  }
}
