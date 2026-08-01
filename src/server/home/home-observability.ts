import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getProductionAuth, readAnalyticsDiscordId } from '../auth/auth'
import {
  createHomeAnalytics,
  createPostHogAdapter,
  validateHomeAnalyticsEnvelope,
  type HomeAnalytics,
} from '../observability/home-analytics'

const HOME_ANALYTICS_RUNTIME_KEY = Symbol.for('bhayanakcast.home-analytics-runtime')

interface HomeAnalyticsRuntime {
  analytics: HomeAnalytics
}

function runtime(): HomeAnalyticsRuntime {
  const shared = globalThis as typeof globalThis & {
    [HOME_ANALYTICS_RUNTIME_KEY]?: HomeAnalyticsRuntime
  }
  return (shared[HOME_ANALYTICS_RUNTIME_KEY] ??= {
    analytics: createHomeAnalytics({ sink: null }),
  })
}

export function bindHomeAnalytics(environment: NodeJS.ProcessEnv) {
  const host = environment.POSTHOG_HOST?.trim()
  const projectApiKey = environment.POSTHOG_PROJECT_API_KEY?.trim()
  runtime().analytics = createHomeAnalytics({
    sink:
      host && projectApiKey
        ? createPostHogAdapter({ host, projectApiKey })
        : null,
  })
}

export const captureHomeInteraction = createServerFn({ method: 'POST' })
  .validator(validateHomeAnalyticsEnvelope)
  .handler(async ({ data }) => {
    runtime().analytics.record(data, await analyticsIdentity())
    return { accepted: true as const }
  })

async function analyticsIdentity() {
  try {
    return await readAnalyticsDiscordId(
      getProductionAuth(),
      getRequest().headers,
    )
  } catch {
    return null
  }
}

