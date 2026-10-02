/**
 * Better Auth server instance (ADR 6, ADR 7): Discord-only sign-in, Drizzle
 * adapter over Postgres, admin plugin for roles/bans, built-in rate limiting.
 * Server-only — never import this from client code.
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";
import { type Db, getDb } from "../db/client.ts";
import * as schema from "../db/schema/index.ts";
import { CLIENT_IP_HEADER } from "../server/client-ip.ts";
import { adminDiscordIds, type Env, env, isTestSignInEnabled } from "../server/env.ts";
import { recordNewUser } from "../server/stats.ts";
import { describeBan } from "./ban.ts";
import { testSignIn } from "./test-sign-in.ts";

/**
 * Fields users may never change through Better Auth's own `/update-user` endpoint. `image` is
 * shown to everyone who sees the user, so only the Discord sign-in sets it (a user-chosen URL
 * would let them log their viewers' IPs). So is `name`, the display name in profiles and search:
 * it would otherwise be unbounded and could impersonate another user.
 */
const SERVER_OWNED_USER_FIELDS = ["name", "discordId", "discordUsername", "image"] as const;

/** Account-linking and session-editing endpoints the app doesn't use. */
const UNUSED_ACCOUNT_PATHS = ["/link-social", "/unlink-account", "/update-session"];

export interface AuthConfig {
  env: Pick<
    Env,
    | "NODE_ENV"
    | "BETTER_AUTH_URL"
    | "BETTER_AUTH_SECRET"
    | "DISCORD_CLIENT_ID"
    | "DISCORD_CLIENT_SECRET"
    | "E2E_AUTH"
  >;
  /** Discord user IDs granted the admin role at sign-in (ADR 6 addendum). */
  adminDiscordIds: ReadonlySet<string>;
}

export function createAuth(db: Db, config: AuthConfig) {
  const { adminDiscordIds } = config;

  async function discordIdOf(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ discordId: schema.user.discordId })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    return row?.discordId ?? null;
  }

  // A banned user's sign-in fails with BANNED_USER and this message; the Discord
  // callback carries both back to home, which shows the ban notice (./ban.ts).
  const adminPlugin = admin({ bannedUserMessage: (user) => describeBan(user) });

  return betterAuth({
    baseURL: config.env.BETTER_AUTH_URL,
    secret: config.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // Closed over HTTP only (a 404 in the router). Server-side `auth.api.*` calls skip this
    // check, so src/server/admin-users.ts still bans, unbans and sets roles, under the app's
    // rules and audit log. Taken from the plugin so an upgrade that adds an admin path is covered.
    disabledPaths: [
      ...Object.values(adminPlugin.endpoints).map((endpoint) => endpoint.path),
      ...UNUSED_ACCOUNT_PATHS,
    ],
    socialProviders: {
      discord: {
        clientId: config.env.DISCORD_CLIENT_ID,
        clientSecret: config.env.DISCORD_CLIENT_SECRET,
        // `identify` only: we never ask for the user's email.
        disableDefaultScope: true,
        scope: ["identify"],
        // Keep the Discord username/avatar current on every sign-in (ADR 7).
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({
          name: profile.global_name ?? profile.username,
          // Better Auth requires an email; without the `email` scope we store a
          // non-deliverable placeholder keyed on the stable Discord id.
          email: `${profile.id}@discord.invalid`,
          emailVerified: false,
          discordId: profile.id,
          discordUsername: profile.username,
        }),
      },
    },
    user: {
      additionalFields: {
        // `input: true` so mapProfileToUser can set them; the update hook below
        // stops users from changing them through /update-user.
        discordId: { type: "string", required: false, input: true },
        discordUsername: { type: "string", required: false, input: true },
        // Written by our own server functions, not through Better Auth.
        settings: { type: "json", required: false, input: false },
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
    },
    advanced: {
      // Better Auth only sees headers, not the socket. The production server (server.prod.ts)
      // rewrites this header to the resolved client IP before any handler runs, so it's only
      // Cloudflare's value when the request came from a trusted proxy (src/server/client-ip.ts).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const discordId = typeof user.discordId === "string" ? user.discordId : null;
            if (discordId && adminDiscordIds.has(discordId)) {
              return { data: { ...user, role: "admin" } };
            }
          },
          after: async (user) => {
            await recordNewUser(db, user.createdAt);
          },
        },
        update: {
          before: async (data, ctx) => {
            if (ctx?.path === "/update-user") {
              // Refuse, not strip: Better Auth merges the data a hook returns over the
              // original, so a field dropped from it would still be written.
              if (SERVER_OWNED_USER_FIELDS.some((field) => data[field] !== undefined)) {
                throw new APIError("FORBIDDEN", {
                  message: "Those fields come from your Discord account and can't be changed.",
                });
              }
              return;
            }
            // Roles change only through set-role, which src/server/admin-users.ts calls and
            // audits. The admin plugin's /admin/update-user takes `role` in its data too.
            if (data.role !== undefined && ctx?.path !== "/admin/set-role") {
              throw new APIError("FORBIDDEN", {
                message: "Change roles with set-role, from the admin dashboard.",
              });
            }
            // Env-listed admins can't be demoted from the UI (ADR 6 addendum).
            if (data.role !== undefined && data.role !== "admin") {
              const body = ctx?.body as { userId?: unknown } | undefined;
              const targetId = typeof body?.userId === "string" ? body.userId : null;
              const discordId = targetId ? await discordIdOf(targetId) : null;
              if (discordId && adminDiscordIds.has(discordId)) {
                throw new APIError("FORBIDDEN", {
                  message: "This admin is configured via ADMIN_DISCORD_IDS and can't be demoted.",
                });
              }
            }
          },
        },
      },
      session: {
        create: {
          // Existing users added to ADMIN_DISCORD_IDS later are promoted on their next sign-in.
          after: async (session) => {
            if (adminDiscordIds.size === 0) return;
            const discordId = await discordIdOf(session.userId);
            if (discordId && adminDiscordIds.has(discordId)) {
              await db
                .update(schema.user)
                .set({ role: "admin" })
                .where(eq(schema.user.id, session.userId));
            }
          },
        },
      },
    },
    plugins: [
      adminPlugin,
      ...(isTestSignInEnabled(config.env) ? [testSignIn(db)] : []),
      // Must stay last (Better Auth TanStack Start integration docs).
      tanstackStartCookies(),
    ],
  });
}

export const auth = createAuth(getDb(), { env, adminDiscordIds });

export type AuthSession = typeof auth.$Infer.Session;
