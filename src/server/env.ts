import { z } from "zod";
import { isTrustedProxyEntry } from "./client-ip.ts";

/**
 * Server environment, validated once at startup.
 *
 * In production a missing or malformed variable throws immediately (fail fast), and so does
 * an unset or unknown NODE_ENV: only an explicit `development` or `test` relaxes the checks.
 * There, missing values fall back to harmless placeholders so the app and unit tests can boot
 * without a full `.env`.
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
  /** With the analytics token: the admin dashboard's account-wide TURN usage panel. */
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  /** A read-only Analytics token, not the TURN API token. */
  CLOUDFLARE_ANALYTICS_API_TOKEN: z.string().optional(),
  /**
   * Peers (IPs or CIDR ranges, comma-separated) whose `cf-connecting-ip` header is trusted: the
   * shared cloudflared host (ADR 9). For anyone else the socket address is the client IP.
   */
  TRUSTED_PROXY_IPS: commaList.refine((entries) => entries.every(isTrustedProxyEntry), {
    error: "must be comma-separated IP addresses or CIDR ranges",
  }),
  /** Open anonymous (lobby-only) realtime sockets allowed per client IP (ADR 20). */
  REALTIME_ANONYMOUS_SOCKETS_PER_IP: z.coerce.number().int().positive().default(20),
  /** Open realtime sockets allowed per signed-in user: their tabs and devices (ADR 4 addendum). */
  REALTIME_SOCKETS_PER_USER: z.coerce.number().int().positive().default(10),
  /**
   * How long an empty room waits before it ends, in ms (ADR 14: 5 minutes, the default). Only
   * e2e runs shorten it, so a test can watch a room end.
   */
  REALTIME_EMPTY_ROOM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  /** `1` enables the test-only sign-in outside tests (e2e). See `isTestSignInEnabled`. */
  E2E_AUTH: z.string().optional(),
});

const prodSchema = baseSchema.extend({
  // Unset, empty and unknown values all land here, so only `production` itself passes.
  NODE_ENV: z
    .literal("production", {
      error: 'must be "production", or "development" or "test" for local runs',
    })
    .default("production"),
  // Fail fast: the test-only sign-in must never be reachable in production.
  E2E_AUTH: z.never({ error: "must not be set in production" }).optional(),
  // Without it every tunnelled visitor shares the cloudflared host's IP for rate limits.
  TRUSTED_PROXY_IPS: baseSchema.shape.TRUSTED_PROXY_IPS.refine((entries) => entries.length > 0, {
    error: "is required in production: the cloudflared host's IP (see docs/deploy.md)",
  }),
});

const devSchema = baseSchema.extend({
  // Always present: `parseEnv` picks this schema only for an explicit development or test.
  NODE_ENV: z.enum(["development", "test"]),
  DATABASE_URL: z.url().default("postgres://postgres:postgres@localhost:5432/bhayanakcast"),
  BETTER_AUTH_SECRET: z.string().default("dev-only-insecure-secret-change-me-0123456789"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  DISCORD_CLIENT_ID: z.string().default("dev-discord-client-id"),
  DISCORD_CLIENT_SECRET: z.string().default("dev-discord-client-secret"),
});

export type Env = z.infer<typeof baseSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  // Fail closed: only an explicit development or test gets the placeholders and the test-only
  // sign-in. Unset, empty or unknown is validated as production, so a deploy that loses
  // NODE_ENV fails startup instead of quietly dropping every production guard.
  const isLocal = source.NODE_ENV === "development" || source.NODE_ENV === "test";
  // An empty value counts as unset: docker-compose.yml passes every variable through as
  // `${NAME:-}`, so an unset one arrives as "".
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = (isLocal ? devSchema : prodSchema).safeParse(present);
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
  if (source.NODE_ENV === "test") return true;
  return source.NODE_ENV === "development" && source.E2E_AUTH === "1";
}

/** Discord user IDs that are granted the admin role at sign-in (ADR 6 addendum). */
export const adminDiscordIds: ReadonlySet<string> = new Set(env.ADMIN_DISCORD_IDS);
