import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";
import { db } from "#/db/index";
import * as schema from "#/db/schema";
import { users } from "#/db/schema";

const isTestEnv = process.env.NODE_ENV === "test";
const isDevEnv = process.env.NODE_ENV === "development";
const isEmailAuthEnabled = isTestEnv || isDevEnv;

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		usePlural: true,
		schema,
	}),
	socialProviders: {
		discord: {
			clientId: process.env.DISCORD_CLIENT_ID as string,
			clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
			getUserInfo: async (tokens) => {
				const response = await fetch("https://discord.com/api/users/@me", {
					headers: {
						Authorization: `Bearer ${tokens.accessToken}`,
					},
				});
				const profile = await response.json();

				return {
					user: {
						id: profile.id,
						name: profile.username,
						email: profile.email,
						image: profile.avatar
							? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
							: undefined,
						emailVerified: profile.verified ?? false,
					},
					data: profile,
				};
			},
		},
	},
	// Enable email/password auth in test and dev environments only
	...(isEmailAuthEnabled && {
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			requireEmailVerification: false,
		},
	}),
	events: {
		signIn: async (ctx: {
			user: { id: string };
			account?: { providerId: string; accessToken?: string } | null;
		}) => {
			const { user, account } = ctx;

			if (account?.providerId === "discord" && account.accessToken) {
				try {
					const response = await fetch("https://discord.com/api/users/@me", {
						headers: {
							Authorization: `Bearer ${account.accessToken}`,
						},
					});
					const profile = await response.json();

					await db
						.update(users)
						.set({
							name: profile.username,
							email: profile.email,
							image: profile.avatar
								? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
								: undefined,
							emailVerified: profile.verified ?? false,
							updatedAt: new Date(),
						})
						.where(eq(users.id, user.id));
				} catch (error) {
					console.error("[Auth] Failed to refresh Discord data:", error);
				}
			}
		},
	},
	plugins: [tanstackStartCookies()],
});

export { isEmailAuthEnabled, isTestEnv };
