export const devUser = {
  id: 'dev-user',
  name: 'Dev User',
  email: 'dev-user@bhayanakcast.local',
  emailVerified: true,
} as const

export function assertDevAuthEnabled(nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv !== 'development') {
    throw new Error(
      'Dev auth dummy user is only available in development runtime',
    )
  }
}
