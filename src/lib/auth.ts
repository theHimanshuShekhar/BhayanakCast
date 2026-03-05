import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";
import { db } from "#/db/index";
import * as schema from "#/db/schema";
import { users } from "#/db/schema";

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
			// Map Discord profile to user data
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
	// Update user profile from Discord on every sign in
	events: {
		signIn: async (ctx: {
			user: { id: string };
			account?: { providerId: string; accessToken?: string } | null;
		}) => {
			const { user, account } = ctx;

			// Only update for Discord OAuth
			if (account?.providerId === "discord" && account.accessToken) {
				try {
					// Fetch fresh Discord data
					const response = await fetch("https://discord.com/api/users/@me", {
						headers: {
							Authorization: `Bearer ${account.accessToken}`,
						},
					});
					const profile = await response.json();

					// Update user with latest Discord data
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
