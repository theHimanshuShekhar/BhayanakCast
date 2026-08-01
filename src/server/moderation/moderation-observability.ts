import { getRequest } from '@tanstack/react-start/server'
import { getProductionAuth, readAnalyticsDiscordId } from '../auth/auth'
import {
  createModerationAnalytics,
  createModerationPostHogAdapter,
  type ModerationAnalytics,
  type ModerationAnalyticsEvent,
} from '../observability/moderation-analytics'

const MODERATION_ANALYTICS_RUNTIME_KEY = Symbol.for(
  'bhayanakcast.moderation-analytics-runtime',
)

interface ModerationAnalyticsRuntime {
  analytics: ModerationAnalytics
}

function runtime(): ModerationAnalyticsRuntime {
  const shared = globalThis as typeof globalThis & {
    [MODERATION_ANALYTICS_RUNTIME_KEY]?: ModerationAnalyticsRuntime
  }
  return (shared[MODERATION_ANALYTICS_RUNTIME_KEY] ??= {
    analytics: createModerationAnalytics({ sink: null }),
  })
}

export function bindModerationAnalytics(environment: NodeJS.ProcessEnv) {
  const host = environment.POSTHOG_HOST?.trim()
  const projectApiKey = environment.POSTHOG_PROJECT_API_KEY?.trim()
  runtime().analytics = createModerationAnalytics({
    sink:
      host && projectApiKey
        ? createModerationPostHogAdapter({ host, projectApiKey })
        : null,
  })
}

export async function recordModerationInteraction(event: ModerationAnalyticsEvent) {
  let discordId: string | null = null
  try {
    discordId = await readAnalyticsDiscordId(
      getProductionAuth(),
      getRequest().headers,
    )
  } catch {
    // Analytics failure must never block report review.
  }
  runtime().analytics.record(event, discordId)
}
