import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db/index";
import * as schema from "#/db/schema";

const isDev = process.env.NODE_ENV === "development";

// Debug logging for Discord OAuth configuration
console.log(
	"[Auth] Discord Client ID:",
	process.env.DISCORD_CLIENT_ID ? "Set" : "Not set",
);
console.log(
	"[Auth] Discord Client Secret:",
	process.env.DISCORD_CLIENT_SECRET ? "Set" : "Not set",
);
console.log("[Auth] Environment:", process.env.NODE_ENV);

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		usePlural: true,
		schema,
	}),
	emailAndPassword: {
		enabled: isDev,
	},
	socialProviders: {
		discord: {
			clientId: process.env.DISCORD_CLIENT_ID as string,
			clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
		},
	},
	plugins: [tanstackStartCookies()],
});
