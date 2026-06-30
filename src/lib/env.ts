import { z } from 'zod'

const nonEmpty = z.string().trim().min(1)

const serverEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: nonEmpty,
  VALKEY_URL: nonEmpty,
  BETTER_AUTH_URL: nonEmpty.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  DISCORD_CLIENT_ID: nonEmpty,
  DISCORD_CLIENT_SECRET: nonEmpty,
  ADMIN_DISCORD_IDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  LOG_LEVEL: z.enum(['silent', 'error', 'info', 'debug']).default('info'),
  CLOUDFLARED_PUBLIC_URL: z
    .string()
    .trim()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((value) => value || undefined),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

export function readServerEnv(
  source: NodeJS.ProcessEnv = process.env,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source)

  if (!result.success) {
    const names = result.error.issues
      .map((issue) => issue.path.join('.'))
      .join(', ')
    throw new Error(`Invalid server environment: ${names}`)
  }

  return result.data
}
