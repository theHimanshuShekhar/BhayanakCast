import { z } from "zod";

/**
 * Server environment, validated once at startup.
 *
 * In production a missing or malformed variable throws immediately (fail fast).
 * In development and tests, missing values fall back to harmless placeholders
 * so the app and unit tests can boot without a full `.env`.
 */
const commaList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  ADMIN_DISCORD_IDS: commaList,
  CLOUDFLARE_TURN_KEY_ID: z.string().optional(),
  CLOUDFLARE_TURN_API_TOKEN: z.string().optional(),
  /** `1` enables the test-only sign-in outside tests (e2e). See `isTestSignInEnabled`. */
  E2E_AUTH: z.string().optional(),
});

const prodSchema = baseSchema.extend({
  // Fail fast: the test-only sign-in must never be reachable in production.
  E2E_AUTH: z.never({ error: "must not be set in production" }).optional(),
});

const devSchema = baseSchema.extend({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.url().default("postgres://postgres:postgres@localhost:5432/bhayanakcast"),
  BETTER_AUTH_SECRET: z.string().default("dev-only-insecure-secret-change-me-0123456789"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  DISCORD_CLIENT_ID: z.string().default("dev-discord-client-id"),
  DISCORD_CLIENT_SECRET: z.string().default("dev-discord-client-secret"),
});

export type Env = z.infer<typeof baseSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const isProduction = source.NODE_ENV === "production";
  const result = (isProduction ? prodSchema : devSchema).safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env: Env = parseEnv();

/**
 * Whether the test-only sign-in endpoint exists: under Vitest, or with `E2E_AUTH=1`
 * for browser tests, and never in production.
 */
export function isTestSignInEnabled(source: Pick<Env, "NODE_ENV" | "E2E_AUTH">): boolean {
  if (source.NODE_ENV === "production") return false;
  return source.NODE_ENV === "test" || source.E2E_AUTH === "1";
}

/** Discord user IDs that are granted the admin role at sign-in (ADR 6 addendum). */
export const adminDiscordIds: ReadonlySet<string> = new Set(env.ADMIN_DISCORD_IDS);
