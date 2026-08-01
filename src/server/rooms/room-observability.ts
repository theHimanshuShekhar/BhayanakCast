import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getProductionAuth, readAnalyticsDiscordId } from '../auth/auth'
import {
  createRoomAnalytics,
  createRoomPostHogAdapter,
  validateRoomAnalyticsEnvelope,
  type RoomAnalytics,
} from '../observability/room-analytics'

const ROOM_ANALYTICS_RUNTIME_KEY = Symbol.for('bhayanakcast.room-analytics-runtime')

interface RoomAnalyticsRuntime {
  analytics: RoomAnalytics
}

function runtime(): RoomAnalyticsRuntime {
  const shared = globalThis as typeof globalThis & {
    [ROOM_ANALYTICS_RUNTIME_KEY]?: RoomAnalyticsRuntime
  }
  return (shared[ROOM_ANALYTICS_RUNTIME_KEY] ??= {
    analytics: createRoomAnalytics({ sink: null }),
  })
}

export function bindRoomAnalytics(environment: NodeJS.ProcessEnv) {
  const host = environment.POSTHOG_HOST?.trim()
  const projectApiKey = environment.POSTHOG_PROJECT_API_KEY?.trim()
  runtime().analytics = createRoomAnalytics({
    sink:
      host && projectApiKey
        ? createRoomPostHogAdapter({ host, projectApiKey })
        : null,
  })
}

export const captureRoomInteraction = createServerFn({ method: 'POST' })
  .validator(validateRoomAnalyticsEnvelope)
  .handler(async ({ data }) => {
    let discordId: string | null = null
    try {
      discordId = await readAnalyticsDiscordId(
        getProductionAuth(),
        getRequest().headers,
      )
    } catch {
      // Analytics identity failure must not enter the Room interaction path.
    }
    runtime().analytics.record(data, discordId)
    return { accepted: true as const }
  })
