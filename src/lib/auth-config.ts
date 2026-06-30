type AuthConfigEnv = {
  BETTER_AUTH_URL: string
  BETTER_AUTH_SECRET: string
  DISCORD_CLIENT_ID: string
  DISCORD_CLIENT_SECRET: string
}

export function buildAuthConfig(env: AuthConfigEnv) {
  return {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      discord: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
      },
    },
  }
}
